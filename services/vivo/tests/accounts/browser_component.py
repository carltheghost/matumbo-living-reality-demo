"""Permitted DOM component checks. No navigation/policy bypass or live OAuth claim.
Run from repo root. Writes bounded screenshots/JSON to the chosen evidence folder.
"""
import argparse,json,os,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--evidence',type=Path,required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[4];out=args.evidence;out.mkdir(parents=True,exist_ok=True)
mem=(root/'services/vivo/web/phone/constructive-memory.mjs').read_text().replace('export ','')
ui=(root/'services/vivo/web/phone/ai-accounts-panel.mjs').read_text();ui='\n'.join(line for line in ui.splitlines() if not line.startswith('import '));ui=ui.replace('export ','')
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_PATH') or shutil.which('chromium') or shutil.which('google-chrome') or p.chromium.executable_path,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.set_default_timeout(4000);page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('''<style>body{font:15px system-ui;background:#081920;color:#ddf1ee;margin:16px}button,input,select,textarea{font:inherit;padding:10px;margin:5px 0;max-width:100%;box-sizing:border-box}button{background:#b7eddb;color:#08241e;border:0;border-radius:6px}section{max-width:580px}textarea{width:100%;background:#102c33;color:#d9f4ed}fieldset{margin:12px 0;border:1px solid #496663}pre{background:#102c33;padding:12px}</style><div id="native-phone-sheet"><p id="nativeSentinel">Existing Vivo controls retained</p></div>''')
    page.add_script_tag(content=mem+'\n'+ui+'\nwindow.mountIntelligence=mountIntelligence;')
    page.evaluate('''() => {
      window.scope={worldId:'world',projectId:'branch'};window.calls=[];window.saved=new Map();
      window.accounts={default:null,connections:[{id:'a',provider:'openai',label:'Personal',status:'authenticated',accountHint:'account 1234',registrationHint:'abcd'},{id:'b',provider:'openai',label:'Work',status:'authenticated',accountHint:'account 9876',registrationHint:'efgh'}]};
      const request=async(path,options)=>{
        calls.push({path,options});const b=options.body?JSON.parse(options.body):{};let data=accounts;
        if(path.endsWith('/login'))data={authorizationUrl:'https://auth.openai.com/api/accounts/authorize?state=fixture',expiresIn:300};
        if(path.endsWith('/default'))accounts.default=b.connectionId;
        if(path.endsWith('/models'))data={models:[{id:'fixture-model',label:'Fixture model'}]};
        if(path.endsWith('/verify')){accounts.connections.find(x=>x.id===b.connectionId).status='execution_verified';data={status:'execution_verified'};}
        if(path.endsWith('/disconnect')){accounts.connections.find(x=>x.id===b.connectionId).status='disconnected';data={remoteRevocationConfirmed:true};}
        return {ok:true,text:async()=>JSON.stringify(data)};
      };
      window.component=mountIntelligence({root:document.querySelector('#native-phone-sheet'),request,getScope:()=>scope,
        store:{load:async s=>structuredClone(saved.get(JSON.stringify(s))),save:async(s,p)=>saved.set(JSON.stringify(s),structuredClone(p))}});
    }''')
    assert page.evaluate('calls.length')==0
    assert page.locator('#nativeSentinel').count()==1;print('passed stage',len(checks)+1,flush=True);checks.append('mount preserves native DOM; zero automatic provider requests')
    page.get_by_role('button',name='Refresh account status').click();page.wait_for_function('calls.length===1')
    assert page.get_by_role('group',name='Personal').count()==1 and page.get_by_role('group',name='Work').count()==1
    print('passed stage',len(checks)+1,flush=True);checks.append('two same-provider connections render separately')
    work=page.get_by_role('group',name='Work');work.get_by_role('button',name='Use for new work').click()
    page.wait_for_function('accounts.default === "b"');print('passed stage',len(checks)+1,flush=True);checks.append('default selects connection B without replacing A')
    page.locator('#vivoAccountLabel').fill('Another account');page.get_by_role('button',name='Add another account').click()
    page.wait_for_selector('a:has-text("Continue with ChatGPT")');assert page.get_by_role('link',name='Continue with ChatGPT').get_attribute('rel')=='noopener noreferrer'
    print('passed stage',len(checks)+1,flush=True);checks.append('explicit sign-in action shows official provider-owned URL; no navigation performed')
    work=page.get_by_role('group',name='Work');work.get_by_role('button',name='Load this account’s models').click()
    page.wait_for_selector('select[aria-label="Model for Work"] option',state='attached');work.get_by_role('button',name='Verify one inference').click()
    assert 'consent' in page.locator('#vivoAccountStatus').inner_text();assert page.evaluate('calls.filter(x=>x.path.endsWith("/verify")).length')==0
    work.locator('input[type=checkbox]').check();work.get_by_role('button',name='Verify one inference').click()
    page.wait_for_function('accounts.connections[1].status === "execution_verified"');print('passed stage',len(checks)+1,flush=True);checks.append('verification requires separate explicit consent and selects B only')
    page.get_by_role('group',name='Personal').get_by_role('button',name='Disconnect this account').click()
    page.wait_for_function('accounts.connections[0].status === "disconnected"');assert page.evaluate('accounts.connections[1].status')=='execution_verified'
    print('passed stage',len(checks)+1,flush=True);checks.append('disconnect A leaves B and project DOM intact')
    page.get_by_role('button',name='Load synthetic example').click();page.get_by_role('button',name='Compile and save these weights').click()
    page.wait_for_function('saved.size===1');page.get_by_role('button',name='Recall through the network').click()
    assert json.loads(page.locator('#vivoMemoryResult').inner_text())['value']==7
    page.get_by_role('button',name='Restore this world’s memory').click();page.get_by_role('button',name='Recall through the network').click()
    assert json.loads(page.locator('#vivoMemoryResult').inner_text())['value']==7;print('passed stage',len(checks)+1,flush=True);checks.append('actual explicit-weight inference and detached restore in browser component')
    page.evaluate('scope={worldId:"other",projectId:"branch"}')
    page.get_by_role('button',name='Recall through the network').click();assert 'first' in page.locator('#vivoMemoryResult').inner_text()
    print('passed stage',len(checks)+1,flush=True);checks.append('world switch cannot recall the previous scope')
    assert errors==[],errors
    page.screenshot(path=str(out/'accounts-component-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1280,'height':900});page.screenshot(path=str(out/'accounts-component-desktop.png'),full_page=True)
    browser.close()
(out/'component.json').write_text(json.dumps({'evidenceClass':'Chromium DOM component with fake account HTTP and injected persistence; NOT live sign-in/full app',
 'checks':checks,'passed':len(checks),'pageErrors':errors,'realProviders':0},indent=2))
print(json.dumps({'passed':len(checks),'realProviders':0,'pageErrors':errors}))
