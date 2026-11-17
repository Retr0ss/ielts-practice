import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function createDatabase() {
    const sqlite = new DatabaseSync(':memory:');
    for (const name of readdirSync(new URL('../../../../cloud/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
        sqlite.exec(readFileSync(new URL('../../../../cloud/migrations/' + name, import.meta.url), 'utf8'));
    }
    const db = { prepare(sql) {
        let params = [];
        const execute = () => { const result = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(result.changes) } }; };
        const query = { bind(...values) { params = values; return query; },
            async run() { return execute(); }, _execute:execute,
            async first() { return sqlite.prepare(sql).get(...params) || null; },
            async all() { return { results: sqlite.prepare(sql).all(...params) }; } };
        return query;
    }, async batch(statements) { sqlite.exec('BEGIN'); try { const result = statements.map(statement=>statement._execute()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }, close: () => sqlite.close() };
    return db;
}
