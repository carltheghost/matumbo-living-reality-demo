import {FEATURE_DEFINITIONS} from './feature-navigator.js';
export const CITY_DISTRICTS=Object.freeze([
  ['finance','Finance','paycore'],['academy','Academy','academy'],['t402','T402','t402'],
  ['contracts','Contracts','contracts'],['arena','Arena','arena'],['rooms','Rooms','rooms'],['receipt','Receipt evidence','ledger'],
].map(([id,label,feature])=>Object.freeze({id,label,feature})));

export function resolveCityRoute(search){
  const params=new URLSearchParams(search);
  if(!params.has('city'))return {status:'absent'};
  if(params.getAll('city').length!==1||params.getAll('feature').length!==1)return {status:'rejected'};
  const district=CITY_DISTRICTS.find(item=>item.id===params.get('city'));
  if(!district||params.get('feature')!==district.feature)return {status:'rejected'};
  // Do not combine this local route with provider, draft or executable handoffs.
  if(['panel','live','draft','contract','record','journey'].some(key=>params.has(key)))return {status:'rejected'};
  return {status:'valid',district};
}

export function mountCityJourney({navigate,documentRoot=document,windowRoot=window}){
  const root=documentRoot.createElement('section');root.id='city-journey';root.setAttribute('aria-label','Local City journey');
  root.style.cssText='position:fixed;top:8px;left:8px;z-index:9000;max-width:calc(100vw - 16px);color:#d9efff;background:#071827;border:1px solid #477a92;border-radius:8px;padding:6px;font:12px system-ui';
  const details=documentRoot.createElement('details'),summary=documentRoot.createElement('summary');summary.textContent='City districts';summary.style.cssText='min-height:36px;cursor:pointer;display:list-item;padding:8px';details.append(summary);
  const status=documentRoot.createElement('p');status.setAttribute('role','status');details.append(status);
  const nav=documentRoot.createElement('nav');nav.setAttribute('aria-label','City districts');nav.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;max-height:60vh;overflow:auto';details.append(nav);
  const buttons=[];
  for(const district of CITY_DISTRICTS){const button=documentRoot.createElement('button');button.textContent=district.label;button.dataset.district=district.id;button.style.cssText='min-height:44px;background:#10334a;color:#e4f5ff;border:1px solid #50839c;padding:8px';button.onclick=()=>{
    // Districts navigate through the canonical feature channel so the URL is
    // always the clean `?feature=<id>` form — never a legacy city URL.
    navigate(district.feature,'button');details.open=false;
  };nav.append(button);buttons.push(button);}
  root.append(details);documentRoot.body.append(root);
  function restore(event){const route=resolveCityRoute(windowRoot.location.search);root.dataset.routeStatus=route.status;
    for(const button of buttons)button.setAttribute('aria-current',String(route.status==='valid'&&route.district.id===button.dataset.district));
    if(route.status==='valid'){
      // Legacy city URLs still resolve, but the address bar is rewritten to
      // the canonical `?feature=<id>` form on arrival.
      const legacyUrl=new URL(windowRoot.location.href);
      legacyUrl.searchParams.delete('city');legacyUrl.searchParams.set('feature',route.district.feature);
      windowRoot.history.replaceState(null,'',legacyUrl);
      summary.textContent=`City · ${route.district.label}`;status.textContent='Local navigation only. Existing feature state; no new services.';navigate(route.district.feature);}
    else {summary.textContent='City districts';status.textContent=route.status==='rejected'?'City route rejected. Choose a valid district.':'Choose an existing local feature.';if(route.status==='rejected'){details.open=true;navigate('reality-lens');}
      else if(event?.type==='popstate'){
        const params=new URLSearchParams(windowRoot.location.search);
        // Specialized handoffs retain their existing handlers; restore only plain feature URLs.
        if(!['panel','live','draft','contract','record','journey','person'].some(key=>params.has(key))){
          const id=params.getAll('feature').length===1?params.get('feature'):null;
          navigate(FEATURE_DEFINITIONS.some(feature=>feature.id===id)?id:'reality-lens');details.open=false;
        }
      }
    }
  }
  restore();windowRoot.addEventListener('popstate',restore);
  windowRoot.addEventListener('city-journey:route-left',restore);
  return {destroy(){windowRoot.removeEventListener('popstate',restore);windowRoot.removeEventListener('city-journey:route-left',restore);root.remove();}};
}
