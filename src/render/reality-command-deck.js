import { FEATURE_DEFINITIONS } from './feature-navigator.js?v=20260922-commanddeck1';

const STYLE = `
#matumbo-command-deck{
  position:fixed;inset:0;z-index:8000;pointer-events:none;
  font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#eaf7ff;
}
#matumbo-command-deck *{box-sizing:border-box}
#matumbo-command-deck .mcd-panel{
  pointer-events:auto;position:absolute;border:1px solid rgba(145,220,255,.18);
  background:linear-gradient(145deg,rgba(7,16,29,.82),rgba(2,7,14,.62));
  backdrop-filter:blur(22px) saturate(125%);box-shadow:0 18px 70px rgba(0,0,0,.32),inset 0 1px rgba(255,255,255,.05);
  border-radius:18px;
}
#matumbo-command-deck .mcd-top{
  left:50%;top:18px;transform:translateX(-50%);width:min(760px,calc(100vw - 36px));
  min-height:58px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;
}
#matumbo-command-deck .mcd-brand{letter-spacing:.14em;font-weight:800;font-size:12px}
#matumbo-command-deck .mcd-sub{font-size:10px;opacity:.5;letter-spacing:.08em}
#matumbo-command-deck .mcd-status{display:flex;gap:7px;align-items:center;font-size:10px;opacity:.72}
#matumbo-command-deck .mcd-dot{width:7px;height:7px;border-radius:50%;background:#76ecff;box-shadow:0 0 14px #76ecff}
#matumbo-command-deck .mcd-left{
  left:18px;top:94px;width:285px;max-height:calc(100vh - 190px);padding:15px;overflow:hidden;
}
#matumbo-command-deck .mcd-right{
  right:18px;top:94px;width:285px;max-height:calc(100vh - 190px);padding:15px;overflow:auto;
}
#matumbo-command-deck .mcd-bottom{
  left:50%;bottom:18px;transform:translateX(-50%);padding:10px;display:flex;gap:7px;align-items:center;
}
#matumbo-command-deck h3{margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
#matumbo-command-deck .mcd-kicker{font-size:9px;letter-spacing:.16em;opacity:.46;text-transform:uppercase}
#matumbo-command-deck .mcd-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:calc(100vh - 275px);overflow:auto;padding-right:3px}
#matumbo-command-deck button{
  border:1px solid rgba(145,220,255,.12);background:rgba(12,27,43,.52);color:#dff6ff;
  border-radius:10px;padding:9px 8px;text-align:left;cursor:pointer;transition:.16s ease;
}
#matumbo-command-deck button:hover{border-color:rgba(145,220,255,.48);transform:translateY(-1px);background:rgba(20,43,65,.7)}
#matumbo-command-deck .mcd-feature strong{display:block;font-size:10px;line-height:1.2}
#matumbo-command-deck .mcd-feature span{display:block;margin-top:3px;font-size:8px;opacity:.48}
#matumbo-command-deck .mcd-selected{border-color:rgba(243,207,115,.7)!important;box-shadow:0 0 20px rgba(243,207,115,.08)}
#matumbo-command-deck .mcd-section{margin-top:14px;padding-top:12px;border-top:1px solid rgba(145,220,255,.08)}
#matumbo-command-deck .mcd-inspector{font-size:10px;line-height:1.5;color:#bcd6ea}
#matumbo-command-deck .mcd-inspector b{display:block;color:#fff;font-size:15px;margin:4px 0}
#matumbo-command-deck .mcd-pill{display:inline-block;margin:4px 4px 0 0;padding:5px 7px;border:1px solid rgba(145,220,255,.13);border-radius:999px;font-size:8px;opacity:.72}
#matumbo-command-deck .mcd-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
#matumbo-command-deck .mcd-action{text-align:center}
#matumbo-command-deck .mcd-gold{border-color:rgba(243,207,115,.28)}
#matumbo-command-deck .mcd-note{font-size:9px;line-height:1.45;opacity:.55}
#matumbo-command-deck .mcd-count{font-size:9px;opacity:.42;margin-bottom:8px}
@media(max-width:900px){
  #matumbo-command-deck .mcd-left{left:8px;width:205px}
  #matumbo-command-deck .mcd-right{right:8px;width:205px}
  #matumbo-command-deck .mcd-top{top:8px}
  #matumbo-command-deck .mcd-bottom{bottom:8px}
}
@media(max-width:700px){
  #matumbo-command-deck .mcd-left{display:none}
  #matumbo-command-deck .mcd-right{left:8px;right:8px;bottom:72px;top:auto;width:auto;max-height:31vh}
  #matumbo-command-deck .mcd-bottom{max-width:calc(100vw - 16px);overflow:auto}
}
`;

function mount(){
  if(document.getElementById('matumbo-command-deck')) return;
  const style=document.createElement('style');style.textContent=STYLE;document.head.appendChild(style);
  const root=document.createElement('div');root.id='matumbo-command-deck';
  root.innerHTML=`
    <div class="mcd-panel mcd-top">
      <div><div class="mcd-brand">maTumbo · REALITY LENS Ω</div><div class="mcd-sub">ONE REALITY · MANY WORLDS · SPATIAL COMMAND DECK</div></div>
      <div class="mcd-status"><span class="mcd-dot"></span><span data-status>ASSEMBLING REALITY</span></div>
    </div>
    <aside class="mcd-panel mcd-left">
      <div class="mcd-kicker">WORLD MAP</div>
      <h3>Every Reality</h3>
      <div class="mcd-count" data-count></div>
      <div class="mcd-grid" data-features></div>
    </aside>
    <aside class="mcd-panel mcd-right">
      <div class="mcd-kicker">REALITY LENS</div>
      <h3>Object / Reality Inspector</h3>
      <div class="mcd-inspector" data-inspector>
        <b>ROOT REALITY</b>
        Choose any world, feature, room, agent, contract, field, or tool from the map.
      </div>
      <div class="mcd-section">
        <div class="mcd-kicker">REALITY OPERATIONS</div>
        <div class="mcd-actions">
          <button class="mcd-action mcd-gold" data-reality25>REALITY .25</button>
          <button class="mcd-action" data-feature>FEATURE DIRECTORY</button>
          <button class="mcd-action" data-branch>NEW SIDE REALITY</button>
          <button class="mcd-action" data-timeline>4D TIMELINE</button>
        </div>
      </div>
      <div class="mcd-section">
        <div class="mcd-kicker">SYSTEM LAYERS</div>
        <span class="mcd-pill">WORLD MAP</span><span class="mcd-pill">OBJECTS</span><span class="mcd-pill">BRANCHES</span>
        <span class="mcd-pill">PORTALS</span><span class="mcd-pill">CONTRACTS</span><span class="mcd-pill">PEOPLE</span>
        <span class="mcd-pill">AGENTS</span><span class="mcd-pill">MARKETS</span><span class="mcd-pill">XR</span>
      </div>
      <div class="mcd-section mcd-note">This deck is presentation-only. Existing feature domains remain the source of truth; selecting a tile routes through the existing feature navigator.</div>
    </aside>
    <div class="mcd-panel mcd-bottom">
      <button data-home>ROOT</button><button data-map>WORLD MAP</button><button data-person>PERSON</button><button data-blocks>BLOCK WORLD</button><button data-agent>AGENT</button><button data-contracts>CONTRACTS</button><button data-arena>ARENA</button><button data-lens>HAND LENS</button>
    </div>`;
  document.body.appendChild(root);

  const features=root.querySelector('[data-features]');
  const inspector=root.querySelector('[data-inspector]');
  const status=root.querySelector('[data-status]');
  const count=root.querySelector('[data-count]');
  count.textContent=`${FEATURE_DEFINITIONS.length} registered realities / local feature surfaces`;

  const category=(f)=>{
    const id=f.id;
    if(['person','wardrobe-atelier','gesture-lens'].includes(id))return 'PERSON';
    if(['block-world','runtime-sync','migration'].includes(id))return 'WORLDS';
    if(['contracts','contract-atelier','asset-market','asset-token','paycore','t402','ledger','nft-atelier'].includes(id))return 'VALUE';
    if(['agent','gateway','web-ai','rooms','social-explorer','social-mirror'].includes(id))return 'NETWORK';
    if(['arena','chess','academy','sports-events','multi-sport-events','world-events'].includes(id))return 'ACTIVITY';
    return 'SYSTEM';
  };

  function select(id){
    const button=document.getElementById('feature-button-'+id);
    if(button){button.click();return true;}
    const fallback=document.querySelector(`[data-feature-id="${id}"]`);
    if(fallback){fallback.click();return true;}
    return false;
  }

  FEATURE_DEFINITIONS.forEach((feature)=>{
    const b=document.createElement('button');b.className='mcd-feature';b.dataset.id=feature.id;
    b.innerHTML=`<strong>${feature.label}</strong><span>${category(feature)} · ${feature.kicker}</span>`;
    b.onclick=()=>{
      select(feature.id);
      inspector.innerHTML=`<div class="mcd-kicker">${category(feature)} / ACTIVE</div><b>${feature.label}</b><div>${feature.description}</div><div class="mcd-section mcd-note">${feature.boundary}</div>`;
      root.querySelectorAll('.mcd-feature').forEach(x=>x.classList.toggle('mcd-selected',x===b));
      status.textContent=`REALITY · ${feature.label.toUpperCase()}`;
    };
    features.appendChild(b);
  });

  const wire=(sel,id)=>root.querySelector(sel)?.addEventListener('click',()=>select(id));
  wire('[data-home]','reality-lens');wire('[data-map]','reality-lens');wire('[data-person]','person');
  wire('[data-blocks]','block-world');wire('[data-agent]','agent');wire('[data-contracts]','contracts');
  wire('[data-arena]','arena');wire('[data-lens]','gesture-lens');

  root.querySelector('[data-feature]')?.addEventListener('click',()=>document.getElementById('feature-toggle')?.click());
  root.querySelector('[data-reality25]')?.addEventListener('click',()=>document.getElementById('matumbo-reality25-launcher')?.click());
  root.querySelector('[data-branch]')?.addEventListener('click',()=>{
    inspector.innerHTML='<div class="mcd-kicker">SIDE REALITY</div><b>NEW BRANCH READY</b><div>Branching is presented as a local architectural operation. The existing branch/timeline surfaces remain authoritative for stored state.</div>';
    status.textContent='SIDE REALITY · READY';
  });
  root.querySelector('[data-timeline]')?.addEventListener('click',()=>{
    inspector.innerHTML='<div class="mcd-kicker">4D / TIMELINE</div><b>SPACE + HISTORY</b><div>Use the existing Reality Assembly timeline surface to inspect local layout history and proposed branches.</div>';
    status.textContent='4D TIMELINE · READY';
  });

  const legacy=document.getElementById('feature-shell');
  if(legacy)legacy.setAttribute('data-command-deck-hidden','true');

  const refresh=()=>{
    const active=document.querySelector('.feature-button[aria-pressed="true"]')?.dataset.featureId;
    root.querySelectorAll('.mcd-feature').forEach(b=>b.classList.toggle('mcd-selected',b.dataset.id===active));
    if(active){const f=FEATURE_DEFINITIONS.find(x=>x.id===active);if(f){status.textContent=`REALITY · ${f.label.toUpperCase()}`;inspector.innerHTML=`<div class="mcd-kicker">${category(f)} / ACTIVE</div><b>${f.label}</b><div>${f.description}</div>`;}}
  };
  setInterval(refresh,500);
  refresh();
  status.textContent='REALITY LENS Ω · READY';
}

let tries=0;
function boot(){if(document.body&&document.getElementById('feature-shell')){mount();return;}if(++tries<120)setTimeout(boot,250);}
boot();
