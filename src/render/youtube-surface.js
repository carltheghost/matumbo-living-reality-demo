const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID=/^[A-Za-z0-9_-]{10,120}$/;

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

export function youtubeEmbedUrl(target){
  if(!target||!['video','playlist'].includes(target.type))throw Error('Choose a YouTube video or playlist.');
  const id=String(target.id??'');
  if(target.type==='video'&&!VIDEO_ID.test(id))throw Error('That YouTube video ID is not valid.');
  if(target.type==='playlist'&&!PLAYLIST_ID.test(id))throw Error('That YouTube playlist ID is not valid.');
  const url=new URL(target.type==='video'?`https://www.youtube-nocookie.com/embed/${id}`:'https://www.youtube-nocookie.com/embed/videoseries');
  if(target.type==='playlist')url.searchParams.set('list',id);
  url.searchParams.set('playsinline','1');url.searchParams.set('rel','0');url.searchParams.set('controls','1');
  return url.href;
}

const STYLE=`
#youtube-player-console{position:fixed;right:20px;top:132px;z-index:121;width:min(490px,calc(100vw - 28px));max-height:76vh;overflow:auto;padding:16px;border:1px solid #8a744e;border-radius:18px;background:linear-gradient(155deg,#111d27f5,#081019f5);box-shadow:0 18px 58px #0008,0 0 26px #c09a5620;color:#d6ddd7;font:13px/1.5 system-ui,sans-serif;pointer-events:auto}
#youtube-player-console[hidden]{display:none!important}#youtube-player-console *{box-sizing:border-box}
#youtube-player-console header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
#youtube-player-console .yt-kicker{display:block;color:#b69b67;font:10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
#youtube-player-console h2{margin:1px 0 0;font-size:20px;font-weight:500;letter-spacing:-.03em;color:#dce2dc}
#youtube-player-console button,#youtube-player-console input{min-height:40px;border:1px solid #50604f;border-radius:10px;background:#0b1820;color:#e0e4dc;font:inherit;padding:8px 11px}
#youtube-player-console button{cursor:pointer}#youtube-player-console button:hover,#youtube-player-console a:hover{border-color:#c2a36c}
#youtube-player-console form{display:flex;gap:8px;margin:12px 0 6px}#youtube-player-console input{min-width:0;flex:1}
#youtube-player-console .yt-search{display:inline-flex;margin:4px 0 12px;color:#d8c18c;text-decoration:none;font-size:12px}
#youtube-player-console .yt-frame{display:block;width:100%;min-height:200px;aspect-ratio:16/9;border:1px solid #34474b;border-radius:14px;background:#05090d}
#youtube-player-console .yt-status{min-height:22px;margin:8px 0;color:#a5b6af;font-size:11px}#youtube-player-console .yt-boundary{margin:8px 0 0;color:#82968e;font-size:10px}
@media(max-width:700px){#youtube-player-console{left:12px;right:12px;top:auto;bottom:12px;width:auto;max-height:70vh;padding:12px}#youtube-player-console .yt-frame{min-height:200px}}
`;

/** A lazy, user-started YouTube player that can sit beside a Reality Lens tab. */
export function createYoutubeSurface({documentRoot=globalThis.document}={}){
  if(!documentRoot)throw Error('A document is required for the YouTube surface.');
  const existing=documentRoot.getElementById?.('youtube-player-console');
  if(existing)return {open:()=>{existing.hidden=false;},close:()=>{existing.hidden=true;},getSnapshot:()=>({open:!existing.hidden})};
  let style=documentRoot.getElementById?.('youtube-object-surface-style');
  if(!style){style=documentRoot.createElement('style');style.id='youtube-object-surface-style';style.textContent=STYLE;documentRoot.head?.append(style);}
  const panel=documentRoot.createElement('aside');panel.id='youtube-player-console';panel.hidden=true;panel.setAttribute('aria-labelledby','youtube-surface-title');
  panel.innerHTML=`<header><div><span class="yt-kicker">Reality Lens · media object</span><h2 id="youtube-surface-title">YouTube</h2></div><button type="button" data-yt-close aria-label="Close YouTube surface">Close</button></header>
    <form data-yt-form><input data-yt-input type="text" inputmode="url" autocomplete="off" placeholder="Paste a YouTube link or video ID" aria-label="YouTube video or playlist"><button type="submit">Play here</button></form>
    <a class="yt-search" data-yt-search target="_blank" rel="noopener noreferrer" aria-disabled="true">Search YouTube ↗</a>
    <iframe class="yt-frame" data-yt-frame title="YouTube player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen src="about:blank"></iframe>
    <p class="yt-status" data-yt-status role="status" aria-live="polite">Paste a public video link or playlist. Nothing loads until you press Play here.</p>
    <p class="yt-boundary">Official YouTube player · video content streams from YouTube. Sign-in, age-restricted, or embed-disabled videos may need to open on YouTube.</p>`;
  (documentRoot.body??documentRoot).append(panel);
  const input=panel.querySelector('[data-yt-input]'),frame=panel.querySelector('[data-yt-frame]'),status=panel.querySelector('[data-yt-status]'),search=panel.querySelector('[data-yt-search]');
  let loadedTarget=null;
  const updateSearch=()=>{
    const query=input.value.trim();
    search.href=query?`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`:'#';
    search.setAttribute('aria-disabled',String(!query));
    search.tabIndex=query?0:-1;
  };
  input.addEventListener('input',updateSearch);
  search.addEventListener('click',event=>{if(search.getAttribute('aria-disabled')==='true')event.preventDefault();});
  panel.querySelector('[data-yt-close]').addEventListener('click',()=>{panel.hidden=true;frame.src='about:blank';});
  panel.querySelector('[data-yt-form]').addEventListener('submit',event=>{
    event.preventDefault();
    const target=parseYouTubeInput(input.value);
    if(!target){status.textContent='Use a YouTube video link, playlist link, or 11-character video ID.';return;}
    loadedTarget=target;frame.src=youtubeEmbedUrl(target);
    status.textContent=target.type==='playlist'?'YouTube playlist loaded here.':'YouTube video loaded here.';
  });
  updateSearch();
  return Object.freeze({
    open(){panel.hidden=false;if(loadedTarget)frame.src=youtubeEmbedUrl(loadedTarget);},
    close(){panel.hidden=true;frame.src='about:blank';},
    getSnapshot(){return Object.freeze({open:!panel.hidden,target:loadedTarget?{...loadedTarget}:null,externalProvider:'youtube',apiKeyRequired:false,autoplay:false});},
    destroy(){frame.src='about:blank';panel.remove();style?.remove();},
  });
}
