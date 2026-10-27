import {COMFY_URL} from './runtime-config.mjs';
import {takeImageOptions,parseUpscaleCommand,frameSize,UPSCALE_HELP} from './image-options.mjs';
import {checkUpscaleReady,stageUpscaleInput,upscaleGeneratedImage,upscaleSource} from './comfy-upscale.mjs';
import {selectLoraExample} from './lora-examples.mjs';
import {clearComfyPipeline} from './comfy-pipeline.mjs';
import {generateImageFromImage,clearImageInputCache} from './comfy-img2img.mjs';
import {deepseekPrompt,deepseekHint} from './comfy-deepseek.mjs';
import {LORA_CATALOG_PATH,ENHANCED_LORA_REFERENCE_PATH,resolveEnhancedLoraReferences,resolveReducedLoraReferences,resolveAuthorLoraReferences,resolveLoraRequest,assertLoraAccess,loraPrompt,loraHint,loraList,loraDetail} from './comfy-loras.mjs';
// Narrow, asynchronous image capability. No shell, arbitrary workflows, paths or URLs.
import fs from 'node:fs';
import {atomicWriteJsonFile} from './lib/json-store.js';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {USER_HELP,ADMIN_LORA_HELP} from './chat-help.mjs';
import {isExplicitGenerationPrompt} from './comfy-content-policy.mjs';
import {ARCHIVE_PASSWORD} from './comfy-archive.mjs';
import {createPreviewRecalls} from './comfy-preview-recalls.mjs';
import {describeDeliveryFailure} from './comfy-delivery.mjs';
import {clearComfyCache,clearVideoCache} from './comfy-cache.mjs';
import {parseVideoCommand,VIDEO_HELP,VIDEO_INSTALLED,stageVideoInput,generateVideo} from './comfy-video.mjs';

const HOUR=3600000;
const generationRequests=new Set(['request','tag-request','upscale-request','video-request']);
const generationClosedText='普通用户的 Comfy 生成功能已关闭，请联系管理员。';
const terminal=new Set(['sent','failed','cancelled','interrupted','delivery-unknown']);
const labels={queued:'排队中',generating:'生成中',reviewing:'文字检查中',sending:'发送中',sent:'已发送',failed:'失败，额度已退还',cancelled:'已取消，额度已退还',interrupted:'重启中断，额度已退还','delivery-unknown':'发送结果未知，请勿重复提交'};
function parseBasicComfyCommand(text){
 const raw=String(text??'').trim();
 if(/^\/修手/.test(raw))return {type:'removed-generation',error:'修手功能已从此版本移除。'};
 if(/^\/画图(?:\s|$)/.test(raw)){
  const reduced=/^\/画图\s+减弱\s*(#[\s\S]+)$/.exec(raw);
  if(reduced)return {type:'request',count:1,reducedReferences:true,description:reduced[1].trim()};
  const enhanced=/^\/画图\s+增强\s*(#[\s\S]+)$/.exec(raw);
  return enhanced?{type:'request',count:1,enhancedReferences:true,description:enhanced[1].trim()}:{type:'enhanced-syntax'};
 }
 if(/^(?:\/-|-\/)生图/.test(raw)){
  const preview=/^(?:\/-|-\/)生图(\d*)(?:\s+|[:：])\s*(\S[\s\S]*)$/.exec(raw);
  return preview?{type:'request',temporaryPreview:true,count:preview[1]?Number(preview[1]):1,description:preview[2].trim()}:{type:'preview-syntax',temporaryPreview:true};
 }
 const video=parseVideoCommand(text);if(video)return video;
 const t=String(text??'').trim().replace(/^\/(?=(?:生图状态|生图队列|排队名单|取消生图|我的额度|生图帮助)(?:\s|$))/,'');let m;
 if(/^\/help$/i.test(t))return {type:'public-help'};
 if(/^\/help\s+管理$/i.test(t))return {type:'admin-help-denied'};
 if(/^\/help\s+/i.test(t))return {type:'public-help'};
 if(/^\/loras(?:\s|$)/i.test(t)){
  const list=/^\/(loras)(?:\s+(角色|画风|动作))?$/i.exec(t);
  return list?{type:'loras',family:'anima',...(list[2]?{category:list[2]==='角色'?'character':list[2]==='画风'?'style':'action'}:{})}:{type:'loras-syntax'};
 }
 if(/^\/lora(?:\s|$)/i.test(t)){
  const detail=/^\/lora\s+#?([\p{L}\p{N}][\p{L}\p{N}_-]{0,63})$/iu.exec(t);
  return detail?{type:'lora-detail',name:detail[1]}:{type:'lora-syntax'};
 }
 if((m=/^\/(关闭生图|开启生图)$/.exec(t)))return {type:'generation-access',enabled:m[1]==='开启生图'};
 if(/^\/(?:关闭生图|开启生图)(?:\s|$)/.test(t))return {type:'generation-access-syntax'};
 if(/^\/刷新模型$/.test(t))return {type:'models-refresh'};
 if(/^\/清理管线$/.test(t))return {type:'pipeline-clear'};
 if(/^\/清除生图缓存$/.test(t))return {type:'cache-clear'};
 if(/^\/tag生图/i.test(t)){
  const tags=/^\/tag生图(\d*)\s+PST\/([\s\S]+?)\s+NGT\/([\s\S]+)$/.exec(t.replace(/^\/tag生图/i,'/tag生图'));
  return tags&&tags[2].trim()&&tags[3].trim()?{type:'tag-request',count:tags[1]?Number(tags[1]):1,prompt:tags[2].trim(),negative:tags[3].trim()}:{type:'tag-syntax'};
 }
 if(/^(?:生图帮助|绘图帮助|机器人帮助)$/.test(t))return {type:'help'};
 if(/^(?:生图额度|我的额度|查看额度|查看生图额度)$/.test(t))return {type:'quota'};
 if((m=/^(?:生图状态|绘图状态|查看生图|生图队列|排队名单)(?:\s+([a-f0-9-]{8,36}))?$/.exec(t)))return {type:'status',id:m[1]};
 if((m=/^(?:取消生图|取消画图)(?:\s+([a-f0-9-]{8,36}))?$/.exec(t)))return {type:'cancel',id:m[1]};
 if((m=/^设置默认生图额度\s+(\d{1,3})$/.exec(t)))return {type:'default',limit:Number(m[1])};
 if((m=/^设置生图额度\s+(\d{5,12})\s+(\d{1,3})$/.exec(t)))return {type:'override',user:m[1],limit:Number(m[2])};
 if((m=/^恢复默认生图额度\s+(\d{5,12})$/.exec(t)))return {type:'clear',user:m[1]};
 if((m=/^查看生图额度\s+(\d{5,12})$/.exec(t)))return {type:'inspect',user:m[1]};
 if(/^(?:设置|恢复默认|查看)生图额度|^设置默认生图额度/.test(t))return {type:'syntax'};
 if((m=/^\/生图额度\s+(.+?)\s+(\d+)$/.exec(t)))return {type:'grant',nickname:m[1].trim(),amount:Number(m[2])};
 if(/^\/生图额度(?:\s|$)/.test(t))return {type:'grant-syntax'};
 if(/^\/生图\d*\s*[:：]?\s*$/.test(t))return {type:'help'};
 if((m=/^\/生图(\d*)(?:\s+|[:：])\s*(\S[\s\S]*)$/.exec(t)))return {type:'request',count:m[1]?Number(m[1]):1,description:m[2].trim()};
 if(/^\/生图/.test(t))return {type:'request-syntax'};
 if((m=/^\/生成ds(?:\s+|[:：])\s*(\S[\s\S]*)$/i.exec(t)))return {type:'request',preset:'deepseek',count:1,description:m[1].trim()};
 if(/^\/生成ds/i.test(t))return {type:'request-syntax'};
 return null;
}
export function parseComfyCommand(text){
 const raw=String(text??'').trim(),high=parseUpscaleCommand(raw);if(high)return high;
 try{
  // Tag bodies remain byte-for-byte unchanged; options are accepted only before PST/.
  const tag=/^(\/tag生图\d*)\s+([\s\S]*)$/i.exec(raw);
  if(tag){const selected=takeImageOptions(tag[2]),c=parseBasicComfyCommand(tag[1]+' '+selected.description);return c?.type==='tag-request'?{...c,...(selected.framing?{framing:selected.framing}:{}),...(selected.hd?{hd:selected.hd}:{})}:c;}
  const c=parseBasicComfyCommand(raw);if(c?.type!=='request')return c;
  const selected=takeImageOptions(c.description);if(!selected.description)throw Error('请在比例/高清选项后填写生图描述');
  return {...c,...selected};
 }catch(error){return {type:'image-option-syntax',error:error.message};}
}
function checkOptions(body){
 const fields=new Set(['ticket','prompt','negative','width','height','steps','seed']);
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.has(k)))throw new Error('不支持的生图参数');
 if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>4000)throw new Error('提示词需为 1~4000 字符');
 if(body.negative!==undefined&&(typeof body.negative!=='string'||body.negative.length>2000))throw new Error('负面提示词过长');
 const o={prompt:body.prompt.trim(),negative:body.negative,width:body.width,height:body.height,steps:body.steps,seed:body.seed};
 for(const [k,lo,hi]of [['width',512,1536],['height',512,1536],['steps',1,40],['seed',0,4294967295]])if(o[k]!==undefined&&(!Number.isInteger(o[k])||o[k]<lo||o[k]>hi))throw new Error(k+' 超出允许范围');
 if(o.width!==undefined&&o.width%64||o.height!==undefined&&o.height%64||o.width*o.height>1572864)throw new Error('尺寸需为 64 的倍数，最多 150 万像素');
 return o;
}
export function createComfyChat({cfg,root,stateDir,notify,log=()=>{},now=Date.now,run,deliver,runVideo,deliverVideo,stageVideo,runUpscale,upscaleReady=checkUpscaleReady,stageUpscale=stageUpscaleInput,loraCatalogFile=LORA_CATALOG_PATH,enhancedLoraReferenceFile=ENHANCED_LORA_REFERENCE_PATH,loraExampleOptions={},resolveGroupMembers,recallPreview,assess,clearCache,clearPipeline,cooldownMs=60000,schedule=setTimeout,unschedule=clearTimeout}){
 const enabled=cfg.comfyChat?.enabled===true;
 const featureAllowed=name=>(name!=='video'||VIDEO_INSTALLED)&&cfg.comfyChat?.features?.[name]!==false;
 const file=path.join(stateDir,'comfy-chat.json');
 const worker=path.resolve(root,'..','qq-workspace','comfy-qq.mjs');
 let state={version:1,publicGenerationEnabled:true,defaultLimit:cfg.comfyChat?.defaultHourlyLimit??5,overrides:{},hourCredits:[],jobs:[],usage:[],lastOutputAt:0};
 const caps=new Map(),events=new Map(),imageBindings=new Map(),upscaleFlights=new Map();let active=null,closed=false,cleaning=false,wakeTimer=null,pipelineEpoch=0,generationAccessEpoch=0;
 if(enabled&&fs.existsSync(file)){
  const stored=JSON.parse(fs.readFileSync(file,'utf8'));
  if(stored.version!==1||!Array.isArray(stored.jobs)||!Array.isArray(stored.usage))throw new Error('生图额度状态损坏，已停止加载以免覆盖');
  state={...state,...stored};
  if(!Array.isArray(state.hourCredits))throw new Error('小时额度状态损坏');
  for(const j of state.jobs)if(!terminal.has(j.state)){j.state=j.state==='sending'?'delivery-unknown':'interrupted';}
  state.usage=state.usage.filter(u=>{const j=state.jobs.find(j=>j.id===u.jobId);return j?.state==='sent'||j?.state==='delivery-unknown';});
 }
 const owner=()=>String(cfg.ownerQQ??'');
 const isOwner=user=>String(user)===owner();
 const generationAllowed=user=>isOwner(user)||state.publicGenerationEnabled!==false;
 const previewRecalls=enabled?createPreviewRecalls({stateDir,owner,now,schedule,unschedule,log,
  recall:recallPreview??(async(key,messageId,options)=>{const lib=await import(pathToFileURL(worker).href);return lib.recallGeneratedPreview(key,messageId,options);}),
  onFailure:(key,text)=>notice(key,text)}):null;
 function allowed(key){
  const m=/^(private|group):(\d{5,12})$/.exec(String(key));if(!m)return false;
  const list=m[1]==='private'?cfg.allow?.private:cfg.allow?.groups;
  return (list??[]).map(String).includes(m[2]);
 }
 function save(){
  if(!enabled)return;
  state.usage=state.usage.filter(u=>u.state==='reserved'||now()-u.at<HOUR);
  state.hourCredits=state.hourCredits.filter(c=>c.expiresAt>now()||state.usage.some(u=>u.creditId===c.id&&u.state==='reserved'));
  const keep=new Set(state.usage.map(u=>u.jobId));
  state.jobs=state.jobs.filter((j,i)=>!terminal.has(j.state)||keep.has(j.id)||i>=state.jobs.length-50);
  atomicWriteJsonFile(file,state);
 }
 function availableCredits(user){
  return state.hourCredits.filter(c=>c.user===String(user)&&c.expiresAt>now()).map(c=>({...c,remaining:Math.max(0,c.amount-state.usage.filter(u=>u.creditId===c.id).length)}));
 }
 function quota(user){
  const id=String(user),baseLimit=state.overrides[id]??state.defaultLimit;
  const baseUsed=state.usage.filter(u=>u.user===id&&!u.creditId&&(u.state==='reserved'||now()-u.at<HOUR)).length;
  const credits=availableCredits(id),bonus=credits.reduce((sum,c)=>sum+c.amount,0),bonusRemaining=credits.reduce((sum,c)=>sum+c.remaining,0);
  const baseRemaining=Math.max(0,baseLimit-baseUsed),unlimited=isOwner(id);
  return {limit:unlimited?null:baseLimit+bonus,used:baseUsed+bonus-bonusRemaining,remaining:unlimited?null:baseRemaining+bonusRemaining,baseLimit,baseRemaining,bonus,bonusRemaining,windowMinutes:60};
 }
 const quotaText=user=>{const q=quota(user);return q.limit===null?'管理员不受每小时张数限制。':`QQ ${user}：每滚动 60 分钟 ${q.limit} 张，已用/预占 ${q.used} 张，剩余 ${q.remaining} 张。${q.bonus?'其中本小时额外 '+q.bonus+' 张，整点到期。':''}`;};
 const view=j=>j?{id:j.id,state:j.state,status:j.deliveryFailureSummary??labels[j.state],deliveryStage:j.deliveryFailure?.stage??null,messageId:j.messageId??null,kind:j.kind??'image',count:j.count??1,completed:j.results?.length??0,archive:j.archive??false}:null;
 const latest=user=>state.jobs.filter(j=>j.user===String(user)&&j.kind!=='video').at(-1);
 async function notice(key,text,mentionUser,example){try{await notify(key,text,mentionUser,example);}catch(e){log('生图通知发送失败：'+e.message);}}
 function ordered(){const q=state.jobs.filter(j=>j.state==='queued');return [...q.filter(j=>isOwner(j.user)),...q.filter(j=>!isOwner(j.user))];}
 function queueText(key){
  const running=active?.job&&!terminal.has(active.job.state)?[active.job]:[];
  const list=[...running,...ordered()];
  const names=list.map((j,i)=>`${i+1}. ${j.key===key||key==='private:'+owner()?j.name:'其他会话任务'}${(j.count??1)>1?'〔'+(j.results?.length??0)+'/'+j.count+'张〕':''}${j.id===active?.job.id?'（正在处理）':isOwner(j.user)?'（管理员优先）':''}`).join('\n');
  const left=Math.max(0,Math.ceil(((state.lastOutputAt??0)+cooldownMs-now())/1000));
  return '普通任务每张发送后间隔 1 分钟。'+(left?'当前间隔剩余 '+left+' 秒。':'')+'\n当前队列：\n'+(names||'暂无排队任务');
 }
 function settle(j,status){j.state=status;j.finishedAt=now();if(status==='sent'||status==='delivery-unknown'){for(const u of state.usage.filter(u=>u.jobId===j.id)){u.state='used';u.at=now();}}else state.usage=state.usage.filter(u=>u.jobId!==j.id);save();}
 async function imageBinding(eid,resolver){
  let pending=imageBindings.get(eid);
  if(!pending){pending=(async()=>{const bytes=await resolver?.();if(bytes)throw Error('图片编辑已从此版本移除；/生图和/tag生图请不要附图或引用图片。高清请用/高清，视频请用/图生视频。');return {};})();imageBindings.set(eid,pending);if(imageBindings.size>512)imageBindings.delete(imageBindings.keys().next().value);}
  try{return await pending;}catch(e){imageBindings.delete(eid);throw e;}
 }
 async function defaultRun(j,signal,{onQueued=()=>{}}={}){
  delete j.promptId; // Each image in a batch owns a distinct ComfyUI prompt.
  const args=[worker,'generate','--prompt',j.options.prompt,'--no-send'];
  if(j.kind==='deepseek')args.push('--deepseek');
  if(j.kind==='lora')args.push('--lora',j.lora.name,'--lora-sha256',j.lora.sha256);
  if(j.kind==='lora'&&j.loraReferenceMode==='reduced')args.push('--lora-reference-mode','reduced');
  for(const key of ['negative','width','height','steps'])if(j.options[key]!==undefined)args.push('--'+key,String(j.options[key]));
  if(j.options.seed!==undefined)args.push('--seed',String(j.options.seed));
  const child=spawn(process.execPath,args,{cwd:path.dirname(worker),windowsHide:true,stdio:['ignore','pipe','pipe']});
  const slot=active?.job.id===j.id?active:null;if(slot){slot.worker=child;slot.job.workerPid=child.pid;}
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  j.workerPid=child.pid;let output='',errors='',queued='';
  child.stdout.on('data',b=>{output+=b.toString();if(output.length>12000)output=output.slice(-12000);if(!j.promptId){const line=output.split('\n').find(l=>l.includes('"state":"queued"'));if(line){try{const v=JSON.parse(line);if(/^[a-f0-9-]{36}$/.test(v.promptId)){j.promptId=v.promptId;queued=v.promptId;onQueued(v.promptId);save();}}catch{}}}});
  child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-1500);});
  const stop=()=>{child.kill();if(queued)void fetch(COMFY_URL+"/queue",{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[queued]}),signal:AbortSignal.timeout(5000)}).catch(()=>{});};
  signal.addEventListener('abort',stop,{once:true});
  try{
   save();if(signal.aborted)stop();
   const code=await exited;
   if(signal.aborted)throw new Error('cancelled');if(code!==0)throw new Error(errors||'生图程序退出 '+code);
   const r=JSON.parse(fs.readFileSync(path.join(path.dirname(worker),'images','last-result.json'),'utf8'));
   if(r.state!=='saved'||r.promptId!==j.promptId)throw new Error('生图结果与任务不一致');
   return {promptId:r.promptId,seed:r.seed,workflow:r.workflow,workflowSha256:r.workflowSha256};
  }finally{
   if(child.exitCode===null&&child.signalCode===null)stop();
   await exited.catch(()=>{});
   if(slot?.worker===child){slot.worker=null;delete slot.job.workerPid;}
   signal.removeEventListener('abort',stop);
   const lock=path.join(path.dirname(worker),'images','.generation.lock');
   try{if(JSON.parse(fs.readFileSync(lock,'utf8')).pid===child.pid)fs.unlinkSync(lock);}catch{}
  }
 }
 async function pump(){
  if(active||closed||cleaning||!enabled)return;
  const j=ordered()[0];if(!j)return;
  if(wakeTimer){unschedule(wakeTimer);wakeTimer=null;}
  const wait=Math.max(0,(state.lastOutputAt??0)+cooldownMs-now());
  if(!isOwner(j.user)&&wait>0){wakeTimer=schedule(()=>{wakeTimer=null;void pump();},wait);return;}
  const abort=new AbortController(),running={job:j,abort};active=running;j.state='generating';j.generationStartedAt=now();
  const timer=setTimeout(()=>abort.abort(),(j.kind==='video'?36:18)*60*1000*(j.count??1));
  try{
   save();
   if(j.kind==='lora')assertLoraAccess(j.lora,{isAdmin:isOwner(j.user)});
   j.results=[];const baseSeed=j.options.seed??randomBytes(4).readUInt32LE(0);save();
   for(let index=0;index<(j.count??1);index++){
    if(j.state==='cancelled')return;abort.signal.throwIfAborted();
    const part={...j,options:{...j.options,seed:(baseSeed+index)>>>0}};
    let generated=j.kind==='upscale'?await(runUpscale??generateImageFromImage)(part,abort.signal,{workspace:path.dirname(worker),onQueued:id=>{j.promptId=id;save();}}):j.kind==='video'?await(runVideo??generateVideo)(part,abort.signal,{workspace:path.dirname(worker),onQueued:id=>{j.promptId=id;save();}}):await(run??defaultRun)(part,abort.signal,{onQueued:id=>{j.promptId=id;save();}});
    if(j.state==='cancelled')return;abort.signal.throwIfAborted();
    if(j.hd&&j.kind!=='upscale'){
     (j.baseResults??=[]).push({...generated});save();
     generated=await upscaleGeneratedImage(generated,j.hd,abort.signal,{workspace:path.dirname(worker),run:runUpscale??generateImageFromImage,onQueued:id=>{j.promptId=id;save();}});
    }
    // Preserve the currently running prompt for cancellation/status, never accept model-selected paths.
    j.promptId=generated.promptId;
    j.results.push({promptId:generated.promptId,seed:generated.seed,workflow:generated.workflow,workflowSha256:generated.workflowSha256,...(generated.upscale?{upscale:generated.upscale}:{}),...(generated.basePromptId?{basePromptId:generated.basePromptId}:{})});save();
   }
   const result={promptId:j.results[0].promptId,promptIds:j.results.map(r=>r.promptId),archive:j.archive,...(j.temporaryPreview&&j.archive&&isOwner(j.user)&&j.key==='private:'+owner()?{temporaryPreview:true}:{})};
   if(j.state==='cancelled')return;abort.signal.throwIfAborted();
   if(!allowed(j.key))throw new Error('目标已移出白名单');
   j.generatedAt=now();j.state='sending';j.deliveryStartedAt=now();save();
   try{
    const send=j.kind==='video'?(deliverVideo??(async(r,key)=>{const lib=await import(pathToFileURL(worker).href);return lib.deliverGeneratedVideo(r.promptId,key,{archive:r.archive});})):deliver??(async(r,key)=>{const lib=await import(pathToFileURL(worker).href);return lib.deliverGeneratedImages(r.promptIds,key,{archive:r.archive,temporaryPreview:r.temporaryPreview===true});});
    const receipt=await send(result,j.key);if(!receipt?.messageId&&!receipt?.uploaded)throw new Error('没有发送回执');
    let previewNotice='';
    if(receipt.previewMessageId&&result.temporaryPreview){
     j.previewMessageId=String(receipt.previewMessageId);
     try{const pending=previewRecalls.add({key:j.key,messageId:receipt.previewMessageId,delayMs:90000});j.previewRecallDueAt=pending.dueAt;previewNotice='直发图片将在90秒后撤回，压缩包保留。';}
     catch(error){log('临时图片撤回登记失败：'+error.message);try{if(recallPreview)await recallPreview(j.key,receipt.previewMessageId);else{const lib=await import(pathToFileURL(worker).href);await lib.recallGeneratedPreview(j.key,receipt.previewMessageId);}previewNotice='临时图片撤回任务登记失败，已立即撤回；压缩包保留。';}catch{previewNotice='临时图片自动撤回未能登记，请手动撤回；压缩包保留。';}}
    }else if(receipt.previewError&&result.temporaryPreview)previewNotice='压缩包已发送，临时图片回执未确认；如已收到图片，请手动撤回。';
    if(receipt.fileDelivery)previewNotice+='高清PNG较大，已按原文件发送。';
    if(j.results.some(r=>r.upscale?.fallback))previewNotice+='整图超分显存不足，本次已回退重叠分块。';
    j.deliveredAt=now();j.receiptRecovered=receipt.receiptRecovered===true;j.messageId=receipt.messageId??null;j.archiveName=receipt.archiveName??null;state.lastOutputAt=now();settle(j,'sent');
    const remaining=quota(j.user).remaining;
    await notice(j.key,j.kind==='video'?`发送成功，共 1 段视频。${j.archive?'解压密码：'+ARCHIVE_PASSWORD+'。':''}`:`发送成功，共 ${j.count??1} 张。剩余额度：${remaining===null?'不限':remaining+' 张'}。${j.archive?'解压密码：'+ARCHIVE_PASSWORD+'。':''}${previewNotice}`,j.user);
   }catch(e){state.lastOutputAt=now();settle(j,'delivery-unknown');j.deliveryError=String(e.message).slice(0,1000);const failure=describeDeliveryFailure(e,{kind:j.kind,temporaryPreview:result.temporaryPreview===true});j.deliveryFailure=failure.detail;j.deliveryFailureSummary=failure.summary;save();log('生图发送结果未知（'+failure.detail.stage+'）：'+e.message);await notice(j.key,failure.message);}
  }catch(e){if(j.state!=='cancelled'){settle(j,'failed');log('生图任务失败：'+e.message);await notice(j.key,j.kind==='video'?'视频生成失败。请确认本机 ComfyUI 已启动、模型可用；可查看控制台。':j.kind==='upscale'||j.hd?'高清处理失败，额度已退还：'+String(e.message).slice(0,250):'生图失败，额度已退还。请确认本机 ComfyUI 已启动、模型可用，或联系管理员。');}}
  finally{clearTimeout(timer);if(active===running)active=null;void pump();}
 }
 async function cancel(user,id){
  const j=id?state.jobs.find(j=>j.id===id||j.id.startsWith(id)):latest(user);
  if(!j||j.user!==String(user))return '没有找到你的生图任务。';
  if(j.state==='sending')return '图片已进入发送阶段，无法撤销，请稍等回执。';
  if(terminal.has(j.state))return `任务 ${j.id.slice(0,8)}：${labels[j.state]}。`;
  settle(j,'cancelled');if(active?.job.id===j.id)active.abort.abort();
  return '已取消任务和后续图片发送，额度已退还。已在 ComfyUI 开始的计算可能继续，不会中断其他人的任务。';
 }
 async function onMessage({kind,id,userId,text,eventId,displayName,explicitAt=false,resolveVideoImage,resolveGenerationImage,resolveUpscaleImage,sourceMessageId}){
  if(!enabled)return {};
  const requestEpoch=pipelineEpoch,requestAccessEpoch=generationAccessEpoch;
  const key=kind+':'+id,user=String(userId),c=parseComfyCommand(text);if(!c||!allowed(key))return {};
  const generationRequestAllowed=()=>isOwner(user)||(generationAllowed(user)&&requestAccessEpoch===generationAccessEpoch);
  if(c.type==='generation-access'||c.type==='generation-access-syntax'){
   if(!isOwner(user)){await notice(key,'生成功能开关仅管理员可用。');return {handled:true};}
   if(kind==='group'&&!explicitAt){await notice(key,'请实际@机器人后发送 /关闭生图 或 /开启生图。');return {handled:true};}
   if(c.type==='generation-access-syntax'){await notice(key,'格式：/关闭生图 或 /开启生图。');return {handled:true};}
   const previous=state.publicGenerationEnabled;state.publicGenerationEnabled=c.enabled;
   try{save();}catch(error){state.publicGenerationEnabled=previous;log('生成功能开关保存失败：'+error.message);await notice(key,'开关保存失败，未修改，请稍后重试。');return {handled:true};}
   generationAccessEpoch++;
   if(!c.enabled){
    for(const [ticket,cap]of caps)if(!isOwner(cap.user)&&!cap.jobId)caps.delete(ticket);
    for(const [event,ticket]of events)if(!caps.has(ticket))events.delete(event);
   }
   await notice(key,c.enabled?'已开启普通用户的 Comfy 生成功能。':'已关闭普通用户的 Comfy 生成功能；管理员仍可使用，已入队任务继续完成。');
   return {handled:true};
  }
  if(c.type==='removed-generation'){await notice(key,c.error);return {handled:true};}
  if(generationRequests.has(c.type)&&!generationAllowed(user)){await notice(key,generationClosedText);return {handled:true};}
  if(c.type==='models-refresh'){
   if(!isOwner(user)){await notice(key,'刷新模型仅管理员可用。');return {handled:true};}
   if(kind==='group'&&!explicitAt){await notice(key,'请实际@机器人后发送 /刷新模型。');return {handled:true};}
   try{const {refreshLoraCatalog}=await import('./lora-discovery.mjs');const report=refreshLoraCatalog();await notice(key,'模型已刷新：可用 '+report.available+' 项，待确认 '+report.pending.length+' 项。'+(report.warnings.length?'\n'+report.warnings.slice(0,8).join('\n'):''));}catch(error){log('模型刷新失败：'+error.message);await notice(key,'刷新失败，请检查LoRA目录与配置。');}
   return {handled:true};
  }
  if(generationRequests.has(c.type)){
   const features=c.type==='video-request'?['video']:c.type==='upscale-request'?['upscale']:['image',...(c.hd?['upscale']:[]),...(c.preset==='deepseek'?['deepseek']:[])];
   if(features.some(feature=>!featureAllowed(feature))){await notice(key,'此生成功能尚未配置，请联系管理员。');return {handled:true};}
  }
  if(c.type==='image-option-syntax'||c.type==='upscale-syntax'){await notice(key,c.error??UPSCALE_HELP);return {handled:true};}
  if(c.type==='upscale-request'){
   if(kind==='group'&&!explicitAt){await notice(key,'请实际@机器人后发送高清指令。');return {handled:true};}
   if(cleaning){await notice(key,'正在清理管线，请稍后高清。');return {handled:true};}
   const eid=key+':'+user+':'+String(eventId??randomUUID());
   if(upscaleFlights.has(eid))return upscaleFlights.get(eid);
   const work=(async()=>{
    let ticket=events.get(eid),binding=caps.get(ticket);
    if(binding?.jobId)return {handled:true,job:view(state.jobs.find(j=>j.id===binding.jobId))};
    if(quota(user).remaining===0){await notice(key,quotaText(user)+'额度不足，请稍后再试。');return {handled:true};}
    try{
     await upscaleReady();
     for(const [t,v]of caps)if(v.expires<now())caps.delete(t);
     if(caps.size>=256)throw Error('生图请求较多，请稍后重试');
     if(!binding||binding.expires<now()){
      const bytes=await(resolveUpscaleImage??resolveGenerationImage)?.();if(!bytes)throw Error('请附带或引用一张图片后发送 /高清');
      const image=await(stageUpscale??stageUpscaleInput)(path.dirname(worker),bytes);
      const original=sourceMessageId?state.jobs.find(j=>j.key===key&&j.state==='sent'&&[j.messageId,j.previewMessageId].some(v=>v!=null&&String(v)===String(sourceMessageId))):null;
      const source=upscaleSource(original),prompt=source?.options?.prompt||'Upscale the supplied image without changing its content.';
      if(!allowed(key)||requestEpoch!==pipelineEpoch||!generationRequestAllowed())return {handled:true};
      ticket=randomBytes(24).toString('hex');binding={kind:'upscale',image,upscale:{longEdge:c.longEdge,source},direct:{prompt,negative:source?.options?.negative},user,key,count:1,description:'高清'+(c.longEdge===4096?'4K':'2K'),name:String(displayName||'群成员').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,32),expires:now()+30*60000,jobId:null};
      caps.set(ticket,binding);events.set(eid,ticket);if(events.size>512)events.delete(events.keys().next().value);
     }
     return {handled:true,job:call({ticket,prompt:binding.direct.prompt}).job};
    }catch(error){await notice(key,'高清暂未提交：'+error.message);return {handled:true};}
   })();upscaleFlights.set(eid,work);try{return await work;}finally{upscaleFlights.delete(eid);}
  }
  if((c.type==='request'||c.type==='tag-request')&&c.hd){try{await upscaleReady();}catch(error){await notice(key,'高清暂不可用：'+error.message);return {handled:true};}}
  if(c.type==='pipeline-clear'){
   if(!isOwner(user)){await notice(key,'清理管线仅管理员可用。');return {handled:true};}
   if(kind==='group'&&!explicitAt){await notice(key,'请通过QQ的@列表选择机器人，再发送 /清理管线。');return {handled:true};}
   if(cleaning){await notice(key,'正在清理，请稍候。');return {handled:true};}
   cleaning=true;pipelineEpoch++;let cancelled=0;
   try{
    if(wakeTimer){unschedule(wakeTimer);wakeTimer=null;}
    caps.clear();imageBindings.clear();
    const sending=state.jobs.filter(j=>j.state==='sending').length;
    for(const j of state.jobs)if(!terminal.has(j.state)&&j.state!=='sending'){settle(j,'cancelled');cancelled++;}
    const running=active;if(running?.job.state==='cancelled')running.abort.abort();
    const report=await(clearPipeline??clearComfyPipeline)({workspace:path.dirname(worker),promptIds:state.jobs.flatMap(j=>[j.promptId,...(j.results??[]).map(r=>r.promptId)]).filter(Boolean),waitForWorker:async()=>{if(running?.job.state==='cancelled')for(let i=0;i<30&&active===running;i++)await new Promise(r=>setTimeout(r,100));}});
    // Release only a cancelled slot after owned Comfy work and live locks are gone.
    const workerAlive=running?.worker&&running.worker.exitCode===null&&running.worker.signalCode===null;
    const recoveredSlot=!!(running&&active===running&&running.job.state==='cancelled'&&!workerAlive&&!report.queueUnavailable&&!report.remaining&&!report.liveLocks);
    if(recoveredSlot)active=null;
    state.lastOutputAt=0;save();
    await notice(key,'管线清理完成：取消 '+cancelled+' 个机器人任务，移除 '+report.removedQueued+' 个Comfy排队任务，停止 '+report.interrupted+' 个生成任务，清除 '+report.removedLocks+' 个失效锁。'+(report.queueUnavailable?'Comfy暂不可连接或队列核对未完成，请检查启动状态。':'')+(report.remaining?'仍有 '+report.remaining+' 个任务等待停止，请稍后再查。':'')+(report.liveLocks?'仍有存活进程持锁，未强行删除。':'')+(recoveredSlot?'释放 1 个失效调度占位。':'')+(sending?'已进入QQ发送的消息继续等待回执，不重复发送。':''));
   }catch(e){log('管线清理未完成：'+e.message);await notice(key,'已取消 '+cancelled+' 个本地任务；管线清理未完成：'+e.message);}
   finally{cleaning=false;void pump();}
   return {handled:true};
  }
  if(c.temporaryPreview&&(!isOwner(user)||kind!=='private'||String(id)!==owner())){await notice(key,'/-生图 仅限管理员在与机器人的私聊中使用。');return {handled:true};}
  if(c.type==='preview-syntax'){await notice(key,'格式：/-生图[n] 描述；需压缩时双发图片和压缩包，图片90秒后撤回。');return {handled:true};}
  if(c.type.startsWith('video-')){
   if(!isOwner(user)){await notice(key,'视频生成仅管理员可用。');return {handled:true};}
   if(kind==='group'&&!explicitAt){await notice(key,'视频指令请通过 QQ 的@列表选择机器人后发送。');return {handled:true};}
   if(c.type==='video-status'||c.type==='video-cancel'){
    const j=c.id?state.jobs.find(j=>j.kind==='video'&&j.user===user&&(j.id===c.id||j.id.startsWith(c.id))):state.jobs.filter(j=>j.kind==='video'&&j.user===user&&j.key===key).at(-1);
    if(c.type==='video-status')await notice(key,(j?(c.id?'指定视频任务：':'最近视频任务'+(terminal.has(j.state)?'（历史记录）':'')+'：')+j.id.slice(0,8)+'，'+labels[j.state]+'。\n':c.id?'未找到该视频任务，请使用排队提示中的任务编号。\n':'当前会话还没有你提交的视频任务。\n')+queueText(key));
    else if(!j)await notice(key,'没有找到当前会话的视频任务。');
    else await notice(key,(await cancel(user,j.id)).replaceAll('生图','视频').replaceAll('图片','视频').replace('，额度已退还',''));
    return {handled:true};
   }
   if(c.type==='video-syntax'){await notice(key,c.error);return {handled:true};}
   if(cleaning){await notice(key,'正在清理缓存，请稍后提交。');return {handled:true};}
   for(const [t,v]of caps)if(v.expires<now())caps.delete(t);
   const eid=key+':'+user+':'+String(eventId??randomUUID());let ticket=events.get(eid),binding=caps.get(ticket);
   if(binding?.jobId)return {handled:true,job:view(state.jobs.find(j=>j.id===binding.jobId))};
   if(!binding){
    if(caps.size>=256){await notice(key,'请求较多，请稍后重试。');return {handled:true};}
    let input={};try{const bytes=await resolveVideoImage?.();if(!bytes)throw Error('请同条附一张图片，或引用一张图片后发送指令');input=await(stageVideo??stageVideoInput)(path.dirname(worker),bytes);}catch(e){await notice(key,e.message);return {handled:true};}
    if(!isOwner(user)||!allowed(key)||requestEpoch!==pipelineEpoch)return {handled:true};
    ticket=randomBytes(24).toString('hex');binding={kind:'video',user,key,count:1,description:c.description,video:{...input,mode:c.mode,params:c.params},name:String(displayName||'群成员').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,32),expires:now()+30*60000,jobId:null};
    caps.set(ticket,binding);events.set(eid,ticket);if(events.size>512)events.delete(events.keys().next().value);
   }
   return {ticket,hint:'\n【本地生图专用授权】管理员图生视频，使用qqbot-video工作流。起始图片和参数已由本条真实QQ消息绑定。整理英文视频动态提示词，只调用一次 mcp__snowluma__qq_comfy_generate，ticket 参数为 '+ticket+'，只传prompt和可选negative，不传width、height、steps、seed。视频时长'+binding.video.params.seconds+'秒。工具返回排队后简短回应即可，不重复播报状态。不要执行命令、切换L2、改工作流或索取图片；不要公开ticket，必须逐字复制。'};
  }
 // Group generation requires an actual OneBot at-self segment, independently of nickname chat triggers.
  if(kind==='group'&&!explicitAt&&(c.preset==='deepseek'||/^\/生图\d*(?:\s|[:：]|$)/.test(String(text).trim())||c.type==='request'||c.type==='request-syntax'||c.type==='enhanced-syntax'||c.type==='tag-request'||c.type==='tag-syntax')){await notice(key,'生图请通过 QQ 的@列表选择机器人，再发送 /生图 描述。手打@昵称不能授权生图。');return {handled:true};}
  if(c.type==='admin-help-denied'){await notice(key,'管理员指令列表仅管理员私聊可查看，请使用 /help 查看普通用户指令。');return {handled:true};}
  if(c.type==='cache-clear'){
   if(!isOwner(user)||kind!=='private'||String(id)!==owner()){await notice(key,'清除生图缓存仅管理员私聊可用。');return {handled:true};}
   if(cleaning||active||state.jobs.some(j=>!terminal.has(j.state))){await notice(key,'生图、发送或排队尚未结束，请稍后清理。');return {handled:true};}
   cleaning=true;
   try{
    const paths=cfg.comfyChat?.cachePaths??{};
    const report=await(clearCache??clearComfyCache)({workspace:path.dirname(worker),outputDirectory:paths.outputDirectory,tempDirectory:paths.tempDirectory,promptIds:state.jobs.flatMap(j=>[j.promptId,...(j.results??[]).map(r=>r.promptId)]).filter(Boolean),extraCleanup:async()=>{
     const v=await clearVideoCache({workspace:path.dirname(worker),outputDirectory:paths.outputDirectory,inputDirectory:cfg.comfyChat?.videoInputDirectory});
     const i=await clearImageInputCache({workspace:path.dirname(worker),inputDirectory:paths.outputDirectory?path.resolve(paths.outputDirectory,'..','..','input','dsh_qq_img2img'):undefined});
     return {removed:v.removed+i.removed,bytes:v.bytes+i.bytes,skipped:v.skipped+i.skipped};
    }});
    for(const [t,cap]of caps)if(['video','upscale'].includes(cap.kind))caps.delete(t);imageBindings.clear();
    await notice(key,`已清除 ${report.removed} 个图片/视频缓存文件，释放 ${(report.bytes/1048576).toFixed(1)} MB。${report.skipped?'跳过 '+report.skipped+' 个不符合清理规则的项目。':''}${report.previewUnavailable?'部分历史预览暂不可核对；稍后可再次清理。':''}`);
   }catch(e){log('生图缓存清理失败：'+e.message);await notice(key,'清理未完成：'+e.message);}
   finally{cleaning=false;void pump();}
   return {handled:true};
  }
  if((c.type==='request'||c.type==='tag-request')&&cleaning){await notice(key,'正在清理生图缓存，请稍后提交。');return {handled:true};}
  if(c.type==='enhanced-syntax'){await notice(key,'格式：/画图 增强#名称 描述，或 /画图 减弱#名称 描述；同底模最多5项，可重复。');return {handled:true};}
  if(c.type==='request-syntax'){await notice(key,'格式：/生图 描述；指令和描述之间需要空格。');return {handled:true};}
  if(c.type==='tag-syntax'){await notice(key,'格式：/tag生图 PST/正面提示词 NGT/负面提示词');return {handled:true};}
  if(c.type==='tag-request'){
   const maxBatch=Math.min(20,Math.max(1,Number(cfg.comfyChat?.maxAdminBatch)||10));
   if(!Number.isInteger(c.count)||c.count<1||c.count>maxBatch){await notice(key,'每次生图张数须为 1~'+maxBatch+'。');return {handled:true};}
   if(c.count>1&&!isOwner(user)){await notice(key,'连续多张生图仅限管理员；请使用 /tag生图 PST/正面提示词 NGT/负面提示词。');return {handled:true};}
   let options;try{options=checkOptions({prompt:c.prompt,negative:c.negative});}catch(e){await notice(key,e.message);return {handled:true};}
   const eid=key+':'+user+':'+String(eventId??randomUUID());
   let ticket=events.get(eid),binding=caps.get(ticket);
   if(binding&&!binding.direct){await notice(key,'该消息已绑定其他生图请求，请重新发送。');return {handled:true};}
   if(binding?.jobId)return {handled:true,job:view(state.jobs.find(j=>j.id===binding.jobId))};
   if(quota(user).remaining===0){await notice(key,quotaText(user)+'额度不足，请稍后再试。');return {handled:true};}
   for(const [t,v]of caps)if(v.expires<now())caps.delete(t);
   if(!binding||binding.expires<now()){
    if(caps.size>=256){await notice(key,'生图请求较多，请稍后重试。');return {handled:true};}
    let image;try{image=await imageBinding(eid,resolveGenerationImage);}catch(e){await notice(key,e.message);return {handled:true};}
    if(!allowed(key)||requestEpoch!==pipelineEpoch||!generationRequestAllowed())return {handled:true};
    ticket=randomBytes(24).toString('hex');binding={...image,...(c.framing?{framing:c.framing}:{}),...(c.hd?{hd:c.hd}:{}),user,key,count:c.count,description:options.prompt,direct:{prompt:options.prompt,negative:options.negative},name:String(displayName||(isOwner(user)?'管理员':'群成员')).replace(/[\r\n\x00-\x1f]/g,' ').slice(0,32),expires:now()+30*60000,jobId:null};
    caps.set(ticket,binding);events.set(eid,ticket);if(events.size>512)events.delete(events.keys().next().value);
   }
   try{const submitted=call({ticket,prompt:binding.direct.prompt,negative:binding.direct.negative});return {handled:true,job:submitted.job};}
   catch(e){await notice(key,e.message);return {handled:true};}
  }
  if(c.type==='help'||c.type==='public-help'){await notice(key,USER_HELP+(isOwner(user)?'\n\n'+ADMIN_LORA_HELP:''));return {handled:true};}
  if(c.type==='lora-syntax'){await notice(key,'格式：/lora LoRA名称，例如 /lora 菲比；名称见 /loras。');return {handled:true};}
  if(c.type==='lora-detail'){
   let intro;
   try{intro=loraDetail(c.name,loraCatalogFile,{isAdmin:isOwner(user)});}catch(e){log('LoRA介绍读取失败：'+e.message);await notice(key,e.code==='LORA_ADMIN_ONLY'||e.message.startsWith('没有这个LoRA')?e.message:'LoRA介绍暂不可用，请联系管理员。');return {handled:true};}
   let example;try{example=selectLoraExample(c.name,{...loraExampleOptions,catalogFile:loraCatalogFile});}catch(e){log('LoRA图例不可用：'+e.message);}
   await notice(key,intro,undefined,example);return {handled:true};
  }
  if(c.type==='loras-syntax'){await notice(key,'格式：/loras [角色|画风|动作]；动作仅管理员可用。');return {handled:true};}
  if(c.type==='loras'){
   try{await notice(key,loraList(loraCatalogFile,{family:c.family,category:c.category,isAdmin:isOwner(user)}));}catch(e){log('LoRA列表读取失败：'+e.message);await notice(key,e.code==='LORA_ADMIN_ONLY'?e.message:'LoRA列表暂不可用，请联系管理员。');}
   return {handled:true};
  }
  if(c.type==='grant'||c.type==='grant-syntax'){
   if(!isOwner(user)){await notice(key,'仅管理员可增加本小时生图额度。');return {handled:true};}
   if(kind!=='group'){await notice(key,'请在目标群内 @ 机器人后使用：/生图额度 群昵称 n。');return {handled:true};}
   if(c.type==='grant-syntax'||!Number.isInteger(c.amount)||c.amount<1||c.amount>100){await notice(key,'格式：/生图额度 群昵称 n，n 为 1~100，当前小时结束整点到期。');return {handled:true};}
   let members;
   try{members=await resolveGroupMembers?.(id);if(!Array.isArray(members))throw new Error('无群成员名单');}
   catch{await notice(key,'群成员名单暂不可用，未修改额度。');return {handled:true};}
   const normalize=name=>String(name??'').trim().normalize('NFKC');
   const matches=[...new Map(members.filter(m=>/^\d{5,12}$/.test(String(m.user_id))&&normalize(m.card||m.nickname)===normalize(c.nickname)).map(m=>[String(m.user_id),m])).values()];
   if(matches.length!==1){await notice(key,matches.length?'此群有同名成员，未修改额度；请先使用不同群名片。':'未找到该群昵称，未修改额度。');return {handled:true};}
   if(!isOwner(user)||!allowed(key)||requestEpoch!==pipelineEpoch)return {handled:true};
   const target=String(matches[0].user_id);
   if(isOwner(target)){await notice(key,'该用户是管理员，无每小时张数限制。');return {handled:true};}
   const expiresAt=(Math.floor(now()/HOUR)+1)*HOUR;
   state.hourCredits.push({id:randomUUID(),user:target,amount:c.amount,expiresAt});save();
   const hour=String(new Date(expiresAt+8*HOUR).getUTCHours()).padStart(2,'0');
   await notice(key,`已为「${c.nickname}」增加本小时 ${c.amount} 张额度，${hour}:00 到期。当前剩余 ${quota(target).remaining} 张。`);
   return {handled:true};
  }
  if(c.type==='request'){
   const maxBatch=Math.min(20,Math.max(1,Number(cfg.comfyChat?.maxAdminBatch)||10));
   if(!Number.isInteger(c.count)||c.count<1||c.count>maxBatch){await notice(key,'每次生图张数须为 1~'+maxBatch+'，例如 /生图3 一只小鲸鱼。');return {handled:true};}
   if(c.count>1&&!isOwner(user)){await notice(key,'连续多张生图仅限管理员；请用 /生图 描述 提交单张任务。');return {handled:true};}
   const q=quota(user);if(q.remaining===0){await notice(key,quotaText(user)+'额度不足，请稍后再试。');return {handled:true};}
   let selected;try{const requested=c.preset==='deepseek'?{description:c.description,lora:null}:resolveLoraRequest(c.description,loraCatalogFile);assertLoraAccess(requested.lora,{isAdmin:isOwner(user)});selected={description:requested.description,lora:requested.lora,...(c.enhancedReferences?{enhancedLoraReferences:resolveEnhancedLoraReferences(requested.lora,enhancedLoraReferenceFile)}:{}),...(c.reducedReferences?{reducedLoraNames:resolveReducedLoraReferences(requested.lora,loraCatalogFile),authorLoraReferences:resolveAuthorLoraReferences(requested.lora,{catalogFile:loraCatalogFile})}:{})};}catch(e){log('生图参考加载失败：'+e.message);await notice(key,e.code&&e.code!=='LORA_ADMIN_ONLY'?'生图参考文件暂不可用':e.message);return {handled:true};}
   for(const [t,v]of caps)if(v.expires<now())caps.delete(t);
   if(caps.size>=256){await notice(key,'生图请求较多，请稍后重试。');return {handled:true};}
   const eid=key+':'+user+':'+String(eventId??randomUUID());
   let ticket=events.get(eid);if(!caps.has(ticket)){let image;try{image=await imageBinding(eid,resolveGenerationImage);if(c.preset==='deepseek')image={kind:'deepseek'};if(selected.lora)image={kind:'lora',lora:selected.lora};}catch(e){await notice(key,e.message);return {handled:true};}if(!allowed(key)||requestEpoch!==pipelineEpoch||!generationRequestAllowed())return {handled:true};ticket=randomBytes(24).toString('hex');caps.set(ticket,{...image,...(c.framing?{framing:c.framing}:{}),...(c.hd?{hd:c.hd}:{}),...(c.temporaryPreview?{temporaryPreview:true}:{}),...(c.enhancedReferences?{enhancedLoraReferences:selected.enhancedLoraReferences}:{}),...(c.reducedReferences?{loraReferenceMode:'reduced',reducedLoraNames:selected.reducedLoraNames,authorLoraReferences:selected.authorLoraReferences}:{}),user,key,count:c.count,description:selected.description,name:String(displayName|| (isOwner(user)?'管理员':'群成员')).replace(/[\r\n\x00-\x1f]/g,' ').slice(0,32),expires:now()+30*60000,jobId:null});events.set(eid,ticket);if(events.size>512)events.delete(events.keys().next().value);}
   const binding=caps.get(ticket);
   return {ticket,hint:'\n【本地生图专用授权】本条真实 QQ 消息已验证身份并绑定额度。画面尺寸由后台按'+(binding.framing??'竖图')+'固定绑定，不传width/height。'+(binding.hd?'基础出图后后台自动高清放大到长边'+binding.hd+'。':'')+(binding.kind==='deepseek'?deepseekHint():binding.kind==='lora'?'使用本条LoRA对应的Anima文生图工作流；':'统一使用qqbot官方Anima Base文生图工作流；')+(binding.temporaryPreview?'本条临时预览由后台发送并定时撤回，无需自行操作。':'')+'整理英文画面提示词，省略未指定的steps。调用 mcp__snowluma__qq_comfy_generate，ticket 参数为 '+ticket+'。后台绑定生成 '+c.count+' 张；只调用一次工具，不拆分。工具返回排队后，只补一句简短自然的角色回应，不重复排队信息或解释等待流程。不要切换 L2、执行命令、提前声称已出图或公开授权串。ticket必须逐字复制，不向用户索取或猜测。'+loraHint(binding)};
  }
  if(['default','override','clear','inspect','syntax'].includes(c.type)){
   if(!isOwner(user)||kind!=='private'||String(id)!==owner()){await notice(key,'额度设置及查看他人额度仅限管理员私聊。');return {handled:true};}
   if(c.type==='syntax'||c.limit>100){await notice(key,'格式：设置默认生图额度 3；设置生图额度 QQ号 5；恢复默认生图额度 QQ号。额度范围 0~100，0 表示停用。');return {handled:true};}
   if(c.type==='default'){state.defaultLimit=c.limit;save();await notice(key,`默认生图额度已设为每 QQ 每滚动 60 分钟 ${c.limit} 张（已有单独设置不变）。`);}
   if(c.type==='override'){state.overrides[c.user]=c.limit;save();await notice(key,'已设置。'+quotaText(c.user));}
   if(c.type==='clear'){delete state.overrides[c.user];save();await notice(key,'已恢复默认。'+quotaText(c.user));}
   if(c.type==='inspect')await notice(key,quotaText(c.user));
  }else if(c.type==='quota')await notice(key,quotaText(user));
  else if(c.type==='status'){const j=c.id?state.jobs.find(j=>(j.id===c.id||j.id.startsWith(c.id))&&j.user===user):latest(user);await notice(key,(j?`生图 ${j.id.slice(0,8)}：${j.deliveryFailureSummary??labels[j.state]}。\n`:'你还没有生图任务。\n')+queueText(key));}
  else if(c.type==='cancel')await notice(key,await cancel(user,c.id));
  else await notice(key,USER_HELP);
  return {handled:true};
 }
 function call(body){
  if(cleaning)throw new Error('正在清理生图缓存，请稍后提交');
  if(!enabled)throw new Error('聊天生图未启用');
  const options=checkOptions(body),cap=caps.get(body.ticket);
  if(!cap||cap.expires<now()||!allowed(cap.key))throw new Error('本条生成授权无效或已过期，请重新发送原始生成指令；无需用户提供授权串，不要补写或猜测ticket');
  if(!generationAllowed(cap.user))throw new Error(generationClosedText);
  const features=cap.kind==='video'?['video']:cap.kind==='upscale'?['upscale']:['image',...(cap.kind==='deepseek'?['deepseek']:[]),...(cap.hd?['upscale']:[])];
  if(features.some(feature=>!featureAllowed(feature)))throw Error('此生成功能尚未配置，请联系管理员');
  if(cap.temporaryPreview&&(!isOwner(cap.user)||cap.key!=='private:'+owner()))throw Error('临时预览仅限管理员私聊');
  if(cap.kind==='video'){if(!isOwner(cap.user))throw new Error('视频生成仅管理员可用');for(const k of ['width','height','steps','seed'])if(body[k]!==undefined)throw new Error('视频参数由原始QQ指令绑定');}
  if(cap.kind==='upscale'&&['width','height','steps','seed'].some(k=>body[k]!==undefined))throw Error('高清参数由真实QQ指令绑定');
  if(cap.kind==='deepseek')options.prompt=deepseekPrompt(options.prompt);
  if(cap.kind==='lora'){assertLoraAccess(cap.lora,{isAdmin:isOwner(cap.user)});options.prompt=loraPrompt(options.prompt,cap.lora,{referenceMode:cap.loraReferenceMode??'default',catalogFile:loraCatalogFile});}
  if(cap.direct){options.prompt=cap.direct.prompt;options.negative=cap.direct.negative;for(const key of ['width','height','steps','seed'])delete options[key];}
  if(!['video','upscale'].includes(cap.kind))Object.assign(options,frameSize(cap.framing??'竖图'));
  if(cap.jobId)return {ok:true,duplicate:true,job:view(state.jobs.find(j=>j.id===cap.jobId)),quota:quota(cap.user)};
  if((cap.count??1)>1&&!isOwner(cap.user))throw new Error('批量生图仅限管理员');
  if(quota(cap.user).remaining!==null&&quota(cap.user).remaining<(cap.count??1))throw new Error('每小时生图额度不足');
  if(state.jobs.filter(j=>!terminal.has(j.state)).length>=8)throw new Error('后台生图队列已满，请稍后重试');
  const j={id:randomUUID(),...(cap.kind==='upscale'?{kind:'upscale',image:cap.image,upscale:structuredClone(cap.upscale)}:cap.kind==='video'?{kind:'video',video:cap.video}:cap.kind==='deepseek'?{kind:'deepseek'}:cap.kind==='base'?{kind:'base'}:cap.kind==='lora'?{kind:'lora',lora:cap.lora}:{}),user:cap.user,key:cap.key,...(cap.baseModel?{baseModel:cap.baseModel}:{}),...(cap.hd?{hd:cap.hd}:{}),...(cap.framing?{framing:cap.framing}:{}),...(cap.temporaryPreview?{temporaryPreview:true}:{}),...(cap.enhancedLoraReferences?{loraReferenceMode:'enhanced',enhancedReferenceNames:Object.keys(cap.enhancedLoraReferences)}:{}),...(cap.loraReferenceMode==='reduced'?{loraReferenceMode:'reduced',reducedLoraNames:cap.reducedLoraNames}:{}),name:cap.name,state:'queued',at:now(),count:cap.count??1,archive:cap.kind==='upscale'?(!!cap.upscale.source?.archive||isExplicitGenerationPrompt(options.prompt)):isExplicitGenerationPrompt(options.prompt),description:cap.description,options};
  if(!isOwner(j.user))for(let unit=0;unit<(j.count??1);unit++){const q=quota(j.user);const creditId=q.baseRemaining>0?null:availableCredits(j.user).find(c=>c.remaining>0)?.id;if(q.baseRemaining===0&&!creditId)throw new Error('小时额外额度已到期');state.usage.push({jobId:j.id,user:j.user,at:now(),state:'reserved',...(creditId?{creditId}:{})});}
  cap.jobId=j.id;state.jobs.push(j);
  save();void notice(j.key,(j.kind==='video'?'视频 ':'生图 ')+j.id.slice(0,8)+' 已排队。\n'+queueText(j.key));queueMicrotask(()=>void pump());
  return {ok:true,job:view(j),quota:quota(j.user),queue:queueText(j.key),message:j.kind==='video'?'已加入后台视频队列，可继续聊天；完成后自动发送视频并 @ 请求者。':'已加入后台队列。队列消息已由后台单独发送；只补一句简短自然的角色回应，不再解释自动发图或等待流程。'};
 }
 function revoke(key){
  for(const [ticket,cap]of caps)if(cap.key===key)caps.delete(ticket);
  for(const [event,ticket]of events)if(!caps.has(ticket))events.delete(event);
  for(const j of state.jobs)if(j.key===key&&!terminal.has(j.state)&&j.state!=='sending'){
   settle(j,'cancelled');if(active?.job.id===j.id)active.abort.abort();
  }
  if(wakeTimer){unschedule(wakeTimer);wakeTimer=null;}
  queueMicrotask(()=>void pump());
 }
 function close(){closed=true;previewRecalls?.close();if(wakeTimer)unschedule(wakeTimer);if(active){settle(active.job,'interrupted');active.abort.abort();}}
 if(enabled)save();
 function requestStatus(ticket,key){
  const cap=caps.get(ticket);
  if(!enabled||closed||!cap||cap.key!==key||!allowed(key))return 'unavailable';
  if(cap.jobId)return 'submitted';
  return cap.expires<now()?'unavailable':'pending';
 }
 return {onMessage,call,quota,close,revoke,requestStatus,forgetPreviewRecall:(key,messageId)=>previewRecalls?.complete(key,messageId),status:user=>view(latest(user))};
}
