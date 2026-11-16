const encoder = new TextEncoder();
const COOKIE = '__Host-atlas';
const MAX_BODY = 450_000;
const SESSION_SECONDS = 30 * 86400;

export async function sha256(text) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function equal(a, b) {
    if (typeof a !== 'string' || a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return difference === 0;
}

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function fail(status, message) { throw Object.assign(new Error(message), { status }); }

async function body(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, '请发送 JSON 数据');
    if (Number(request.headers.get('content-length')) > MAX_BODY) fail(413, '内容过长，请拆分后保存');
    const reader = request.body?.getReader();
    if (!reader) fail(400, '缺少请求内容');
    const chunks = [];
    let size = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) { await reader.cancel(); fail(413, '内容过长，请拆分后保存'); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let parsed;
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { fail(400, 'JSON 格式无效'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, '请求必须是 JSON 对象');
    return parsed;
}

function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,180}$/.test(id); }

export function validateChange(input) {
    if (!['note', 'practice'].includes(input.kind) || !validId(input.id) || !validId(input.operationId)
        || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0 || typeof input.deleted !== 'boolean') {
        fail(400, '记录标识或版本无效');
    }
    const data = input.deleted ? null : input.data;
    if (!input.deleted && (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== input.id)) fail(400, '记录内容无效');
    if (!input.deleted && input.kind === 'note') {
        for (const field of ['text', 'analysis', 'source', 'createdAt', 'updatedAt']) {
            if (typeof data[field] !== 'string' || data[field].length > (['text', 'analysis'].includes(field) ? 20000 : 500)) fail(400, '笔记字段无效或过长');
        }
        if (!data.text.trim() || !['vocabulary', 'grammar'].includes(data.category) || !['review', 'mastered'].includes(data.status)) fail(400, '笔记类型或复习状态无效');
    }
    return { ...input, data };
}

function unpack(row) {
    return row ? { seq: row.seq, kind: row.kind, id: row.id, version: row.version, operationId: row.operation_id,
        data: row.data === null ? null : JSON.parse(row.data), deleted: Boolean(row.deleted), updatedAt: row.updated_at } : null;
}

export async function writeChange(db, raw) {
    const input = validateChange(raw);
    const serialized = input.deleted ? null : JSON.stringify(input.data);
    // The SELECT condition and insert are one SQLite statement, so two devices
    // cannot both update the same version. No read-then-write race or full replace.
    await db.prepare(`INSERT INTO changes (kind,id,version,operation_id,data,deleted,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT version FROM changes
        WHERE kind=? AND id=? ORDER BY seq DESC LIMIT 1),0)=?
        ON CONFLICT DO NOTHING`).bind(input.kind, input.id, input.baseVersion + 1, input.operationId,
        serialized, Number(input.deleted), new Date().toISOString(), input.kind, input.id, input.baseVersion).run();
    const committed = await db.prepare('SELECT * FROM changes WHERE operation_id=?').bind(input.operationId).first();
    if (committed) {
        if (committed.kind !== input.kind || committed.id !== input.id || committed.version !== input.baseVersion + 1
            || committed.data !== serialized || committed.deleted !== Number(input.deleted)) fail(409, '操作编号已用于其他内容');
        return { ok: true, record: unpack(committed) };
    }
    const current = await db.prepare('SELECT * FROM changes WHERE kind=? AND id=? ORDER BY seq DESC LIMIT 1').bind(input.kind, input.id).first();
    return { ok: false, current: unpack(current) };
}

function sameOrigin(request) {
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-atlas-request') !== '1') fail(403, '请从网站内发起此操作');
}

async function sessionFor(request, env) {
    const token = (request.headers.get('cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND auth_epoch=? AND expires_at>?')
        .bind(await sha256(token), env.OWNER_ACCESS_HASH, Math.floor(Date.now() / 1000)).first();
}

async function login(request, env) {
    sameOrigin(request);
    const now = Math.floor(Date.now() / 1000);
    const bucket = await sha256(`${env.OWNER_ACCESS_HASH}:${request.headers.get('cf-connecting-ip') || 'local'}:${Math.floor(now / 600)}`);
    await env.DB.prepare(`INSERT INTO login_limits(bucket,attempts,expires_at) VALUES (?,1,?)
        ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1`).bind(bucket, now + 1200).run();
    const limit = await env.DB.prepare('SELECT attempts FROM login_limits WHERE bucket=?').bind(bucket).first();
    if (limit.attempts > 10) fail(429, '尝试过多，请十分钟后再试');
    const input = await body(request);
    if (typeof input.accessCode !== 'string' || !equal(await sha256(input.accessCode), env.OWNER_ACCESS_HASH)) fail(401, '私人访问码不正确');
    const token = randomToken();
    await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at<? OR auth_epoch<>?').bind(now, env.OWNER_ACCESS_HASH),
        env.DB.prepare('DELETE FROM login_limits WHERE expires_at<?').bind(now),
        env.DB.prepare('INSERT INTO sessions(token_hash,auth_epoch,expires_at) VALUES (?,?,?)').bind(await sha256(token), env.OWNER_ACCESS_HASH, now + SESSION_SECONDS)
    ]);
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}` });
}

async function route(request, env) {
    const url = new URL(request.url);
    // Stateless browser-only random-code generator. It cannot read or write any
    // account settings/data and must work before OWNER_ACCESS_HASH is configured.
    const setupFiles = ['/learn/setup.html', '/learn/setup.js', '/learn/style.css'];
    if (setupFiles.includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
    if (!env.DB || !/^[a-f0-9]{64}$/.test(env.OWNER_ACCESS_HASH || '')) return json({ error: '私人站点尚未配置完成' }, 503);
    if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env);
    // Optional append-only shortcut endpoint: no login/read/delete privileges.
    if (url.pathname === '/api/capture' && request.method === 'POST') {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
        if (!env.CAPTURE_TOKEN_HASH || !equal(await sha256(token), env.CAPTURE_TOKEN_HASH)) fail(401, '快捷指令凭证无效');
        const input = await body(request);
        if (!validId(input.id) || typeof input.text !== 'string' || !input.text.trim()) fail(400, '请提供稳定 id 和原文');
        // Stable fields make retrying the same shortcut request idempotent.
        const note = { id: input.id, text: input.text.trim(), analysis: '', source: 'iOS 快捷指令手动收集',
            createdAt: typeof input.createdAt === 'string' ? input.createdAt : '', updatedAt: typeof input.createdAt === 'string' ? input.createdAt : '',
            category: input.category === 'grammar' ? 'grammar' : 'vocabulary', status: 'review' };
        if (!Number.isFinite(Date.parse(note.createdAt))) fail(400, '请提供 ISO 格式 createdAt');
        const result = await writeChange(env.DB, { kind: 'note', id: input.id, data: note, deleted: false, baseVersion: 0, operationId: 'capture:' + input.id });
        if (!result.ok) fail(409, '该收集编号已存在，请保留原文并检查记录');
        return json({ saved: true, id: input.id }, 201);
    }
    // Only the login document and its scripts/styles are anonymous. All bank
    // files, generated exercises, PDFs and audio go through session validation.
    const publicFiles = ['/learn/login.html', '/learn/login.js', '/learn/style.css'];
    if (publicFiles.includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
    const session = await sessionFor(request, env);
    if (!session) {
        if (url.pathname.startsWith('/api/')) return json({ error: '请先登录' }, 401);
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/learn/' || url.pathname === '/learn/index.html')) {
            return Response.redirect(`${url.origin}/learn/login.html`, 303);
        }
        return json({ error: '请先登录' }, 401);
    }
    if (!['GET', 'HEAD'].includes(request.method)) sameOrigin(request);
    if (url.pathname === '/api/session' && request.method === 'GET') return json({ authenticated: true });
    if (url.pathname === '/api/logout' && request.method === 'POST') {
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.token_hash).run();
        return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }
    if (url.pathname === '/api/changes' && request.method === 'GET') {
        const cursor = Number(url.searchParams.get('cursor') || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0) fail(400, '游标无效');
        const rows = await env.DB.prepare('SELECT * FROM changes WHERE seq>? ORDER BY seq LIMIT 50').bind(cursor).all();
        return json({ changes: rows.results.map(unpack), cursor: rows.results.at(-1)?.seq || cursor, more: rows.results.length === 50 });
    }
    if (url.pathname === '/api/changes' && request.method === 'POST') {
        const result = await writeChange(env.DB, await body(request));
        return json(result, result.ok ? 200 : 409);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: '接口不存在' }, 404);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: '不支持的请求方式' }, 405);
    const result = await env.ASSETS.fetch(request);
    if (request.method === 'GET' && result.headers.get('content-type')?.includes('text/html') && result.ok) {
        const html = await result.text();
        const headers = new Headers(result.headers);
        for (const name of ['content-length', 'content-encoding', 'etag']) headers.delete(name);
        return new Response(html.replace(/<head>/i, '<head><meta name="atlas-private" content="1">'), { status: result.status, headers });
    }
    return result;
}

export default {
    async fetch(request, env) {
        let response;
        try { response = await route(request, env); }
        catch (error) { response = json({ error: error.status ? error.message : '保存失败，请稍后重试' }, error.status || 500); }
        const secured = new Response(response.body, response);
        secured.headers.set('Cache-Control', 'private, no-store');
        secured.headers.set('X-Content-Type-Options', 'nosniff');
        secured.headers.set('Referrer-Policy', 'no-referrer');
        secured.headers.set('X-Frame-Options', 'SAMEORIGIN');
        // Keep opener/postMessage intact: practice currently uses same-origin windows.
        secured.headers.set('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
        return secured;
    }
};
