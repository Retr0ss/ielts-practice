import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = join(root, 'dist/private');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// Explicit runtime allowlist. Never publish the checkout, .env, .git or tooling.
for (const name of ['index.html', 'css', 'js', 'assets', 'templates', 'learn', 'LICENSE']) {
    await cp(join(root, name), join(target, name), { recursive: true, filter: source => !basename(source).startsWith('.') });
}
async function verify(path) {
    for (const name of await readdir(path)) {
        const child = join(path, name);
        const info = await stat(child);
        if (name.startsWith('.') || /\.(env|pem|key)$/.test(name)) throw new Error(`Forbidden deployment file: ${name}`);
        if (info.isDirectory()) await verify(child);
        else if (info.size > 25 * 1024 * 1024) throw new Error(`Cloudflare asset exceeds 25 MiB: ${child}`);
    }
}
await verify(target);
console.log('Private runtime packaged at dist/private. No deployment performed.');
