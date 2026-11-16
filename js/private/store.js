(function (global) {
    'use strict';
    function stable(value) {
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
        return JSON.stringify(value);
    }
    function open() {
        return new Promise((resolve, reject) => {
            const request = global.indexedDB.open('IELTSAtlasPrivateV1', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('items', { keyPath: 'key' });
                request.result.createObjectStore('meta');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    let ready;
    function database() { return ready || (ready = open()); }
    async function transaction(store, mode, work) {
        const db = await database();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode);
            let result;
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地保存失败'));
            work(tx.objectStore(store), value => { result = value; });
        });
    }
    const get = key => transaction('items', 'readonly', (store, done) => { store.get(key).onsuccess = event => done(event.target.result); });
    const list = () => transaction('items', 'readonly', (store, done) => { store.getAll().onsuccess = event => done(event.target.result); });
    function change(key, update) {
        return transaction('items', 'readwrite', (store, done) => {
            store.get(key).onsuccess = event => {
                const value = update(event.target.result);
                if (value) store.put(value);
                done(value);
            };
        });
    }
    function local(kind, id, data, localHash) {
        return change(kind + ':' + id, previous => ({ ...previous, key: kind + ':' + id, kind, id, data,
            deleted: data === null, dirty: true, version: previous?.version || 0,
            localHash: localHash === undefined ? previous?.localHash : localHash,
            operationId: crypto.randomUUID(), conflict: previous?.conflict || null }));
    }
    global.AtlasPrivateStore = Object.freeze({ stable, get, list, change, local,
        meta: key => transaction('meta', 'readonly', (store, done) => { store.get(key).onsuccess = event => done(event.target.result); }),
        setMeta: (key, value) => transaction('meta', 'readwrite', store => store.put(value, key))
    });
})(globalThis);
