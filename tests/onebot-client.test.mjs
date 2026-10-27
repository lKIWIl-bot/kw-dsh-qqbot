import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocketServer} from '../qq-bridge-enhanced-v1.0.0/node_modules/ws/wrapper.mjs';
import {OneBotWebSocketClient,text} from '../qq-bridge-enhanced-v1.0.0/src/onebot-client.mjs';
import {onebotRpcTimeoutMs} from '../qq-bridge-enhanced-v1.0.0/src/comfy-delivery.mjs';
async function server(t,handler){
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 const sockets=[];wss.on('connection',(socket,req)=>{sockets.push(socket);handler?.(socket,req);});
 t.after(async()=>{for(const s of sockets)s.terminate();await new Promise(r=>wss.close(r));});
 return {wss,sockets,url:'ws://127.0.0.1:'+wss.address().port};
}
function client(t,options){const c=new OneBotWebSocketClient({reconnect:false,...options});t.after(()=>c.close());return c;}
const reply=(socket,p,data,status='ok',retcode=0)=>socket.send(JSON.stringify({echo:p.echo,status,retcode,data}));
test('OneBot并发请求按echo关联，未知与重复响应不串单，request保留完整信封',async t=>{
 const received=[];const s=await server(t,socket=>socket.on('message',buf=>{const p=JSON.parse(buf);received.push(p);if(received.length===2){reply(socket,received[1],{value:2});reply(socket,received[0],{value:1});reply(socket,received[0],{value:999});reply(socket,{echo:'unknown'},{value:4});}}));
 const c=client(t,{url:s.url});const p1=c.connect(),p2=c.connect();assert.equal(p1,p2);await p1;
 const result=await Promise.all([c.request('get_login_info'),c.request('get_version_info')]);assert.deepEqual(result.map(r=>r.data.value),[1,2]);assert.equal(c.pendingCount,0);
});
test('OneBot使用Bearer请求头，凭据不进入URL，错误中不泄漏令牌',async t=>{
 const secret='fixture-only-token',headers=[];const s=await server(t,(socket,req)=>{headers.push({auth:req.headers.authorization,url:req.url});socket.on('message',b=>reply(socket,JSON.parse(b),null,'failed',1401));});
 const c=client(t,{url:s.url,accessToken:secret});await c.connect();assert.deepEqual(headers,[{auth:'Bearer '+secret,url:'/'}]);
 await assert.rejects(c.raw('send_private_msg'),e=>e.code==='ONEBOT_API_ERROR'&&!e.message.includes(secret));
 await assert.rejects(client(t,{url:s.url+'?access_token='+secret}).connect(),e=>e.code==='ONEBOT_INVALID_URL'&&!e.message.includes(secret));
});
test('消息、通知和心跳准确分派，坏JSON与异步处理失败被隔离',async t=>{
 const s=await server(t),c=client(t,{url:s.url}),seen=[],errors=[];c.on('error',e=>errors.push(e.code??e.message));
 c.onEvent(e=>seen.push('all:'+e.post_type));c.onPrivateMessage(()=>seen.push('private'));c.onGroupMessage(async()=>{seen.push('group');throw Error('handler failed');});c.onNotice('notify',()=>seen.push('poke'));c.onBotStatus(()=>seen.push('status'));
 await c.connect();const socket=s.sockets[0];socket.send('invalid');
 for(const e of [{post_type:'message',message_type:'private'},{post_type:'message',message_type:'group'},{post_type:'notice',notice_type:'notify'},{post_type:'notice',notice_type:'bot_status'},{post_type:'meta_event',meta_event_type:'heartbeat'}])socket.send(JSON.stringify(e));
 for(let i=0;i<50&&seen.length<9;i++)await delay(5);
 assert.deepEqual(seen,['all:message','private','all:message','group','all:notice','poke','all:notice','status','all:meta_event']);assert.ok(errors.includes('ONEBOT_INVALID_PACKET'));assert.ok(errors.includes('handler failed'));
});
test('便捷方法生成OneBot标准参数，text按文本段发送，API失败不会伪装成功',async t=>{
 const packets=[],s=await server(t,socket=>socket.on('message',b=>{const p=JSON.parse(b);packets.push(p);reply(socket,p,{message_id:9});})),c=client(t,{url:s.url});await c.connect();
 await c.sendPrivateMessage(100001,text('[CQ:at,qq=all]'));await c.sendGroupMessage(100002,'你好');await c.getGroupMemberList(100002,{noCache:true});await c.getGroupMemberInfo(100002,100001,{noCache:true});await c.getMessage(9);await c.getImage({file:'image.png'});await c.fetchFaceEntity('14');
 assert.deepEqual(packets[0].params,{user_id:100001,message:[{type:'text',data:{text:'[CQ:at,qq=all]'}}]});assert.equal(packets[1].action,'send_group_msg');assert.equal(packets[2].params.no_cache,true);assert.equal(packets[3].params.user_id,100001);assert.equal(packets[4].params.message_id,9);assert.equal(packets[5].action,'get_image');assert.equal(packets[6].action,'fetch_face_entity');
});
test('请求超时和断线均清理待响应项，不重试发送',async t=>{
 const packets=[],s=await server(t,socket=>socket.on('message',b=>packets.push(JSON.parse(b)))),c=client(t,{url:s.url});await c.connect();
 await assert.rejects(c.request('send_private_msg',{}, {timeoutMs:25}),{code:'ONEBOT_RPC_TIMEOUT'});assert.equal(c.pendingCount,0);
 const pending=c.request('send_group_msg');const rejected=assert.rejects(pending,{code:'ONEBOT_CONNECTION_CLOSED'});for(let i=0;i<50&&packets.length<2;i++)await delay(2);assert.equal(packets.length,2);s.sockets[0].terminate();await rejected;await delay(30);assert.equal(c.pendingCount,0);assert.equal(packets.length,2);
});
test('自动重连恢复事件且不重放旧请求，手动关闭停止重连，显式连接仍可恢复',async t=>{
 const s=await server(t),c=client(t,{url:s.url,reconnect:true,reconnectMs:10,maxReconnectMs:20});let events=0;c.onPrivateMessage(()=>events++);await c.connect();
 const open=once(c,'open');s.sockets[0].terminate();await open;
 s.sockets.at(-1).send(JSON.stringify({post_type:'message',message_type:'private'}));for(let i=0;i<30&&!events;i++)await delay(5);assert.equal(events,1);
 c.close();const count=s.sockets.length;await delay(50);assert.equal(s.sockets.length,count);await c.connect();assert.equal(c.isConnected,true);
});
test('握手被拒的connect会结束，可用更新后的令牌重连',async t=>{
 const httpServer=http.createServer(),wss=new WebSocketServer({noServer:true});let accepted=0;
 httpServer.on('upgrade',(req,socket,head)=>{if(req.headers.authorization!=='Bearer correct'){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}wss.handleUpgrade(req,socket,head,ws=>{accepted++;wss.emit('connection',ws,req);});});
 httpServer.listen(0,'127.0.0.1');await once(httpServer,'listening');t.after(async()=>{for(const s of wss.clients)s.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>httpServer.close(r));});
 const c=client(t,{url:'ws://127.0.0.1:'+httpServer.address().port,accessToken:'wrong'});await assert.rejects(c.connect(),{code:'ONEBOT_WS_ERROR'});await delay(10);c.accessToken='correct';await c.connect();assert.equal(accepted,1);
});
test('压缩包上传兼容发送器计算的长超时，成功后不遗留计时器',async t=>{
 const s=await server(t,socket=>socket.on('message',b=>reply(socket,JSON.parse(b),{uploaded:true}))),c=client(t,{url:s.url});await c.connect();
 const timeoutMs=onebotRpcTimeoutMs('upload_private_file',{}, {uploadBytes:100*1024*1024});assert.ok(timeoutMs>=1200000);
 const response=await c.request('upload_private_file',{user_id:100001,file:'fixture.z删ip'},{timeoutMs});assert.equal(response.data.uploaded,true);assert.equal(c.pendingCount,0);
});
test('握手停滞会超时，手动关闭可终止握手；离线与异常参数明确拒绝',async t=>{
 const peers=[],raw=net.createServer(socket=>peers.push(socket));raw.listen(0,'127.0.0.1');await once(raw,'listening');t.after(async()=>{for(const p of peers)p.destroy();await new Promise(r=>raw.close(r));});
 const url='ws://127.0.0.1:'+raw.address().port,c=client(t,{url,connectTimeoutMs:30});await assert.rejects(c.connect(),e=>['ONEBOT_WS_ERROR','ONEBOT_CONNECT_TIMEOUT'].includes(e.code));
 const d=client(t,{url});const connecting=d.connect(),rejected=assert.rejects(connecting,{code:'ONEBOT_CONNECTION_CLOSED'});d.close();await rejected;await assert.rejects(d.request('send_private_msg'),{code:'ONEBOT_NOT_CONNECTED'});
 const s=await server(t),e=client(t,{url:s.url});await e.connect();await assert.rejects(e.request('../bad'),{code:'ONEBOT_INVALID_REQUEST'});await assert.rejects(e.request('get_status',{}, {timeoutMs:0}),{code:'ONEBOT_INVALID_REQUEST'});const p={};p.loop=p;await assert.rejects(e.request('get_status',p),{code:'ONEBOT_INVALID_REQUEST'});
});
