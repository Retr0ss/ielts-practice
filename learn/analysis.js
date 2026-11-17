(function () {
    'use strict';
    const app = window.AtlasPrivate;
    if (!app) return;
    const $ = selector => document.querySelector(selector);
    const button = $('#analyze');
    const status = $('#analysis-status');
    const provider = $('#analysis-provider');
    let providers = [];
    let selectedProvider = null;
    let currentUsage = null;
    let enabled = false;
    let busy = false;
    let generation = 0;
    let preview = null;
    let request = null;
    function signature() { return JSON.stringify([$('#note-text').value.trim(),$('#note-category').value,provider.value]); }
    function quota(value) { return value ? `今日剩余 ${value.remaining}/${value.dailyLimit} 次（UTC 零点恢复）` : ''; }
    function say(text) { status.textContent = text; }
    function updateProvider() {
        selectedProvider = provider.value;
        for (const option of provider.options) option.defaultSelected = option.value === selectedProvider;
        const entry = providers.find(item=>item.id === selectedProvider);
        enabled = Boolean(entry?.enabled);
        button.disabled = !enabled || busy;
        if (!busy) say(enabled ? `${entry.label} · ${entry.model} 已就绪 · ${quota(currentUsage)}` : `${entry?.label || '自动解析'} 尚未配置或已关闭，仍可使用基础词典和手动解析。`);
    }
    async function configure() {
        try {
            const config = await app.api('/api/analysis/config');
            providers = config.providers || [{id:'deepseek',label:'DeepSeek',model:'deepseek-flash',enabled:config.enabled}];
            const desired = selectedProvider || config.defaultProvider || 'deepseek';
            provider.replaceChildren(...providers.map(entry=>new Option(entry.label+(entry.enabled?'':'（未配置或已关闭）'),entry.id)));
            provider.value = providers.some(entry=>entry.id===desired) ? desired : providers[0].id;
            provider.disabled = false;
            currentUsage = config.usage;
            updateProvider();
        } catch (_) { say('暂时无法连接解析服务，可继续手动记录或刷新页面。'); }
    }
    function invalidate() {
        window.AtlasSentenceTools.stop();
        generation += 1;
        preview = null;
        request = null;
        $('#analysis-preview').hidden = true;
        if (busy) say('输入或解析服务已变化；正在进行的解析结果不会填入新内容。');
    }
    $('#note-text').addEventListener('input',invalidate);
    $('#note-category').addEventListener('change',invalidate);
    window.addEventListener('atlas-note-editor-changed',invalidate);
    provider.addEventListener('change',()=>{invalidate();updateProvider();});
    button.addEventListener('click', async () => {
        if (busy || !enabled) return;
        const text = $('#note-text').value.trim();
        if (!text || text.length > 4000) return say('请填写要解析的单词或句子，最长 4000 字符。');
        const source = signature();
        const epoch = ++generation;
        if (!request || request.source !== source) request = {source,id:crypto.randomUUID()};
        const operation = request;
        busy = true; button.disabled = true; button.textContent = '正在解析…';
        say('正在分析词义、语法和搭配，原文与现有解析会保留。');
        try {
            let result = await app.api('/api/analysis', {text,category:$('#note-category').value,provider:provider.value,requestId:operation.id}, {timeoutMs:55000});
            for (let poll=0; result.status === 'pending' && poll<20; poll++) {
                operation.id = result.requestId;
                await new Promise(resolve=>setTimeout(resolve,1500));
                if (epoch !== generation) return;
                result = await app.api('/api/analysis/status?id='+encodeURIComponent(operation.id));
            }
            if (epoch !== generation || source !== signature()) return;
            if (result.status === 'pending') { say('解析仍在进行，请稍后再点一次查看结果；不会重复发起模型调用。'); return; }
            if (result.status !== 'complete') { request = null; throw new Error(result.error || '解析未完成，请重试'); }
            preview = {source,analysis:result.analysis,metadata:result.metadata};
            currentUsage = result.usage;
            window.AtlasSentenceTools.render($('#analysis-preview-text'),result.analysis);
            $('#analysis-meta').textContent = `AI 生成 · ${providers.find(item=>item.id===provider.value)?.label || ''} · ${result.metadata.model} · ${new Date(result.metadata.generatedAt).toLocaleString()}${result.cached?' · 复用已有结果':''}`;
            $('#analysis-preview').hidden = false;
            say('解析完成，请核对预览再填入解析框 · '+quota(result.usage));
        } catch (error) {
            if (epoch !== generation) return;
            if (error.status) request = null;
            // Preserve the id after a transport timeout: the server may still be
            // working. A retry should retrieve that job rather than bill twice.
            say((error.name==='AbortError'?'等待超时，请稍后再点一次查看结果':error.message || '解析失败，请稍后重试')+'。原文和现有解析已保留。');
        } finally {
            busy = false; button.disabled = !enabled; button.textContent = '自动解析';
        }
    });
    function apply(append) {
        if (!preview || preview.source !== signature()) { invalidate(); say('原文已变化，请重新解析。'); return; }
        const field = $('#note-analysis');
        const next = append && field.value.trim() ? field.value.trimEnd()+'\n\n'+preview.analysis : preview.analysis;
        if (next.length > 20000) return say('解析框超过长度限制，请先精简已有内容。');
        field.value = next;
        field.dispatchEvent(new Event('input',{bubbles:true}));
        $('#analysis-preview').hidden = true;
        say('已填入解析框，可编辑后保存笔记。');
        field.focus();
    }
    $('#analysis-append').onclick = ()=>apply(true);
    $('#analysis-replace').onclick = ()=>apply(false);
    $('#analysis-discard').onclick = ()=>{ preview=null; $('#analysis-preview').hidden=true; };
    window.addEventListener('pagehide',invalidate);
    window.addEventListener('pageshow',event=>{if(event.persisted) configure();});
    configure();
})();
