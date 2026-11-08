"""Actual panel DOM; fake account HTTP and memory store, not live provider evidence."""
import argparse,json,os,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--evidence',type=Path,required=True);args=p.parse_args()
root=Path(__file__).resolve().parents[4];args.evidence.mkdir(parents=True,exist_ok=True)
mem=(root/'services/vivo/web/phone/constructive-memory.mjs').read_text().replace('export ','')
ui=(root/'services/vivo/web/phone/ai-accounts-panel.mjs').read_text()
ui='\n'.join(l for l in ui.splitlines() if not l.startswith('import ')).replace('export ','')
checks=[]
def check(name,condition):
    assert condition,name
    checks.append(name)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_PATH') or shutil.which('chromium') or p.chromium.executable_path,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844});page.set_default_timeout(4000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('''<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px/1.55 system-ui;background:#0c181e;color:#dfebe4;margin:16px}button,input,select,textarea{font:inherit;max-width:100%;box-sizing:border-box}section{max-width:580px;margin:auto}fieldset{min-width:0;margin:15px 0;padding:12px;border:1px solid #48685d}fieldset button{min-height:44px;margin:5px}fieldset input{max-width:100%}textarea{width:100%}fieldset .row{display:flex;flex-wrap:wrap}pre{white-space:pre-wrap}a{color:#dfc88d}</style><div id="sheet"><p id="sentinel">Existing Vivo world controls retained</p></div>''')
    page.add_script_tag(content=mem+'\n'+ui+'\nwindow.mountIntelligence=mountIntelligence;')
    page.evaluate('''() => {
      window.calls=[];window.saved=new Map();window.scope={worldId:'world',projectId:'branch'};
      window.accounts={default:null,connections:[{id:'a',provider:'openai',label:'Personal',status:'authenticated'},{id:'b',provider:'openai',label:'Work',status:'authenticated'}]};
      window.pendingLogin=null;window.delayLogin=false;window.badURL=false;window.badResponse=false;
      const request=async(path,options)=>{
        calls.push({path,options});const b=options.body?JSON.parse(options.body):{};
        if(badResponse)return {ok:true,text:async()=>'<html>static host</html>'};
        if(path.endsWith('/login')&&delayLogin)return new Promise(resolve=>{pendingLogin=()=>resolve({ok:true,text:async()=>JSON.stringify({authorizationUrl:'https://auth.openai.com/api/accounts/authorize?state=late'})});});
        let data=accounts;
        if(path.endsWith('/login'))data={authorizationUrl:badURL?'https://invalid.example/authorize':'https://auth.openai.com/api/accounts/authorize?state=fixture'};
        if(path.endsWith('/default'))accounts.default=b.connectionId;
        if(path.endsWith('/models'))data={models:[{id:'fixture',label:'Fixture model'}]};
        if(path.endsWith('/verify')){accounts.connections.find(x=>x.id===b.connectionId).status='execution_verified';data={status:'execution_verified'};}
        if(path.endsWith('/disconnect')){accounts.connections.find(x=>x.id===b.connectionId).status='disconnected';data={remoteRevocationConfirmed:true};}
        return {ok:true,text:async()=>JSON.stringify(data)};
      };
      window.component=mountIntelligence({root:document.querySelector('#sheet'),request,getScope:()=>scope,
        store:{load:async s=>structuredClone(saved.get(JSON.stringify(s))),save:async(s,p)=>saved.set(JSON.stringify(s),structuredClone(p))}});
    }''')
    check('zero requests on mount; native world controls retained',page.evaluate('calls.length')==0 and page.locator('#sentinel').count()==1)
    check('six popular choices, ten total; details closed until selected',page.locator('.provider-row').count()==10 and page.locator('.provider-group').count()==3 and not page.locator('#vivoProviderDetail').is_visible())
    check('no password, API key or manual management-URL input',page.locator('input[type=password],input[type=url]').count()==0)
    check('no horizontal overflow at phone width',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.screenshot(path=str(args.evidence/'provider-picker-mobile.png'),full_page=True)
    search=page.get_by_role('searchbox',name='Search AI providers');search.fill('Claude')
    check('search filters rows without network calls',page.locator('.provider-row').count()==2 and page.evaluate('calls.length')==0)
    page.locator('[data-provider-id=claude-native]').click()
    check('Claude subscription shows native-flow boundary, no invented login', 'native Claude Code' in page.locator('#vivoProviderDetail').inner_text() and page.get_by_role('button',name='Sign in with ChatGPT').count()==0 and page.evaluate('calls.length')==0)
    page.get_by_role('button',name='Back to providers').click();search.fill('no-such-provider')
    check('empty search state is useful',page.get_by_text('No providers match. Try another name.').is_visible())
    search.fill('OpenAI');page.locator('[data-provider-id=openai-api]').click()
    check('API option cannot collect credentials without an adapter','not implemented' in page.locator('#vivoProviderDetail').inner_text() and page.locator('#vivoProviderDetail input').count()==0 and page.evaluate('calls.length')==0)
    before_add=page.evaluate('({calls:calls.length,accounts:JSON.stringify(accounts)})')
    page.get_by_role('button',name='Add another account',exact=True).click()
    check('add account resets search and selection without authentication or account changes',
          search.input_value()=='' and not page.locator('#vivoProviderDetail').is_visible()
          and page.locator('#vivoLoginArea a').count()==0
          and page.evaluate('({calls:calls.length,accounts:JSON.stringify(accounts)})')==before_add)
    row=page.locator('[data-provider-id=chatgpt-plan]');row.focus();row.press('Enter')
    check('provider row activates by keyboard; readable account detail',page.locator('#vivoProviderDetail').is_visible() and page.locator('#vivoAccountLabel').is_visible())
    check('provider selection alone does not initiate OAuth',page.evaluate('calls.length')==0)
    page.locator('#vivoAccountLabel').fill('Personal 2');page.get_by_role('button',name='Sign in with ChatGPT',exact=True).click()
    page.wait_for_selector('#vivoLoginArea a')
    check('explicit sign-in reaches existing same-origin account endpoint',page.evaluate("calls[0].path==='/api/vivo/accounts/login' && JSON.parse(calls[0].options.body).label==='Personal 2' && calls[0].options.credentials==='same-origin'"))
    link=page.get_by_role('link',name='Continue with ChatGPT',exact=True)
    check('official sign-in link; never marked connected by link creation',link.get_attribute('href').startswith('https://auth.openai.com/api/accounts/authorize?') and link.get_attribute('rel')=='noopener noreferrer' and 'No account is connected yet' in page.locator('#vivoAccountStatus').inner_text())
    page.get_by_role('button',name='Refresh account status').click()
    check('two same-provider accounts retain their separate identities',page.get_by_role('group',name='Personal',exact=True).count()==1 and page.get_by_role('group',name='Work',exact=True).count()==1)
    work=page.get_by_role('group',name='Work',exact=True);work.get_by_role('button',name='Use for new work').click()
    page.wait_for_function('accounts.default === "b"')
    check('default changes do not replace the other account',page.evaluate("accounts.connections.length===2 && accounts.connections[0].id==='a'"))
    work.get_by_role('button',name='Load this account’s models').click();page.wait_for_selector('select[aria-label="Model for Work"] option',state='attached')
    work.get_by_role('button',name='Verify one inference').click()
    check('inference still requires explicit consent',page.evaluate("calls.filter(c=>c.path.endsWith('/verify')).length") == 0)
    work.locator('input[type=checkbox]').check();work.get_by_role('button',name='Verify one inference').click();page.wait_for_function("accounts.connections[1].status==='execution_verified'")
    page.get_by_role('group',name='Personal',exact=True).get_by_role('button',name='Disconnect this account').click();page.wait_for_function("accounts.connections[0].status==='disconnected'")
    check('disconnect account A leaves B intact',page.evaluate("accounts.connections[1].status==='execution_verified'"))
    page.get_by_role('button',name='Load synthetic example').click();page.get_by_role('button',name='Compile and save these weights').click();page.wait_for_function('saved.size===1')
    page.get_by_role('button',name='Recall through the network').click();check('existing actual memory inference preserved',json.loads(page.locator('#vivoMemoryResult').inner_text())['value']==7)
    page.get_by_role('button',name='Restore this world’s memory').click();page.get_by_role('button',name='Recall through the network').click()
    check('memory restore preserved',json.loads(page.locator('#vivoMemoryResult').inner_text())['value']==7)
    page.evaluate('scope={worldId:"other",projectId:"branch"}');page.get_by_role('button',name='Recall through the network').click()
    check('memory remains world scoped','first' in page.locator('#vivoMemoryResult').inner_text())
    page.locator('[data-provider-id=chatgpt-plan]').click();page.evaluate('badURL=true');page.get_by_role('button',name='Sign in with ChatGPT',exact=True).click()
    page.wait_for_function("document.querySelector('#vivoAccountStatus').textContent.includes('Unexpected')")
    check('untrusted authorization URL rejected and old link removed',page.locator('#vivoLoginArea a').count()==0)
    page.evaluate('badURL=false;delayLogin=true');page.get_by_role('button',name='Sign in with ChatGPT',exact=True).click();page.wait_for_function('pendingLogin!==null')
    page.locator('[data-provider-id=claude-api]').click();page.evaluate('pendingLogin()');page.wait_for_timeout(30)
    check('late login response cannot repopulate another provider selection',page.locator('#vivoLoginArea a').count()==0 and 'Anthropic Claude' in page.locator('#vivoProviderDetail').inner_text())
    page.evaluate('delayLogin=false;badResponse=true');page.get_by_role('button',name='Refresh account status').click()
    page.wait_for_function("document.querySelector('#vivoAccountStatus').textContent.includes('companion')")
    check('static-host response gives an actionable companion message','existing accounts have not changed' in page.locator('#vivoAccountStatus').inner_text())
    page.get_by_role('button',name='Add another account',exact=True).click();page.set_viewport_size({'width':1280,'height':900});page.evaluate('scrollTo(0,0)')
    check('desktop does not overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.screenshot(path=str(args.evidence/'provider-picker-desktop.png'),full_page=True)
    check('no page errors',errors==[])
    browser.close()
(args.evidence/'provider-picker.json').write_text(json.dumps({'evidenceClass':'Actual Chromium component; mocked account HTTP, injected storage; no real sign-in, no full live app','passed':len(checks),'failed':0,'checks':checks,'pageErrors':errors,'realProviders':0},indent=2))
print(json.dumps({'passed':len(checks),'failed':0,'realProviders':0,'pageErrors':errors}))
