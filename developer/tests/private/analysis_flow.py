"""Mobile analysis UI contract tests; model routes are mocked, no billable calls."""
import json
from playwright.sync_api import sync_playwright

URL='https://127.0.0.1:8791'
result={'status':'complete','requestId':'mock-analysis-request','analysis':'词义 / 句意\n政策很重要。\n\nIELTS 场景原创例句\nPublic policy affects education.\n公共政策影响教育。\n<img src=x onerror="window.__analysisInjected=true">','metadata':{'model':'deepseek-flash','promptVersion':'ielts-grammar-v1','generatedAt':'2026-11-17T12:00:00Z'},'cached':False,'usage':{'remaining':19,'dailyLimit':20}}
config={'enabled':True,'defaultProvider':'deepseek','providers':[{'id':'deepseek','label':'DeepSeek','model':'deepseek-flash','enabled':True},{'id':'openai','label':'OpenAI（GPT）','model':'gpt-5.4-mini','enabled':True}],'maxInput':4000,'usage':{'remaining':20,'dailyLimit':20}}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(ignore_https_errors=True,viewport={'width':393,'height':852})
    try:
        page=context.new_page()
        page.route('**/api/analysis/config',lambda route:route.fulfill(json=config))
        page.route('**/api/analysis',lambda route:route.fulfill(json=result))
        page.route('**/api/analysis/check',lambda route:route.fulfill(json={'ok':False,'code':'PROVIDER_BALANCE','stage':'balance','httpStatus':402,'message':'DeepSeek API 余额不可用，请到开放平台检查余额'}))
        page.goto(URL+'/learn/login.html')
        page.locator('#access-code').fill('local-test-access-code-not-for-production')
        page.locator('button[type=submit]').click()
        page.wait_for_url('**/learn/index.html')
        page.wait_for_function('!document.querySelector("#analyze").disabled')
        page.locator('#note-text').fill('Policies matter.')
        page.locator('#note-analysis').fill('My own existing note')
        page.locator('#analysis-check').click()
        page.wait_for_function('document.querySelector("#connection-check-status").textContent.includes("PROVIDER_BALANCE")')
        assert 'HTTP 402' in page.locator('#connection-check-status').inner_text()
        assert page.locator('#note-analysis').input_value()=='My own existing note'
        assert page.locator('#note-text').input_value()=='Policies matter.'
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
        page.locator('#analysis-provider').select_option('openai')
        pending.pop().fulfill(json=result)
        page.wait_for_function('!document.querySelector("#analyze").disabled')
        assert page.locator('#analysis-preview').is_hidden()
        assert page.locator('#note-analysis').input_value()==''

        # Explicit provider selection reaches the backend; a provider switch
        # fences a late result even if the source text stays identical.
        with page.expect_request('**/api/analysis') as request:
            page.locator('#analyze').click()
        assert request.value.post_data_json['provider']=='openai'
        page.locator('#analysis-provider').select_option('deepseek')
        pending.pop().fulfill(json={**result,'metadata':{**result['metadata'],'provider':'openai','model':'gpt-5.4-mini'}})
        page.wait_for_function('!document.querySelector("#analyze").disabled')
        assert page.locator('#analysis-preview').is_hidden()

        page.unroute('**/api/analysis')
        page.route('**/api/analysis',lambda route:route.fulfill(json={**result,'metadata':{**result['metadata'],'provider':'openai','model':'gpt-5.4-mini'}}))
        page.locator('#analysis-provider').select_option('openai')
        page.locator('#note-analysis').fill('My own OpenAI note')
        page.locator('#analyze').click()
        page.locator('#analysis-preview').wait_for(state='visible')
        assert 'OpenAI' in page.locator('#analysis-meta').inner_text()
        assert page.locator('#note-analysis').input_value()=='My own OpenAI note'
        page.locator('#analysis-replace').click()
        assert page.locator('#note-analysis').input_value()==result['analysis']
        page.locator('button[type=submit]').click()
        page.wait_for_function('document.querySelector("#note-text").value === ""')
        assert page.locator('#analysis-provider').input_value()=='openai'
        page.locator('#note-text').fill('New sentence.')

        page.unroute('**/api/analysis')
        page.route('**/api/analysis',lambda route:route.fulfill(status=429,json={'error':'今日自动解析次数已用完','code':'DAILY_LIMIT'}))
        page.locator('#note-analysis').fill('Keep this when quota is used')
        page.locator('#analyze').click()
        page.wait_for_function('document.querySelector("#analysis-status").textContent.includes("次数已用完")')
        assert page.locator('#note-text').input_value()=='New sentence.'
        assert page.locator('#note-analysis').input_value()=='Keep this when quota is used'
        page.unroute('**/api/analysis')
        page.route('**/api/analysis',lambda route:route.fulfill(status=502,json={'error':'Worker 连接模型服务失败，请先运行检查连接','code':'PROVIDER_NETWORK','diagnostic':{'provider':'deepseek','stage':'connect'}}))
        page.locator('#analyze').click()
        page.wait_for_function('document.querySelector("#analysis-status").textContent.includes("[PROVIDER_NETWORK]")')
        assert page.locator('#note-text').input_value()=='New sentence.'
        assert page.locator('#note-analysis').input_value()=='Keep this when quota is used'
        page.unroute('**/api/analysis')
        warning='解析已生成，但云端解析缓存暂存失败。请先保存笔记，避免重复解析。'
        page.route('**/api/analysis',lambda route:route.fulfill(json={**result,'usage':None,'warning':warning}))
        page.locator('#analyze').click()
        page.locator('#analysis-preview').wait_for(state='visible')
        assert page.locator('#analysis-status').inner_text()==warning
        assert page.locator('#note-analysis').input_value()=='Keep this when quota is used'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path='/tmp/atlas-analysis-mobile.png',full_page=True)

        # No key/configured service: manual notes remain usable.
        page.unroute('**/api/analysis/config')
        page.route('**/api/analysis/config',lambda route:route.fulfill(json={**config,'enabled':False,'providers':[{**entry,'enabled':False} for entry in config['providers']]}))
        page.reload()
        page.wait_for_function('document.querySelector("#analysis-status").textContent.includes("尚未配置")')
        assert page.locator('#analyze').is_disabled()
        page.locator('#analysis-provider').select_option('openai')
        assert page.locator('#analyze').is_disabled()
        assert page.locator('button[type=submit]').is_enabled()
        page.unroute('**/api/analysis/config')
        page.route('**/api/analysis/config',lambda route:route.fulfill(json={**config,'enabled':False,'providers':[{**entry,'enabled':False,'issue':'INVALID_KEY_FORMAT'} for entry in config['providers']]}))
        page.reload()
        page.wait_for_function('document.querySelector("#analysis-status").textContent.includes("API Key 格式不正确")')
        assert page.locator('#analyze').is_disabled()
        assert page.locator('#analysis-check').is_enabled()
        print(json.dumps({'status':'pass','checks':['preview preserves notes','explicit append/save/sync','late response discarded','provider switch fences results','OpenAI selection/replace/save','quota failure preserves original','HTML treated as text','mobile layout','manual fallback without keys'],'model_calls':'mocked only'}))
    finally:
        context.close();browser.close()
