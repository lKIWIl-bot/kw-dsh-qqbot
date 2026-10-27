// Local OneBot v11 adapter, implemented from the public protocol specification.
// Request envelopes are returned by request(); raw()/convenience methods unwrap data.
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
export const text=value=>({type:'text',data:{text:String(value)}});
const failure=(message,code,extra={})=>Object.assign(new Error(message),{code,...extra});
export class OneBotWebSocketClient extends EventEmitter {
 #socket=null;#connecting=null;#cancelConnect=null;#pending=new Map();#timer=null;#stopped=true;#delay;
 constructor({url,accessToken,reconnect=true,reconnectMs=1000,maxReconnectMs=15000,connectTimeoutMs=10000,requestTimeoutMs=30000}={}){
  super();Object.assign(this,{url,accessToken,reconnect,reconnectMs,maxReconnectMs,connectTimeoutMs,requestTimeoutMs});this.#delay=reconnectMs;
 }
 get isConnected(){return !this.#stopped&&this.#socket?.readyState===WebSocket.OPEN;}
 get pendingCount(){return this.#pending.size;}
 #error(error){for(const fn of this.rawListeners('error'))try{Promise.resolve(fn.call(this,error)).catch(()=>{});}catch{}}
 #dispatch(name,value){for(const fn of this.rawListeners(name))try{Promise.resolve(fn.call(this,value)).catch(e=>this.#error(e));}catch(e){this.#error(e);}}
 #rejectPending(error){for(const p of this.#pending.values()){clearTimeout(p.timer);p.reject(failure(error.message,error.code,{action:p.action}));}this.#pending.clear();}
 #schedule(){
  if(this.#stopped||!this.reconnect||this.#timer)return;
  this.#timer=setTimeout(()=>{this.#timer=null;void this.connect().catch(()=>{});},this.#delay);this.#timer.unref?.();this.#delay=Math.min(this.maxReconnectMs,this.#delay*2);
 }
 connect(){
  if(this.isConnected)return Promise.resolve();if(this.#connecting)return this.#connecting;
  let endpoint;try{endpoint=new URL(this.url);if(!['ws:','wss:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.searchParams.has('access_token'))throw Error();}catch{return Promise.reject(failure('OneBot地址无效；凭据请使用accessToken配置','ONEBOT_INVALID_URL'));}
  clearTimeout(this.#timer);this.#timer=null;this.#stopped=false;
  let settle,timeout;
  const promise=new Promise((resolve,reject)=>{let done=false;settle=error=>{if(done)return;done=true;clearTimeout(timeout);if(this.#connecting===promise)this.#connecting=null;this.#cancelConnect=null;error?reject(error):resolve();};});
  this.#connecting=promise;this.#cancelConnect=settle;
  let socket;try{socket=new WebSocket(endpoint,{headers:this.accessToken?{Authorization:'Bearer '+this.accessToken}:{},handshakeTimeout:this.connectTimeoutMs,maxPayload:16*1048576,perMessageDeflate:false});}catch{queueMicrotask(()=>{settle(failure('OneBot连接初始化失败','ONEBOT_CONNECT_FAILED'));this.#schedule();});return promise;}
  this.#socket=socket;
  timeout=setTimeout(()=>{if(this.#socket!==socket)return;const error=failure('OneBot连接超时','ONEBOT_CONNECT_TIMEOUT');settle(error);socket.terminate();this.#error(error);},this.connectTimeoutMs);
  socket.once('open',()=>{if(this.#socket!==socket)return;this.#delay=this.reconnectMs;settle();this.#dispatch('open');});
  socket.on('message',data=>{
   if(this.#socket!==socket||this.#stopped)return;
   let packet;try{packet=JSON.parse(data.toString());if(!packet||typeof packet!=='object'||Array.isArray(packet))throw Error();}catch{this.#error(failure('OneBot收到无效JSON数据','ONEBOT_INVALID_PACKET'));return;}
   if(Object.hasOwn(packet,'echo')){const p=this.#pending.get(packet.echo);if(p){this.#pending.delete(packet.echo);clearTimeout(p.timer);p.resolve(packet);}return;}
   if(typeof packet.post_type!=='string')return;
   this.#dispatch('event',packet);
   if(packet.post_type==='message'&&['private','group'].includes(packet.message_type))this.#dispatch('message:'+packet.message_type,packet);
   if(packet.post_type==='notice'&&typeof packet.notice_type==='string')this.#dispatch('notice:'+packet.notice_type,packet);
  });
  socket.on('error',()=>{if(this.#socket!==socket)return;const error=failure('OneBot WebSocket连接失败','ONEBOT_WS_ERROR');settle(error);this.#rejectPending(error);this.#error(error);});
  socket.once('close',(code,reason)=>{
   if(this.#socket!==socket)return;this.#socket=null;const error=failure('OneBot连接已断开；发送结果可能未知，请勿自动重发','ONEBOT_CONNECTION_CLOSED');settle(error);this.#rejectPending(error);
   // Do not expose gateway-controlled close reasons, which can contain credentials.
   this.#dispatch('close',{code,reason:reason.length?'OneBot连接关闭':''});this.#schedule();
  });
  return promise;
 }
 close(code=1000,reason=''){
  this.#stopped=true;clearTimeout(this.#timer);this.#timer=null;const error=failure('OneBot连接已关闭','ONEBOT_CONNECTION_CLOSED');this.#cancelConnect?.(error);this.#rejectPending(error);
  const socket=this.#socket;if(socket?.readyState===WebSocket.CONNECTING)socket.terminate();else if(socket?.readyState===WebSocket.OPEN)socket.close(code,reason);
 }
 request(action,params={},options={}){
  if(!this.isConnected)return Promise.reject(failure('OneBot尚未连接','ONEBOT_NOT_CONNECTED',{action}));
  if(typeof action!=='string'||!/^[a-z][a-z0-9_]{0,95}$/.test(action)||!params||typeof params!=='object'||Array.isArray(params))return Promise.reject(failure('OneBot请求参数无效','ONEBOT_INVALID_REQUEST'));
  const timeoutMs=options.timeoutMs??this.requestTimeoutMs;if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>7200000)return Promise.reject(failure('OneBot请求超时配置无效','ONEBOT_INVALID_REQUEST'));
  if(this.#pending.size>=256)return Promise.reject(failure('OneBot待响应请求过多','ONEBOT_BUSY',{action}));
  const echo=randomUUID();let payload;try{payload=JSON.stringify({action,params,echo});}catch{return Promise.reject(failure('OneBot请求无法序列化','ONEBOT_INVALID_REQUEST',{action}));}
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.#pending.delete(echo);reject(failure('OneBot请求超时；发送结果可能未知，请勿自动重发','ONEBOT_RPC_TIMEOUT',{action}));},timeoutMs);
   this.#pending.set(echo,{resolve,reject,timer,action});
   this.#socket.send(payload,error=>{if(!error)return;const p=this.#pending.get(echo);if(!p)return;this.#pending.delete(echo);clearTimeout(timer);p.reject(failure('OneBot请求发送失败','ONEBOT_SEND_FAILED',{action}));});
  });
 }
 async raw(action,params={},options){const r=await this.request(action,params,options);if(r.status!=='ok'||Number(r.retcode)!==0)throw failure('OneBot操作失败：'+action+'，retcode='+String(r.retcode),'ONEBOT_API_ERROR',{action,retcode:r.retcode});return r.data;}
 onEvent(handler){return this.on('event',handler);}
 onPrivateMessage(handler){return this.on('message:private',handler);}
 onGroupMessage(handler){return this.on('message:group',handler);}
 onNotice(type,handler){return this.on('notice:'+type,handler);}
 onBotStatus(handler){return this.onNotice('bot_status',handler);}
 getLoginInfo(){return this.raw('get_login_info');}
 getMessage(messageId){return this.raw('get_msg',{message_id:messageId});}
 getImage(params){return this.raw('get_image',params);}
 getGroupMemberList(groupId,{noCache=false}={}){return this.raw('get_group_member_list',{group_id:groupId,no_cache:noCache});}
 getGroupMemberInfo(groupId,userId,{noCache=false}={}){return this.raw('get_group_member_info',{group_id:groupId,user_id:userId,no_cache:noCache});}
 fetchFaceEntity(faceId){return this.raw('fetch_face_entity',{face_id:faceId});}
 sendPrivateMessage(userId,message){return this.raw('send_private_msg',{user_id:userId,message:Array.isArray(message)?message:[typeof message==='string'?text(message):message]});}
 sendGroupMessage(groupId,message){return this.raw('send_group_msg',{group_id:groupId,message:Array.isArray(message)?message:[typeof message==='string'?text(message):message]});}
}
