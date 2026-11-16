(function () {
    'use strict';
    const status = document.querySelector('#setup-status');
    const generate = document.querySelector('#generate');
    generate.addEventListener('click', async () => {
        if (document.querySelector('#private-code').value && !confirm('重新生成会替换当前显示的访问码，请先确认已保存需要保留的访问码。继续？')) return;
        generate.disabled = true;
        try {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            const code = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
            document.querySelector('#private-code').type = 'password';
            document.querySelector('#private-code').value = code;
            document.querySelector('#private-hash').value = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
            document.querySelector('#generated').hidden = false;
            status.textContent = '已在本机生成。先保存访问码，再复制摘要到 Cloudflare。';
        } catch (_) { status.textContent = '生成失败，请通过 HTTPS 在 Safari 中打开本页。'; }
        finally { generate.disabled = false; }
    });
    for (const [button, input, message] of [['#copy-code', '#private-code', '访问码已复制，请保存到密码管理器。'], ['#copy-hash', '#private-hash', '摘要已复制，请填入 OWNER_ACCESS_HASH Secret。']]) {
        document.querySelector(button).addEventListener('click', async () => {
            const field = document.querySelector(input);
            try { await navigator.clipboard.writeText(field.value); status.textContent = message; }
            catch (_) { if (field.type === 'password') field.type = 'text'; field.focus(); field.select(); status.textContent = '请长按所选内容，手动复制。'; }
        });
    }
})();
