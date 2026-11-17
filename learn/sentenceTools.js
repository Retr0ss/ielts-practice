(function () {
    'use strict';
    const dialog = document.querySelector('#word-dialog');
    if (!dialog) return;
    const speechStatus = document.querySelector('#speech-status');
    const stopButton = document.querySelector('#speech-stop');
    const wordAudio = document.querySelector('#word-speak');
    const supported = Boolean(window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function');
    let utterance = null;
    let activeButton = null;
    let speechEpoch = 0;
    let lookupEpoch = 0;
    let selectedWord = '';
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    function stop(message = '') {
        const wasPlaying = Boolean(utterance);
        speechEpoch += 1;
        if (activeButton) activeButton.setAttribute('aria-pressed','false');
        activeButton = null;
        utterance = null;
        stopButton.disabled = true;
        if (supported) { try { window.speechSynthesis.cancel(); } catch (_) { /* Still release UI state. */ } }
        if (message || wasPlaying) speechStatus.textContent = message || '朗读已停止。';
    }
    function speak(text, button) {
        if (!supported) { speechStatus.textContent = '此浏览器暂不支持系统朗读，请使用新版 Safari。'; return; }
        if (activeButton === button && utterance) return stop('朗读已停止。');
        if (!text.trim()) return;
        if (text.length > 2000) { speechStatus.textContent = '这段英文过长，请分成较短的例句后朗读。'; return; }
        stop();
        const epoch = speechEpoch;
        try {
            // Keep speak synchronous with the user's tap for iPhone Safari.
            // A retained reference also avoids premature utterance collection.
            utterance = new window.SpeechSynthesisUtterance(text);
            utterance.lang = 'en-GB';
            utterance.rate = 0.9;
            const voices = window.speechSynthesis.getVoices();
            const voice = voices.find(item=>/^en[-_]GB$/i.test(item.lang)) || voices.find(item=>/^en\b/i.test(item.lang));
            if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
            const finish = message => {
                if (epoch !== speechEpoch) return;
                if (activeButton) activeButton.setAttribute('aria-pressed','false');
                activeButton = null; utterance = null; stopButton.disabled = true;
                speechStatus.textContent = message;
            };
            utterance.onend = ()=>finish('朗读结束。');
            utterance.onerror = event=>finish(['canceled','interrupted'].includes(event.error) ? '朗读已停止。' : '语音播放失败，请检查设备音量、英语语音是否可用，然后重试。');
            activeButton = button;
            button.setAttribute('aria-pressed','true');
            stopButton.disabled = false;
            speechStatus.textContent = '正在朗读英文…';
            window.speechSynthesis.speak(utterance);
        } catch (_) { stop('暂时无法朗读，请检查系统英语语音后重试。'); }
    }
    async function lookup(word) {
        const epoch = ++lookupEpoch;
        if (activeButton === wordAudio) stop();
        selectedWord = word;
        document.querySelector('#word-title').textContent = word;
        document.querySelector('#word-phonetic').textContent = '';
        document.querySelector('#word-meaning').textContent = '正在查询本地词典…';
        document.querySelector('#word-source').textContent = '';
        wordAudio.disabled = !supported;
        if (!dialog.open) dialog.showModal();
        try {
            const dictionary = await window.ensureReadingDictionary();
            if (epoch !== lookupEpoch || !dialog.open) return;
            const result = dictionary.lookup(word);
            const basic = {a:'不定冠词：一个；某个。',i:'代词：我。'};
            const fallback = Object.hasOwn(basic,word.toLowerCase()) ? basic[word.toLowerCase()] : '';
            if (!result.found && fallback) {
                document.querySelector('#word-meaning').textContent = fallback;
                document.querySelector('#word-source').textContent = '基础释义 · 具体含义请结合原句判断。';
                return;
            }
            const entries = result.parts || [result];
            document.querySelector('#word-phonetic').textContent = result.phonetic || '';
            document.querySelector('#word-meaning').textContent = result.found
                ? entries.map(entry=>`${entry.term}${entry.pos ? ' · '+entry.pos : ''}\n${entry.zh || entry.en || ''}`).join('\n\n')
                : '本地词典未收录这个词，可用自动解析补充理解。';
            document.querySelector('#word-source').textContent = result.found
                ? `来源：${[...new Set(entries.map(entry=>entry.sourceLabel || '本地词典'))].join('、')} · 词典释义，请结合原句判断。` : '本次查询未调用模型服务。';
        } catch (_) {
            if (epoch === lookupEpoch && dialog.open) document.querySelector('#word-meaning').textContent = '词典暂时无法加载，请联网后重新点词。';
        }
    }
    function render(target, text) {
        if (!target) return;
        const fragment = document.createDocumentFragment();
        // Preserve punctuation, whitespace, Chinese explanations and literal
        // markup. All user/model content goes through text nodes, never HTML.
        const lines = String(text || '').split('\n');
        lines.forEach((line,index)=>{
            if (index) fragment.append(document.createTextNode('\n'));
            const row = element('span',undefined,'sentence-line');
            const spoken = (line.match(/[A-Za-z0-9][A-Za-z0-9\s.,!?;:'’"“”()\-–—…/]*[A-Za-z0-9.!?'"]|[A-Za-z]/g) || [])
                .filter(part=>/[A-Za-z]/.test(part)).map(part=>part.trim()).join('. ');
            if (spoken) {
                const play = element('button','▶ 朗读','sentence-play secondary');
                play.type = 'button'; play.disabled = !supported;
                play.setAttribute('aria-label','朗读英文：'+spoken.slice(0,80));
                play.setAttribute('aria-pressed','false');
                play.onclick = ()=>speak(spoken,play);
                row.append(play,document.createTextNode(' '));
            }
            let cursor = 0;
            for (const match of line.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)) {
                row.append(document.createTextNode(line.slice(cursor,match.index)));
                const word = element('button',match[0],'sentence-word');
                word.type = 'button'; word.setAttribute('aria-label','查看 '+match[0]+' 的词义');
                word.onclick = ()=>lookup(match[0]);
                row.append(word); cursor = match.index + match[0].length;
            }
            row.append(document.createTextNode(line.slice(cursor)));
            fragment.append(row);
        });
        target.replaceChildren(fragment);
    }
    wordAudio.onclick = ()=>speak(selectedWord,wordAudio);
    document.querySelector('#word-close').onclick = ()=>dialog.close();
    dialog.addEventListener('close',()=>{
        if (!dialog.open) { lookupEpoch += 1; if(activeButton === wordAudio)stop(); }
    });
    stopButton.onclick = ()=>stop('朗读已停止。');
    window.addEventListener('pagehide',()=>{stop('朗读已停止。');lookupEpoch+=1;if(dialog.open)dialog.close();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('朗读已停止。');});
    window.AtlasSentenceTools = Object.freeze({render,stop,speak});
    const source = document.querySelector('#note-text');
    const analysis = document.querySelector('#note-analysis');
    const analysisStudy = document.querySelector('#analysis-study');
    let sourceTimer;
    function updateSource() {
        document.querySelector('#source-study').hidden = !source.value.trim();
        render(document.querySelector('#source-sentences'),source.value);
    }
    function updateAnalysis() {
        if (analysisStudy.open) render(document.querySelector('#analysis-study-text'),analysis.value);
    }
    source.addEventListener('input',()=>{if(utterance)stop();clearTimeout(sourceTimer);sourceTimer=setTimeout(updateSource,150);});
    analysis.addEventListener('input',updateAnalysis);
    analysisStudy.addEventListener('toggle',updateAnalysis);
    window.addEventListener('atlas-note-editor-changed',()=>{clearTimeout(sourceTimer);updateSource();updateAnalysis();});
    window.addEventListener('pageshow',updateSource);
    updateSource();
    if (!supported) speechStatus.textContent = '此浏览器暂不支持系统朗读；仍可点词查看释义。';
})();
