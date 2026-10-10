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

test('a stalled public provider is aborted before the search fails over',async()=>{
  let calls=0,firstSignal=null;
  const fetchFn=async(_url,{signal}={})=>{
    calls+=1;
    if(calls===1){
      firstSignal=signal;
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{
        const error=new Error('aborted');error.name='AbortError';reject(error);
      },{once:true}));
    }
    return {ok:true,status:200,json:async()=>({items:[
      {url:'/watch?v=M7lc1UVf-VE',title:'Recovered result',uploaderName:'Channel B',duration:64},
    ]})};
  };
  const found=await searchYoutubeVideos('provider recovery',{
    fetchFn,
    providers:['https://stalled.example','https://healthy.example'],
    timeoutMs:25,
  });
  assert.equal(firstSignal?.aborted,true);
  assert.equal(calls,2);
  assert.equal(found.provider,'healthy.example');
  assert.equal(found.results[0].title,'Recovered result');
});

test('empty in-object YouTube search never makes a provider request',async()=>{
  let called=false;
  await assert.rejects(
    searchYoutubeVideos('   ',{fetchFn:async()=>{called=true;return {ok:true,json:async()=>({items:[]})};}}),
    /Type something/,
  );
  assert.equal(called,false);
});
