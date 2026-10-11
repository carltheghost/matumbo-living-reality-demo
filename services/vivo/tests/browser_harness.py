"""Container-only harness.

This environment blocks top-level navigation. Set the real DOM/scripts in an
about:blank page, and route its HTTP/WS traffic through real loopback HTTP/TCP.
The production client state machine, renderer and server run, but the browser
WebSocket constructor is replaced by a test-only relay to real TCP sockets. This tests
UI + protocol behavior, not deployment-origin/HTTPS/storage/browser policy.
"""
import asyncio,json,re
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import ClientSession,WSMsgType
ROOT=Path(__file__).resolve().parents[1]

async def mount(page,base='http://127.0.0.1:8765'):
    http=ClientSession();tasks=[]
    async def route(req):
        r=req.request;url=base+urlsplit(r.url).path
        if urlsplit(r.url).query:url+='?'+urlsplit(r.url).query
        headers={k:v for k,v in r.headers.items() if k.lower() in ['content-type','authorization']}
        if r.method=='OPTIONS':
            await req.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'});return
        async with http.request(r.method,url,headers=headers,data=r.post_data_buffer) as response:
            data=await response.read();hs={'Access-Control-Allow-Origin':'*','Content-Type':response.headers.get('Content-Type','application/octet-stream')}
            await req.fulfill(status=response.status,body=data,headers=hs)
    await page.route('https://viva.test/**',route)
    sockets={}
    async def open_socket(sid):
        sock=await http.ws_connect(base+'/ws');sockets[sid]=sock
        async def forward():
            try:
                async for msg in sock:
                    if msg.type==WSMsgType.TEXT:
                        await page.evaluate("([id,data])=>window.__testSockets[id]?.onmessage?.({data})",[sid,msg.data])
            except Exception:pass
            finally:
                try:await page.evaluate("id=>{const s=window.__testSockets[id];if(s&&s.readyState!==3){s.readyState=3;s.onclose?.({});}}",sid)
                except Exception:pass
        tasks.append(asyncio.create_task(forward()))
        return True
    async def send_socket(sid,data):await sockets[sid].send_str(data)
    async def close_socket(sid):
        if sid in sockets:await sockets[sid].close()
    await page.expose_function('__openSocket',open_socket)
    await page.expose_function('__sendSocket',send_socket)
    await page.expose_function('__closeSocket',close_socket)
    html=(ROOT/'web/index.html').read_text().replace('<head>','<head><base href="https://viva.test/">')
    html=re.sub(r'<script type="module" src="shared.js"></script>','',html)
    html=html.replace('<link rel="stylesheet" href="shared.css">','<style>'+(ROOT/'web/shared.css').read_text()+'</style>')
    await page.set_content(html)
    await page.evaluate('''()=>{if(!crypto.randomUUID)crypto.randomUUID=()=>{const a=crypto.getRandomValues(new Uint8Array(16));return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');};}''')
    await page.evaluate("""()=>{
      window.__testSockets={};let serial=0;
      window.WebSocket=class {
        static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
        constructor(url){this.url=String(url);this.readyState=0;this.id='socket'+(++serial);window.__testSockets[this.id]=this;
          window.__openSocket(this.id).then(()=>{if(this.readyState===0){this.readyState=1;this.onopen?.({});}}).catch(()=>this.onerror?.({}));}
        send(data){if(this.readyState!==1)throw Error('Socket not open');window.__sendSocket(this.id,data).catch(()=>this.onerror?.({}));}
        close(){if(this.readyState===3)return;this.readyState=3;window.__closeSocket(this.id).finally(()=>this.onclose?.({}));}
      };
    }""")
    render=(ROOT/'web/render.js').read_text().replace('export ','')
    camera=(ROOT/'web/camera.js').read_text().replace('export ','').replace('import.meta.url','"https://viva.test/camera.js"')
    main=(ROOT/'web/shared.js').read_text();main=re.sub(r'^import .*?;\n','',main,flags=re.M)
    script='(()=>{'+render+'\nwindow.__Render={Renderer,embed};})();\n(()=>{'+camera+'\nwindow.__Camera={Camera};})();\n(()=>{const {Renderer,embed}=window.__Render;const {Camera}=window.__Camera;\n'+main+'\n})();'
    await page.add_script_tag(content=script)
    await page.wait_for_function('window.VivaShared?.R')
    async def cleanup():
        for t in tasks:t.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        await http.close()
    return cleanup
