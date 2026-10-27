import fs from 'node:fs';
import path from 'node:path';
import {getQuotedBotMessage} from './quoted-recall.mjs';
import {createPreviewRecalls} from '../comfy-preview-recalls.mjs';

const validId=id=>/^-?[1-9]\d{0,15}$/.test(String(id))&&Number.isSafeInteger(Number(id));
export function parseArchivePreview(event,{botId}={}){
 const segments=event?.message;if(!Array.isArray(segments))return null;
 const text=segments.filter(s=>s?.type==='text').map(s=>String(s.data?.text??'')).join('').trim();
 if(text!=='/解压')return null;
 const replies=segments.filter(s=>s?.type==='reply');
 if(segments.some(s=>!['text','reply','at'].includes(s?.type)||s.type==='at'&&String(s.data?.qq)!==String(botId))||replies.length>1||replies.length===1&&!validId(replies[0].data?.id))return {messageId:null};
 return {messageId:replies.length?String(replies[0].data.id):null};
}

export function createArchivePreviews({stateDir,owner,notify,getMessage,getPrivateHistory,loadImages,sendImages,recall,log=()=>{},now=Date.now,schedule=setTimeout,unschedule=clearTimeout}){
 const file=path.join(stateDir,'archive-preview-requests.json');let requests=[];
 if(fs.existsSync(file)){
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(saved.version!==1||!Array.isArray(saved.requests))throw Error('解压请求记录损坏');
  requests=saved.requests;
 }
 const recalls=createPreviewRecalls({stateDir,fileName:'archive-preview-recalls.json',allowGroups:true,owner,recall,onFailure:notify,log,now,schedule,unschedule});
 const save=()=>{fs.mkdirSync(stateDir,{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,requests},null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);};
 async function handle({key,event,botId,guard=()=>{}}){
  const command=parseArchivePreview(event,{botId});if(!command)return false;
  const actor=String(event.user_id),ownerId=String(owner());
  if(actor!==ownerId||key.startsWith('private:')&&key!=='private:'+ownerId){await notify(key,'解压指令仅管理员可用。');return true;}
  if(!command.messageId){await notify(key,'请引用机器人发送的压缩文件，再发送 /解压；图片90秒后撤回。');return true;}
  const eventId=event.message_id??event.msg_id;
  if(!validId(eventId)){await notify(key,'无法确认本条指令，请重新引用压缩文件发送 /解压。');return true;}
  const eventKey=key+':'+eventId;if(requests.some(r=>r.eventKey===eventKey))return true;
  const request={eventKey,key,actorQQ:actor,at:now(),status:'checking'};
  requests.push(request);if(requests.length>512)requests=requests.slice(-512);save();
  let sent=false;
  try{
   guard();
   const raw=await getQuotedBotMessage({key,messageId:command.messageId,botId,getMessage,getPrivateHistory});
   const files=raw.message?.filter(s=>s?.type==='file')??[];
   if(files.length!==1)throw Error('请引用机器人按规则发送的图片压缩文件。');
   const name=String(files[0].data?.name??files[0].data?.file_name??files[0].data?.filename??files[0].data?.file??'');
   if(!/^(?:[a-f0-9]{10}|images-[a-f0-9-]{36})\.z删ip$/i.test(name))throw Error('该文件不是机器人按规则发送的图片压缩包。');
   const images=await loadImages(name);
   guard();if(String(owner())!==actor)throw Error('管理员身份已变更，未发送。');
   request.status='sending';save();
   const receipt=await sendImages(images,key,actor);sent=true;
   if(!validId(receipt?.messageId))throw Error('未取得图片发送回执');
   request.messageId=String(receipt.messageId);request.status='sent';save();
   try{const entry=recalls.add({key,messageId:receipt.messageId,actorQQ:actor,delayMs:90000});request.dueAt=entry.dueAt;save();}
   catch(error){
    log('解压图片撤回登记失败：'+String(error?.message??error));
    try{const result=await recall(key,receipt.messageId,{actorQQ:actor});if(result?.unconfirmed||result?.recalled===false)throw Error('回执未确认');await notify(key,'自动撤回登记失败，已立即撤回图片；压缩包保留。');}
    catch{await notify(key,'自动撤回登记失败，请手动撤回刚发送的图片；压缩包保留。');}
    return true;
   }
  }catch(error){
   const uncertain=sent||request.status==='sending';request.status=uncertain?'delivery-unknown':'failed';save();
   log('解压预览未完成：'+String(error?.message??error).slice(0,300));
   const text=String(error?.message??'');
   await notify(key,uncertain?'图片发送回执未确认，不会自动重发；如已收到，请手动撤回。':/^(只能撤回|无法确认|无法核对|请引用|该文件不是|压缩包|管理员身份)/.test(text)?text:'解压未完成，请检查本地压缩包缓存或QQ接口。');
  }
  return true;
 }
 return {handle,complete:(key,id)=>recalls.complete(key,id),close:()=>recalls.close()};
}
