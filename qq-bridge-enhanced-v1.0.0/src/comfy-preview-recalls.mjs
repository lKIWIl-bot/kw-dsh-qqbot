import fs from 'node:fs';
import path from 'node:path';
const validId=id=>/^-?[1-9]\d{0,15}$/.test(String(id))&&Number.isSafeInteger(Number(id));
export function createPreviewRecalls({stateDir,fileName='preview-recalls.json',allowGroups=false,owner,recall,onFailure=()=>{},log=()=>{},now=Date.now,schedule=setTimeout,unschedule=clearTimeout}){
 if(!/^[a-z-]+\.json$/.test(fileName))throw Error('Invalid recall state filename');
 const authorized=e=>e.key==='private:'+String(owner())||allowGroups&&/^group:\d{5,12}$/.test(e.key)&&e.actorQQ===String(owner());
 const file=path.join(stateDir,fileName),timers=new Map(),running=new Set();let closed=false;
 let entries=[];
 if(fs.existsSync(file)){
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(saved.version!==1||!Array.isArray(saved.entries)||saved.entries.some(e=>!validId(e.messageId)||!(/^private:\d{5,12}$/.test(e.key)||allowGroups&&/^group:\d{5,12}$/.test(e.key)&&/^\d{5,12}$/.test(e.actorQQ))||!Number.isFinite(e.dueAt)))throw Error('临时图片撤回记录损坏');
  entries=saved.entries;
 }
 function save(){fs.mkdirSync(stateDir,{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,entries},null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
 function arm(entry){
  if(closed||['failed','unconfirmed'].includes(entry.status)||running.has(entry.messageId))return;
  const old=timers.get(entry.messageId);if(old)unschedule(old);
  const timer=schedule(()=>{timers.delete(entry.messageId);void execute(entry);},Math.max(0,(entry.retryAt??entry.dueAt)-now()));timer?.unref?.();timers.set(entry.messageId,timer);
 }
 async function execute(entry){
  if(closed||running.has(entry.messageId))return;running.add(entry.messageId);
  try{
   if(!authorized(entry))throw Error('管理员身份已变更');
   const result=await recall(entry.key,entry.messageId,{verifyOnly:entry.uncertain===true,...(entry.actorQQ?{actorQQ:entry.actorQQ}:{})});
   if(!entries.includes(entry))return; // A matching QQ notice may settle the job while its RPC is pending.
   if(result?.unconfirmed===true||result?.recalled===false){
    entry.uncertain=true;entry.attempts=(entry.attempts??0)+1;entry.status=entry.attempts>=3?'unconfirmed':'pending';entry.retryAt=now()+10000;save();
    log('临时生图撤回回执未确认 '+entry.key+' '+entry.messageId+'，仅查询状态 '+entry.attempts+'：'+String(result?.detail??'等待QQ撤回通知').slice(0,200));
    if(entry.status==='unconfirmed')await onFailure(entry.key,'临时图片的撤回回执未确认；若图片仍可见，请手动撤回。压缩包已保留。');
    return;
   }
   entries=entries.filter(e=>e!==entry);save();log('临时生图已撤回 '+entry.key+' '+entry.messageId);
  }catch(error){
   if(!entries.includes(entry))return;
   if(entry.uncertain===true){
    entry.attempts=(entry.attempts??0)+1;entry.status=entry.attempts>=3?'unconfirmed':'pending';entry.retryAt=now()+10000;save();
    log('临时图片撤回状态查询未确认 '+entry.key+' '+entry.messageId+'：'+String(error?.message??error).slice(0,200));
    if(entry.status==='unconfirmed')await onFailure(entry.key,'临时图片的撤回回执未确认；若图片仍可见，请手动撤回。压缩包已保留。');
    return;
   }
   entry.attempts=(entry.attempts??0)+1;entry.status=entry.attempts>=3?'failed':'pending';entry.retryAt=now()+10000;save();
   log('临时生图撤回失败 '+entry.key+' '+entry.messageId+'，尝试 '+entry.attempts+'：'+String(error?.message??error).slice(0,200));
   if(entry.status==='failed')await onFailure(entry.key,'临时图片自动撤回失败，请手动撤回；压缩包已保留。');
  }finally{running.delete(entry.messageId);if(entries.includes(entry))arm(entry);}
 }
 function add({key,messageId,delayMs=60000,actorQQ}){
  if(closed||!authorized({key,actorQQ})||!validId(messageId)||![60000,90000].includes(delayMs))throw Error('无效的管理员临时图片回执');
  const found=entries.find(e=>String(e.messageId)===String(messageId));if(found)return found;
  const entry={key,messageId:String(messageId),dueAt:now()+delayMs,attempts:0,status:'pending',...(actorQQ?{actorQQ}:{})};
  entries.push(entry);try{save();}catch(e){entries=entries.filter(v=>v!==entry);throw e;}arm(entry);return entry;
 }
 for(const entry of entries)arm(entry);
 function complete(key,messageId){
  const removed=entries.filter(e=>e.key===key&&String(e.messageId)===String(messageId));if(!removed.length)return false;
  const timer=timers.get(String(messageId));if(timer)unschedule(timer);timers.delete(String(messageId));
  entries=entries.filter(e=>!removed.includes(e));save();return true;
 }
 return {add,complete,close(){closed=true;for(const timer of timers.values())unschedule(timer);timers.clear();}};
}
