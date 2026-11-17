"""Mobile analysis UI contract tests; model routes are mocked, no billable calls."""
import json
from playwright.sync_api import sync_playwright

URL='https://127.0.0.1:8791'
result={'status':'complete','requestId':'mock-analysis-request','analysis':'词义 / 句意\n政策很重要。\n\nIELTS 场景原创例句\nPublic policy affects education.\n公共政策影响教育。\n<img src=x onerror="window.__analysisInjected=true">','metadata':{'model':'deepseek-flash','promptVersion':'ielts-grammar-v1','generatedAt':'2026-11-17T12:00:00Z'},'cached':False,'usage':{'remaining':19,'dailyLimit':20}}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(ignore_https_errors=True,viewport={'width':393,'height':852})
    try:
        page=context.new_page()
        page.route('**/api/analysis/config',lambda route:route.fulfill(json={'enabled':True,'maxInput':4000,'usage':{'remaining':20,'dailyLimit':20}}))
        page.route('**/api/analysis',lambda route:route.fulfill(json=result))
        page.goto(URL+'/learn/login.html')
        page.locator('#access-code').fill('local-test-access-code-not-for-production')
        page.locator('button[type=submit]').click()
        page.wait_for_url('**/learn/index.html')
        page.wait_for_function('!document.querySelector("#analyze").disabled')
        page.locator('#note-text').fill('Policies matter.')
        page.locator('#note-analysis').fill('My own existing note')
        page.locator('#analyze').click()
        page.locator('#analysis-preview').wait_for(state='visible')
        assert page.locator('#note-analysis').input_value()=='My own existing note'
        assert page.evaluate('window.__analysisInjected === undefined')
        page.locator('#analysis-append').click()
        assert page.locator('#note-analysis').input_value().startswith('My own existing note\n\n')
        assert '政策很重要' in page.locator('#note-analysis').input_value()
        page.locator('button[type=submit]').click()
        page.wait_for_function('document.querySelector("#notice").textContent.includes("已保存")')
        page.evaluate('async()=>{await AtlasPrivate.sync();await AtlasPrivate.sync()}')
        saved=page.evaluate('()=>AtlasPrivate.store.list().then(rows=>rows.find(r=>r.data?.text==="Policies matter."))')
        assert 'My own existing note' in saved['data']['analysis']
        assert not saved['dirty']

        # A late response for A must never fill B or a different selected note.
        pending=[]
        page.unroute('**/api/analysis')
        page.route('**/api/analysis',lambda route:pending.append(route))
        page.locator('#note-text').fill('Old sentence.')
        with page.expect_request('**/api/analysis'):
            page.locator('#analyze').click()
        page.locator('#note-text').fill('New sentence.')
        pending.pop().fulfill(json=result)
        page.wait_for_function('!document.querySelector("#analyze").disabled')
        assert page.locator('#analysis-preview').is_hidden()
        assert page.locator('#note-analysis').input_value()==''

        page.unroute('**/api/analysis')
        page.route('**/api/analysis',lambda route:route.fulfill(status=429,json={'error':'今日自动解析次数已用完','code':'DAILY_LIMIT'}))
        page.locator('#note-analysis').fill('Keep this when quota is used')
        page.locator('#analyze').click()
        page.wait_for_function('document.querySelector("#analysis-status").textContent.includes("次数已用完")')
        assert page.locator('#note-text').input_value()=='New sentence.'
        assert page.locator('#note-analysis').input_value()=='Keep this when quota is used'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path='/tmp/atlas-analysis-mobile.png',full_page=True)

        # No key/configured service: manual notes remain usable.
        page.unroute('**/api/analysis/config')
        page.route('**/api/analysis/config',lambda route:route.fulfill(json={'enabled':False,'maxInput':4000,'usage':{'remaining':20,'dailyLimit':20}}))
        page.reload()
        page.wait_for_function('document.querySelector("#analysis-status").textContent.includes("尚未配置")')
        assert page.locator('#analyze').is_disabled()
        assert page.locator('button[type=submit]').is_enabled()
        print(json.dumps({'status':'pass','checks':['preview preserves notes','explicit append/save/sync','late response discarded','quota failure preserves original','HTML treated as text','mobile layout','manual fallback without key'],'model_calls':'mocked only'}))
    finally:
        context.close();browser.close()
