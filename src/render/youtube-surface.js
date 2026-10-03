const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID=/^[A-Za-z0-9_-]{10,120}$/;
const surfaceControllers=new WeakMap();
const SEARCH_TIMEOUT_MS=4500;

function abortError(){return new DOMException('YouTube search was cancelled.','AbortError');}

/** Bound both the connection and JSON body, even if a fetch adapter ignores abort. */
async function fetchSearchPayload(fetchFn,url,{signal,timeoutMs}){
  if(signal?.aborted)throw abortError();
  const controller=new AbortController();
  let timer,onAbort;
  const cancelled=new Promise((_,reject)=>{
    onAbort=()=>{controller.abort();reject(abortError());};
    signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(new Error('Search provider timed out.'));},timeoutMs);
  });
  try{
    return await Promise.race([cancelled,(async()=>{
      const response=await fetchFn(url,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',signal:controller.signal});
      if(!response?.ok)throw new Error(`Search provider returned ${response?.status??'an error'}.`);
      return await response.json();
    })()]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}

/**
 * Public Piped search endpoints. Search only: playback still uses YouTube's
 * privacy-enhanced embed. The list is intentionally small and failover-based
 * because public mirrors can disappear without notice.
 */
export const YOUTUBE_SEARCH_PROVIDERS=Object.freeze([
  // Reviewed public instance list: TeamPiped/documentation, public-instances.
  // These first two returned real search JSON with browser CORS on 2026-10-03.
  'https://pipedapi.ducks.party',
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
]);

/** Accept only public YouTube video and playlist links or raw video IDs. */
export function parseYouTubeInput(value){
  const raw=String(value??'').trim();
  if(VIDEO_ID.test(raw))return Object.freeze({type:'video',id:raw});
  if(!raw)return null;
  let url;
  try{url=new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)?raw:`https://${raw}`);}catch{return null;}
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  if(!['youtube.com','m.youtube.com','music.youtube.com','youtu.be','youtube-nocookie.com'].includes(host))return null;
  if(host==='youtu.be'){
    const id=url.pathname.split('/').filter(Boolean)[0];
    return VIDEO_ID.test(id??'')?Object.freeze({type:'video',id}):null;
  }
  const path=url.pathname.split('/').filter(Boolean);
  const videoId=url.searchParams.get('v')??(['embed','shorts','live'].includes(path[0])?path[1]:null);
  if(videoId&&VIDEO_ID.test(videoId))return Object.freeze({type:'video',id:videoId});
  const playlistId=url.searchParams.get('list');
  if(playlistId&&PLAYLIST_ID.test(playlistId))return Object.freeze({type:'playlist',id:playlistId});
  return null;
}

export function youtubeEmbedUrl(target,{autoplay=false}={}){
  if(!target||!['video','playlist'].includes(target.type))throw Error('Choose a YouTube video or playlist.');
  const id=String(target.id??'');
  if(target.type==='video'&&!VIDEO_ID.test(id))throw Error('That YouTube video ID is not valid.');
  if(target.type==='playlist'&&!PLAYLIST_ID.test(id))throw Error('That YouTube playlist ID is not valid.');
  const url=new URL(target.type==='video'?`https://www.youtube-nocookie.com/embed/${id}`:'https://www.youtube-nocookie.com/embed/videoseries');
  if(target.type==='playlist')url.searchParams.set('list',id);
  url.searchParams.set('playsinline','1');url.searchParams.set('rel','0');url.searchParams.set('controls','1');
  if(autoplay)url.searchParams.set('autoplay','1');
  return url.href;
}

function resultVideoId(item){
  const direct=String(item?.videoId??item?.id??'');
  if(VIDEO_ID.test(direct))return direct;
  const raw=String(item?.url??'');
  const match=raw.match(/[?&]v=([A-Za-z0-9_-]{11})(?:&|$)/);
  return match?.[1]??null;
}

export function normalizeYoutubeSearchResult(item){
  const id=resultVideoId(item);
  if(!id)return null;
  const title=String(item?.title??item?.name??'Untitled video').trim().slice(0,500)||'Untitled video';
  const channel=String(item?.uploaderName??item?.author??item?.channelName??'').trim().slice(0,160);
  const duration=Number(item?.duration??item?.lengthSeconds);
  return Object.freeze({id,title,channel,duration:Number.isFinite(duration)&&duration>=0?duration:null});
}

/**
 * Search public YouTube metadata without requiring the user to paste a link.
 * The first healthy public Piped endpoint wins. No credentials are sent.
 */
export async function searchYoutubeVideos(query,{fetchFn=globalThis.fetch,providers=YOUTUBE_SEARCH_PROVIDERS,limit=8,signal=null,timeoutMs=SEARCH_TIMEOUT_MS}={}){
  const q=String(query??'').trim();
  if(!q)throw Error('Type something to search for.');
  if(q.length>500)throw Error('Keep the search to 500 characters or fewer.');
  if(typeof fetchFn!=='function')throw Error('Search is unavailable in this browser.');
  const candidates=[...new Set((providers??[]).map(String).filter(value=>/^https:\/\//i.test(value)))].slice(0,3);
  const requestTimeout=Math.max(1,Math.min(10000,Number(timeoutMs)||SEARCH_TIMEOUT_MS));
  let lastError=null;
  for(const base of candidates){
    if(signal?.aborted)throw abortError();
    try{
      const url=new URL('/search',base);url.searchParams.set('q',q);url.searchParams.set('filter','videos');
      const payload=await fetchSearchPayload(fetchFn,url.href,{signal,timeoutMs:requestTimeout});
      const items=Array.isArray(payload?.items)?payload.items:Array.isArray(payload)?payload:[];
      const seen=new Set(),results=items.slice(0,500).map(normalizeYoutubeSearchResult).filter(item=>{
        if(!item||seen.has(item.id))return false;seen.add(item.id);return true;
      }).slice(0,Math.max(1,Math.min(20,Number(limit)||8)));
      if(results.length)return Object.freeze({provider:new URL(base).hostname,results:Object.freeze(results)});
      lastError=new Error('Search returned no playable videos.');
    }catch(error){if(signal?.aborted)throw abortError();lastError=error;}
  }
  throw lastError??new Error('YouTube search is temporarily unavailable.');
}

const STYLE=`
#youtube-player-console{position:fixed;right:20px;top:132px;z-index:121;width:min(560px,calc(100vw - 28px));max-height:78vh;overflow:auto;padding:16px;border:1px solid #8a744e;border-radius:18px;background:linear-gradient(155deg,#111d27f5,#081019f5);box-shadow:0 18px 58px #0008,0 0 26px #c09a5620;color:#d6ddd7;font:13px/1.5 system-ui,sans-serif;pointer-events:auto}
#youtube-player-console[hidden]{display:none!important}#youtube-player-console *{box-sizing:border-box}
#youtube-player-console [hidden]{display:none!important}
#youtube-player-console header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
#youtube-player-console .yt-kicker{display:block;color:#b69b67;font:10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
#youtube-player-console h2{margin:1px 0 0;font-size:20px;font-weight:500;letter-spacing:-.03em;color:#dce2dc}
#youtube-player-console button,#youtube-player-console input{min-height:42px;border:1px solid #50604f;border-radius:10px;background:#0b1820;color:#e0e4dc;font:inherit;padding:8px 11px}
#youtube-player-console button{cursor:pointer}#youtube-player-console button:hover,#youtube-player-console a:hover{border-color:#c2a36c}
#youtube-player-console form{display:flex;gap:8px;margin:12px 0 7px}#youtube-player-console input{min-width:0;flex:1}
#youtube-player-console .yt-search{display:inline-flex;margin:2px 0 10px;color:#d8c18c;text-decoration:none;font-size:11px}
#youtube-player-console .yt-results{display:grid;gap:7px;margin:0 0 10px}
#youtube-player-console .yt-results[hidden]{display:none!important}
#youtube-player-console [data-yt-watch][hidden]{display:none!important}
#youtube-player-console .yt-result{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;width:100%;text-align:left;background:linear-gradient(125deg,#0b1820,#0b141b);border-color:#334b4b}
#youtube-player-console .yt-result strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
#youtube-player-console .yt-result small{grid-column:1;color:#8fa6a0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#youtube-player-console .yt-result span{grid-row:1/3;grid-column:2;align-self:center;color:#d4bc83;font:10px ui-monospace,monospace}
#youtube-player-console .yt-frame{display:block;width:100%;min-height:220px;aspect-ratio:16/9;border:1px solid #34474b;border-radius:14px;background:#05090d}
#youtube-player-console .yt-status{min-height:22px;margin:8px 0;color:#a5b6af;font-size:11px}#youtube-player-console .yt-boundary{margin:8px 0 0;color:#82968e;font-size:10px}
@media(max-width:700px){#youtube-player-console{left:12px;right:12px;top:auto;bottom:12px;width:auto;max-height:72vh;padding:12px}#youtube-player-console form{display:grid;grid-template-columns:1fr auto}#youtube-player-console .yt-frame{min-height:200px}}
`;

function formatDuration(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return '';
  const total=Math.round(seconds),h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=String(total%60).padStart(2,'0');
  return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;
}

/** Search + play YouTube directly on the Reality Lens media object. */
export function createYoutubeSurface({documentRoot=globalThis.document,fetchFn=globalThis.fetch,searchProviders=YOUTUBE_SEARCH_PROVIDERS}={}){
  if(!documentRoot)throw Error('A document is required for the YouTube surface.');
  const existing=documentRoot.getElementById?.('youtube-player-console');
  if(existing){
    const controller=surfaceControllers.get(existing);
    if(controller)return controller;
    throw Error('A YouTube surface is already mounted by another owner.');
  }
  let style=documentRoot.getElementById?.('youtube-object-surface-style');
  if(!style){style=documentRoot.createElement('style');style.id='youtube-object-surface-style';style.textContent=STYLE;documentRoot.head?.append(style);}
  const panel=documentRoot.createElement('aside');panel.id='youtube-player-console';panel.hidden=true;panel.setAttribute('aria-labelledby','youtube-surface-title');
  panel.innerHTML=`<header><div><span class="yt-kicker">Reality Lens · media object</span><h2 id="youtube-surface-title">YouTube</h2></div><button type="button" data-yt-close aria-label="Close YouTube surface">Close</button></header>
    <form data-yt-form role="search"><input data-yt-input type="search" maxlength="500" autocomplete="off" placeholder="Search YouTube, or paste a video / playlist link" aria-label="Search YouTube or paste a video or playlist"><button type="submit">Search / Play</button></form>
    <button type="button" data-yt-cancel hidden>Cancel search</button>
    <a class="yt-search" data-yt-search target="_blank" rel="noopener noreferrer" aria-disabled="true">Open this search on YouTube ↗</a>
    <div class="yt-results" data-yt-results hidden aria-label="YouTube search results"></div>
    <button type="button" data-yt-results-toggle hidden aria-expanded="false">Show search results</button>
    <iframe class="yt-frame" data-yt-frame title="YouTube player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen src="about:blank"></iframe>
    <a class="yt-search" data-yt-watch target="_blank" rel="noopener noreferrer" hidden>Open selected video on YouTube ↗</a>
    <p class="yt-status" data-yt-status role="status" aria-live="polite">Search by title, channel, topic, or phrase. Pick a result and it plays here; pasted links still work too.</p>
    <p class="yt-boundary">Search metadata is fetched only when you search, from a public Piped endpoint with no credentials. Selected video IDs play through YouTube's privacy-enhanced embed. If public search is unavailable, the YouTube search link remains available.</p>`;
  (documentRoot.body??documentRoot).append(panel);
  const input=panel.querySelector('[data-yt-input]'),frame=panel.querySelector('[data-yt-frame]'),status=panel.querySelector('[data-yt-status]'),search=panel.querySelector('[data-yt-search]'),watch=panel.querySelector('[data-yt-watch]'),resultsEl=panel.querySelector('[data-yt-results]'),resultsToggle=panel.querySelector('[data-yt-results-toggle]'),submit=panel.querySelector('[data-yt-form] button[type="submit"]'),cancelButton=panel.querySelector('[data-yt-cancel]');
  let loadedTarget=null,lastQuery='',lastProvider=null,resultCount=0,searchToken=0,searchController=null,destroyed=false;
  const cancelSearch=()=>{searchToken++;searchController?.abort();searchController=null;submit.disabled=false;cancelButton.hidden=true;};
  const close=()=>{
    const wasSearching=searchController!==null;cancelSearch();
    if(wasSearching)status.textContent=loadedTarget?'Search cancelled. Your selected video is retained.':'Search cancelled. Search again when you reopen this object.';
    panel.hidden=true;frame.src='about:blank';
  };

  const updateSearchLink=()=>{
    const query=input.value.trim();
    search.href=query?`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`:'#';
    search.setAttribute('aria-disabled',String(!query));
    search.tabIndex=query?0:-1;
  };
  const playTarget=(target,{autoplay=true,label=null}={})=>{
    loadedTarget=target;frame.src=youtubeEmbedUrl(target,{autoplay});
    watch.hidden=false;watch.href=target.type==='playlist'?`https://www.youtube.com/playlist?list=${target.id}`:`https://www.youtube.com/watch?v=${target.id}`;
    watch.textContent=target.type==='playlist'?'Open selected playlist on YouTube ↗':'Open selected video on YouTube ↗';
    status.textContent=label??(target.type==='playlist'?'Playlist selected. YouTube controls playback.':'Video selected. YouTube controls playback.');
  };
  const renderResults=(items)=>{
    resultsEl.replaceChildren();resultCount=items.length;resultsEl.hidden=!items.length;resultsToggle.hidden=true;resultsToggle.setAttribute('aria-expanded','false');
    for(const item of items){
      const button=documentRoot.createElement('button');button.type='button';button.className='yt-result';
      const title=documentRoot.createElement('strong');title.textContent=item.title;
      const meta=documentRoot.createElement('small');meta.textContent=[item.channel,formatDuration(item.duration)].filter(Boolean).join(' · ')||'YouTube video';
      const action=documentRoot.createElement('span');action.textContent='PLAY';
      button.append(title,meta,action);
      button.addEventListener('click',()=>{
        cancelSearch();resultsEl.hidden=true;resultsToggle.hidden=false;resultsToggle.textContent=`Show ${resultCount} search results`;resultsToggle.setAttribute('aria-expanded','false');
        playTarget({type:'video',id:item.id},{autoplay:true,label:`Video selected: ${item.title}. YouTube controls playback.`});
      });
      resultsEl.append(button);
    }
  };

  input.addEventListener('input',updateSearchLink);
  cancelButton.addEventListener('click',()=>{cancelSearch();status.textContent=loadedTarget?'Search cancelled. Your selected video is retained.':'Search cancelled. Type a new search or paste a video link.';});
  resultsToggle.addEventListener('click',()=>{
    resultsEl.hidden=!resultsEl.hidden;resultsToggle.textContent=resultsEl.hidden?`Show ${resultCount} search results`:'Hide search results';resultsToggle.setAttribute('aria-expanded',String(!resultsEl.hidden));
  });
  search.addEventListener('click',event=>{if(search.getAttribute('aria-disabled')==='true')event.preventDefault();});
  panel.querySelector('[data-yt-close]').addEventListener('click',close);
  panel.querySelector('[data-yt-form]').addEventListener('submit',async event=>{
    event.preventDefault();
    if(destroyed)return;
    cancelSearch();
    const raw=input.value.trim(),target=parseYouTubeInput(raw);
    updateSearchLink();
    if(target){renderResults([]);lastQuery='';lastProvider=null;playTarget(target,{autoplay:true});return;}
    if(!raw){status.textContent='Type a video, creator, channel, topic, or phrase.';return;}
    const token=searchToken;searchController=new AbortController();submit.disabled=true;cancelButton.hidden=false;lastQuery=raw;lastProvider=null;status.textContent=`Searching YouTube for “${raw}”…`;renderResults([]);
    try{
      const found=await searchYoutubeVideos(raw,{fetchFn,providers:searchProviders,limit:8,signal:searchController.signal});
      if(token!==searchToken)return;
      lastQuery=raw;lastProvider=found.provider;renderResults(found.results);
      status.textContent=`${found.results.length} video result${found.results.length===1?'':'s'} via ${found.provider}. Pick one to open the player on this object.`;
    }catch(error){
      if(token!==searchToken)return;
      lastQuery=raw;lastProvider=null;status.textContent=`In-object search is unavailable right now: ${error?.message??'provider error'} Use the YouTube link above or try again.`;
    }finally{if(token===searchToken){submit.disabled=false;searchController=null;cancelButton.hidden=true;}}
  });
  updateSearchLink();
  const controller=Object.freeze({
    open(){if(destroyed)return;panel.hidden=false;if(loadedTarget&&frame.src==='about:blank')frame.src=youtubeEmbedUrl(loadedTarget);},
    close,
    search(query){input.value=String(query??'');updateSearchLink();panel.querySelector('[data-yt-form]').requestSubmit();},
    getSnapshot(){return Object.freeze({open:!panel.hidden,target:loadedTarget?{...loadedTarget}:null,query:lastQuery,searchProvider:lastProvider,resultCount,searching:searchController!==null,externalProvider:'youtube',searchInObject:true,apiKeyRequired:false,autoplayOnlyAfterUserAction:true});},
    destroy(){if(destroyed)return;destroyed=true;close();panel.remove();style?.remove();surfaceControllers.delete(panel);},
  });
  surfaceControllers.set(panel,controller);return controller;
}
