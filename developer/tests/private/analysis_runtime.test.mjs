import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse } from '../../../cloud/node_modules/miniflare/dist/src/index.js';

const example = {kind:'sentence',meaning:'公共政策影响教育。',structure:'Public policy affects education.',components:[],grammar:[],collocations:[],examples:[{english:'Education improves lives.',chinese:'教育改善生活。'},{english:'Policies affect society.',chinese:'政策影响社会。'}],notes:[]};
const source = readFileSync(new URL('../../../cloud/analysis/service.mjs',import.meta.url),'utf8');
// Use the production service and its default global fetch in actual workerd.
// Only the remote HTTP responses are mocked, after runtime Request construction.
const entry = `
import { createAnalysisService } from './service.mjs';
const api = createAnalysisService();
export default {
    async fetch(request,env) {
        const path = new URL(request.url).pathname;
        if (path === '/constructor') {
            let rejected = false;
            try { new Request('https://api.deepseek.com/models',{redirect:'error'}); }
            catch(error) { rejected = error.name === 'TypeError'; }
            return Response.json({unsupportedModeRejected:rejected,manualMode:new Request('https://api.deepseek.com/models',{redirect:'manual'}).redirect});
        }
        const input = await request.json();
        try { return Response.json(await (path === '/check' ? api.check(env,input) : api.analyze(env,input))); }
        catch(error) { return Response.json({code:error.code,diagnostic:error.diagnostic}, {status:error.status || 500}); }
    }
}`;

test('workerd supports authenticated model checks and generation while rejecting credential redirects',async()=>{
    const requests=[];
    let redirect = false;
    const mf = new Miniflare(convertV4MiniflareOptions({
        compatibilityDate:'2026-11-01',modulesRoot:fileURLToPath(new URL('../../../cloud/analysis/',import.meta.url)),
        modules:[
            {type:'ESModule',path:fileURLToPath(new URL('../../../cloud/analysis/runtime-test-entry.mjs',import.meta.url)),contents:entry},
            {type:'ESModule',path:fileURLToPath(new URL('../../../cloud/analysis/service.mjs',import.meta.url)),contents:source}
        ],
        d1Databases:{DB:'runtime-analysis-only'},
        bindings:{DEEPSEEK_API_KEY:'runtime-only-deepseek-key',OPENAI_API_KEY:'runtime-only-openai-key'},
        outboundService:async request=>{
            const url=new URL(request.url);
            assert.ok(['api.deepseek.com','api.openai.com'].includes(url.hostname),'credentials must never reach a redirect destination');
            assert.equal(request.headers.get('Authorization'),'Bearer '+(url.hostname==='api.openai.com'?'runtime-only-openai-key':'runtime-only-deepseek-key'));
            requests.push({url:url.href,method:request.method});
            if(redirect)return new RuntimeResponse(null,{status:307,headers:{Location:'https://untrusted.test/do-not-follow'}});
            if(url.pathname.endsWith('/models'))return RuntimeResponse.json({data:[{id:url.hostname==='api.openai.com'?'gpt-5.4-mini':'deepseek-flash'}]});
            if(url.pathname==='/user/balance')return RuntimeResponse.json({is_available:true});
            const body=await request.json();
            if(url.pathname==='/chat/completions'){
                assert.equal(body.thinking.type,'disabled');
                return RuntimeResponse.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(example)}}]});
            }
            assert.equal(url.pathname,'/v1/responses');assert.equal(body.store,false);
            return RuntimeResponse.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(example)}]}]});
        }
    }));
    const call=async(path,input)=>{
        const response=await mf.dispatchFetch('https://runtime.test'+path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
        return {status:response.status,body:await response.json()};
    };
    try{
        const control=await call('/constructor');assert.equal(control.body.unsupportedModeRejected,true);assert.equal(control.body.manualMode,'manual');
        const db=await mf.getD1Database('DB');
        const migration=readFileSync(new URL('../../../cloud/migrations/0002_analysis.sql',import.meta.url),'utf8');
        for(const sql of migration.split(';').map(value=>value.trim()).filter(Boolean))await db.prepare(sql).run();
        assert.equal((await call('/check',{provider:'deepseek'})).body.ok,true);
        assert.equal((await call('/check',{provider:'openai'})).body.ok,true);
        assert.equal((await db.prepare('SELECT count(*) AS count FROM analysis_requests').first()).count,0);
        for(const provider of ['deepseek','openai']){
            const result=await call('/analyze',{provider,text:'Public policy affects education.',category:'grammar',requestId:'runtime-analysis-'+provider});
            assert.equal(result.status,200);assert.equal(result.body.status,'complete');assert.equal(result.body.metadata.provider,provider);
        }
        assert.equal((await db.prepare("SELECT count(*) AS count FROM analysis_requests WHERE status='complete'").first()).count,2);
        assert.equal(requests.length,5);
        redirect=true;
        const check=await call('/check',{provider:'deepseek'});assert.equal(check.body.code,'PROVIDER_REDIRECT');
        const generation=await call('/analyze',{provider:'deepseek',text:'Different sentence.',category:'grammar',requestId:'runtime-analysis-redirect'});
        assert.equal(generation.body.code,'PROVIDER_REDIRECT');assert.equal(generation.body.diagnostic.httpStatus,307);
        assert.equal(requests.length,7);
    }finally{await mf.dispose();}
});
