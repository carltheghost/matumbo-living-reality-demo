from __future__ import annotations
import asyncio,json,os,socket,sys,tempfile,time,unittest
from pathlib import Path
from urllib import request,error

ROOT=Path(__file__).resolve().parents[4]
SERVICES=ROOT/'services'/'vivo'

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));return s.getsockname()[1]

class AdaptiveEntrypointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.port=free_port();self.base=f'http://127.0.0.1:{self.port}'
        self.proc=await asyncio.create_subprocess_exec(
            sys.executable,'-m','server.local_application','--port',str(self.port),
            '--store','memory','--material-adaptive',cwd=SERVICES,
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            if self.proc.returncode is not None:
                out,err=await self.proc.communicate();self.fail(f'server exited: {out!r} {err!r}')
            try:
                status=await asyncio.to_thread(self.get,'/api/local/ready')
                if status.get('ok'):break
            except Exception:pass
            await asyncio.sleep(.1)
        else:self.fail('adaptive app readiness timeout')
    async def asyncTearDown(self):
        if self.proc.returncode is None:
            self.proc.terminate()
            try:await asyncio.wait_for(self.proc.wait(),5)
            except asyncio.TimeoutError:self.proc.kill();await self.proc.wait()
    def call(self,path,payload=None,token=None):
        data=None if payload is None else json.dumps(payload).encode()
        headers={'Content-Type':'application/json'}
        if data is not None:headers['Origin']=self.base
        if token:headers['Authorization']='Bearer '+token
        req=request.Request(self.base+path,data=data,headers=headers,method='POST' if data is not None else 'GET')
        with request.urlopen(req,timeout=5) as r:return json.load(r)
    def get(self,path):return self.call(path)
    async def open(self,seat):
        return await asyncio.to_thread(self.call,'/api/local/open',{'seat':seat})
    async def rpc(self,token,op,args=None):
        return await asyncio.to_thread(self.call,'/api/local/rpc',{'op':op,'args':args or {}},token)
    async def wait_for(self,token,predicate,timeout=8):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            state=(await self.rpc(token,'state'))['state']
            if predicate(state):return state
            await asyncio.sleep(.1)
        self.fail('state condition timeout')

    async def test_root_x4_and_inner_x11_learned_motion_with_independent_eyes(self):
        one=await self.open('one');two=await self.open('two');a,b=one['token'],two['token']
        state=one['state'];self.assertTrue(state['capabilities']['materialLearning'])
        self.assertEqual(state['capabilities']['material']['profile'],'adaptive-graph')
        eye2=json.loads(json.dumps(two['state']['eye']))
        async def command(token,sid,kind,expected,payload):
            return (await self.rpc(token,'submit',{'command':{'schema':'vivo.command/1','id':f't.{time.time_ns()}','worldId':state['snapshot']['worldId'],'spaceId':sid,'kind':kind,'expectedRevision':expected,'payload':payload}}))['value']
        lease=(await command(a,'root','grab.begin',0,{'entityId':'relic','source':'touch','inputEpoch':1}))['result']['leaseId']
        await command(a,'root','grab.target',0,{'entityId':'relic','leaseId':lease,'source':'touch','inputEpoch':1,'targetSeq':1,'dimension':4,'chart':'flat','q':[-1.2,-.15,.25,1],'sampleAgeMs':1})
        await self.rpc(a,'materialRun',{'running':True})
        moved=await self.wait_for(a,lambda s:s['snapshot']['spaces']['root']['entities']['relic']['q'][3]>0)
        self.assertGreater(moved['snapshot']['spaces']['root']['entities']['relic']['q'][3],0)
        self.assertEqual((await self.rpc(b,'state'))['state']['eye'],eye2)
        await command(a,'root','grab.end',moved['snapshot']['spaces']['root']['entities']['relic']['revision'],{'entityId':'relic','leaseId':lease,'inputEpoch':1,'reason':'done'})

        inner=(await self.rpc(a,'state'))['state']['snapshot']['spaces']['inner']['entities']['relic']
        lease2=(await command(a,'inner','grab.begin',inner['revision'],{'entityId':'relic','source':'keyboard','inputEpoch':2}))['result']['leaseId']
        q=list(inner['q']);q[10]=1
        await command(a,'inner','grab.target',inner['revision'],{'entityId':'relic','leaseId':lease2,'source':'keyboard','inputEpoch':2,'targetSeq':1,'dimension':11,'chart':'flat','q':q,'sampleAgeMs':1})
        moved2=await self.wait_for(a,lambda s:s['snapshot']['spaces']['inner']['entities']['relic']['q'][10]>0)
        self.assertGreater(moved2['snapshot']['spaces']['inner']['entities']['relic']['q'][10],0)
        await self.rpc(a,'materialRun',{'running':False})

    async def test_last_local_session_pauses_adaptive_host_without_fault_and_rejoins(self):
        opened = await self.open('one')
        token = opened['token']
        await self.rpc(token, 'materialRun', {'running': True})
        running = await self.wait_for(token, lambda state:
            state['materialHost']['running'] and state['materialHost']['acceptedSteps'] > 0)
        accepted_before_close = running['materialHost']['acceptedSteps']

        closed = await self.rpc(token, 'close')
        self.assertFalse(closed['state']['capabilities']['material']['running'])

        rejoined = await self.open('one')
        state = await self.wait_for(rejoined['token'], lambda current:
            not current['materialHost']['running'] and
            current['materialHost']['pauseReason'] == 'MATERIAL_PAUSED' and
            current['materialHost']['fault'] is None)
        self.assertEqual(state['materialHost']['pauseReason'], 'MATERIAL_PAUSED')
        self.assertGreaterEqual(state['materialHost']['acceptedSteps'], accepted_before_close)

        await self.rpc(rejoined['token'], 'materialRun', {'running': True})
        resumed = await self.wait_for(rejoined['token'], lambda current:
            current['materialHost']['running'] and
            current['materialHost']['acceptedSteps'] > accepted_before_close)
        self.assertIsNone(resumed['materialHost']['fault'], resumed['materialHost'])
        await self.rpc(rejoined['token'], 'materialRun', {'running': False})
        await self.rpc(rejoined['token'], 'close')

if __name__=='__main__':unittest.main()
