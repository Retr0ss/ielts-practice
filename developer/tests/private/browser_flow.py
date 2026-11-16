"""Run against local Wrangler only; never against a user's production database.

ATLAS_TEST_URL=https://127.0.0.1:8791 PLAYWRIGHT_BROWSERS_PATH=... python ...
"""
import json
import os
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('ATLAS_TEST_URL', 'https://127.0.0.1:8791')
if not URL.startswith(('https://127.0.0.1:', 'https://localhost:')):
    raise RuntimeError('This test only accepts a local test server')


def sync(page):
    page.evaluate('async () => { await AppData.ready; await AtlasPrivate.sync(); }')


def login(context):
    page = context.new_page()
    page.goto(URL + '/learn/login.html')
    page.locator('#access-code').fill('local-test-access-code-not-for-production')
    page.get_by_role('button', name='进入学习', exact=True).click()
    page.wait_for_url('**/learn/index.html')
    page.wait_for_function('() => !!window.AtlasPrivate && !!window.AppData')
    sync(page)
    return page


def run(browser_type):
    browser = browser_type.launch(headless=True)
    a_context = browser.new_context(ignore_https_errors=True, viewport={'width': 393, 'height': 852})
    b_context = browser.new_context(ignore_https_errors=True, viewport={'width': 393, 'height': 852})
    try:
        a, b = login(a_context), login(b_context)
        marker = 'grammar-' + str(uuid.uuid4())
        a.locator('#note-category').select_option('grammar')
        a.locator('#note-text').fill(marker)
        a.locator('#note-analysis').fill('A sentence which contains a relative clause.')
        a.get_by_role('button', name='保存笔记', exact=True).click()
        a.wait_for_function('() => document.querySelector("#notice").textContent.includes("已保存")')
        sync(a)
        sync(b)
        b.locator('#notes .note-card').filter(has_text=marker).wait_for()
        note_id = a.evaluate('(text) => AtlasPrivate.store.list().then(rows => rows.find(row => row.data?.text === text).id)', marker)

        # Both devices edit the same base version. Preserve both until a user chooses.
        a_context.set_offline(True)
        a.locator('#notes .note-card').filter(has_text=marker).get_by_role('button', name='编辑', exact=True).click()
        a.locator('#note-analysis').fill('offline edit from phone')
        a.get_by_role('button', name='保存笔记', exact=True).click()
        a.wait_for_function('() => document.querySelector("#notice").textContent.includes("已保存")')
        b.locator('#notes .note-card').filter(has_text=marker).get_by_role('button', name='编辑', exact=True).click()
        b.locator('#note-analysis').fill('online edit from another device')
        b.get_by_role('button', name='保存笔记', exact=True).click()
        b.wait_for_function('() => document.querySelector("#notice").textContent.includes("已保存")')
        sync(b)
        a_context.set_offline(False)
        sync(a)
        a.locator('#conflict-panel').wait_for(state='visible')
        local = a.evaluate('(id) => AtlasPrivate.store.get("note:" + id)', note_id)
        assert local['data']['analysis'] == 'offline edit from phone'
        assert local['conflict']['data']['analysis'] == 'online edit from another device'
        a.locator('#conflicts .note-card').filter(has_text=marker).get_by_role('button', name='保留本机版本', exact=True).click()
        a.wait_for_function('(id) => AtlasPrivate.store.get("note:" + id).then(row => !row.conflict)', arg=note_id)
        sync(a)
        sync(b)
        assert b.evaluate('(id) => AtlasPrivate.store.get("note:" + id).then(row => row.data.analysis)', note_id) == 'offline edit from phone'

        # Canonical practice roundtrip, including guard against in-flight local changes.
        record_id = 'practice-' + str(uuid.uuid4())
        a.evaluate('''async id => {
            await AppData.practice.completeAttempt({record: {id, examId: 'p1-high-01', title: 'Cloud practice fixture',
                type: 'reading', score: 100, correctAnswers: 1, totalQuestions: 1, duration: 30,
                date: new Date().toISOString(), answers: {'1': 'YES'}, correctAnswersMap: {'1':'YES'}}});
        }''', record_id)
        sync(a)
        sync(b)
        assert b.evaluate('(id) => AppData.practice.get(id).then(Boolean)', record_id)
        a.evaluate('''async id => {
            const before = await AppData.practice.readForSync(id);
            await AppData.practice.updateAnnotations({recordId:id, examId:'p1-high-01', patch:{noteText:'new local annotation'}});
            let rejected = false;
            try { await AppData.practice.applyFromSync({recordId:id, record:before.record, expectedRevisions:before.revisions}); }
            catch(error) { rejected = error.code === 'CONFLICT'; }
            if (!rejected) throw new Error('In-flight response overwrote a local annotation');
        }''', record_id)
        sync(a)
        sync(b)
        with a.expect_download() as backup_download:
            a.locator('#backup').click()
        backup_path = backup_download.value.path()
        await_delete = '(id) => AppData.practice.delete({recordId:id})'
        b.evaluate(await_delete, record_id)
        sync(b)
        sync(a)
        assert a.evaluate('(id) => AppData.practice.get(id)', record_id) is None
        a.once('dialog', lambda dialog: dialog.accept())
        a.locator('#restore-file').set_input_files(backup_path)
        a.wait_for_function('() => document.querySelector("#notice").textContent.includes("已恢复")')
        sync(a)
        sync(b)
        assert b.evaluate('(id) => AppData.practice.get(id).then(Boolean)', record_id), 'JSON restore lost a practice record'

        with a.expect_download() as download:
            a.locator('#export').click()
        exported = Path(download.value.path()).read_text()
        assert note_id in exported and 'offline edit from phone' in exported
        assert a.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow'
        a.locator('#note-text').fill('benefit')
        a.locator('#dictionary').click()
        a.wait_for_function('() => document.querySelector("#dictionary-result").textContent.includes("来源")')
        # Treat source text as text, never as HTML.
        a.locator('#note-text').fill('<img src=x onerror="window.__injected=true">')
        a.get_by_role('button', name='保存笔记', exact=True).click()
        a.wait_for_function('() => document.querySelector("#notice").textContent.includes("已保存")')
        assert a.evaluate('window.__injected === undefined')
        a.screenshot(path=f'/tmp/atlas-{browser_type.name}-mobile.png', full_page=True)
        a.reload()
        sync(a)
        assert a.evaluate('(id) => AtlasPrivate.store.get("note:"+id).then(row => row.data.analysis)', note_id) == 'offline edit from phone'
        # A session cookie is required even for an asset's direct address.
        anonymous = browser.new_context(ignore_https_errors=True)
        response = anonymous.request.get(URL + '/assets/generated/reading-exams/p1-high-01.js')
        assert response.status == 401
        anonymous.close()
        print(json.dumps({'browser': browser_type.name, 'status': 'pass', 'checks': ['mobile notes', 'two devices', 'offline conflict', 'practice roundtrip', 'local CAS', 'deletion tombstone', 'JSON backup restore', 'local dictionary', 'Markdown', 'XSS', 'reload', 'private assets']}))
    finally:
        a_context.close()
        b_context.close()
        browser.close()


with sync_playwright() as p:
    for name in os.environ.get('ATLAS_TEST_BROWSERS', 'chromium,webkit').split(','):
        run(getattr(p, name.strip()))
