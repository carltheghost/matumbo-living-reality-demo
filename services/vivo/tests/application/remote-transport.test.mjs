import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteTransport} from '../../web/application/remote-transport.mjs';

class FakeSocket {
  static instances=[];
  constructor(url){this.url=url;this.readyState=0;this.sent=[];FakeSocket.instances.push(this);}
  send(raw){this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.onopen?.();}
  emit(message){this.onmessage?.({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
}

async function admitted(onError=()=>{}){
  FakeSocket.instances.length=0;
  const transport=new RemoteTransport({url:'ws://vivo.test/ws',token:'x'.repeat(24),WebSocket:FakeSocket,onError,timeoutMs:1000});
  const joining=transport.admit();
  const socket=FakeSocket.instances[0];
  socket.open();
  socket.emit({type:'joined',role:'owner',actorId:'remote.owner',session:{id:'s'},state:{snapshot:{acceptedSequence:0}}});
  await joining;
  return {transport,socket};
}
async function shutdown(transport,socket){
  const closing=transport.close();
  const id=socket.sent.at(-1).id;
  socket.emit({type:'reply',id,value:{closed:true}});
  await closing;
}

test('top-level authority errors reject pending calls and reach the UI hook',async()=>{
  const errors=[];
  const {transport,socket}=await admitted(error=>errors.push(error));
  const pending=transport.refresh();
  assert.equal(socket.sent.at(-1).op,'state');
  socket.emit({type:'error',code:'AUTHORITY_UNAVAILABLE'});
  await assert.rejects(pending,error=>error.code==='AUTHORITY_UNAVAILABLE');
  assert.equal(errors.at(-1).code,'AUTHORITY_UNAVAILABLE');
  await shutdown(transport,socket);
});

test('a rate-limit error cannot leave a request hanging',async()=>{
  const {transport,socket}=await admitted();
  const pending=transport.call('submit',{command:{}});
  socket.emit({type:'error',code:'RATE_LIMIT'});
  await assert.rejects(pending,error=>error.code==='RATE_LIMIT');
  await shutdown(transport,socket);
});

test('identified reply errors still reject only their request',async()=>{
  const {transport,socket}=await admitted();
  const first=transport.call('state');
  const second=transport.call('export');
  const ids=socket.sent.slice(-2).map(message=>message.id);
  socket.emit({type:'reply',id:ids[0],error:'STALE_STATE'});
  await assert.rejects(first,error=>error.code==='STALE_STATE');
  socket.emit({type:'reply',id:ids[1],value:{ok:true}});
  assert.deepEqual(await second,{ok:true});
  await shutdown(transport,socket);
});
