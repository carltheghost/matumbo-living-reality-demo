import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYouTubeInput,
  youtubeEmbedUrl,
  normalizeYoutubeSearchResult,
  searchYoutubeVideos,
} from '../src/render/youtube-surface.js';

test('YouTube object accepts common video-link forms without an API key',()=>{
  assert.deepEqual(parseYouTubeInput('M7lc1UVf-VE'),{type:'video',id:'M7lc1UVf-VE'});
  assert.deepEqual(parseYouTubeInput('https://youtu.be/M7lc1UVf-VE?t=10'),{type:'video',id:'M7lc1UVf-VE'});
  assert.deepEqual(parseYouTubeInput('https://www.youtube.com/watch?v=M7lc1UVf-VE'),{type:'video',id:'M7lc1UVf-VE'});
  assert.deepEqual(parseYouTubeInput('https://youtube.com/shorts/M7lc1UVf-VE'),{type:'video',id:'M7lc1UVf-VE'});
  assert.deepEqual(parseYouTubeInput('https://youtube.com/embed/M7lc1UVf-VE'),{type:'video',id:'M7lc1UVf-VE'});
});

test('YouTube object supports playlists and rejects lookalike or malformed domains',()=>{
  assert.deepEqual(parseYouTubeInput('https://youtube.com/playlist?list=PL1234567890abcdef'),{type:'playlist',id:'PL1234567890abcdef'});
  assert.equal(parseYouTubeInput('https://youtube.com.evil.example/watch?v=M7lc1UVf-VE'),null);
  assert.equal(parseYouTubeInput('https://example.com/watch?v=M7lc1UVf-VE'),null);
  assert.equal(parseYouTubeInput('not a video id'),null);
  assert.equal(parseYouTubeInput(''),null);
});

test('YouTube player stays on the privacy-enhanced embed and only autoplays after a user action',()=>{
  const quiet=new URL(youtubeEmbedUrl({type:'video',id:'M7lc1UVf-VE'}));
  assert.equal(quiet.origin,'https://www.youtube-nocookie.com');
  assert.equal(quiet.pathname,'/embed/M7lc1UVf-VE');
  assert.equal(quiet.searchParams.get('autoplay'),null);
  assert.equal(quiet.searchParams.get('playsinline'),'1');

  const started=new URL(youtubeEmbedUrl({type:'video',id:'M7lc1UVf-VE'},{autoplay:true}));
  assert.equal(started.searchParams.get('autoplay'),'1');

  const playlist=new URL(youtubeEmbedUrl({type:'playlist',id:'PL1234567890abcdef'}));
  assert.equal(playlist.pathname,'/embed/videoseries');
  assert.equal(playlist.searchParams.get('list'),'PL1234567890abcdef');
  assert.throws(()=>youtubeEmbedUrl({type:'video',id:'bad'}),/not valid/);
});

test('Piped result normalization keeps only playable YouTube videos',()=>{
  assert.deepEqual(
    normalizeYoutubeSearchResult({url:'/watch?v=M7lc1UVf-VE',title:'Three.js demo',uploaderName:'Example',duration:125}),
    {id:'M7lc1UVf-VE',title:'Three.js demo',channel:'Example',duration:125},
  );
  assert.equal(normalizeYoutubeSearchResult({url:'/channel/UC123',title:'A channel'}),null);
});

test('in-object YouTube search fails over between public providers without credentials',async()=>{
  const calls=[];
  const fetchFn=async url=>{
    calls.push(String(url));
    if(calls.length===1)return {ok:false,status:503,json:async()=>({})};
    return {
      ok:true,status:200,
      json:async()=>({items:[
        {url:'/watch?v=M7lc1UVf-VE',title:'First playable',uploaderName:'Channel A',duration:42},
        {url:'/channel/UC_NOT_A_VIDEO',title:'Skip me'},
      ]}),
    };
  };
  const found=await searchYoutubeVideos('three js',{fetchFn,providers:['https://one.example','https://two.example']});
  assert.equal(calls.length,2);
  assert.match(calls[0],/\/search\?q=three(\+|%20)js&filter=videos/);
  assert.equal(found.provider,'two.example');
  assert.deepEqual(found.results,[{id:'M7lc1UVf-VE',title:'First playable',channel:'Channel A',duration:42}]);
});

test('empty in-object YouTube search never makes a provider request',async()=>{
  let called=false;
  await assert.rejects(
    searchYoutubeVideos('   ',{fetchFn:async()=>{called=true;return {ok:true,json:async()=>({items:[]})};}}),
    /Type something/,
  );
  assert.equal(called,false);
});

test('a hung search provider times out and aborts before failover',async()=>{
  const calls=[];
  const found=await searchYoutubeVideos('geometry',{
    providers:['https://slow.example','https://ready.example'],timeoutMs:10,
    fetchFn:async(url,options)=>{
      calls.push({url,options});
      if(calls.length===1)return new Promise(()=>{});
      return {ok:true,json:async()=>({items:[{videoId:'M7lc1UVf-VE',title:'Geometry'}]})};
    },
  });
  assert.equal(calls.length,2);
  assert.equal(calls[0].options.signal.aborted,true);
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(found.provider,'ready.example');
});

test('the search timeout also bounds a stalled JSON body',async()=>{
  let calls=0;
  const found=await searchYoutubeVideos('geometry',{
    providers:['https://body.example','https://ready.example'],timeoutMs:10,
    fetchFn:async()=>({ok:true,json:()=>++calls===1?new Promise(()=>{}):Promise.resolve([{videoId:'M7lc1UVf-VE'}])}),
  });
  assert.equal(calls,2);
  assert.equal(found.results[0].id,'M7lc1UVf-VE');
});

test('cancelling search aborts the active provider and never starts failover',async()=>{
  const controller=new AbortController();let calls=0,requestSignal;
  const search=searchYoutubeVideos('geometry',{
    signal:controller.signal,providers:['https://one.example','https://two.example'],
    fetchFn:async(_url,options)=>{calls++;requestSignal=options.signal;return new Promise(()=>{});},
  });
  controller.abort();
  await assert.rejects(search,error=>error.name==='AbortError');
  assert.equal(calls,1);assert.equal(requestSignal.aborted,true);
  await assert.rejects(searchYoutubeVideos('again',{signal:controller.signal,fetchFn:()=>{throw Error('must not request');}}),error=>error.name==='AbortError');
});

test('search deduplicates video IDs and bounds displayed metadata',async()=>{
  const found=await searchYoutubeVideos('geometry',{
    providers:['https://ready.example'],
    fetchFn:async()=>({ok:true,json:async()=>({items:[
      {videoId:'M7lc1UVf-VE',title:'x'.repeat(1000),uploaderName:'y'.repeat(1000)},
      {videoId:'M7lc1UVf-VE',title:'Duplicate'},
      {url:'/channel/UC_NOT_A_VIDEO'},
    ]})}),
  });
  assert.equal(found.results.length,1);
  assert.equal(found.results[0].title.length,500);
  assert.equal(found.results[0].channel.length,160);
});

test('an oversized search query is rejected before sending it to a provider',async()=>{
  let calls=0;
  await assert.rejects(searchYoutubeVideos('x'.repeat(501),{fetchFn:async()=>{calls++;}}),/500 characters/);
  assert.equal(calls,0);
});
