"""Mobile sentence/dictionary UI checks; speech engine and model are mocked."""
import json
from playwright.sync_api import sync_playwright

URL='https://127.0.0.1:8791'
SPEECH_MOCK="""(() => {
    window.__spoken=[];window.__cancelled=0;
    class Utterance { constructor(text){this.text=text;} }
    Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:Utterance});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
        getVoices:()=>[{lang:'en-GB',name:'Test English'}],
        speak:item=>{window.__currentSpeech=item;window.__spoken.push({text:item.text,lang:item.lang,rate:item.rate});},
        cancel:()=>{window.__cancelled++;const old=window.__currentSpeech;window.__currentSpeech=null;if(old?.onerror)old.onerror({error:'canceled'});}
    }});
})()"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(ignore_https_errors=True,viewport={'width':393,'height':852})
    context.add_init_script(SPEECH_MOCK)
    try:
        page=context.new_page()
        config={'enabled':True,'defaultProvider':'deepseek','providers':[{'id':'deepseek','label':'DeepSeek','model':'deepseek-flash','enabled':True}],'usage':{'remaining':100,'dailyLimit':100}}
        analysis='IELTS 场景原创例句\nPublic policy affects education.\n公共政策影响教育。\n<img src=x onerror="window.__sentenceInjected=true">'
        result={'status':'complete','analysis':analysis,'metadata':{'model':'deepseek-flash','generatedAt':'2026-11-17T12:00:00Z'},'usage':{'remaining':99,'dailyLimit':100}}
        model_calls=[]
        page.route('**/api/analysis/config',lambda route:route.fulfill(json=config))
        def analyze(route):
            model_calls.append(route.request.post_data_json)
            route.fulfill(json=result)
        page.route('**/api/analysis',analyze)
        page.goto(URL+'/learn/login.html')
        page.locator('#access-code').fill('local-test-access-code-not-for-production')
        page.locator('button[type=submit]').click()
        page.wait_for_url('**/learn/index.html')
        sentence="Public policy affects education. I don't agree."
        page.locator('#note-text').fill(sentence)
        source=page.locator('#source-sentences')
        source.get_by_role('button',name='查看 policy 的词义',exact=True).wait_for()
        assert source.get_by_role('button',name="查看 don't 的词义",exact=True).count()==1
        source.locator('.sentence-play').click()
        assert page.evaluate('window.__spoken.at(-1).text')==sentence
        assert page.evaluate('window.__spoken.at(-1).lang')=='en-GB'
        assert source.locator('.sentence-play').get_attribute('aria-pressed')=='true'
        page.locator('#speech-stop').click()
        assert source.locator('.sentence-play').get_attribute('aria-pressed')=='false'

        source.get_by_role('button',name='查看 policy 的词义',exact=True).click()
        page.wait_for_function('document.querySelector("#word-source").textContent.includes("来源")')
        assert page.locator('#word-dialog').is_visible()
        assert 'policy' in page.locator('#word-meaning').inner_text()
        assert '未收录' not in page.locator('#word-meaning').inner_text()
        page.screenshot(path='/tmp/atlas-word-mobile.png')
        page.locator('#word-speak').click()
        assert page.evaluate('window.__spoken.at(-1).text')=='policy'
        page.locator('#word-close').click()
        source.get_by_role('button',name='查看 I 的词义',exact=True).click()
        page.wait_for_function('document.querySelector("#word-meaning").textContent.includes("我")')
        page.keyboard.press('Escape')
        assert not page.locator('#word-dialog').is_visible()
        assert len(model_calls)==0

        # Native focus return, missing words and HTML safety, with actual local dictionary.
        page.locator('#note-text').fill('zzzzunlistedieltsword <img src=x onerror="window.__sentenceInjected=true">')
        source.get_by_role('button',name='查看 zzzzunlistedieltsword 的词义',exact=True).wait_for()
        source.get_by_role('button',name='查看 zzzzunlistedieltsword 的词义',exact=True).click()
        page.wait_for_function('document.querySelector("#word-meaning").textContent.includes("未收录")')
        page.locator('#word-close').click()
        assert page.evaluate('window.__sentenceInjected === undefined')
        assert source.locator('img').count()==0

        # A closed lookup must not replace a later selection, including a rapid reopen.
        page.locator('#note-text').fill('policy education')
        source.get_by_role('button',name='查看 policy 的词义',exact=True).wait_for()
        page.evaluate("""() => {
            window.__realDictionary=window.ensureReadingDictionary;
            window.__dictionaryQueue=[];
            window.ensureReadingDictionary=()=>new Promise(resolve=>window.__dictionaryQueue.push(resolve));
        }""")
        source.get_by_role('button',name='查看 policy 的词义',exact=True).click()
        page.evaluate("""() => {
            document.querySelector('#word-dialog').close();
            document.querySelector('#source-sentences [aria-label="查看 education 的词义"]').click();
        }""")
        page.evaluate("""() => {
            window.__dictionaryQueue[1]({lookup:()=>({found:true,term:'education',zh:'新词释义',sourceLabel:'测试词典'})});
            window.__dictionaryQueue[0]({lookup:()=>({found:true,term:'policy',zh:'过期释义',sourceLabel:'测试词典'})});
        }""")
        page.wait_for_function('document.querySelector("#word-meaning").textContent.includes("新词释义")')
        assert '过期' not in page.locator('#word-meaning').inner_text()
        page.locator('#word-close').click()
        page.evaluate('window.ensureReadingDictionary=window.__realDictionary')

        # Original sentence, AI preview, filled analysis and saved review all work.
        page.locator('#note-text').fill(sentence)
        page.locator('#analyze').click()
        preview=page.locator('#analysis-preview-text')
        preview.get_by_role('button',name='查看 education 的词义',exact=True).wait_for()
        preview.get_by_role('button',name='朗读英文：Public policy affects education.',exact=True).click()
        assert page.evaluate('window.__spoken.at(-1).text')=='Public policy affects education.'
        page.locator('#analysis-replace').click()
        page.locator('#analysis-study summary').click()
        page.locator('#analysis-study-text').get_by_role('button',name='查看 education 的词义',exact=True).wait_for()
        assert page.locator('#note-analysis').input_value()==analysis
        page.locator('button[type=submit]').click()
        page.wait_for_function('document.querySelector("#note-text").value === ""')
        card=page.locator('#notes .note-card').filter(has=page.locator('h3',has_text=sentence)).first
        card.locator('.sentence-study summary').click()
        card.get_by_role('button',name='查看 policy 的词义',exact=True).first.click()
        page.wait_for_function('document.querySelector("#word-source").textContent.includes("来源")')
        page.locator('#word-close').click()
        assert len(model_calls)==1

        # Speech lifecycle: an old completion cannot stop a new utterance.
        page.locator('#note-text').fill('Public policy.')
        source.get_by_role('button',name='查看 policy 的词义',exact=True).wait_for()
        source.locator('.sentence-play').click()
        page.evaluate('window.__oldSpeech=window.__currentSpeech')
        card.get_by_role('button',name='朗读英文：Public policy affects education.',exact=True).click()
        page.evaluate('window.__oldSpeech.onend()')
        assert not page.locator('#speech-stop').is_disabled()
        page.evaluate('window.__currentSpeech.onerror({error:"language-unavailable"})')
        assert page.locator('#speech-stop').is_disabled()
        assert '语音播放失败' in page.locator('#speech-status').inner_text()
        page.evaluate('window.speechSynthesis.getVoices=()=>[]')
        source.locator('.sentence-play').click()
        assert page.evaluate('window.__spoken.at(-1).lang')=='en-GB'
        page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}))')
        assert page.locator('#speech-stop').is_disabled()
        page.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path='/tmp/atlas-sentence-mobile.png',full_page=True)
        page.locator('#note-text').fill('word '*500)
        page.wait_for_function('document.querySelector("#source-sentences").textContent.length > 2000')
        before=len(page.evaluate('window.__spoken'))
        source.locator('.sentence-play').click()
        assert '过长' in page.locator('#speech-status').inner_text()
        assert len(page.evaluate('window.__spoken'))==before

        # No speech engine: disabled playback must not prevent dictionary lookup.
        unsupported=browser.new_context(ignore_https_errors=True,viewport={'width':393,'height':852})
        try:
            unsupported.add_cookies(context.cookies())
            unsupported.add_init_script("Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true})")
            plain=unsupported.new_page();plain.goto(URL+'/learn/index.html')
            plain.locator('#note-text').fill('public policy')
            plain.locator('#source-sentences .sentence-word').first.wait_for()
            assert plain.locator('#source-sentences .sentence-play').is_disabled()
            plain.get_by_role('button',name='查看 policy 的词义',exact=True).click()
            plain.wait_for_function('document.querySelector("#word-source").textContent.includes("来源")')
            assert plain.locator('#word-speak').is_disabled()
        finally:
            unsupported.close()
        print(json.dumps({'status':'pass','checks':['whole-example playback','stop/end/error/pagehide','stale speech ignored','actual local definitions and single-letter words','lookup races','preview and saved notes','literal HTML','mobile layout'],'speech':'mocked, no audible-device verification','model_calls':'one mocked analysis only'}))
    finally:
        context.close();browser.close()
