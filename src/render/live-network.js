import { createLiveNetworkClient } from "../domains/live-network.js";

export function mountLiveNetworkConsole({ documentRoot = globalThis.document, client = createLiveNetworkClient() } = {}) {
  if (!documentRoot?.body) return null;
  if (documentRoot.getElementById("matumbo-live-console")) return documentRoot.getElementById("matumbo-live-console");
  const style = documentRoot.createElement("style");
  style.textContent = `
    #matumbo-live-console{position:fixed;right:18px;bottom:18px;z-index:180;width:min(390px,calc(100vw - 36px));max-height:min(78vh,720px);overflow:auto;padding:14px;border:1px solid rgba(125,232,255,.25);border-radius:16px;background:rgba(3,10,15,.94);color:#dff7ff;box-shadow:0 24px 80px rgba(0,0,0,.5);backdrop-filter:blur(18px);font:12px/1.4 system-ui,sans-serif}
    #matumbo-live-console[hidden]{display:none}#matumbo-live-console h3{margin:0;font-size:14px;letter-spacing:.08em;text-transform:uppercase}
    #matumbo-live-console .ml-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}
    #matumbo-live-console input,#matumbo-live-console select{width:100%;box-sizing:border-box;padding:8px;border:1px solid rgba(126,224,246,.2);border-radius:8px;background:#07131a;color:#e8fbff}
    #matumbo-live-console button{padding:8px 9px;border:1px solid rgba(126,224,246,.25);border-radius:8px;background:#0a2029;color:#d9faff;cursor:pointer}
    #matumbo-live-console button:hover{border-color:#8beaff}.ml-row{display:flex;gap:7px;align-items:center;margin-top:8px}.ml-row>*{flex:1}
    .ml-status{margin-top:8px;color:#9fc0ca}.ml-status.ok{color:#8de0b8}.ml-status.err{color:#ffabb2}
    .ml-card{margin-top:9px;padding:9px;border:1px solid rgba(126,224,246,.12);border-radius:10px;background:rgba(10,31,40,.6)}
    .ml-list{display:grid;gap:5px;max-height:180px;overflow:auto}.ml-small{font-size:10px;color:#769aa5}
  `;
  documentRoot.head.appendChild(style);
  const open = documentRoot.createElement("button"); open.textContent = "LIVE NETWORK"; open.id = "matumbo-live-open";
  Object.assign(open.style,{position:"fixed",right:"18px",bottom:"18px",zIndex:"179",padding:"10px 13px",borderRadius:"999px",border:"1px solid rgba(125,232,255,.28)",background:"rgba(3,12,18,.82)",color:"#dff7ff",cursor:"pointer"});
  const panel = documentRoot.createElement("section"); panel.id="matumbo-live-console"; panel.hidden=true; panel.setAttribute("aria-label","Live network");
  panel.innerHTML=`
    <div class="ml-row"><div><h3>Live Network</h3><div class="ml-small">accounts · multiplayer · prediction-market data · consented event collection</div></div><button data-close>×</button></div>
    <div class="ml-card"><label class="ml-small">API endpoint</label><input data-api placeholder="https://your-api.example.com"></div>
    <div class="ml-row"><button data-health>Check API</button><button data-markets>Refresh markets</button></div>
    <div class="ml-card"><div class="ml-small">ACCOUNT</div><div class="ml-grid"><input data-user placeholder="username"><input data-name placeholder="display name"><input data-pass type="password" placeholder="password (10+ chars)"><button data-register>Register</button></div><div class="ml-row"><button data-login>Log in</button><button data-logout>Log out</button></div><div data-auth class="ml-status">Not signed in.</div></div>
    <div class="ml-card"><div class="ml-small">MULTIPLAYER ROOM</div><div class="ml-row"><input data-room value="lobby"><button data-join>Join</button></div><div data-members class="ml-list"></div><div data-feed class="ml-list ml-small"></div><div class="ml-row"><input data-message placeholder="message"><button data-send>Send</button></div></div>
    <div class="ml-card"><div class="ml-small">PREDICTION MARKETS · READ ONLY</div><select data-provider><option value="all">All supported providers</option><option value="kalshi">Kalshi</option><option value="polymarket">Polymarket</option><option value="manifold">Manifold</option></select><div data-market-status class="ml-status">Not refreshed.</div><div data-market-list class="ml-list"></div></div>
    <div class="ml-card"><label><input data-consent type="checkbox"> I consent to collect my account's app events (never raw camera/audio/credentials).</label><div class="ml-row"><button data-export>Export my data</button><button data-share>Copy share link</button></div></div>
    <div data-status class="ml-status">Live API is optional. The local demo works without it.</div>`;
  documentRoot.body.append(open,panel);
  const q = s => panel.querySelector(s); let room="lobby"; let stream=null; let sequence=0;
  const status=(text,kind="")=>{const el=q("[data-status]");el.textContent=text;el.className="ml-status "+kind;};
  const renderMembers=(items=[])=>{q("[data-members]").innerHTML=items.map(m=>`<div>${m.user.displayName} · ${m.state} <span class="ml-small">${m.seenAt}</span></div>`).join("")||'<div class="ml-small">No active members.</div>';};
  async function members(){try{renderMembers((await client.members(room)).members)}catch{}}
  async function markets(){try{q("[data-market-status]").textContent="Refreshing…";const data=await client.markets(q("[data-provider]").value,50);q("[data-market-status]").textContent=`${data.records.length} live observations · ${data.retrievedAt}`;q("[data-market-list]").innerHTML=data.records.slice(0,30).map(r=>`<div><b>${r.provider}</b> · ${r.title}<div class="ml-small">probability ${r.probability==null?"—":Math.round(r.probability*100)+"%"} · ${r.status}</div></div>`).join("")||'<div class="ml-small">No records returned.</div>'}catch(e){q("[data-market-status]").textContent=e.message}}
  q("[data-api]").value=client.base||"";
  q("[data-health]").onclick=async()=>{try{const h=await fetch(client.base+"/api/health").then(r=>r.json());status(`API online · ${h.storage} · accounts ${h.accounts} · multiplayer ${h.multiplayer}`,"ok")}catch(e){status(e.message,"err")}};
  q("[data-markets]").onclick=markets; q("[data-provider]").onchange=markets;
  q("[data-api]").onchange=e=>{client.configure(e.target.value);status(client.base?"API configured.":"API not configured.")};
  q("[data-register]").onclick=async()=>{try{await client.register(q("[data-user]").value,q("[data-pass]").value,q("[data-name]").value);status("Account created. Log in to continue.","ok")}catch(e){status(e.message,"err")}};
  q("[data-login]").onclick=async()=>{try{const d=await client.login(q("[data-user]").value,q("[data-pass]").value);q("[data-auth]").textContent=`Signed in as ${d.user.displayName}`;status("Signed in.","ok")}catch(e){status(e.message,"err")}};
  q("[data-logout]").onclick=async()=>{await client.logout();q("[data-auth]").textContent="Not signed in.";stream?.close();stream=null};
  q("[data-join]").onclick=async()=>{room=q("[data-room]").value.trim()||"lobby";await members();stream?.close();stream=client.stream(room,sequence,event=>{sequence=Math.max(sequence,event.sequence||0);q("[data-feed]").prepend(Object.assign(documentRoot.createElement("div"),{textContent:event.type+" · "+(event.user?.displayName||"system")}));members()});try{await client.presence(room,{state:"online"});status(`Joined ${room}`,"ok")}catch(e){status(e.message,"err")}};
  q("[data-send]").onclick=async()=>{const input=q("[data-message]");if(!input.value.trim())return;try{await client.postEvent(room,"message",{text:input.value.trim()});input.value=""}catch(e){status(e.message,"err")}};
  q("[data-export]").onclick=async()=>{try{const data=await client.exportData();const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const a=documentRoot.createElement("a");a.href=URL.createObjectURL(blob);a.download="matumbo-my-data.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){status(e.message,"err")}};
  q("[data-share]").onclick=async()=>{const api=client.base;const link=api?location.origin+location.pathname+"?api="+encodeURIComponent(api):location.href;try{await navigator.clipboard.writeText(link);status("Share link copied.","ok")}catch{status(link)}};
  q("[data-close]").onclick=()=>{panel.hidden=true;open.hidden=false};open.onclick=()=>{panel.hidden=false;open.hidden=true};
  return Object.freeze({ open:()=>{panel.hidden=false;open.hidden=true}, close:()=>{panel.hidden=true;open.hidden=false}, client });
}
