import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './helpers/d1.mjs';
import worker, { sha256, writeChange } from '../../../cloud/worker.mjs';


const note = (id, text = 'A long sentence.') => ({ id, text, analysis: '', source: 'self', category: 'grammar', status: 'review', createdAt: '2026-11-16T10:00:00Z', updatedAt: '2026-11-16T10:00:00Z' });
const mutation = (id, operationId, baseVersion = 0, text) => ({ kind: 'note', id, operationId, baseVersion, deleted: false, data: note(id, text) });

test('two devices cannot overwrite a newer record; retry is idempotent; deletions are incremental', async () => {
    const db = createDatabase();
    try {
        const first = await writeChange(db, mutation('n1', 'operation-1'));
        assert.equal(first.record.version, 1);
        const retry = await writeChange(db, mutation('n1', 'operation-1'));
        assert.equal(retry.record.seq, first.record.seq);
        const second = await writeChange(db, mutation('n1', 'operation-2', 1, 'Device A edit'));
        assert.equal(second.record.version, 2);
        const stale = await writeChange(db, mutation('n1', 'operation-3', 1, 'Device B stale edit'));
        assert.equal(stale.ok, false);
        assert.equal(stale.current.data.text, 'Device A edit');
        const deleted = await writeChange(db, { kind: 'note', id: 'n1', operationId: 'operation-delete', baseVersion: 2, data: null, deleted: true });
        assert.equal(deleted.record.version, 3);
        assert.equal(deleted.record.deleted, true);
        const resurrect = await writeChange(db, mutation('n1', 'operation-old', 2));
        assert.equal(resurrect.ok, false);
        assert.equal(resurrect.current.deleted, true);
        assert.equal((await db.prepare('SELECT * FROM changes').all()).results.length, 3);
        await assert.rejects(writeChange(db, mutation('n2', 'operation-1')), { status: 409 });
    } finally { db.close(); }
});

test('invalid records are rejected before persistence', async () => {
    const db = createDatabase();
    try {
        for (const payload of [{ ...mutation('n1', 'op'), baseVersion: -1 }, { ...mutation('n1','op'), kind: 'session' }, { ...mutation('n1','op'), data: { ...note('n1'), text: 'x'.repeat(20001) } }]) {
            await assert.rejects(writeChange(db, payload), { status: 400 });
        }
        assert.equal((await db.prepare('SELECT * FROM changes').all()).results.length, 0);
    } finally { db.close(); }
});

test('private assets, CSRF, session logout, configuration failure and rotation', async () => {
    const db = createDatabase();
    const accessCode = 'test-only-random-code-never-deploy-this';
    const env = { DB: db, OWNER_ACCESS_HASH: await sha256(accessCode), ASSETS: { fetch: () => new Response('<head></head><body>bank</body>', { headers: { 'Content-Type': 'text/html' } }) } };
    const request = async (path, { method = 'GET', payload, cookie, origin = 'https://atlas.test', marker = true } = {}) => worker.fetch(new Request('https://atlas.test' + path, {
        method, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: origin, ...(marker ? { 'X-Atlas-Request': '1' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined
    }), env);
    try {
        assert.equal((await worker.fetch(new Request('https://atlas.test/assets/secret.pdf'), {})).status, 503);
        for (const path of ['/assets/generated/reading-exams/p1-high-01.js', '/assets/audio.mp3', '/api/changes', '/templates/exam.html']) {
            const response = await request(path); assert.equal(response.status, 401); assert.match(response.headers.get('Cache-Control'), /no-store/);
        }
        assert.equal((await request('/')).status, 303);
        assert.equal((await request('/learn/login.html')).status, 200);
        assert.equal((await request('/api/login', { method: 'POST', payload: { accessCode }, origin: 'https://other.test' })).status, 403);
        assert.equal((await request('/api/login', { method: 'POST', payload: { accessCode: 'wrong' } })).status, 401);
        const loggedIn = await request('/api/login', { method: 'POST', payload: { accessCode } });
        assert.equal(loggedIn.status, 200);
        const cookie = loggedIn.headers.get('Set-Cookie').split(';')[0];
        assert.match(loggedIn.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
        const page = await request('/index.html', { cookie }); assert.equal(page.status, 200); assert.match(await page.text(), /atlas-private/);
        assert.equal((await request('/api/changes', { method: 'POST', cookie, payload: mutation('n1','op'), marker: false })).status, 403);
        assert.equal((await request('/api/changes', { method: 'POST', cookie, payload: mutation('n1','op') })).status, 200);
        const pulled = await (await request('/api/changes?cursor=0', { cookie })).json(); assert.equal(pulled.changes.length, 1);
        assert.equal((await (await request('/api/changes?cursor=' + pulled.cursor, { cookie })).json()).changes.length, 0);
        assert.equal((await request('/api/logout', { method: 'POST', cookie, payload: {} })).status, 200);
        assert.equal((await request('/api/session', { cookie })).status, 401);
        const again = await request('/api/login', { method: 'POST', payload: { accessCode } });
        const oldCookie = again.headers.get('Set-Cookie').split(';')[0];
        env.OWNER_ACCESS_HASH = await sha256('rotated-code');
        assert.equal((await request('/api/session', { cookie: oldCookie })).status, 401);
    } finally { db.close(); }
});

test('shortcut token only appends notes; retries do not duplicate; token cannot read the bank', async () => {
    const db = createDatabase();
    const env = { DB: db, OWNER_ACCESS_HASH: await sha256('owner'), CAPTURE_TOKEN_HASH: await sha256('capture-only') };
    const payload = { id: 'shortcut-1', text: 'My sentence', createdAt: '2026-11-16T11:00:00Z' };
    const call = (path, input) => worker.fetch(new Request('https://atlas.test' + path, { method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer capture-only', 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined }), env);
    try {
        assert.equal((await call('/api/capture', payload)).status, 201);
        assert.equal((await call('/api/capture', payload)).status, 201);
        assert.equal((await db.prepare('SELECT * FROM changes').all()).results.length, 1);
        assert.equal((await call('/api/capture', { ...payload, text: 'changed retry' })).status, 409);
        assert.equal((await call('/api/changes')).status, 401);
        assert.equal((await call('/api/analysis/config')).status, 401);
        assert.equal((await call('/api/analysis', {text:'Policies matter.',category:'grammar',requestId:'capture-cannot-generate'})).status, 401);
        assert.equal((await call('/api/analysis/check', {provider:'deepseek'})).status, 401);
        assert.equal((await call('/assets/bank.js')).status, 401);
    } finally { db.close(); }
});

test('pre-configuration only exposes the stateless setup helper; learning data stays closed', async () => {
    const fetched = [];
    const env = { ASSETS: { async fetch(request) { fetched.push(new URL(request.url).pathname); return new Response('setup'); } } };
    for (const path of ['/learn/setup.html', '/learn/setup.js', '/learn/style.css']) {
        const response = await worker.fetch(new Request('https://atlas.test' + path), env);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('Cache-Control'), /no-store/);
    }
    for (const path of ['/api/changes', '/index.html', '/learn/index.html', '/assets/bank.js', '/learn/setup.html/extra']) {
        assert.equal((await worker.fetch(new Request('https://atlas.test' + path), env)).status, 503);
    }
    assert.equal((await worker.fetch(new Request('https://atlas.test/learn/setup.html', { method: 'POST' }), env)).status, 503);
    assert.equal(fetched.length, 3);
});
