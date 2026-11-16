"""Public mobile setup must generate credentials entirely in browser memory."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(ignore_https_errors=True, viewport={"width": 393, "height": 852})
    try:
        page = context.new_page()
        page.goto('https://127.0.0.1:8791/learn/setup.html', wait_until='networkidle')
        requests = []
        page.on('request', lambda request: requests.append(request.url))
        page.locator('#generate').click()
        page.wait_for_function('document.querySelector("#private-hash").value.length === 64')
        # Secrets never leave the page evaluation; return assertions only.
        assert page.evaluate('''async () => {
            const code = document.querySelector('#private-code').value;
            if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return false;
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))), x=>x.toString(16).padStart(2,'0')).join('');
            window.__firstCodeForTest = code;
            return hash === document.querySelector('#private-hash').value && location.search === '' && location.hash === '';
        }''')
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#generate').click()
        page.wait_for_function('document.querySelector("#private-code").value !== window.__firstCodeForTest')
        assert page.evaluate('localStorage.length === 0 && sessionStorage.length === 0')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert requests == [], 'Generator unexpectedly sent a network request'
        print('PASS: mobile code generator; valid digest; fresh randomness; no network/storage/URL leakage')
    finally:
        context.close()
        browser.close()
