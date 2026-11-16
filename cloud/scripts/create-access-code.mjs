import { randomBytes, createHash } from 'node:crypto';
// Run interactively on your own device. Never paste the access code into Git/chat.
const code = randomBytes(32).toString('base64url');
console.log('Private access code (save in your password manager):');
console.log(code);
console.log('\nOWNER_ACCESS_HASH (configure as a Worker secret):');
console.log(createHash('sha256').update(code).digest('hex'));
