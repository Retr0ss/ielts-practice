"""Notebook -> reading -> Safari back lifecycle regression, local test data only."""
import uuid
from playwright.sync_api import sync_playwright

URL = 'https://127.0.0.1:8791'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(ignore_https_errors=True, viewport={'width':393, 'height':852})
    try:
        page = context.new_page()
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto(URL + '/learn/login.html')
        page.locator('#access-code').fill('local-test-access-code-not-for-production')
        page.locator('button[type=submit]').click()
        page.wait_for_url('**/learn/index.html')
        page.wait_for_function('window.AppData && window.AtlasPrivate')
        page.evaluate('async () => { await AppData.ready; await AtlasPrivate.sync(); }')
        page.get_by_role('link', name='开始阅读练习 ↗').click()
        page.wait_for_url('**/index.html')
        page.wait_for_function('window.app && app.isInitialized === true')
        page.go_back()
        page.wait_for_url('**/learn/index.html')
        page.wait_for_function('window.AtlasPrivate && window.AppDiagnostics')
        page.evaluate('async () => { await AppData.ready; await AtlasPrivate.sync(); }')
        # The user's report contains an opaque post-navigation rejection. Its
        # original Safari exception is redacted; reproduce its classification,
        # without claiming Chromium reproduces the underlying native exception.
        page.evaluate("dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {promise:Promise.resolve(), reason:{}}))")
        assert page.evaluate('AppDiagnostics.snapshot().events.at(-1).code') == 'UNEXPECTED_RUNTIME_ERROR'
        assert page.locator('#diagnostic-startup-failure').count() == 0

        # Suspend an in-flight synchronization as BFCache does. This must resolve
        # through the navigation cancellation path, preserve data, and resume.
        pending = []
        page.route('**/api/session', lambda route: pending.append(route))
        with page.expect_request('**/api/session'):
            page.evaluate('() => { window.__navigationSync = AtlasPrivate.sync(); }')
        page.evaluate("dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}))")
        page.evaluate('async () => { await window.__navigationSync; }')
        for route in pending:
            try: route.abort()
            except Exception: pass
        page.unroute('**/api/session')
        page.evaluate("dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))")
        page.evaluate('async () => { await AtlasPrivate.sync(); }')
        marker = 'back-navigation-' + str(uuid.uuid4())
        page.locator('#note-text').fill(marker)
        page.locator('button[type=submit]').click()
        page.wait_for_function('document.querySelector("#notice").textContent.includes("已保存")')
        page.evaluate('async () => { await AtlasPrivate.sync(); }')
        assert page.evaluate('(text) => AtlasPrivate.store.list().then(rows => rows.some(row => row.data?.text === text && !row.dirty))', marker)
        page.reload()
        page.wait_for_function('window.AtlasPrivate')
        page.evaluate('async () => { await AppData.ready; await AtlasPrivate.sync(); }')
        assert page.evaluate('(text) => AtlasPrivate.store.list().then(rows => rows.some(row => row.data?.text === text))', marker)

        # True startup failure remains visible. Do not fix a false notification
        # by disabling the startup failure diagnostic path.
        page.add_init_script('''
            const open = IDBFactory.prototype.open;
            IDBFactory.prototype.open = function(name, ...args) {
                if (name === 'IELTSAtlasPrivateV1') throw new DOMException('test-only', 'InvalidStateError');
                return open.call(this, name, ...args);
            };
        ''')
        page.reload()
        page.wait_for_selector('#diagnostic-startup-failure')
        assert page.evaluate('AppDiagnostics.snapshot().events.some(e => e.code === "APP_BOOT_FAILED")')
        print('PASS: notebook-reading-back; late errors retained without startup alert; pending sync cancelled/resumed; notes preserved; real startup errors visible')
    finally:
        context.close()
        browser.close()
