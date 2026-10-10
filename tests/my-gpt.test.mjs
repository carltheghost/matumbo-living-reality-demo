import test from 'node:test';
import assert from 'node:assert/strict';
import {createGptWorkspace,normalizeGptUrl,buildGptChatRequest,GPT_STORAGE_KEY} from '../src/domains/my-gpt.js';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
test('GPT links only accept actual HTTPS ChatGPT GPT paths and remove tracking',()=>{
  assert.equal(normalizeGptUrl('https://chatgpt.com/g/g-abc-assistant?secret=discard#x'),'https://chatgpt.com/g/g-abc-assistant');
  for(const url of ['javascript:alert(1)','https://chatgpt.com.evil.test/g/g-a','https://u:p@chatgpt.com/g/g-a','https://chatgpt.com:999/g/g-a','https://chatgpt.com/c/conversation','http://chatgpt.com/g/g-a'])assert.throws(()=>normalizeGptUrl(url));
});
test('profiles and conversation persist locally without tools or credentials',()=>{
  const s=storage(),w=createGptWorkspace({storage:s});w.saveProfile({name:'Researcher',url:'https://chatgpt.com/g/g-research',instructions:'Cite evidence',knowledge:'Local note'});w.appendMessage({role:'user',content:'Hello'});
  const restored=createGptWorkspace({storage:s}).snapshot();assert.equal(restored.profiles.length,2);assert.equal(restored.conversations[0].messages[0].content,'Hello');assert.equal(restored.selectedProfileId,w.snapshot().selectedProfileId);
  const state=w.snapshot();state.profiles[0].name='tamper';assert.notEqual(w.snapshot().profiles[0].name,'tamper');
});
test('ChatGPT import follows selected branch and strips system, tool and image payloads',()=>{
  const w=createGptWorkspace();const result=w.importConversations([{id:'one',title:'Selected',current_node:'b',mapping:{s:{parent:null,message:{author:{role:'system'},content:{parts:['private system']}}},u:{parent:'s',message:{author:{role:'user'},content:{parts:['Question',{image:'data'}]}}},a:{parent:'u',message:{author:{role:'assistant'},content:{parts:['alternative']}}},b:{parent:'u',message:{author:{role:'assistant'},content:{parts:['selected answer']}}}}}]);
  assert.equal(result.imported,1);assert.deepEqual(result.conversations[0].messages,[{role:'user',content:'Question'},{role:'assistant',content:'selected answer'}]);
  assert.equal(w.importConversations(w.exportData()).imported,0);
});
test('malformed and oversized imports do not change existing workspace',()=>{
  const w=createGptWorkspace();w.appendMessage({role:'user',content:'Keep me'});const before=w.snapshot();
  assert.throws(()=>w.importConversations([{id:'bad',current_node:'a',mapping:{a:{parent:'a'}}}]));
  assert.throws(()=>w.importConversations('x'.repeat(2000001)));assert.throws(()=>w.importConversations('{'));assert.deepEqual(w.snapshot(),before);
});
test('explicit Send includes only selected assistant and selected bounded conversation',()=>{
  const w=createGptWorkspace();w.appendMessage({role:'user',content:'Other private chat'});w.newConversation();w.appendMessage({role:'user',content:'Selected question'});w.appendMessage({role:'assistant',content:'Selected answer'});w.saveProfile({name:'Guide',instructions:'Be concise',knowledge:'Use this fact'});
  const payload=buildGptChatRequest({workspace:w,provider:'chatgpt',model:'chosen',prompt:'Follow up'});
  assert.equal(payload.messages.length,3);assert.equal(payload.messages[2].content,'Follow up');assert.ok(!JSON.stringify(payload).includes('Other private chat'));assert.ok(payload.instructions.includes('Use this fact'));assert.equal(w.snapshot().conversations.at(-1).messages.length,2);
});
test('prompt and context limits hold before external requests',()=>{
  const w=createGptWorkspace();for(let n=0;n<30;n++)w.appendMessage({role:n%2?'assistant':'user',content:'a'.repeat(2000)});
  const p=buildGptChatRequest({workspace:w,prompt:'b'.repeat(8000)});assert.ok(p.messages.length<=20);assert.ok(p.messages.reduce((sum,m)=>sum+m.content.length,0)<=24000);assert.throws(()=>buildGptChatRequest({workspace:w,prompt:'b'.repeat(8001)}));assert.throws(()=>buildGptChatRequest({workspace:w,prompt:'hello',provider:'unknown'}));
});
test('storage errors keep session usable and visibly report persistence failure',()=>{
  const w=createGptWorkspace({storage:{getItem:()=>null,setItem:()=>{throw new Error('quota');}}});w.appendMessage({role:'user',content:'Still here'});assert.match(w.snapshot().storageError,/storage/);assert.equal(w.exportData().conversations[0].messages.length,1);
});
test('corrupt stored state is bounded and starts safe',()=>{const s=storage();s.setItem(GPT_STORAGE_KEY,'{bad');const w=createGptWorkspace({storage:s});assert.equal(w.snapshot().profiles.length,1);assert.match(w.snapshot().storageError,/could not be read/);});
test('a stale second tab preserves newer history and makes its own changes exportable',()=>{
  const s=storage(),first=createGptWorkspace({storage:s});first.appendMessage({role:'user',content:'Original prompt'});
  const second=createGptWorkspace({storage:s});first.appendMessage({role:'assistant',content:'Answer after second tab opened'});
  second.saveProfile({name:'Second tab assistant',instructions:'Keep this too'});
  assert.match(second.snapshot().storageError,/Another tab/);assert.equal(second.exportData().profiles.length,2);
  assert.equal(createGptWorkspace({storage:s}).snapshot().conversations[0].messages.length,2);
  second.appendMessage({role:'user',content:'Still only in this tab'});assert.match(second.snapshot().storageError,/Export this tab/);
  assert.equal(createGptWorkspace({storage:s}).snapshot().conversations[0].messages.at(-1).role,'assistant');
  first.saveProfile({name:'Primary tab still saves'});assert.equal(first.snapshot().storageError,null);
});
test('unreadable persisted workspace is never overwritten by session edits',()=>{
  const s=storage();s.setItem(GPT_STORAGE_KEY,'{broken but potentially recoverable');const w=createGptWorkspace({storage:s});w.appendMessage({role:'user',content:'Export me'});
  assert.equal(s.getItem(GPT_STORAGE_KEY),'{broken but potentially recoverable');assert.match(w.snapshot().storageError,/preserved/);assert.equal(w.exportData().conversations[0].messages[0].content,'Export me');
});
test('a conflicting tab backup recovers its divergent conversation without overwriting the saved answer',()=>{
  const s=storage(),first=createGptWorkspace({storage:s});first.appendMessage({role:'user',content:'Shared start'});const second=createGptWorkspace({storage:s});
  first.appendMessage({role:'assistant',content:'Saved answer'});second.appendMessage({role:'user',content:'Unsaved continuation'});
  const recovered=createGptWorkspace({storage:s});recovered.importConversations(second.exportData());const state=recovered.snapshot();
  assert.equal(state.conversations.length,2);assert.equal(state.conversations[0].messages.at(-1).content,'Saved answer');
  assert.equal(state.conversations[1].messages.at(-1).content,'Unsaved continuation');assert.notEqual(state.conversations[0].id,state.conversations[1].id);assert.equal(state.activeConversationId,state.conversations[1].id);
  assert.equal(recovered.importConversations(second.exportData()).imported,0);assert.equal(recovered.snapshot().conversations.length,2);
});
test('history clearing preserves assistant profiles',()=>{const w=createGptWorkspace();w.saveProfile({name:'Keep'});w.appendMessage({role:'user',content:'Clear'});w.clearHistory();assert.equal(w.snapshot().profiles.length,2);assert.deepEqual(w.snapshot().conversations,[]);});
test('profile-only backup restores customized default without overwriting the current assistant',()=>{const from=createGptWorkspace();from.saveProfile({id:'matumbo',name:'My customized companion',instructions:'Authored instructions',knowledge:'My knowledge'});const to=createGptWorkspace();to.importConversations(from.exportData());const s=to.snapshot();assert.equal(s.profiles.length,2);const selected=s.profiles.find(p=>p.id===s.selectedProfileId);assert.equal(selected.instructions,'Authored instructions');assert.equal(selected.knowledge,'My knowledge');assert.equal(s.profiles[0].name,'maTumbo companion');});
test('full history rejects a new chat without erasing earlier conversations',()=>{const w=createGptWorkspace();for(let i=0;i<60;i++){w.newConversation();w.appendMessage({role:'user',content:`Keep ${i}`});}const before=w.snapshot();assert.throws(()=>w.newConversation(),/Export and clear/);assert.deepEqual(w.snapshot(),before);});
test('import excludes analysis and tool-directed assistant messages',()=>{const w=createGptWorkspace();w.importConversations([{id:'filtered',current_node:'final',mapping:{u:{parent:null,message:{author:{role:'user'},content:{parts:['question']}}},a:{parent:'u',message:{author:{role:'assistant'},channel:'analysis',content:{parts:['private reasoning']}}},t:{parent:'a',message:{author:{role:'assistant'},recipient:'python',content:{parts:['tool code']}}},final:{parent:'t',message:{author:{role:'assistant'},channel:'final',recipient:'all',content:{parts:['Visible answer']}}}}}]);assert.deepEqual(w.snapshot().conversations[0].messages.map(m=>m.content),['question','Visible answer']);});
