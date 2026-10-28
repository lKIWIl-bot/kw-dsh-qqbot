import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {atomicWriteJsonFile} from '../../../qq-bridge-enhanced-v1.0.0/src/lib/json-store.js';
import {inspectWebMedia,fetchWebMedia,mediaFormat,fileFormat,mediaError,publicMediaUrl,WEB_MEDIA_LIMITS} from './web-media-fetch.mjs';
import {downloadHls} from './web-media-hls.mjs';
import {sendImagesWithReceipt,sendVideoWithReceipt,uploadFileWithReceipt,onebotRpcTimeoutMs,napcatRpcError} from './comfy-delivery.mjs';
import {ARCHIVE_PASSWORD} from './comfy-archive.mjs';
import {webSearch} from '../../../qq-bridge-enhanced-v1.0.0/src/web-search.js';
import {availableWebArchiveName,validWebArchiveName} from './web-media-names.mjs';

const tokenHash=token=>createHash('sha256').update(String(token)).digest('hex');
export const WEB_MEDIA_BATCH_LIMITS=Object.freeze({image:100,video:10,file:100});
const states=new Set(['queued','downloading','sending']);
const isId=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
export function parseWebMediaCommand(text){
 const raw=String(text??'').trim();
 if(raw==='/正常抓取')return {action:'mode',mode:'normal'};
 if(raw==='/加密抓取')return {action:'mode',mode:'encrypted'};
 if(raw==='/清除抓取缓存')return {action:'clear'};
 const m=/^\/(下载图片|下载视频|下载文件)\s+(https?:\/\/\S+?)(?:\s+(\d+))?$/i.exec(raw);
 if(m)return {action:'download',kind:m[1]==='下载图片'?'image':m[1]==='下载视频'?'video':'file',url:m[2],index:Number(m[3]??1)};
 if(/^\/(?:下载图片|下载视频|下载文件|正常抓取|加密抓取|清除抓取缓存)(?:\s|$)/.test(raw))return {action:'syntax'};
 return null;
}
export function isWebMediaRequest(text){
 const value=String(text),media='(?:图片|图|照片|相片|壁纸|海报|头像|插画|表情包|动图|视频|短片|片段|录像|素材|文件|文档|PDF|压缩包|音频|音乐|歌曲|电子书|表格|PPT)';
 return /下载|转发/i.test(value)||new RegExp('(?:发|找|搜|给我|来|传|要).{0,100}'+media+'|'+media+'.{0,100}(?:发来|发给|发送|下载|转发|找找|搜搜)','i').test(value);
}
async function packArchive(asset,directory,signal,name){
 const output=path.join(directory,name??availableWebArchiveName('',asset.kind,new Set()));
 await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./web-media-archive-worker.mjs',import.meta.url),{workerData:{directory,file:asset.file,output,ext:asset.ext}});
  let done=false;const finish=e=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(e){void worker.terminate();reject(e);}else resolve();};
  const abort=()=>finish(Error('打包已取消或超时')),timer=setTimeout(abort,3600000);
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  worker.on('message',m=>finish(m.ok?null:Error(m.error)));worker.on('error',finish);worker.on('exit',code=>{if(!done)finish(Error('打包进程提前结束'));});
 });
 return {file:output,kind:'file',ext:'z删ip',bytes:(await fsp.stat(output)).size,archive:true};
}
export async function deliverWebMedia(asset,key,{rpc,botId,guard=()=>{},inlinePreview=false}){
 const match=/^(private|group):(\d{5,12})$/.exec(key);if(!match)throw Error('发送目标无效');
 const target={kind:match[1],id:Number(match[2])};
 const bot={rpc:async(action,params)=>{guard();return rpc(action,params);}};
 guard();
 if(asset.archive||asset.kind==='file'||!inlinePreview&&(asset.bytes>20*1048576||asset.kind==='video'&&asset.ext!=='mp4')){
  const name=asset.archive?path.basename(asset.file):'网页媒体-'+asset.id+'.'+asset.ext;
  const r=await uploadFileWithReceipt(bot,target,{file:asset.file,name,sizeBytes:asset.bytes},{botId});return {uploaded:true,messageId:r?.message_id,receiptRecovered:r?.recovered===true,archive:asset.archive===true};
 }
 if(asset.kind==='image'){
  const r=await sendImagesWithReceipt(bot,target,[{bytes:await fsp.readFile(asset.file),ext:asset.ext}],{botId});return {messageId:r.message_id,receiptRecovered:r.recovered===true};
 }
 const r=await sendVideoWithReceipt(bot,target,{file:asset.file,sizeBytes:asset.bytes},{botId});
 return {messageId:r.message_id,receiptRecovered:r.recovered===true};
}
export function createWebMedia({root,stateDir,cfg,allowed,guardFor,isOwner,notify,rpc,botId,now=Date.now,search=webSearch,inspect=inspectWebMedia,fetchResource=fetchWebMedia,hls=(url,directory,options)=>downloadHls(url,directory,{...options,ffmpeg:cfg.webMedia?.ffmpegPath||undefined}),archive=packArchive,deliver=deliverWebMedia,log=()=>{}}){
 const cache=path.join(stateDir,'web-media-cache'),stateFile=path.join(stateDir,'web-media.json');
 fs.mkdirSync(cache,{recursive:true});if(fs.lstatSync(cache).isSymbolicLink())throw Error('网页媒体缓存目录不能是链接');
 let store={version:1,modes:{},jobs:[]};
 if(fs.existsSync(stateFile)){store=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(store.version!==1||!store.modes||typeof store.modes!=='object'||Array.isArray(store.modes)||!Array.isArray(store.jobs))throw Error('网页媒体状态异常');}
 for(const j of store.jobs)if(states.has(j.state))j.state='interrupted';
 const grants=new Map(),choices=new Map(),jobSources=new Map(),submitted=new Map(),summaries=new Map(),inspections=new Map(),inspecting=new Set(),events=new Map(),previewPins=new Map(),previewAssets=new WeakMap();let active=null,closed=false,lastKey=null,restoring=false,recoveryWorker=null;
 const save=()=>{const keep=new Set(store.jobs.filter(j=>!states.has(j.state)).slice(-1000));store.jobs=store.jobs.filter(j=>states.has(j.state)||keep.has(j));atomicWriteJsonFile(stateFile,store);};save();
 const check=key=>{if(cfg.webMedia?.enabled===false||cfg.socialV2?.tools?.webMedia===false)throw Error('网页抓取功能已关闭');if(!allowed(key))throw Error('当前会话未获授权');};
 const mode=key=>store.modes[key]==='encrypted'?'encrypted':'normal';
 const view=j=>j?{jobId:j.id,state:j.state,kind:j.kind,mode:j.mode,bytes:j.bytes??null,messageId:j.messageId??null,filename:j.filename??j.archiveName??null,error:j.error??null}:null;
 function noteRequest({key,text,eventId,directed=true}){
  for(const[k,g]of grants)if(now()-g.at>600000)grants.delete(k);
  const prior=grants.get(key);if(prior&&prior.eventId===String(eventId))return;
  if(!directed||!isWebMediaRequest(text)){grants.delete(key);return;}
  grants.set(key,{id:randomUUID(),eventId:String(eventId),at:now(),remaining:{...WEB_MEDIA_BATCH_LIMITS}});
  while(grants.size>512)grants.delete(grants.keys().next().value);
 }
 function beginLookup(key){
  check(key);if(inspecting.has(key)||inspecting.size>=2)throw Error('正在解析网页，请稍后再试');
  const grant=grants.get(key),budget=grant&&now()-grant.at<=600000?256:6;
  const history=(inspections.get(key)??[]).filter(t=>now()-t<60000);if(history.length>=budget)throw Error('网页解析请求较多，请稍后再试');inspections.set(key,[...history,now()]);
  inspecting.add(key);
 }
 async function searchMedia({key,query,kind='auto',limit=6}){
  if(!['auto','image','video','file'].includes(kind))throw Error('资源类型无效');
  if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('搜索数量须为1至20');
  const clean=String(query??'').replace(/\[CQ:[^\]]*\]/gi,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
  if(!clean)throw Error('请提供需要寻找的图片或视频内容');
  beginLookup(key);
  try{
   const result=await search(clean,{root,config:{maxResults:limit}});check(key);const results=[],seen=new Set();
   for(const row of result.results??[]){
    try{const url=publicMediaUrl(row.url);if(seen.has(url))continue;seen.add(url);results.push({title:String(row.title??'').slice(0,180),url,snippet:String(row.snippet??'').slice(0,350)});if(results.length>=limit)break;}catch{}
   }
   return {ok:true,query:clean,kind,mode:mode(key),results,note:results.length?'搜索结果是待核对的网页，不是已下载媒体。选择相关来源继续inspect；图片按需用web_fetch_image核对内容，再send候选id。无需用户提供链接；仅发送符合真实用户要求的内容。':'本次未找到可用来源，可换一次关键词或来源；不要编造下载成功。'};
  }finally{inspecting.delete(key);}
 }
 async function inspectMedia({key,token,url,kind='auto'}){
  beginLookup(key);
  try{
  for(const[id,c]of choices)if(c.expires<now())choices.delete(id);
  if(choices.size>8192)throw Error('媒体候选过多，请稍后再试');
   const result=await inspect(url,{kind,fetchResource,signal:AbortSignal.timeout(55000)});check(key);
   const grant=grants.get(key),tokenId=tokenHash(token),rows=[];
   for(const c of result.candidates.slice(0,210)){
    const id=randomUUID();choices.set(id,{...c,id,key,tokenId,grantId:grant?.id,expires:now()+600000});rows.push({id,kind:c.kind,label:c.label??'',url:c.url});
   }
   return {ok:true,mode:mode(key),limits:WEB_MEDIA_BATCH_LIMITS,candidates:rows,note:result.note};
  }finally{inspecting.delete(key);}
 }
 function send({key,token,candidateId,candidateIds,description,descriptions}){
  check(key);
  if(candidateId!==undefined&&candidateIds!==undefined)throw Error('单个候选和批量候选不能同时填写');
  const ids=candidateIds??[candidateId];if(!Array.isArray(ids)||ids.length<1||ids.length>210||ids.some(id=>typeof id!=='string'))throw Error('每批最多100张图片、10个视频、100个其他文件');
  if(descriptions!==undefined&&(!Array.isArray(descriptions)||descriptions.length!==ids.length||descriptions.some(s=>typeof s!=='string'||s.length>80)))throw Error('文件简述必须与候选资源一一对应');
  if(description!==undefined&&(ids.length!==1||typeof description!=='string'||description.length>80))throw Error('单文件简述参数无效');
  const labels=new Map(ids.map((id,i)=>[id,descriptions?.[i]??description]));
  const selected=[...new Set(ids)].map(id=>choices.get(id)),tokenId=tokenHash(token);
  if(selected.some(c=>!c||c.key!==key||c.tokenId!==tokenId||c.expires<now()))throw Error('候选资源已失效或不属于当前会话，请重新解析');
  for(const [ref,row]of submitted)if(row.expires<now())submitted.delete(ref);
  const grant=grants.get(key),rows=[],fresh=new Map();
  for(const c of selected){
   const sourceKey=tokenHash(key+'\n'+c.grantId+'\n'+c.url),existing=c.jobId??submitted.get(sourceKey)?.id;
   if(existing){const j=store.jobs.find(j=>j.id===existing&&j.key===key);if(!j)throw Error('原下载记录已过期，请重新解析');rows.push({c,j,sourceKey});continue;}
   if(!grant||grant.id!==c.grantId||now()-grant.at>600000)throw Error('请先在当前会话明确要求下载或发送图片/视频；群内需真实@机器人');
   let j=fresh.get(sourceKey)?.j;
   if(!j){
    const used=new Set([...store.jobs.filter(row=>row.key===key).flatMap(row=>[row.filename,row.archiveName]),...[...fresh.values()].map(row=>row.j.archiveName)].filter(Boolean));
    j={id:randomUUID(),key,requestId:grant.id,kind:c.kind,mode:mode(key),archiveName:availableWebArchiveName(labels.get(c.id)??c.label,c.kind,used),state:'queued',createdAt:now(),sourceHost:new URL(c.url).hostname};fresh.set(sourceKey,{j,c});
   }
   rows.push({c,j,sourceKey});
  }
  const counts={image:0,video:0,file:0};for(const {j}of fresh.values()){if(!Object.hasOwn(WEB_MEDIA_BATCH_LIMITS,j.kind))throw Error('资源类型无效');counts[j.kind]++;}
  for(const kind of Object.keys(counts))if(counts[kind]>(grant?.remaining[kind]??0))throw Error('本次请求'+({image:'图片',video:'视频',file:'其他文件'}[kind])+'上限为'+WEB_MEDIA_BATCH_LIMITS[kind]+'，还可提交'+(grant?.remaining[kind]??0)+'个');
  const pending=store.jobs.filter(j=>states.has(j.state));
  if(fresh.size&&pending.length+fresh.size>840)throw Error('网页下载队列已满，请稍后再试');
  for(const kind of Object.keys(counts))if(counts[kind]&&pending.filter(j=>j.key===key&&j.kind===kind).length+counts[kind]>WEB_MEDIA_BATCH_LIMITS[kind])throw Error('当前会话该类型排队已满，请等现有任务结束');
  const guard=fresh.size?guardFor(key):null;guard?.();
  for(const [sourceKey,{j,c}]of fresh){j.batchSize=fresh.size;jobSources.set(j.id,{candidate:{...c},guard});submitted.set(sourceKey,{id:j.id,expires:grant.at+600000});store.jobs.push(j);}
  for(const {c,j}of rows)c.jobId=j.id;
  if(fresh.size)for(const kind of Object.keys(counts))grant.remaining[kind]-=counts[kind];
  const jobs=[...new Map(rows.map(r=>[r.j.id,r.j])).values()],single=jobs.length===1;
  save();void pump();
  return {ok:true,...(single?view(jobs[0]):{}),batchId:jobs[0].requestId??null,jobs:jobs.map(view),count:jobs.length,added:fresh.size,queued:fresh.size>0,duplicate:fresh.size===0,note:'已批量排队，后台逐个下载发送；简短确认后结束，不循环查询或重复提交。'};
 }
 let cleanupFlight=null;
 async function cleanup(force=false){
  if(cleanupFlight){await cleanupFlight;if(!force)return;}
  const flight=cleanupFiles(force);cleanupFlight=flight;
  try{return await flight;}finally{if(cleanupFlight===flight)cleanupFlight=null;}
 }
 async function cleanupFiles(force=false){
  let removedFiles=0,removedBytes=0;
  const busy=new Set([...store.jobs.filter(j=>states.has(j.state)).map(j=>j.id),...previewPins.keys()]);let size=0;const dirs=[];
  for(const id of await fsp.readdir(cache)){
   if(!isId(id)||busy.has(id))continue;const dir=path.join(cache,id),stat=await fsp.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
   let j;try{const file=path.join(dir,'job.json');if((await fsp.lstat(file)).isSymbolicLink())continue;j=JSON.parse(await fsp.readFile(file,'utf8'));}catch{continue;}
   if(j.marker!=='dsh-web-media-cache-v1'||j.id!==id||!Number.isFinite(j.createdAt))continue;
   const files=await fsp.readdir(dir);let bytes=0;for(const f of files){const s=await fsp.lstat(path.join(dir,f));if(s.isFile()&&!s.isSymbolicLink())bytes+=s.size;}size+=bytes;dirs.push({j,dir,files,bytes});
  }
  for(const {j,dir,files,bytes}of dirs.sort((a,b)=>a.j.createdAt-b.j.createdAt)){
   if(previewPins.has(j.id))continue;
   if(!force&&now()-j.createdAt<86400000&&size<=16*1024**3)continue;
   for(const file of files){if(!(validWebArchiveName(file)&&file===j.archiveName)&&!/^(?:job\.json|media\.part|archive\.part|media\.[a-z0-9]{1,12}|(?:video|audio)(?:-init\.mp4|-\d{4,5}\.(?:ts|m4s)|\.m3u8)|[a-f0-9]{10}\.z删ip)$/.test(file))continue;const full=path.join(dir,file),s=await fsp.lstat(full);if(s.isFile()&&!s.isSymbolicLink()){if(previewPins.has(j.id))break;await fsp.unlink(full);removedFiles++;removedBytes+=s.size;size-=s.size;}}
   try{await fsp.rmdir(dir);}catch{}
  }
  return {removedFiles,removedBytes,skippedJobs:busy.size};
 }
 async function pump(){
  if(active||closed)return;const pending=store.jobs.filter(j=>j.state==='queued'),j=pending.find(j=>j.key!==lastKey)??pending[0];if(!j)return;
  const source=jobSources.get(j.id),c=source?.candidate,controller=new AbortController();active={job:j,controller};let timer;
  try{
   check(j.key);if(!c)throw Error('候选资源已过期，请重新请求');const guard=source.guard;guard();
   await cleanup();const directory=path.join(cache,j.id);await fsp.mkdir(directory);await fsp.writeFile(path.join(directory,'job.json'),JSON.stringify({marker:'dsh-web-media-cache-v1',id:j.id,archiveName:j.archiveName,createdAt:j.createdAt}),{flag:'wx'});j.state='downloading';save();
   timer=setTimeout(()=>controller.abort(),c.kind!=='image'?7200000:300000);
   const first=await fetchResource(c.url,{maxBytes:c.kind==='image'?WEB_MEDIA_LIMITS.imageBytes:WEB_MEDIA_LIMITS.videoBytes,timeoutMs:c.kind!=='image'?3600000:120000,referer:c.referer,signal:controller.signal,...(c.kind!=='image'?{destination:path.join(directory,'media.part')}:{})});
   const format=mediaFormat(first.prefix??first.buffer,String(first.headers?.['content-type']??''))??fileFormat(first.prefix??first.buffer,first.headers,first.url);
   if(!format||format.kind!==c.kind)throw Error('资源实际格式与所选图片/视频不符');
   let asset;
   if(format.ext==='m3u8'){if(first.file)await fsp.unlink(first.file);asset=await hls(first.url,directory,{referer:c.referer,signal:controller.signal,fetchResource});}
   else{const file=path.join(directory,'media.'+format.ext);if(first.file)await fsp.rename(first.file,file);else await fsp.writeFile(file,first.buffer,{flag:'wx'});asset={file,...format,bytes:first.bytes??first.buffer.length};}
   j.sourceExt=asset.ext;j.sourceBytes=asset.bytes;
   guard();if(j.mode==='encrypted')asset=await archive(asset,directory,controller.signal,j.archiveName);
   clearTimeout(timer);j.state='sending';j.bytes=asset.bytes;j.filename=path.basename(asset.file);save();guard();
   const receipt=await deliver({...asset,id:j.id},j.key,{rpc:async(action,params)=>{guard();return rpc(action,params);},botId:botId(),guard});
   j.state='sent';j.messageId=receipt.messageId??null;j.receiptRecovered=receipt.receiptRecovered===true;j.finishedAt=now();save();
   if(j.mode==='encrypted'&&j.batchSize<=1)try{await notify(j.key,'文件已发送，解压密码：'+ARCHIVE_PASSWORD+'。');}catch(e){log('密码提示未发送：'+mediaError(e));}
  }catch(e){
   j.state=j.state==='sending'?'delivery-unknown':'failed';j.error=mediaError(e);j.finishedAt=now();save();log('网页媒体任务 '+j.id+' '+j.state+': '+j.error);
   if(!closed&&allowed(j.key)&&j.batchSize<=1)try{await notify(j.key,j.state==='delivery-unknown'?'网页媒体发送回执未确认，请先核对是否收到；不会自动重发。':'网页媒体下载失败：'+j.error);}catch{}
  }finally{
   clearTimeout(timer);lastKey=j.key;jobSources.delete(j.id);active=null;
   const batch=store.jobs.filter(row=>row.key===j.key&&row.requestId===j.requestId);
   if(!closed&&j.batchSize>1&&!batch.some(row=>states.has(row.state))&&summaries.get(j.requestId)!==batch.length&&allowed(j.key)){
    summaries.set(j.requestId,batch.length);const done=batch.filter(row=>row.state==='sent').length,failed=batch.filter(row=>row.state==='failed'),unknown=batch.filter(row=>row.state==='delivery-unknown').length;
    try{await notify(j.key,'本批抓取结束：成功'+done+'个，失败'+failed.length+'个，发送待确认'+unknown+'个。'+(failed.length?'首个失败原因：'+failed[0].error+'。':'')+(unknown?'待确认项不会自动重发。':'')+(batch.some(row=>row.mode==='encrypted'&&row.state==='sent')?'加密文件解压密码：'+ARCHIVE_PASSWORD+'。':''));}catch{}
   }
   void cleanup().catch(e=>log('网页媒体缓存清理：'+mediaError(e)));void pump();
  }
 }
 async function command({key,text,userId,eventId,directed=true}){
  const cmd=parseWebMediaCommand(text);if(!cmd)return false;check(key);
  if(!directed){await notify(key,'请真实@机器人后发送抓取指令。');return true;}
  if(cmd.action==='clear'){
   if(!isOwner(userId)){await notify(key,'清除抓取缓存仅管理员可用。');return true;}
   try{const r=await cleanup(true);await notify(key,'已清除抓取本地缓存：'+r.removedFiles+'个文件，约'+(r.removedBytes/1048576).toFixed(1)+'MiB。'+(r.skippedJobs?'已跳过'+r.skippedJobs+'个未结束任务。':''));}
   catch(e){await notify(key,'抓取缓存未完全清除：'+mediaError(e));}return true;
  }
  if(cmd.action==='mode'){
   if(!isOwner(userId)){await notify(key,'抓取模式仅管理员可切换。');return true;}
   store.modes[key]=cmd.mode;save();await notify(key,cmd.mode==='encrypted'?'本会话已切换为加密抓取，发送.z删ip压缩包，密码'+ARCHIVE_PASSWORD+'。':'本会话已切换为正常抓取，直接发送图片/视频，较大资源按文件发送。');return true;
  }
  if(cmd.action==='syntax'||cmd.index<1||cmd.index>210){await notify(key,'格式：/下载图片 链接 [序号] 、/下载视频 链接 [序号] 或 /下载文件 链接 [序号]');return true;}
  const eid=key+':'+String(eventId);if(events.has(eid))return true;events.set(eid,now());while(events.size>512)events.delete(events.keys().next().value);
  noteRequest({key,text,eventId,directed});await notify(key,'开始解析并下载'+(cmd.kind==='image'?'图片':cmd.kind==='video'?'视频':'文件')+'，完成后发送。');
  try{const token='command:'+eventId,r=await inspectMedia({key,token,url:cmd.url,kind:cmd.kind});if(!r.candidates.length)throw Error(r.note);const item=r.candidates[cmd.index-1];if(!item)throw Error('没有这个序号的资源，共找到'+r.candidates.length+'个');send({key,token,candidateId:item.id});}
  catch(e){await notify(key,'网页媒体下载失败：'+mediaError(e));}return true;
 }
 async function recoverArchive(j,name,{key,quoted,actorQQ}){
  if(restoring)throw Error('压缩包缓存恢复繁忙，请稍后再试。');restoring=true;
  const guard=()=>{check(key);if(closed||!isOwner(actorQQ))throw Error('管理员身份已变更，未恢复。');};
  try{
   guard();const directory=path.join(cache,j.id);await fsp.mkdir(directory,{recursive:true});
   const parent=await fsp.lstat(directory);if(parent.isSymbolicLink()||path.relative(directory,await fsp.realpath(directory))!=='')throw Error('压缩包缓存目录无效。');
   const cacheMarker=path.join(directory,'job.json');try{const old=await fsp.lstat(cacheMarker);if(old.isSymbolicLink())throw Error('压缩包缓存标记无效。');const meta=JSON.parse(await fsp.readFile(cacheMarker,'utf8'));if(meta.marker!=='dsh-web-media-cache-v1'||meta.id!==j.id)throw Error('压缩包缓存标记无效。');}catch(e){if(e.code!=='ENOENT')throw e;}
   atomicWriteJsonFile(cacheMarker,{marker:'dsh-web-media-cache-v1',id:j.id,archiveName:name,createdAt:now()});
   const archiveFile=path.join(directory,name);let stat;
   try{stat=await fsp.lstat(archiveFile);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!stat){
    const data=quoted?.message?.find(s=>s.type==='file')?.data??{},fileId=String(data.file_id??data.id??'');
    if(!fileId)throw Error('压缩包本地缓存已清理，且QQ消息缺少文件句柄，无法恢复。');
    const group=/^group:(\d+)$/.exec(key),r=await rpc(group?'get_group_file_url':'get_private_file_url',group?{group_id:Number(group[1]),file_id:fileId,...(data.busid!=null?{busid:data.busid}:{})}:{file_id:fileId});guard();
    const url=r?.url??r?.file_url;if(typeof url!=='string')throw Error('压缩包QQ文件链接暂不可用，无法恢复。');
    if(!Number.isSafeInteger(j.bytes)||j.bytes<22||j.bytes>WEB_MEDIA_LIMITS.videoBytes+1048576)throw Error('压缩包发送记录大小无效。');
    const part=path.join(directory,'archive.part');
    try{const old=await fsp.lstat(part);if(old.isSymbolicLink()||!old.isFile())throw Error('压缩包临时缓存无效。');await fsp.unlink(part);}catch(e){if(e.code!=='ENOENT')throw e;}
    const downloaded=await fetchResource(url,{destination:part,maxBytes:j.bytes,timeoutMs:3600000});guard();
    if(downloaded.file){if(downloaded.bytes!==j.bytes)throw Error('压缩包QQ文件大小与记录不符。');await fsp.rename(part,archiveFile);}
    else{if(downloaded.buffer?.length!==j.bytes)throw Error('压缩包QQ文件大小与记录不符。');await fsp.writeFile(archiveFile,downloaded.buffer,{flag:'wx'});}
    stat=await fsp.lstat(archiveFile);
   }
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==j.bytes)throw Error('压缩包缓存大小与记录不符。');
   const mediaPart=path.join(directory,'media.part');try{const old=await fsp.lstat(mediaPart);if(old.isSymbolicLink()||!old.isFile())throw Error('压缩包临时媒体无效。');await fsp.unlink(mediaPart);}catch(e){if(e.code!=='ENOENT')throw e;}
   const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./web-media-restore-worker.mjs',import.meta.url),{workerData:{archive:archiveFile,directory,maxBytes:j.kind==='image'?WEB_MEDIA_LIMITS.imageBytes:WEB_MEDIA_LIMITS.videoBytes}});recoveryWorker=worker;let settled=false;
    const finish=async(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){await worker.terminate();reject(error);}else resolve(value);};
    const timer=setTimeout(()=>void finish(Error('压缩包恢复超时。')),3600000);worker.on('message',m=>void finish(m.ok?null:Error(m.error),m));worker.on('error',e=>void finish(e));worker.on('exit',code=>{if(!settled)void finish(Error('压缩包恢复进程提前结束。'));});
   });guard();j.sourceExt=result.ext;j.sourceBytes=result.bytes;save();
   const marker=path.join(directory,'job.json');try{if((await fsp.lstat(marker)).isSymbolicLink())throw Error('压缩包缓存标记无效。');}catch(e){if(e.code!=='ENOENT')throw e;}
   atomicWriteJsonFile(marker,{marker:'dsh-web-media-cache-v1',id:j.id,archiveName:name,createdAt:now()});
  }finally{recoveryWorker=null;restoring=false;}
 }
 async function loadArchivePreview(name,{key,quoted,actorQQ}={}){
  check(key);if(!validWebArchiveName(name))return null;
  const matches=store.jobs.filter(j=>j.filename===name&&j.mode==='encrypted');if(!matches.length)return null;
  const compatible=matches.filter(j=>j.key===key&&['sent','delivery-unknown'].includes(j.state));
  const j=compatible.find(j=>j.messageId!=null&&String(j.messageId)===String(quoted?.message_id))??(compatible.length===1?compatible[0]:null);
  if(!j)throw Error('该文件不是当前会话已发送的抓取压缩包。');
  if(j.kind==='file')throw Error('压缩包内为其他类型文件，请在本地解压；/解压仅支持直发图片或视频。');
  if(j.messageId!=null&&String(j.messageId)!==String(quoted?.message_id))throw Error('无法确认被引用的抓取压缩包回执。');
  const segment=quoted?.message?.find(s=>s.type==='file'),declared=segment?.data?.file_size??segment?.data?.size;
  if(declared!==undefined&&Number(declared)!==j.bytes)throw Error('压缩包大小与发送记录不符。');
  if(!isId(j.id))throw Error('压缩包记录无效。');
  previewPins.set(j.id,(previewPins.get(j.id)??0)+1);let asset;
  const release=()=>{if(!previewPins.has(j.id)||asset&&!previewAssets.has(asset))return;const count=previewPins.get(j.id)-1;if(count>0)previewPins.set(j.id,count);else previewPins.delete(j.id);if(asset)previewAssets.delete(asset);};
  const loadLocal=async()=>{
   const directory=path.join(cache,j.id),parent=await fsp.lstat(directory);
   if(!parent.isDirectory()||parent.isSymbolicLink()||path.relative(directory,await fsp.realpath(directory))!=='')throw Error('压缩包缓存目录无效。');
   const marker=path.join(directory,'job.json');if((await fsp.lstat(marker)).isSymbolicLink())throw Error('压缩包缓存标记无效。');
   const meta=JSON.parse(await fsp.readFile(marker,'utf8'));if(meta.marker!=='dsh-web-media-cache-v1'||meta.id!==j.id)throw Error('压缩包缓存标记无效。');
   const files=(await fsp.readdir(directory)).filter(n=>/^media\.(?:png|jpg|webp|gif|mp4|webm|mov|mkv)$/.test(n));
   const filename=j.sourceExt?'media.'+j.sourceExt:files.length===1?files[0]:null;if(!filename||!files.includes(filename))throw Error('压缩包原始内容缓存已清理，无法预览。');
   const file=path.join(directory,filename),ext=filename.slice(6),info=await fsp.lstat(file);
   if(!info.isFile()||info.isSymbolicLink()||info.size<12||info.size>(j.kind==='video'?WEB_MEDIA_LIMITS.videoBytes:WEB_MEDIA_LIMITS.imageBytes)||j.sourceBytes!=null&&info.size!==j.sourceBytes)throw Error('压缩包原始内容缓存无效。');
   const handle=await fsp.open(file,'r');let format;
   try{const opened=await handle.stat();if(opened.ino!==info.ino||opened.dev!==info.dev||opened.size!==info.size)throw Error('压缩包缓存已变化。');const prefix=Buffer.alloc(Math.min(65536,info.size));await handle.read(prefix,0,prefix.length,0);format=mediaFormat(prefix);}finally{await handle.close();}
   if(!format||format.kind!==j.kind||format.ext!==ext)throw Error('压缩包原始内容格式不符。');
   asset={file,ext,kind:j.kind,bytes:info.size,release};previewAssets.set(asset,{key,info});return asset;
  };
  try{
   try{return await loadLocal();}catch(e){
    if((e.code==='ENOENT'||String(e.message).includes('原始内容缓存已清理'))&&actorQQ){await recoverArchive(j,name,{key,quoted,actorQQ});return await loadLocal();}throw e;
   }
  }catch(e){release();if(e.code==='ENOENT')throw Error('压缩包本地抓取缓存已清理，无法预览。');throw e;}
 }
 async function sendArchivePreview(asset,key,actor){
  const registered=previewAssets.get(asset);if(!registered||registered.key!==key)throw Error('压缩包预览来源无效。');
  const baseGuard=guardFor(key),guard=()=>{check(key);baseGuard();if(!isOwner(actor))throw Error('管理员身份已变更，未发送。');};guard();
  const info=await fsp.lstat(asset.file);if(!info.isFile()||info.isSymbolicLink()||info.ino!==registered.info.ino||info.dev!==registered.info.dev||info.size!==registered.info.size||info.mtimeMs!==registered.info.mtimeMs)throw Error('压缩包缓存已变化。');
  return deliverWebMedia(asset,key,{rpc:async(action,params)=>{guard();return rpc(action,params);},botId:botId(),guard,inlinePreview:true});
 }
 const status=({key,jobId})=>{
  check(key);const j=jobId?store.jobs.find(j=>j.id===jobId&&j.key===key):store.jobs.filter(j=>j.key===key).at(-1);
  const jobs=j?.requestId?store.jobs.filter(row=>row.key===key&&row.requestId===j.requestId):j?[j]:[];
  const summary={total:jobs.length};for(const row of jobs)summary[row.state]=(summary[row.state]??0)+1;
  return {ok:true,mode:mode(key),job:view(j),batchId:j?.requestId??null,jobs:jobs.map(view),summary};
 };
 function close(){closed=true;active?.controller.abort();void recoveryWorker?.terminate();}
 return {noteRequest,search:searchMedia,inspect:inspectMedia,send,status,command,loadArchivePreview,sendArchivePreview,close,busy:()=>!!active||restoring||previewPins.size>0||store.jobs.some(j=>states.has(j.state))};
}

export function bridgeMediaRpc(bot,guard=()=>{}){
 return async(action,params)=>{
  guard();const bytes=/^upload_(?:group|private)_file$/.test(action)?(await fsp.stat(params.file)).size:0;
  const r=await bot.request(action,params,{timeoutMs:onebotRpcTimeoutMs(action,params,{uploadBytes:bytes})});
  if(r?.status!=='ok'||r?.retcode!==0)throw napcatRpcError(action,r??{});return r.data;
 };
}





