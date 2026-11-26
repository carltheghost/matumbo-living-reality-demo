"""Actual Station HTTP and native owner-face browser smoke. --native uses the original Vivo route.
Fixture mode uses only a synthetic native registry, never a real user world or memory store.
"""
import argparse, contextlib, json, os, tempfile, threading, uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from station import Station, serve
from client import call

ROOT = Path(__file__).resolve().parent
WEB = ROOT.parent / 'web'

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
    def list_directory(self, *_): self.send_error(403)
    def translate_path(self, path):
        from urllib.parse import unquote, urlsplit
        rel=unquote(urlsplit(path).path)
        if rel=='/fixture.html' and self.server.fixture:
            return str(self.server.fixture)
        prefix='/services/vivo/web/'
        if not rel.startswith(prefix): return str(WEB/'__missing__')
        p=(WEB/rel[len(prefix):]).resolve()
        return str(p if p.is_relative_to(WEB.resolve()) else WEB/'__missing__')

FIXTURE='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><main id="owner"></main><script type="module">
import {mountAgentStationFace} from '/services/vivo/web/phone/station-face.mjs';
const sessions=[];const engine={snapshot:async()=>({snapshot:{worldId:'station-ui-fixture'}})};
const admin={agents:()=>sessions,register:s=>{const row={...s,sessionId:crypto.randomUUID(),status:'active'};sessions.push(row);return row;},stop:async s=>{s.status='stopped';}};
const tools={listFor:s=>s.capabilities.map(c=>({name:'vivo.'+c})),invokeFor:async()=>engine.snapshot()};
mountAgentStationFace(document.querySelector('#owner'),{tools,admin,engine});</script>'''

def run(native=False, executable=None):
    with tempfile.TemporaryDirectory(prefix='vivo-station-ui-') as td, contextlib.ExitStack() as cleanup:
        p=Path(td); fixture=p/'fixture.html';fixture.write_text(FIXTURE,encoding='utf-8')
        web=ThreadingHTTPServer(('127.0.0.1',0),Handler);web.fixture=None if native else fixture
        origin='http://127.0.0.1:'+str(web.server_port)
        station=Station(p/'station.sqlite');cleanup.callback(station.db.close)
        # Fixed port is the original native face's local transport. Refuse collisions.
        api=serve(station,18761,[origin])
        for server in (web,api):
            t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
            cleanup.callback(server.server_close);cleanup.callback(t.join,5);cleanup.callback(server.shutdown)
        base='http://127.0.0.1:18761';world='station-ui-'+uuid.uuid4().hex if native else 'station-ui-fixture'
        o=station.enroll('owner','Fixture owner');h=station.enroll('host','Fixture host',world)
        a=station.enroll('agent','Fixture worker A',world,['world.read','mission.continue'])
        b=station.enroll('agent','Fixture worker B',world,['world.read','mission.continue'])
        def req(p,path,body=None):return call(path,body,p['token'],base)
        def own(path,body=None):return req(o,'/v1/owner/continuity/'+path,body)
        def create(agent,label):return own('create',{'agent':agent['id'],'objective':label,'grants':[],'request_id':uuid.uuid4().hex})['id']
        first=create(a,'Inspect fixture');last=create(b,'Review fixture');ids=[first,last]
        body={'id':last,'tasks':[{'id':x,'expected_revision':1,'minutes':{'optimistic':1,'nominal':2,'conservative':3},'units':2} for x in ids],
              'availability':[{'agent':x['id'],'available_after_minutes':0} for x in (a,b)],
              'alternatives':[{'name':'Reviewed chain','nodes':[{'id':first,'requires':[]},{'id':last,'requires':[first]}],'max_parallel':2,'overhead_units':0}],
              'deadline_minutes':20,'budget_units':4}
        with sync_playwright() as pw:
            opts={'headless':True}
            if executable:opts['executable_path']=executable
            browser=pw.chromium.launch(**opts)
            context=browser.new_context(viewport={'width':1280,'height':900});page=context.new_page();page.set_default_timeout(10000)
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            # No provider requests, third-party scripts, remote worlds or cameras.
            page.route('**/*',lambda route: route.continue_() if route.request.url.startswith((origin+'/',base+'/')) else route.abort())
            if native:
                page.add_init_script('localStorage.setItem("vivo.phone.worldId",'+json.dumps(world)+');')
                page.goto(origin+'/services/vivo/web/phone/',wait_until='domcontentloaded')
                page.locator('#enterPhoneLocal').click();page.wait_for_function('Boolean(window.VivaPhoneEngine?.active)')
                if page.locator('.vivo-companion-world-context > summary').count():
                    context_section=page.locator('.vivo-companion-world-context')
                    if not context_section.evaluate('n=>n.open'):page.locator('.vivo-companion-world-context > summary').click()
                page.locator('#phonePanelButton').click();page.locator('[data-local-cap="world.read"]').check(force=True)
                page.locator('[data-agent-station-mount] > summary').click()
            else:page.goto(origin+'/fixture.html')
            page.locator('#station-owner-key').fill(o['token']);page.locator('#station-host-key').fill(h['token'])
            page.get_by_role('button',name='Connect station',exact=True).click()
            page.get_by_role('button',name='Bind Fixture worker A',exact=True).click()
            page.get_by_role('button',name='Bind Fixture worker B',exact=True).click()
            page.wait_for_function('document.querySelector("[data-station-agents]").textContent.match(/Native session bound/g)?.length===2')
            assert page.locator('#station-owner-key').input_value()=='' and page.locator('#station-host-key').input_value()==''
            face=page.locator('[data-station-strategy]');face.locator('summary').click()
            for name in ('Inspect fixture','Review fixture'):face.get_by_label('Select mission '+name).check()
            face.get_by_role('button',name='Prepare request from selected missions').click()
            editor=face.get_by_label('Strategy request JSON');template=json.loads(editor.input_value());assert template['id'] is None and template['deadline_minutes'] is None
            raw=json.dumps(body);editor.fill(raw)
            compare=face.get_by_role('button',name='Compare strategy with Station');compare.click()
            face.get_by_text('Actual Station result: unique_nondominated',exact=False).wait_for()
            face.get_by_text('Optimistic / nominal / conservative minutes: 2 / 4 / 6',exact=True).wait_for()
            assert not own('organization/get',{'id':last})['member']
            face.get_by_role('button',name='Review Reviewed chain',exact=True).click()
            assert not own('organization/get',{'id':last})['member']
            # A changed request invalidates the staged decision without writing.
            editor.fill(raw+' ');assert face.get_by_role('button',name='Configure reviewed graph').count()==0
            compare.click();face.get_by_role('button',name='Review Reviewed chain',exact=True).click()
            page.set_viewport_size({'width':390,'height':844});face.get_by_role('button',name='Configure reviewed graph').click()
            page.wait_for_function('document.querySelector("[data-station-face]").textContent.includes("Graph configured") || !document.querySelector("[data-strategy-results]").textContent.includes("Actual Station result")')
            graph=own('organization/get',{'id':last});assert graph['member'] and len(graph['nodes'])==2
            assert req(o,'/v1/owner/actions')==[]
            # Current native observation and two-step inline owner review.
            m=req(a,'/v1/continuity/state',{'id':first});lease=uuid.uuid4().hex+uuid.uuid4().hex
            m=req(a,'/v1/continuity/claim',{'id':first,'expected_revision':m['revision'],'lease':lease,'ttl_seconds':120})
            bound={'id':first,'epoch':m['lease_epoch'],'lease':lease}
            obs=req(a,'/v1/continuity/observe',bound|{'request_id':'browser-read'})
            import time
            deadline=time.monotonic()+10
            while time.monotonic()<deadline and not req(a,'/v1/actions/'+obs['id'])['confirmed']:time.sleep(.15)
            assert req(a,'/v1/actions/'+obs['id'])['confirmed']
            req(a,'/v1/continuity/checkpoint',bound|{'expected_revision':m['revision'],'request_id':'browser-cp','progress':'Fixture observed','next_step':'Owner review','observation':obs['id'],'ready':True})
            page.get_by_role('button',name='Refresh agents and receipts').click();page.get_by_role('button',name='Inspect mission '+first[:8]).click()
            mission=page.locator('[data-continuity-mission="'+first+'"]');note=mission.get_by_label('Owner review note');note.fill('Reviewed fixture')
            mission.get_by_role('button',name='Accept reviewed checkpoint').click();assert req(a,'/v1/continuity/state',{'id':first})['phase']=='ready'
            note.fill('Revised note');assert mission.get_by_role('button',name='Confirm checkpoint acceptance').count()==0
            mission.get_by_role('button',name='Accept reviewed checkpoint').click();mission.get_by_role('button',name='Confirm checkpoint acceptance').click()
            mission.get_by_text('closed',exact=False).first.wait_for();assert req(a,'/v1/continuity/state',{'id':first})['phase']=='closed'
            assert len(req(o,'/v1/owner/actions'))==1
            page.get_by_role('button',name='Disconnect and stop local sessions').click();page.get_by_text('Disconnected · local sessions stopped',exact=True).wait_for()
            assert not errors, errors
            print(json.dumps({'actual_station_http':True,'native_route':native,'viewports':[[1280,900],[390,844]],'strategy_preview_no_write':True,'stale_preview_invalidated':True,'graph_configured':True,'confirmed_read':True,'inline_review_accepted':True,'native_edits':0,'page_errors':errors}))
            context.close();browser.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--native',action='store_true');parser.add_argument('--chromium');args=parser.parse_args();run(args.native,args.chromium)
