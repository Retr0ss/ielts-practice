(function (global) {
    'use strict';
    // Static/file:// edition remains usable without a cloud backend.
    if (!document.querySelector('meta[name="atlas-private"]')) return;
    const store = global.AtlasPrivateStore;
    let timer;
    let running;
    let status = '正在连接私人空间…';
    let retryDelay = 30000;
    let pageSuspended = false;
    let pageEpoch = 0;
    const requests = new Set();
    function announce(message) {
        status = message;
        document.querySelectorAll('[data-atlas-status]').forEach(node => { node.textContent = message; });
        global.dispatchEvent(new CustomEvent('atlas-private-status', { detail: message }));
    }
    async function api(path, payload) {
        const controller = new AbortController();
        requests.add(controller);
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
                method: payload === undefined ? 'GET' : 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Atlas-Request': '1' },
                body: payload === undefined ? undefined : JSON.stringify(payload) });
            const result = await response.json();
            if (response.status === 401) throw new Error('登录已过期；本地内容已保留，请重新登录');
            if (!response.ok && !(response.status === 409 && Object.hasOwn(result, 'current'))) throw new Error(result.error || '同步失败');
            return result;
        } finally { clearTimeout(timeout); requests.delete(controller); }
    }
    function schedule(delay = 800) {
        clearTimeout(timer);
        if (pageSuspended) return;
        timer = setTimeout(() => sync().catch(() => {}), delay);
    }
    async function mirrorPractice() {
        if (!global.AppData) return;
        await AppData.ready;
        const identity = await AppData.backups.getStorageIdentity();
        const previousIdentity = await store.meta('practice-storage');
        const cached = (await store.list()).filter(row => row.kind === 'practice');
        // Clearing browser learning data must never become a mass cloud delete.
        if (identity !== previousIdentity) {
            for (const row of cached.filter(row => !row.deleted && !row.conflict)) {
                const current = await AppData.practice.readForSync(row.id);
                if (!current.record) {
                    await AppData.practice.applyFromSync({ recordId: row.id, record: row.data,
                        expectedRevisions: current.revisions, operationId: crypto.randomUUID() });
                    const restored = await AppData.practice.get(row.id);
                    await store.change(row.key, latest => ({ ...latest, localHash: store.stable(restored) }));
                }
            }
            await store.setMeta('practice-storage', identity);
        }
        const records = await AppData.practice.list();
        const present = new Set();
        for (const record of records) {
            if (!record.id) continue;
            present.add(record.id);
            const key = 'practice:' + record.id;
            const row = await store.get(key);
            const fingerprint = store.stable(record);
            if (!row || row.localHash !== fingerprint) await store.local('practice', record.id, record, fingerprint);
        }
        if (previousIdentity === identity) {
            for (const row of cached) {
                if (!row.deleted && !row.conflict && row.localHash && !present.has(row.id)) await store.local('practice', row.id, null, 'null');
            }
        }
    }
    async function receive(remote) {
        const key = remote.kind + ':' + remote.id;
        const local = await store.get(key);
        if (local && local.version >= remote.version) return;
        if (local?.dirty) {
            await store.change(key, current => ({ ...current, conflict: remote }));
            return;
        }
        let localHash = remote.deleted ? 'null' : store.stable(remote.data);
        if (remote.kind === 'practice' && global.AppData) {
            const current = await AppData.practice.readForSync(remote.id);
            const actual = store.stable(current.record);
            if ((local && local.localHash && actual !== local.localHash) || (!local && current.record)) {
                await store.local('practice', remote.id, current.record, actual);
                await store.change(key, value => ({ ...value, conflict: remote }));
                return;
            }
            await AppData.practice.applyFromSync({ recordId: remote.id, record: remote.deleted ? null : remote.data,
                expectedRevisions: current.revisions, operationId: crypto.randomUUID() });
            localHash = store.stable(await AppData.practice.get(remote.id));
        }
        await store.change(key, current => {
            // A note can be edited while a network request or practice write is pending.
            if (current?.dirty || current?.operationId !== local?.operationId) return { ...current, conflict: remote };
            return { ...remote, key, dirty: false, conflict: null, localHash };
        });
    }
    async function run(epoch) {
        if (pageSuspended || epoch !== pageEpoch) return;
        announce('正在同步…');
        await api('/api/session');
        await mirrorPractice();
        if (pageSuspended || epoch !== pageEpoch) return;
        for (const row of (await store.list()).filter(row => row.dirty && !row.conflict)) {
            if (pageSuspended || epoch !== pageEpoch) return;
            const result = await api('/api/changes', { kind: row.kind, id: row.id, data: row.data, deleted: row.deleted,
                baseVersion: row.version, operationId: row.operationId });
            await store.change(row.key, current => {
                if (result.ok) return { ...current, version: result.record.version,
                    dirty: current.operationId !== row.operationId, conflict: null };
                return { ...current, conflict: result.current || { kind: row.kind, id: row.id, version: 0, data: null, deleted: true } };
            });
        }
        let more = true;
        while (more) {
            if (pageSuspended || epoch !== pageEpoch) return;
            const cursor = await store.meta('cursor') || 0;
            const result = await api('/api/changes?cursor=' + cursor);
            for (const remote of result.changes) {
                await receive(remote);
                // Cursor advances only after the individual change is durable locally.
                await store.setMeta('cursor', remote.seq);
            }
            more = result.more;
        }
        const rows = await store.list();
        const conflicts = rows.filter(row => row.conflict).length;
        const pending = rows.filter(row => row.dirty).length;
        announce(conflicts ? `${conflicts} 条内容有版本冲突，请在学习笔记中处理` : pending ? `${pending} 条内容待同步` : '已同步 · ' + new Date().toLocaleTimeString());
        global.dispatchEvent(new Event('atlas-private-updated'));
        retryDelay = 30000;
        schedule(pending && !conflicts ? 1000 : 30000);
    }
    async function sync() {
        if (pageSuspended) return;
        if (running) return running;
        if (!navigator.locks) { announce('此浏览器缺少同步锁，请更新 Safari 后使用云同步'); return; }
        const epoch = pageEpoch;
        running = navigator.locks.request('atlas-private-sync', () => run(epoch)).catch(error => {
            // A page being put into Safari's back/forward cache intentionally
            // aborts its network work. Keep every local operation pending and
            // resume on pageshow instead of treating cancellation as startup failure.
            if (pageSuspended || epoch !== pageEpoch) return;
            announce((error.name === 'AbortError' ? '连接超时' : error.message) + '；未上传内容保留在本机');
            retryDelay = Math.min(retryDelay * 2, 300000);
            schedule(retryDelay);
            throw error;
        }).finally(() => {
            running = null;
            if (!pageSuspended && epoch !== pageEpoch) schedule(0);
        });
        return running;
    }
    async function resolveConflict(key, keepLocal) {
        await navigator.locks.request('atlas-private-sync', async () => {
            const row = await store.get(key);
            if (!row?.conflict) return;
            if (keepLocal) {
                await store.change(key, current => ({ ...current, version: row.conflict.version,
                    operationId: crypto.randomUUID(), conflict: null, dirty: true }));
            } else {
                let localHash = store.stable(row.conflict.deleted ? null : row.conflict.data);
                if (row.kind === 'practice' && global.AppData) {
                    const current = await AppData.practice.readForSync(row.id);
                    await AppData.practice.applyFromSync({ recordId: row.id, record: row.conflict.deleted ? null : row.conflict.data,
                        expectedRevisions: current.revisions, operationId: crypto.randomUUID() });
                    localHash = store.stable(await AppData.practice.get(row.id));
                }
                await store.change(key, () => ({ ...row.conflict, key, dirty: false, conflict: null,
                    localHash }));
            }
        });
        schedule(0);
    }
    global.AtlasPrivate = Object.freeze({ store, api, sync, resolveConflict, getStatus: () => status,
        async saveNote(note) { await store.local('note', note.id, note); announce('已保存到本机，等待同步'); schedule(); },
        async deleteNote(id) { await store.local('note', id, null); schedule(); }
    });
    function init() {
        if (!document.querySelector('[data-atlas-status]')) {
            const bar = document.createElement('aside');
            bar.className = 'atlas-private-bar';
            const link = document.createElement('a'); link.href = '/learn/index.html'; link.textContent = '学习笔记与复习';
            const label = document.createElement('span'); label.dataset.atlasStatus = ''; label.textContent = status;
            const button = document.createElement('button'); button.type = 'button'; button.textContent = '同步'; button.onclick = () => sync().catch(() => {});
            bar.append(link, label, button); document.body.prepend(bar);
        }
        if (global.AppData) AppData.ready.then(() => {
            AppData.backups.onDataCommitted(() => schedule(1200));
        }).catch(error => announce('练习数据库不可用：' + error.message));
        global.addEventListener('online', () => schedule(0));
        global.addEventListener('pagehide', () => {
            pageSuspended = true;
            pageEpoch += 1;
            clearTimeout(timer);
            for (const controller of requests) controller.abort();
        });
        global.addEventListener('pageshow', event => {
            if (!pageSuspended && !event.persisted) return;
            pageSuspended = false;
            schedule(0);
        });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
        schedule(0);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(globalThis);
