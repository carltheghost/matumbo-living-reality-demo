/**
 * Social Mirror bootstrap (auto-mount).
 *
 * Imported at the top of main.js so the console + ticker mount before
 * mountCenteredSurfaces()/initMobilePanelManager() discover panels.
 * Syncs the console open state with the ?feature=social-mirror URL, so
 * 3-D cube double-click, feature-navigator selection, and direct URLs
 * all open the full feed world.
 *
 * Official embeds only (X timeline widget, YouTube iframe). Snapchat and
 * Meta are connect placeholders. Never asks for, accepts, or stores
 * credentials, API keys, tokens, or secrets. Simulated points only —
 * no money, no wagering, no wallets anywhere.
 */
import{mountSocialMirrorFeature}from'./social-mirror.js';
const socialMirror=mountSocialMirrorFeature({documentRoot:document});
if(socialMirror){
const syncSocialMirrorFromUrl=()=>{
try{
const active=new URLSearchParams(location.search).get('feature');
if(active==='social-mirror'){socialMirror.console.open('url-sync');}
else if(socialMirror.console.getSnapshot().opened){socialMirror.console.close();}
}catch{}};
const origReplaceState=history.replaceState.bind(history);
history.replaceState=function(...args){origReplaceState(...args);syncSocialMirrorFromUrl();};
window.addEventListener('popstate',syncSocialMirrorFromUrl);
syncSocialMirrorFromUrl();
window.__TUMBO_SOCIAL_MIRROR__=socialMirror;
}
export default socialMirror;
