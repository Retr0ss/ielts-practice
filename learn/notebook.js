(function () {
    'use strict';
    const $ = selector => document.querySelector(selector);
    const app = window.AtlasPrivate;
    if (!app) { $('#notice').textContent = '请通过私人云端服务访问此页面；静态预览不提供云同步。'; return; }
    const { store } = app;
    let editedAt = null;
    let editorOperation = null;
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const tell = message => { $('#notice').textContent = message; };
    const today = () => new Date().toLocaleDateString('en-CA');
    const noteDate = note => new Date(note.createdAt).toLocaleDateString('en-CA');
    function action(text, handler) {
        const button = element('button', text, 'secondary'); button.type = 'button';
        button.onclick = () => Promise.resolve().then(handler).catch(error => tell(error.message));
        return button;
    }
    function reset() { $('#note-form').reset(); $('#note-id').value = ''; editedAt = null; editorOperation = null; $('#editor-title').textContent = '留住一个疑问'; }
    function edit(row) {
        const note = row.data;
        $('#note-id').value = note.id; $('#note-text').value = note.text; $('#note-analysis').value = note.analysis;
        $('#note-source').value = note.source; $('#note-category').value = note.category; editedAt = note.updatedAt; editorOperation = row.operationId;
        $('#editor-title').textContent = '补充你的理解'; $('#note-text').focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    async function render() {
        const rows = await store.list();
        const filter = $('#note-filter').value;
        const search = $('#note-search').value.trim().toLowerCase();
        const notes = rows.filter(row => row.kind === 'note' && !row.deleted).sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
        const visible = notes.filter(({ data }) => (filter === 'all' || (filter === 'today' ? noteDate(data) === today() : data.status === filter))
            && [data.text, data.analysis, data.source].some(value => value.toLowerCase().includes(search)));
        $('#note-count').textContent = `共 ${notes.length} 条笔记 · 当前 ${visible.length} 条`;
        $('#notes').replaceChildren();
        if (!visible.length) $('#notes').append(element('p', '这里还没有笔记。先收集一个今天想弄懂的单词或句子。', 'empty'));
        for (const row of visible) {
            const note = row.data;
            const card = element('article', undefined, 'note-card');
            card.append(element('p', `${note.category === 'grammar' ? '语法' : '词汇'} · ${new Date(note.createdAt).toLocaleString()} · ${row.conflict ? '版本待选择' : row.dirty ? '待同步' : '已同步'}`, 'note-meta'), element('h3', note.text));
            if (note.analysis) card.append(element('p', note.analysis));
            if (note.source) card.append(element('p', '来源：' + note.source, 'note-meta'));
            const actions = element('div', undefined, 'actions');
            actions.append(action('编辑', () => edit(row)), action(note.status === 'mastered' ? '放回待复习' : '已掌握', async () => {
                await app.saveNote({ ...note, status: note.status === 'mastered' ? 'review' : 'mastered', updatedAt: new Date().toISOString() }); await render();
            }), action('删除', async () => { if (confirm('删除这条笔记？删除也会同步到其他设备。')) { await app.deleteNote(note.id); await render(); } }));
            card.append(actions); $('#notes').append(card);
        }
        const conflicts = rows.filter(row => row.conflict);
        $('#conflict-panel').hidden = !conflicts.length; $('#conflicts').replaceChildren();
        for (const row of conflicts) {
            const card = element('article', undefined, 'note-card');
            card.append(element('h3', row.data?.text || row.data?.title || row.id));
            for (const [label, value] of [['本机版本', row.deleted ? '已删除' : row.data], ['云端版本', row.conflict.deleted ? '已删除' : row.conflict.data]]) {
                const details = element('details'); details.append(element('summary', label), element('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); card.append(details);
            }
            card.append(action('保留本机版本', async () => { await app.resolveConflict(row.key, true); await render(); }), action('使用云端版本', async () => {
                if (confirm('将用云端版本替换这条本机内容。建议先导出备份。')) { await app.resolveConflict(row.key, false); await render(); }
            })); $('#conflicts').append(card);
        }
        const practice = rows.filter(row => row.kind === 'practice' && !row.deleted).sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || ''))).slice(0,20);
        $('#practice-list').replaceChildren();
        if (!practice.length) $('#practice-list').append(element('p', '完成一篇阅读后，记录会出现在这里。', 'empty'));
        for (const row of practice) {
            const record = row.data;
            const card = element('article', undefined, 'note-card'); card.append(element('h3', record.title || record.examId || record.id));
            card.append(element('p', `${record.correctAnswers ?? '—'} / ${record.totalQuestions ?? '—'} · ${record.date || ''} · ${row.dirty ? '待同步' : '已同步'}`, 'note-meta'));
            const details = element('details'); details.append(element('summary', '查看已保存作答与注释'), element('pre', JSON.stringify(record, null, 2))); card.append(details); $('#practice-list').append(card);
        }
    }
    $('#note-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
        try {
            const id = $('#note-id').value || crypto.randomUUID();
            const previous = await store.get('note:' + id);
            const now = new Date().toISOString();
            const text = $('#note-text').value.trim();
            if (!text) throw new Error('请先填写单词或原句');
            // An editor may stay open while another device changes this note.
            // Preserve the draft as a separate note instead of losing either edit.
            const changed = previous && editedAt && (previous.data?.updatedAt !== editedAt || previous.operationId !== editorOperation);
            const note = { id: changed ? crypto.randomUUID() : id, text, analysis: $('#note-analysis').value,
                source: $('#note-source').value.trim(), category: $('#note-category').value,
                createdAt: changed ? now : previous?.data?.createdAt || now, updatedAt: now,
                status: previous?.data?.status || 'review' };
            await app.saveNote(note); reset(); await render(); tell(changed ? '另一台设备已修改原笔记；你的内容已另存为新笔记。' : '已保存到本机，联网时自动同步。');
        } catch (error) { tell(error.message); }
        finally { button.disabled = false; }
    });
    $('#cancel-edit').onclick = reset;
    $('#dictionary').onclick = async () => {
        const text = $('#note-text').value.trim();
        if (!text || text.length > 100) return tell('请填写一个单词或短语；长句请使用解析提示词。');
        $('#dictionary-result').textContent = '正在查询本地词典…';
        try {
            const dictionary = await window.ensureReadingDictionary();
            const result = dictionary.lookup(text);
            const entries = result.parts || [result];
            $('#dictionary-result').textContent = result.found ? entries.map(entry => `${entry.term} ${entry.phonetic || ''}\n${entry.zh || entry.en || ''}\n来源：${entry.sourceLabel || '本地词典'}`).join('\n\n') : '本地词典未收录，可手动补充理解。';
        } catch (error) { $('#dictionary-result').textContent = error.message; }
    };
    $('#copy-prompt').onclick = async () => {
        const text = $('#note-text').value.trim();
        if (!text) return tell('先填写需要解析的单词或句子。');
        const prompt = `请用中文帮助我理解下面的英语内容，我的 IELTS 目标是 7 分以上。按适用情况说明：1.语境词义；2.句子主干与成分；3.从句、时态和非谓语结构；4.固定搭配；5.两个原创 IELTS 场景例句及翻译。孤立单词不强行分析句法，存在歧义时说明，不确定的地方明确标出。\n\n${text}`;
        try { await navigator.clipboard.writeText(prompt); tell('已复制。到 ChatGPT 粘贴解析后，把结果保存回来。'); }
        catch (_) { $('#note-analysis').value = prompt; tell('剪贴板不可用，提示词已放入解析框，可手动复制。'); }
    };
    $('#note-filter').onchange = () => render().catch(error => tell(error.message));
    $('#note-search').oninput = () => render().catch(error => tell(error.message));
    $('#sync-now').onclick = () => app.sync().then(render).catch(error => tell(error.message));
    function download(text, type, name) {
        const url = URL.createObjectURL(new Blob([text], { type })); const link = element('a');
        link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    $('#backup').onclick = async () => {
        try { const records = await store.list(); download(JSON.stringify({ format: 'ielts-atlas-private-v1', exportedAt: new Date().toISOString(), records }, null, 2), 'application/json', `atlas-backup-${today()}.json`); }
        catch (error) { tell(error.message); }
    };
    $('#restore-file').onchange = async event => {
        try {
            const file = event.target.files[0]; if (!file) return;
            if (file.size > 20 * 1024 * 1024) throw new Error('备份超过 20 MB，请分批恢复');
            const payload = JSON.parse(await file.text());
            if (payload.format !== 'ielts-atlas-private-v1' || !Array.isArray(payload.records)) throw new Error('不是 IELTS Atlas 私人备份');
            // Recovery never replays old cursors/versions or cloud deletes.
            const notes = payload.records.filter(row => row.kind === 'note' && !row.deleted);
            const practice = payload.records.filter(row => row.kind === 'practice' && !row.deleted);
            for (const row of notes) {
                const note = row.data;
                if (!note || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 20000 || typeof note.analysis !== 'string' || note.analysis.length > 20000
                    || typeof note.source !== 'string' || note.source.length > 500 || !['vocabulary','grammar'].includes(note.category) || !['review','mastered'].includes(note.status)
                    || !Number.isFinite(Date.parse(note.createdAt))) throw new Error('备份中有无效笔记，尚未开始恢复');
            }
            for (const row of practice) {
                if (!row.data || typeof row.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(row.id) || row.data.id !== row.id || JSON.stringify(row.data).length > 400000) throw new Error('备份中有无效练习记录，尚未开始恢复');
            }
            if (!confirm(`将恢复 ${notes.length} 条笔记为新副本，并恢复 ${practice.length} 条练习。相同编号的本机练习会替换；云端版本冲突仍需确认。继续？`)) return;
            for (const { data } of notes) await app.saveNote({ ...data, id: crypto.randomUUID(), updatedAt: new Date().toISOString() });
            for (const row of practice) {
                const current = await AppData.practice.readForSync(row.id);
                await AppData.practice.applyFromSync({ recordId: row.id, record: row.data, expectedRevisions: current.revisions, operationId: crypto.randomUUID() });
                const canonical = await AppData.practice.get(row.id);
                await store.local('practice', row.id, canonical, store.stable(canonical));
            }
            tell(`已恢复 ${notes.length} 条笔记副本与 ${practice.length} 条练习；如有失败可重试或查看已恢复内容。`); await render();
        } catch (error) { tell(error.message); }
        finally { event.target.value = ''; }
    };
    $('#export').onclick = async () => {
        try {
            const rows = (await store.list()).filter(row => row.kind === 'note' && !row.deleted);
            const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const text = `---\nexported: ${JSON.stringify(new Date().toISOString())}\ntags: [ielts, study-notes]\n---\n\n# IELTS 学习笔记\n\n` + rows.map(({ data: note }) => `## ${note.category === 'grammar' ? '语法' : '词汇'}\n\nID: ${note.id}\n\n创建：${note.createdAt}  \n更新：${note.updatedAt}  \n来源：${escapeHtml(note.source)}  \n状态：${note.status}\n\n${escapeHtml(note.text)}\n\n${escapeHtml(note.analysis)}\n\n^atlas-${note.id}\n`).join('\n\n');
            download(text, 'text/markdown;charset=utf-8', `IELTS-${today()}.md`); tell('已导出 Markdown。可保存到 Obsidian；每条笔记都保留稳定 ID。');
        } catch (error) { tell(error.message); }
    };
    $('#logout').onclick = async () => {
        if (!confirm('退出登录后，本机仍保留学习缓存，供离线恢复。公用设备请另行清除站点数据。继续？')) return;
        try { await app.api('/api/logout', {}); location.replace('/learn/login.html'); }
        catch (error) { tell(error.message); }
    };
    window.addEventListener('atlas-private-updated', () => render().catch(error => tell(error.message)));
    // This entry uses the shared diagnostic collector, but does not start the
    // legacy ExamSystemApp that normally calls markReady(). Complete our own
    // startup only after both databases and the first render are usable.
    async function initialize() {
        try {
            await AppData.ready;
            await render();
            window.AppDiagnostics?.markReady();
        } catch (error) {
            tell('本地数据库不可用：' + error.message);
            window.AppDiagnostics?.startupFailed(error);
        }
    }
    initialize();
})();
