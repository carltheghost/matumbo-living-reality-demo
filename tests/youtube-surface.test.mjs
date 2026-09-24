import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYouTubeInput,youtubeEmbedUrl} from '../src/render/youtube-surface.js';

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

test('YouTube player URL is constrained to the official privacy-enhanced embed origin',()=>{
  const video=new URL(youtubeEmbedUrl({type:'video',id:'M7lc1UVf-VE'}));
  assert.equal(video.origin,'https://www.youtube-nocookie.com');
  assert.equal(video.pathname,'/embed/M7lc1UVf-VE');
  assert.equal(video.searchParams.get('autoplay'),null);
  assert.equal(video.searchParams.get('playsinline'),'1');
  const playlist=new URL(youtubeEmbedUrl({type:'playlist',id:'PL1234567890abcdef'}));
  assert.equal(playlist.pathname,'/embed/videoseries');
  assert.equal(playlist.searchParams.get('list'),'PL1234567890abcdef');
  assert.throws(()=>youtubeEmbedUrl({type:'video',id:'bad'}),/not valid/);
});
