import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './helpers/d1.mjs';
import { createAnalysisService } from '../../../cloud/analysis/service.mjs';
import worker, { sha256 } from '../../../cloud/worker.mjs';

const explanation = {kind:'sentence',meaning:'政策很重要。',structure:'Policies matter.',components:[{text:'Policies',role:'主语',explanation:'复数名词'}],grammar:[{point:'一般现在时',explanation:'陈述一般事实'}],collocations:[{expression:'public policy',meaning:'公共政策'}],examples:[{english:'Public policy affects education.',chinese:'公共政策影响教育。'},{english:'Effective policies improve public health.',chinese:'有效政策改善公共健康。'}],notes:[]};
const input = (requestId='analysis-request-0001',text='Policies matter.') => ({requestId,text,category:'grammar'});
const envFor = DB => ({DB,DEEPSEEK_API_KEY:'test-only-deepseek-key',AI_DAILY_LIMIT:'2'});
const success = () => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(explanation)}}]});
const openaiSuccess = () => Response.json({status:'completed',output:[
    {type:'reasoning',summary:[]},
    {type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(explanation)}]}
]});

test('OpenAI Responses uses its own key, endpoint, model and strict schema without provider state',async()=>{
    const DB=createDatabase();let calls=0;
    const env={...envFor(DB),OPENAI_API_KEY:'test-only-openai-key',AI_MODEL:'other-deepseek-model',AI_BASE_URL:'https://deepseek-proxy.test/v1',AI_JSON_MODE:'off'};
    const service=createAnalysisService({fetchImpl:async(url,options)=>{
        calls++;assert.equal(url,'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY);
        assert.equal(options.redirect,'error');
        const body=JSON.parse(options.body);
        assert.equal(body.model,'gpt-5.4-mini');assert.equal(body.store,false);assert.equal(body.stream,false);
        assert.equal(body.max_output_tokens,2500);assert.equal(body.reasoning.effort,'none');
        assert.equal(body.max_tokens,undefined);assert.equal(body.thinking,undefined);assert.equal(body.tools,undefined);
        assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);
        assert.equal(body.text.format.schema.additionalProperties,false);
        assert.ok(body.text.format.schema.required.includes('examples'));
        assert.equal(JSON.parse(body.input).text,'Policies matter.');
        assert.ok(!options.body.includes(env.OPENAI_API_KEY)&&!options.body.includes(env.DEEPSEEK_API_KEY));
        return openaiSuccess();
    }});
    try{
        const result=await service.analyze(env,{...input(),provider:'openai',model:'browser-cannot-override',apiKey:'ignored',baseUrl:'https://evil.test'});
        assert.equal(result.status,'complete');assert.equal(result.metadata.provider,'openai');assert.match(result.analysis,/句子成分/);
        const settings=await service.settings(env);assert.equal(settings.defaultProvider,'deepseek');
        assert.equal(settings.providers.length,2);assert.ok(settings.providers.every(p=>p.enabled));
        assert.ok(!JSON.stringify(settings).includes('test-only-'));assert.ok(!JSON.stringify(settings).includes('proxy.test'));
        await service.analyze(env,{...input('openai-cached-request'),provider:'openai'});assert.equal(calls,1);
    }finally{DB.close();}
});

test('providers isolate cached results and share a single daily allowance',async()=>{
    const DB=createDatabase();let calls=0;
    const env={...envFor(DB),OPENAI_API_KEY:'test-only-openai-key'};
    const service=createAnalysisService({fetchImpl:async url=>{calls++;return url.endsWith('/responses')?openaiSuccess():success();}});
    try{
        const deep=await service.analyze(env,input());
        const open=await service.analyze(env,{...input('openai-analysis-0001'),provider:'openai'});
        assert.equal(deep.cached,false);assert.equal(open.cached,false);assert.equal(calls,2);assert.equal(open.usage.remaining,0);
        assert.equal((await service.analyze(env,{...input('openai-analysis-cache'),provider:'openai'})).cached,true);
        assert.equal((await service.analyze(env,input('deepseek-analysis-cache'))).cached,true);
        await assert.rejects(service.analyze(env,{...input('new-openai-analysis','Other text'),provider:'openai'}),{code:'DAILY_LIMIT'});
        await assert.rejects(service.analyze(env,{...input(),provider:'openai'}),{code:'REQUEST_REUSED'});
        assert.equal(calls,2);
    }finally{DB.close();}
});

test('OpenAI failures, refusals and partial output never trigger another provider',async()=>{
    const message={type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(explanation)}]};
    for(const payload of [
        {status:'incomplete',output:[message],incomplete_details:{reason:'max_output_tokens'}},
        {status:'completed',output:[{...message,content:[{type:'refusal',refusal:'declined'}]}]},
        {status:'failed',error:{message:'internal upstream detail'},output:[message]},
        {status:'completed',output:[{...message,status:'in_progress'}]},
        {status:'completed',output:[],output_text:JSON.stringify(explanation)},
        {status:'completed',output:[{...message,content:[{type:'output_text',text:'not JSON'}]}]}
    ]){
        const DB=createDatabase();let calls=0;
        const env={...envFor(DB),OPENAI_API_KEY:'test-only-openai-key'};
        const service=createAnalysisService({fetchImpl:async url=>{calls++;assert.ok(url.endsWith('/responses'));return Response.json(payload);}});
        try{
            await assert.rejects(service.analyze(env,{...input(),provider:'openai'}),error=>[422,502].includes(error.status)&&!error.message.includes('internal upstream'));
            assert.equal(calls,1);assert.equal((await service.status(env,'analysis-request-0001')).status,'failed');
        }finally{DB.close();}
    }
});

test('missing OpenAI credentials or unknown provider cannot use the DeepSeek key',async()=>{
    const DB=createDatabase();let calls=0;
    const service=createAnalysisService({fetchImpl:async()=>{calls++;return openaiSuccess();}});
    try{
        await assert.rejects(service.analyze(envFor(DB),{...input(),provider:'openai'}),{code:'AI_NOT_CONFIGURED'});
        await assert.rejects(service.analyze(envFor(DB),{...input(),provider:'untrusted'}),{code:'INVALID_PROVIDER'});
        assert.equal(calls,0);
        const env={DB,OPENAI_API_KEY:'test-only-openai-key',OPENAI_MODEL:'gpt-custom-model'};
        const config=await service.settings(env);assert.equal(config.defaultProvider,'openai');assert.equal(config.enabled,true);
        const result=await service.analyze(env,input());assert.equal(result.metadata.provider,'openai');assert.equal(result.metadata.model,'gpt-custom-model');
        assert.equal(calls,1);
    }finally{DB.close();}
});

test('DeepSeek request is server-only, bounded, non-thinking and cached across retries/devices', async () => {
    const DB=createDatabase();let calls=0;
    const env=envFor(DB);
    const service=createAnalysisService({fetchImpl:async(url,options)=>{
        calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');
        assert.equal(options.headers.Authorization,'Bearer '+env.DEEPSEEK_API_KEY);
        const body=JSON.parse(options.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.max_tokens,2500);
        assert.equal(body.thinking.type,'disabled');assert.equal(body.response_format.type,'json_object');
        assert.ok(!options.body.includes(env.DEEPSEEK_API_KEY));assert.equal(body.tools,undefined);return success();
    }});
    try {
        const first=await service.analyze(env,input());assert.equal(first.status,'complete');assert.match(first.analysis,/句子成分/);assert.equal(first.usage.used,1);
        assert.equal((await service.analyze(env,input())).requestId,first.requestId);
        const cached=await service.analyze(env,input('analysis-other-device'));assert.equal(cached.cached,true);assert.equal(calls,1);
        assert.equal((await service.status(env,first.requestId)).status,'complete');
        assert.ok(!JSON.stringify(await service.settings(env)).includes(env.DEEPSEEK_API_KEY));
        await assert.rejects(service.analyze(env,input('analysis-request-0001','Changed text')), {code:'REQUEST_REUSED'});
    } finally {DB.close();}
});

test('quota is shared, failures count, cached responses stay available, UTC day resets',async()=>{
    const DB=createDatabase();let current=Date.parse('2026-11-17T23:59:00Z');let calls=0;
    const env=envFor(DB);
    const service=createAnalysisService({now:()=>current,fetchImpl:async()=>{calls++;return calls===2?new Response('DO NOT EXPOSE test-only-deepseek-key',{status:401}):success();}});
    try {
        await service.analyze(env,input());
        await assert.rejects(service.analyze(env,input('analysis-request-0002','Other input')),error=>error.code==='PROVIDER_AUTH'&&!error.message.includes(env.DEEPSEEK_API_KEY));
        await assert.rejects(service.analyze(env,input('analysis-request-0003','Third input')),{code:'DAILY_LIMIT'});
        assert.equal(calls,2);assert.equal((await service.analyze(env,input('analysis-cached-again'))).cached,true);
        current+=120000;
        await service.analyze(env,input('analysis-next-day-0001','Next day input'));
        assert.equal((await service.settings(env)).usage.used,1);
    }finally{DB.close();}
});

test('same-input concurrency reserves one call and pending requests can be polled',async()=>{
    const DB=createDatabase();const env=envFor(DB);let finish;let started;
    const gate=new Promise(resolve=>{started=resolve;});let calls=0;
    const service=createAnalysisService({fetchImpl:()=>{calls++;started();return new Promise(resolve=>{finish=()=>resolve(success());});}});
    try{
        const first=service.analyze(env,input());await gate;
        const other=await service.analyze(env,input('analysis-second-client'));
        assert.equal(other.status,'pending');assert.equal(other.requestId,'analysis-request-0001');
        assert.equal((await service.settings(env)).usage.used,1);assert.equal(calls,1);
        finish();await first;assert.equal((await service.status(env,other.requestId)).status,'complete');
    }finally{DB.close();}
});

test('parallel different inputs cannot exceed the daily allowance',async()=>{
    const DB=createDatabase();let calls=0;
    const service=createAnalysisService({fetchImpl:async()=>{calls++;return success();}});
    try{
        const results=await Promise.allSettled(Array.from({length:8},(_,i)=>service.analyze(envFor(DB),input('parallel-analysis-'+i,'Sentence '+i))));
        assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
        assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='DAILY_LIMIT').length,6);
        assert.equal(calls,2);assert.equal((await service.settings(envFor(DB))).usage.used,2);
    }finally{DB.close();}
});

test('simultaneous retries of one request id call the provider only once',async()=>{
    const DB=createDatabase();let calls=0;
    const service=createAnalysisService({fetchImpl:async()=>{calls++;return success();}});
    try{
        const results=await Promise.all(Array.from({length:8},()=>service.analyze(envFor(DB),input())));
        assert.equal(calls,1);assert.equal((await service.settings(envFor(DB))).usage.used,1);
        assert.ok(results.every(x=>['complete','pending'].includes(x.status)));
    }finally{DB.close();}
});

test('concurrent reuse of an id for different input cannot bill or mix results',async()=>{
    const DB=createDatabase();let calls=0;
    const service=createAnalysisService({fetchImpl:async()=>{calls++;return success();}});
    try{
        const results=await Promise.allSettled([service.analyze(envFor(DB),input()),service.analyze(envFor(DB),input('analysis-request-0001','Different sentence.'))]);
        assert.equal(calls,1);
        assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
        assert.equal(results.find(x=>x.status==='rejected').reason.code,'REQUEST_REUSED');
    }finally{DB.close();}
});

test('malformed, empty or truncated provider output is never accepted as a finished analysis',async()=>{
    for(const payload of [
        {choices:[{finish_reason:'stop',message:{content:'   '}}]},
        {choices:[{finish_reason:'length',message:{content:JSON.stringify(explanation)}}]},
        {choices:[{finish_reason:'stop',message:{content:JSON.stringify({...explanation,examples:[]})}}]},
        {choices:[{finish_reason:'stop',message:{content:'x'.repeat(129000)}}]}
    ]){
        const DB=createDatabase();const service=createAnalysisService({fetchImpl:async()=>Response.json(payload)});
        try{await assert.rejects(service.analyze(envFor(DB),input()),error=>error.status===502);assert.equal((await service.status(envFor(DB),'analysis-request-0001')).status,'failed');}
        finally{DB.close();}
    }
});

test('invalid input/unconfigured service never invokes model; expired pending jobs do not rebill silently',async()=>{
    const DB=createDatabase();let current=Date.parse('2026-11-17T10:00:00Z');let calls=0;
    const service=createAnalysisService({now:()=>current,fetchImpl:async()=>{calls++;return success();}});
    try{
        await assert.rejects(service.analyze({DB},input()),{code:'AI_NOT_CONFIGURED'});
        await assert.rejects(service.analyze(envFor(DB),input('analysis-invalid-input','x'.repeat(4001))),{code:'INVALID_INPUT'});
        await assert.rejects(service.analyze({...envFor(DB),AI_BASE_URL:'http://provider.test'},input()),{code:'AI_NOT_CONFIGURED'});
        await service.analyze(envFor(DB),input());
        await DB.prepare("UPDATE analysis_requests SET status='pending',result_json=NULL,created_ms=? WHERE request_id=?").bind(current-121000,'analysis-request-0001').run();
        const failed=await service.analyze(envFor(DB),input());assert.equal(failed.status,'failed');assert.equal(calls,1);
    }finally{DB.close();}
});

test('analysis endpoints require login and same-origin writes; missing key does not break ordinary notes',async()=>{
    const DB=createDatabase();const env={DB,OWNER_ACCESS_HASH:await sha256('owner-test'),ASSETS:{fetch:()=>new Response('ok')}};
    const call=(path,method='GET',body,cookie,origin='https://atlas.test')=>worker.fetch(new Request('https://atlas.test'+path,{method,headers:{Origin:origin,'X-Atlas-Request':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined}),env);
    try{
        assert.equal((await call('/api/analysis/config')).status,401);
        assert.equal((await call('/api/analysis','POST',input())).status,401);
        const login=await call('/api/login','POST',{accessCode:'owner-test'});const cookie=login.headers.get('set-cookie').split(';')[0];
        const config=await(await call('/api/analysis/config','GET',undefined,cookie)).json();assert.equal(config.enabled,false);
        assert.equal((await call('/api/analysis','POST',input(),cookie,'https://evil.test')).status,403);
        assert.equal((await call('/api/analysis','POST',input(),cookie)).status,503);
        assert.equal((await call('/api/changes','GET',undefined,cookie)).status,200);
    }finally{DB.close();}
});
