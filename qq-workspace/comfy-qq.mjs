import {OneBotWebSocketClient} from '../qq-bridge-enhanced-v1.0.0/src/onebot-client.mjs';
import {readDeployment,COMFY_URL} from '../qq-bridge-enhanced-v1.0.0/src/runtime-config.mjs';
import {MAX_HD_BYTES,MAX_BATCH_BYTES,needsImageFileDelivery,inlinePreviewImages} from '../qq-bridge-enhanced-v1.0.0/src/hd-delivery.mjs';
import {inspectLoraExampleImage} from '../qq-bridge-enhanced-v1.0.0/src/lora-examples.mjs';
import {mediaSendTimeoutMs,onebotRpcTimeoutMs,napcatRpcError,sendImagesWithReceipt,uploadFileWithReceipt} from '../qq-bridge-enhanced-v1.0.0/src/comfy-delivery.mjs';
import {loadDeepseekWorkflow} from '../qq-bridge-enhanced-v1.0.0/src/comfy-deepseek.mjs';
import {findLoraSelection as findLora,loadLoraWorkflow,loraPrompt} from '../qq-bridge-enhanced-v1.0.0/src/comfy-loras.mjs';
// Local ComfyUI -> dedicated output directory -> fixed QQ owner. No shell execution.
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID, randomInt} from 'node:crypto';
import {imageZip,videoZip,readImageZip,ARCHIVE_PASSWORD} from '../qq-bridge-enhanced-v1.0.0/src/comfy-archive.mjs';
import {isExplicitImagePrompt} from '../qq-bridge-enhanced-v1.0.0/src/comfy-content-policy.mjs';
import {loadQqbotWorkflow} from './qqbot-workflow.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const COMFY=COMFY_URL;
const deployment=readDeployment(),OWNER=Number(deployment.ownerQQ),BOT=Number(deployment.botQQ);
const argv=process.argv.slice(2), action=argv.shift();
function arg(name,fallback){const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];}
function number(name,fallback,min,max){const v=Number(arg(name,fallback));if(!Number.isInteger(v)||v<min||v>max)throw new Error(`${name} must be ${min}..${max}`);return v;}
async function api(route,body,timeout=15000){
  const r=await fetch(COMFY+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  if(!r.ok)throw new Error(`ComfyUI ${route.split('?')[0]} HTTP ${r.status}: ${(await r.text()).slice(0,250)}`);
  return r.json();
}
async function onebot(){
 const config=readDeployment().snowluma??{};
 if(!Number.isSafeInteger(BOT)||BOT<10000||!Number.isSafeInteger(OWNER)||OWNER<10000)throw Error('请先配置 botQQ 与 ownerQQ');
 const bot=new OneBotWebSocketClient({url:config.wsUrl||'ws://127.0.0.1:3001',accessToken:config.accessToken,reconnect:false,requestTimeoutMs:10000});
 try{await bot.connect();const login=await bot.getLoginInfo();if(Number(login.user_id)!==BOT)throw Error('Unexpected robot QQ account; sending blocked');}catch(error){bot.close();throw error;}
 const rpc=async(action,params={})=>{
  const uploadBytes=/^upload_(?:group|private)_file$/.test(action)?(await fs.stat(params.file)).size:0;
  const result=await bot.request(action,params,{timeoutMs:onebotRpcTimeoutMs(action,params,{uploadBytes,uploadTimeout:config.timeout})});
  if(result.status!=='ok'||Number(result.retcode)!==0)throw napcatRpcError(action,result);return result.data;
 };
 return {rpc,close:()=>bot.close()};
}
export function workflow(options){return loadQqbotWorkflow(options).prompt;}
export function generationWorkflowLoader({deepseek=false,loraName,loraSha256,loraReferenceMode='default'}={}){
 if(deepseek&&loraName)throw Error('Base、LoRA与鲸鱼娘工作流选项冲突');
 const lora=loraName?findLora(loraName):null;
 if(!['default','reduced'].includes(loraReferenceMode)||loraReferenceMode==='reduced'&&!lora)throw Error('LoRA参考模式无效');
 if(lora&&loraSha256!==undefined&&loraSha256!==lora.sha256)throw Error('LoRA配置已更新，请重新发送生成指令');
 const coreLoader=lora?(options=>loadLoraWorkflow(options,lora.name,{expectedSha256:lora.sha256,referenceMode:loraReferenceMode})):deepseek?loadDeepseekWorkflow:loadQqbotWorkflow;
 const loader=options=>coreLoader(options);
 return {loader,lora};
}
async function main(){
  if(!['status','generate'].includes(action))throw new Error('Usage: comfy-qq.mjs status | generate --prompt "English prompt" [--negative "..."] [--seed N] [--width 1024] [--height 1024] [--steps 24] [--no-send]');
  const nodes=await api('/object_info');
  const loraName=arg('lora',undefined);if(argv.includes('--lora')&&!loraName)throw Error('LoRA名称不能为空');
 const loraReferenceMode=arg('lora-reference-mode','default');
 const {lora,loader}=generationWorkflowLoader({deepseek:argv.includes('--deepseek'),loraName,loraSha256:arg('lora-sha256',undefined),loraReferenceMode}),template=loader();
  for(const node of Object.values(template.prompt)){
    if(!nodes[node.class_type])throw new Error('qqbot node unavailable: '+node.class_type);
    for(const [key,value]of Object.entries(node.inputs)){const spec=nodes[node.class_type].input;const choices=(spec.required?.[key]??spec.optional?.[key])?.[0];if(Array.isArray(choices)&&!choices.some(choice=>String(choice).replaceAll('\\','/')===String(value).replaceAll('\\','/')))throw new Error('qqbot selection unavailable: '+node.class_type+'.'+key);}
  }
  if(action==='status'){
    const bot=await onebot();
    try{console.log(JSON.stringify({comfy:COMFY,workflow:template.name,models:template.models,defaults:template.defaults,bot:BOT,recipient:OWNER,qqConnected:true},null,2))}finally{bot.close()}
    return;
  }
  let prompt=arg('prompt','');if(!prompt||prompt.length>4000)throw new Error('prompt must contain 1..4000 characters');
  if(lora)prompt=loraPrompt(prompt,lora,{referenceMode:loraReferenceMode});
  const width=number('width',template.defaults.width,512,1536),height=number('height',template.defaults.height,512,1536),steps=number('steps',template.defaults.steps,1,40),seed=number('seed',randomInt(0,2**31),0,2**32-1);
  if(width%64||height%64||width*height>1572864)throw new Error('Width/height must be multiples of 64, maximum 1.5 megapixels');
  const loaded=loader({prompt,negative:arg('negative',undefined),width,height,steps,seed}),graph=loaded.prompt;
  if(loaded.fixedHandLora){const sampler=Object.values(graph).find(n=>n.class_type==='KSamplerAdvanced');prompt=graph[sampler.inputs.positive[0]].inputs.text;}
  for(const node of Object.values(graph))if(!nodes[node.class_type])throw new Error(`Missing built-in node ${node.class_type}`);
  const noSend=argv.includes('--no-send');
  const archiveForCli=isExplicitImagePrompt(prompt);
  let bot=noSend?null:await onebot();
  // Only one request in flight for this helper. Never interrupt another ComfyUI user's queue.
  await fs.mkdir(path.join(ROOT,'images'),{recursive:true});
  const lockPath=path.join(ROOT,'images','.generation.lock');
  let lock;
  try{lock=await fs.open(lockPath,'wx')}catch{bot?.close();throw new Error('Another generation is in progress; inspect .generation.lock before retrying')}
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
    const queue=await api('/queue');
    if((queue.queue_running?.length??0)+(queue.queue_pending?.length??0)>=4)throw new Error('ComfyUI queue is busy; please retry later');
    const submitted=await api('/prompt',{prompt:graph,client_id:randomUUID(),extra_data:{dsh_qq_pipeline:true}});
    if(!submitted.prompt_id||Object.keys(submitted.node_errors??{}).length)throw new Error('Workflow rejected: '+JSON.stringify(submitted.node_errors).slice(0,500));
    const id=String(submitted.prompt_id);if(!/^[a-zA-Z0-9-]+$/.test(id))throw new Error('Unexpected ComfyUI prompt ID');
    console.log(JSON.stringify({state:'queued',promptId:id,seed,workflow:template.name,workflowSha256:template.sha256}));
    await fs.writeFile(path.join(ROOT,'images','last-job.json'),JSON.stringify({id,seed,prompt,width,height,steps,submittedAt:new Date().toISOString(),workflow:template.name,...(loaded.fixedHandLora?{fixedHandLora:loaded.fixedHandLora}:{}),...(lora?{lora:{name:lora.name,sha256:lora.sha256}}:{})},null,2));
    let entry;
    const deadline=Date.now()+15*60*1000;
    while(Date.now()<deadline){
      const history=await api('/history/'+id);entry=history[id];
      if(entry?.status?.status_str==='error')throw new Error('ComfyUI execution failed: '+JSON.stringify(entry.status.messages).slice(0,700));
      if(entry?.outputs?.[template.outputId]?.images?.length)break;
      await new Promise(r=>setTimeout(r,1500));
    }
    const assets=Object.values(entry?.outputs??{}).flatMap(node=>Array.isArray(node.images)?node.images:[]).map(({filename,subfolder,type})=>({filename,subfolder,type}));
    await fs.writeFile(path.join(ROOT,'images',id+'.assets.json'),JSON.stringify(assets));
    const image=entry?.outputs?.[template.outputId]?.images?.[0];if(!image)throw new Error('Generation timed out; job may still run, do not blindly resubmit');
    if(image.type!=='output'||path.basename(image.filename)!==image.filename||String(image.subfolder??'').split(/[\\/]/).includes('..'))throw new Error('Unexpected output metadata');
    const url=COMFY+'/view?'+new URLSearchParams({filename:image.filename,subfolder:image.subfolder??'',type:'output'});
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok||!/^image\/(png|jpeg|webp)/i.test(response.headers.get('content-type')??''))throw new Error('ComfyUI output is not a supported image');
    if(Number(response.headers.get('content-length'))>20*1024*1024)throw new Error('Image exceeds 20 MiB');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>20*1024*1024)throw new Error('Image exceeds 20 MiB');
    const ext=response.headers.get('content-type').includes('jpeg')?'jpg':response.headers.get('content-type').includes('webp')?'webp':'png';
    const file=path.join(ROOT,'images',`${id}.${ext}`);await fs.writeFile(file,bytes);
    let receipt;
    if(!noSend){
      // Reconnect after a long generation so idle QQ sockets cannot cause a blind resend.
      bot.close();bot=null;
      const sent=await deliverGeneratedImages([id],'private:'+OWNER,{archive:archiveForCli});
      receipt={message_id:sent.messageId,uploaded:sent.uploaded};
      if(!receipt.message_id&&!receipt.uploaded)throw new Error('NapCat returned no delivery receipt; do not resend automatically');
    }
    const result={state:noSend?'saved':'sent',promptId:id,seed,file,workflow:template.name,workflowSha256:template.sha256,recipient:noSend?undefined:OWNER,messageId:receipt?.message_id};
    await fs.writeFile(path.join(ROOT,'images','last-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{bot?.close();await lock.close();await fs.unlink(lockPath)}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});


// These exports are only called by the trusted bridge background queue. Model tools
// cannot choose a recipient, a file path, a URL, or a workflow.
function deliveryTarget(key) {
  const match = /^(private|group):(\d{5,12})$/.exec(String(key));
  if (!match) throw new Error('Invalid delivery conversation');
  const c = JSON.parse(requireReadConfig());
  const list = match[1] === 'group' ? c.allow?.groups : c.allow?.private;
  if (!(list ?? []).map(String).includes(match[2])) throw new Error('Delivery target no longer allowlisted');
  return { kind: match[1], id: Number(match[2]) };
}
function requireReadConfig() {
  return readFileSync(path.join(ROOT,'..','qq-bridge-enhanced-v1.0.0','config.json'),'utf8');
}
export async function sendComfyNotice(key, text, mentionUser, example) {
  const t=deliveryTarget(key);
  const message=[];
  if(t.kind==='group' && /^\d{5,12}$/.test(String(mentionUser??''))) message.push({type:'at',data:{qq:String(mentionUser)}});
  message.push({type:'text',data:{text:String(text).slice(0,3000)}});
  if(example)inspectLoraExampleImage(example.bytes,example.ext);
  const bot=await onebot();
  try {
    if(example){const receipt=await sendImagesWithReceipt(bot,t,[example],{botId:BOT,prefixSegments:message});return {messageId:receipt.message_id,receiptRecovered:receipt.recovered===true};}
    const receipt=await bot.rpc(t.kind==='group'?'send_group_msg':'send_private_msg',t.kind==='group'?{group_id:t.id,message}:{user_id:t.id,message});
    return {messageId:receipt?.message_id};
  } finally {bot.close();}
}
export async function readGeneratedImage(promptId) {
 if(!/^[a-f0-9-]{36}$/.test(String(promptId)))throw new Error('Invalid generated prompt ID');
 for(const ext of ['png','jpg','webp']){
  try{
   const file=path.join(ROOT,'images',promptId+'.'+ext);
   const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_HD_BYTES)throw new Error('Invalid generated image');
   const bytes=await fs.readFile(file);if(!bytes.length||bytes.length>MAX_HD_BYTES)throw new Error('Generated image too large');
   return {bytes,ext};
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 throw new Error('Generated image unavailable');
}
export async function deliverGeneratedImage(promptId,key){return deliverGeneratedImages([promptId],key,{archive:true});}
export async function deliverGeneratedImages(promptIds,key,{archive=true,temporaryPreview=false}={}){
 if(!Array.isArray(promptIds)||!promptIds.length||promptIds.length>20)throw new Error('Invalid generated image count');
 const t=deliveryTarget(key),images=[];let total=0;
 if(temporaryPreview&&(t.kind!=='private'||String(t.id)!==String(JSON.parse(requireReadConfig()).ownerQQ)))throw Error('Temporary preview requires owner private chat');
 for(const id of promptIds){const image=await readGeneratedImage(id);total+=image.bytes.length;if(total>MAX_BATCH_BYTES)throw new Error('Batch exceeds 256 MiB');images.push(image);}
 // Archive path is always created by this helper, never by a model or a QQ message.
 let archiveFile,archiveName;
 if(archive){
  const zipName=randomUUID().replace(/-/g,'').slice(0,10)+'.zip';
  const directory=path.join(ROOT,'archives');await fs.mkdir(directory,{recursive:true});
  const zipFile=path.join(directory,zipName);
  await fs.writeFile(zipFile,imageZip(images,{password:ARCHIVE_PASSWORD}),{flag:'wx'});
  archiveName=zipName.slice(0,-4)+'.z删ip';archiveFile=path.join(directory,archiveName);
  await fs.link(zipFile,archiveFile);await fs.unlink(zipFile);
 }
 // Recheck the live allowlist immediately before sending; upload failures never fall back to inline images.
 deliveryTarget(key);
 const bot=await onebot();
 try{
  if(archive){
   const upload=await uploadFileWithReceipt(bot,t,{file:archiveFile,name:archiveName,sizeBytes:(await fs.stat(archiveFile)).size},{botId:BOT});
   if(temporaryPreview){
    // Retain the archive first; send the preview only once using verified receipts.
    deliveryTarget(key);
    try{const previews=await inlinePreviewImages(images);const receipt=await sendImagesWithReceipt(bot,t,previews,{botId:BOT});return {uploaded:true,archiveName,previewMessageId:receipt.message_id,receiptRecovered:receipt.recovered===true||upload?.recovered===true};}
    catch(error){return {uploaded:true,archiveName,previewError:String(error?.message??error).slice(0,300)};}
   }
   return {uploaded:true,archiveName,receiptRecovered:upload?.recovered===true};
  }
  if(needsImageFileDelivery(images)){
   for(let index=0;index<images.length;index++){
    deliveryTarget(key);
    const file=path.join(ROOT,'images',promptIds[index]+'.'+images[index].ext),name='高清-'+promptIds[index]+'.'+images[index].ext;
    try{await uploadFileWithReceipt(bot,t,{file,name,sizeBytes:images[index].bytes.length},{botId:BOT});}catch(error){error.generatedImageFile=true;throw error;}
   }
   return {uploaded:true,fileDelivery:true};
  }
  const receipt=await sendImagesWithReceipt(bot,t,images,{botId:BOT});
  return {messageId:receipt.message_id,receiptRecovered:receipt.recovered===true};
 }finally{bot.close();}
}

export async function deliverGeneratedVideo(promptId,key,{archive=false}={}){
 if(!/^[a-f0-9-]{36}$/.test(String(promptId)))throw Error('Invalid generated video ID');
 const t=deliveryTarget(key),file=path.join(ROOT,'videos',promptId+'.mp4'),stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>100*1024*1024)throw Error('Invalid generated video');
 const bytes=await fs.readFile(file);if(bytes.length<12||bytes.length>100*1024*1024||bytes.toString('ascii',4,8)!=='ftyp')throw Error('Invalid MP4');
 let archiveName,archiveFile;
 if(archive){
  const name=randomUUID().replace(/-/g,'').slice(0,10),dir=path.join(ROOT,'archives');await fs.mkdir(dir,{recursive:true});
  const zip=path.join(dir,name+'.zip');await fs.writeFile(zip,videoZip(bytes,{password:ARCHIVE_PASSWORD}),{flag:'wx'});
  archiveName=name+'.z删ip';archiveFile=path.join(dir,archiveName);await fs.link(zip,archiveFile);await fs.unlink(zip);
 }
 deliveryTarget(key);const bot=await onebot();
 try{
  if(archive){await bot.rpc(t.kind==='group'?'upload_group_file':'upload_private_file',t.kind==='group'?{group_id:t.id,file:archiveFile,name:archiveName}:{user_id:t.id,file:archiveFile,name:archiveName});return {uploaded:true,archiveName};}
  const message=[{type:'video',data:{file:pathToFileURL(file).href}}];
  const r=await bot.rpc(t.kind==='group'?'send_group_msg':'send_private_msg',t.kind==='group'?{group_id:t.id,message,timeout:mediaSendTimeoutMs(bytes.length)}:{user_id:t.id,message,timeout:mediaSendTimeoutMs(bytes.length)});return {messageId:r?.message_id};
 }finally{bot.close();}
}


// Only the trusted persisted preview-recall queue calls this; never an MCP tool.
export async function recallGeneratedPreview(key,messageId,{verifyOnly=false,actorQQ}={}){
 const owner=String(JSON.parse(requireReadConfig()).ownerQQ??'');
 const group=/^group:(\d{5,12})$/.exec(String(key)),groupAuthorized=group&&String(actorQQ)===owner;
 if((key!=='private:'+owner&&!groupAuthorized)||!/^\d{5,12}$/.test(owner)||!(/^-?[1-9]\d{0,15}$/.test(String(messageId)))||!Number.isSafeInteger(Number(messageId)))throw Error('Invalid temporary preview recall');
 const bot=await onebot();
 try{
  const raw=await bot.rpc('get_msg',{message_id:Number(messageId)});
  if(verifyOnly)return {recalled:false,unconfirmed:true,detail:'等待QQ撤回通知；本次只读查询，不重复发撤回请求'};
  if(!raw||String(raw.sender?.user_id??raw.user_id)!==String(BOT)||(groupAuthorized?String(raw.group_id)!==group[1]||raw.message_type&&raw.message_type!=='group':raw.group_id!=null||raw.message_type&&raw.message_type!=='private')||!Array.isArray(raw.message)||!raw.message.some(s=>s.type==='image')||raw.message.some(s=>s.type==='file'))throw Error('Preview receipt does not identify a robot private image');
  try{await bot.rpc('delete_msg',{message_id:Number(messageId)});return {recalled:true};}
  catch(error){
   if(Number(error?.retcode)===1200||['ONEBOT_RPC_TIMEOUT','ONEBOT_CONNECTION_CLOSED'].includes(error?.code)||/timeout|connection closed/i.test(String(error?.message??'')))return {recalled:false,unconfirmed:true,detail:String(error?.message??error).slice(0,200)};
   throw error;
  }
 }finally{bot.close();}
}

export async function readArchivedPreviewImages(name){
 if(!/^(?:[a-f0-9]{10}|images-[a-f0-9-]{36})\.z删ip$/i.test(name))throw Error('压缩包文件名无效。');
 const directory=path.join(ROOT,'archives');let handle;
 try{
  const parent=await fs.lstat(directory),real=await fs.realpath(directory);
  if(!parent.isDirectory()||parent.isSymbolicLink()||path.relative(directory,real)!=='')throw Error('压缩包缓存目录无效。');
  const file=path.join(directory,name),stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<22||stat.size>258*1024*1024)throw Error('压缩包缓存无效。');
  handle=await fs.open(file,'r');const opened=await handle.stat();
  if(opened.ino!==stat.ino||opened.dev!==stat.dev||opened.size!==stat.size)throw Error('压缩包缓存已变化。');
  const bytes=await handle.readFile();return readImageZip(bytes);
 }catch(error){if(error.code==='ENOENT')throw Error('压缩包本地缓存已清理，无法读取。');throw error;}
 finally{await handle?.close();}
}
export async function sendArchivePreviewImages(images,key,actorQQ){
 const check=()=>{
  const owner=String(JSON.parse(requireReadConfig()).ownerQQ??''),target=deliveryTarget(key);
  if(String(actorQQ)!==owner||target.kind==='private'&&String(target.id)!==owner)throw Error('管理员身份已变更，未发送。');
  return target;
 };
 const target=check();if(!Array.isArray(images)||images.length<1||images.length>20)throw Error('Invalid archive preview images');
 const bot=await onebot();
 try{check();const previews=await inlinePreviewImages(images);const receipt=await sendImagesWithReceipt(bot,target,previews,{botId:BOT});return {messageId:receipt.message_id};}
 finally{bot.close();}
}
