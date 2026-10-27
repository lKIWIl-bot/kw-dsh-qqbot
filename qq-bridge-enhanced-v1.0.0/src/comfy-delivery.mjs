import {createHash} from 'node:crypto';

export function mediaSendTimeoutMs(bytes){
 return Math.min(600000,Math.max(120000,30000+Math.ceil(bytes/131072)*1000));
}
export function onebotRpcTimeoutMs(action,params={}, {uploadBytes=0,uploadTimeout={}}={}){
 if(/^upload_(?:group|private)_file$/.test(action)){
  // NapCat's upload endpoints use its configured size-based wait, not params.timeout.
  // Keep the outer RPC alive beyond that wait, including for large archives.
  const base=Number(uploadTimeout.baseTimeout)||40000,speed=Math.max(1,Number(uploadTimeout.uploadSpeedKBps)||64),max=Number(uploadTimeout.maxTimeout)||3600000;
  return Math.max(1200000,Math.ceil(Math.min(base+Math.max(0,uploadBytes)/1024/speed*1000,max))+30000);
 }
 if(/^send_(?:group|private)_msg$/.test(action)&&Array.isArray(params.message)&&params.message.some(s=>['image','video','file'].includes(s.type)))return Math.min(630000,Math.max(120000,Number(params.timeout)||120000)+30000);
 return 30000;
}
export function napcatRpcError(action,response){
 const detail=String(response.message||response.wording||'').replace(/base64:\/\/[A-Za-z0-9+/=]+/gi,'[image data]').replace(/https?:\/\/[^\s]+/gi,'[url]').replace(/((?:access_?token|token|authorization|password)\s*[=:]\s*)\S+/gi,'$1[redacted]').slice(0,500);
 const e=new Error('NapCat '+action+' rejected: '+response.retcode+(detail?'; '+detail:''));
 e.code='NAPCAT_RPC_REJECTED';e.retcode=response.retcode;e.action=action;return e;
}
const validId=id=>typeof id==='number'?Number.isSafeInteger(id)&&id!==0:typeof id==='string'&&/^-?[1-9]\d{0,15}$/.test(id);
function imageHash(segment){
 if(segment?.type!=='image')return null;
 const m=/^([a-f\d]{32})(?:\.(?:png|jpe?g|webp))?$/i.exec(String(segment.data?.file??''));return m?.[1].toLowerCase()??null;
}
function receiptMessageMatches(m,{target,botId,startedAt,now}){
 if(String(m.sender?.user_id??m.user_id)!==String(botId)||!validId(m.message_id))return false;
 const seq=Number(m.real_seq);if(!Number.isSafeInteger(seq)||seq<=0)return false;
 if(m.message_type&&m.message_type!==target.kind)return false;
 if(target.kind==='group'&&m.group_id!==undefined&&String(m.group_id)!==String(target.id))return false;
 if(target.kind==='private'&&m.group_id!=null)return false;
 const at=Number(m.time)*1000;
 return Number.isFinite(at)&&at>=startedAt-2000&&at<=now+30000&&Array.isArray(m.message);
}
export function findFileReceipt(messages,{target,botId,name,sizeBytes,startedAt,now=Date.now()}){
 for(const m of messages??[]){
  if(!receiptMessageMatches(m,{target,botId,startedAt,now}))continue;
  const files=m.message.filter(s=>s.type==='file');
  if(files.length!==1)continue;
  const d=files[0].data??{},fileName=d.name??d.file_name??d.file;
  if(fileName!==name||Number(d.file_size??d.size)!==sizeBytes)continue;
  return {message_id:m.message_id,recovered:true};
 }
 return null;
}
const uncertainDelivery=error=>error.code==='NO_DELIVERY_RECEIPT'||Number(error.retcode)===1200||['ONEBOT_RPC_TIMEOUT','ONEBOT_CONNECTION_CLOSED'].includes(error.code)||/\btimeout\b|connection closed|rejected: 1200/i.test(error.message);
function messageHistory(bot,target){
 return bot.rpc(target.kind==='group'?'get_group_msg_history':'get_friend_msg_history',{...(target.kind==='group'?{group_id:String(target.id)}:{user_id:String(target.id)}),count:50,reverse_order:false,disable_get_url:true,parse_mult_msg:false,quick_reply:true});
}
// A confirmed server-side message may arrive before NapCat completes its send RPC.
// Poll reads alongside that single request; never cancel the server send or issue a second one.
async function waitForDeliveryReceipt({send,lookup,find,sleep,recoveryDelays,pollIntervalMs}){
 let stopped=false,timer;
 const readReceipt=async()=>{try{return find((await lookup())?.messages);}catch{return null;}};
 const ack=Promise.resolve().then(send).then(receipt=>({receipt}),error=>({error}));
 const early=new Promise(resolve=>{
  if(pollIntervalMs<=0)return;
  const tick=async()=>{
   if(stopped)return;
   const receipt=await readReceipt();
   if(stopped)return;
   if(receipt)resolve({receipt});else timer=setTimeout(tick,pollIntervalMs);
  };
  timer=setTimeout(tick,pollIntervalMs);
 });
 let outcome;
 try{outcome=await Promise.race([ack,early]);}
 finally{stopped=true;clearTimeout(timer);}
 if(!outcome.error)return outcome.receipt;
 const error=outcome.error;
 if(!uncertainDelivery(error))throw error;
 for(const delay of recoveryDelays){
  if(delay)await sleep(delay);
  const receipt=await readReceipt();if(receipt)return receipt;
 }
 throw error;
}
export async function uploadFileWithReceipt(bot,target,{file,name,sizeBytes},{botId,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),recoveryDelays=[0,5000,10000,15000,15000],pollIntervalMs=2000}={}){
 const startedAt=now(),action=target.kind==='group'?'upload_group_file':'upload_private_file';
 return waitForDeliveryReceipt({
  send:()=>bot.rpc(action,{...(target.kind==='group'?{group_id:target.id}:{user_id:target.id}),file,name}),
  lookup:()=>messageHistory(bot,target),
  find:messages=>findFileReceipt(messages,{target,botId,name,sizeBytes,startedAt,now:now()}),
  sleep,recoveryDelays,pollIntervalMs,
 });
}
export function findImageReceipt(messages,{target,botId,hashes,startedAt,expectedText,now=Date.now()}){
 const expected=[...hashes].sort().join(',');
 for(const m of messages??[]){
  if(!receiptMessageMatches(m,{target,botId,startedAt,now}))continue;
  if(expectedText!==undefined&&m.message.filter(s=>s.type==='text').map(s=>String(s.data?.text??'')).join('')!==expectedText)continue;
  const actual=m.message.filter(s=>s.type==='image').map(imageHash);
  if(actual.length===hashes.length&&actual.every(Boolean)&&actual.sort().join(',')===expected)return {message_id:m.message_id,recovered:true};
 }
 return null;
}
export async function sendImagesWithReceipt(bot,target,images,{botId,prefixSegments=[],now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),recoveryDelays=[0,5000,10000,15000,15000],pollIntervalMs=2000}={}){
 const startedAt=now(),timeout=mediaSendTimeoutMs(images.reduce((sum,i)=>sum+i.bytes.length,0));
 if(!Array.isArray(prefixSegments)||prefixSegments.some(s=>!s||!['text','at'].includes(s.type)))throw Error('Invalid media message prefix');
 const message=[...prefixSegments,...images.map(i=>({type:'image',data:{file:'base64://'+i.bytes.toString('base64')}}))];
 const expectedText=prefixSegments.length?prefixSegments.filter(s=>s.type==='text').map(s=>String(s.data?.text??'')).join(''):undefined;
 const action=target.kind==='group'?'send_group_msg':'send_private_msg';
 const hashes=images.map(i=>createHash('md5').update(i.bytes).digest('hex'));
 return waitForDeliveryReceipt({send:async()=>{
  const receipt=await bot.rpc(action,{...(target.kind==='group'?{group_id:target.id}:{user_id:target.id}),message,timeout});
  if(validId(receipt?.message_id))return receipt;
  throw Object.assign(new Error('NapCat returned no delivery receipt'),{code:'NO_DELIVERY_RECEIPT'});
 },lookup:()=>messageHistory(bot,target),find:messages=>findImageReceipt(messages,{target,botId,hashes,startedAt,expectedText,now:now()}),sleep,recoveryDelays,pollIntervalMs});
}

export function describeDeliveryFailure(error,{kind='image',temporaryPreview=false}={}){
 const action=String(error?.action??/\b(upload_(?:group|private)_file|send_(?:group|private)_msg)\b/.exec(String(error?.message??''))?.[1]??'');
 const uncertain=Number(error?.retcode)===1200||/timeout|connection closed|no delivery receipt/i.test(String(error?.message??''))||error?.code==='ONEBOT_RPC_TIMEOUT';
 const fileUpload=/^upload_(?:group|private)_file$/.test(action),plainImageFile=fileUpload&&error?.generatedImageFile===true,archiveUpload=fileUpload&&!plainImageFile;
 const stage=plainImageFile?'image-file-upload':archiveUpload?'archive-upload':'media-send';
 const summary=plainImageFile?(uncertain?'高清PNG文件上传回执未确认':'高清PNG文件上传失败'):archiveUpload?(uncertain?'压缩包上传回执未确认':'压缩包上传失败'):'发送结果未确认';
 const detail={stage,action:action||null,uncertain,code:String(error?.code??'DELIVERY_ERROR'),retcode:error?.retcode??null,...(archiveUpload?{previewAttempted:false}:{})};
 const media=kind==='video'?'视频':'图片';
 const message=fileUpload
  ?media+'已生成，'+summary+'。'+(uncertain?'文件可能已收到，请先核对。':'')+(temporaryPreview?'直发预览尚未发送。':'')+'不会自动重传；请管理员检查文件上传。'
  :media+'已生成，但发送结果未知，请勿重复提交；请管理员检查。';
 return {detail,summary,message};
}
