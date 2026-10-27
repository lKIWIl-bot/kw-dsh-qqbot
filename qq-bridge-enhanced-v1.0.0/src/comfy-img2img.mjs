import {COMFY_URL} from './runtime-config.mjs';
import {buildUpscaleGraph,upscaleImageExtension,MAX_HD_IMAGE_BYTES} from './comfy-upscale.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {videoImageExtension} from './comfy-video.mjs';
const inputPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:png|jpg|webp)$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Only actual image segments on this event or its explicitly quoted message.
// Never fall back to a previous image, a text description, or a model-selected ID.
export async function resolveQqGenerationImage({segments=[],kind,id,selfId,extract,findMedia,getMessage,fetchImage,maxBytes=10*1048576}){
 let media=extract(segments).filter(m=>m.kind==='image');
 if(!media.length){
  const replies=segments.filter(s=>s.type==='reply');if(!replies.length)return null;
  if(replies.length!==1)throw Error('请只引用一条含图片的消息');
  const ref=String(replies[0].data?.id??'');
  if(!/^-?\d{1,16}$/.test(ref)||!Number.isSafeInteger(Number(ref)))throw Error('引用消息编号无效');
  media=(findMedia(ref)??[]).filter(m=>m.kind==='image');
  if(!media.length){
   const raw=await getMessage(Number(ref));
   const group=raw?.group_id??raw?.groupId,user=raw?.user_id??raw?.userId??raw?.sender?.user_id;
   if(!raw||(kind==='group'?String(group)!==String(id):group!=null||user==null||![String(id),String(selfId)].includes(String(user))))throw Error('无法确认引用图片属于当前会话，请重新附图');
   media=extract(raw.message??[]).filter(m=>m.kind==='image');
  }
 }
 if(!media.length)return null;
 if(media.length!==1)throw Error('图片处理每次只支持一张参考图，请单独发送或引用一张图片');
 const image=await fetchImage(media[0]);if(!image?.buffer)throw Error('无法获取参考图，请重新附图或引用图片');
 if(image.buffer.length>maxBytes)throw Error('参考图超过允许大小');
 if(maxBytes>10*1048576)upscaleImageExtension(image.buffer);else videoImageExtension(image.buffer);return image.buffer;
}
export function getImageDimensions(buf) {
    if (!buf || buf.length < 24) return null;
    try {
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
      if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
      }
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        let offset = 2;
        while (offset + 9 < buf.length) {
          if (buf[offset] !== 0xff) { offset += 1; continue; }
          const marker = buf[offset + 1];
          if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
          const len = buf.readUInt16BE(offset + 2);
          if (len < 2) return null;
          // SOF0-SOF15（排除 DHT C4、DAC CC、DNL DC、DRI DD）
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
          }
          offset += 2 + len;
        }
      }
      // WebP：解析 VP8X / VP8L / VP8 三种容器，避免“图片炸弹”绕过像素上限。
      if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const fourcc = buf.toString('ascii', 12, 16);
        if (fourcc === 'VP8X' && buf.length >= 30) {
          const width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
          const height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
          return { width, height };
        }
        if (fourcc === 'VP8L' && buf.length >= 25) {
          const bits = [buf[21], buf[22], buf[23], buf[24]];
          const width = 1 + (((bits[1] & 0x3f) << 8) | bits[0]);
          const height = 1 + (((bits[3] & 0x0f) << 10) | (bits[2] << 2) | ((bits[1] & 0xc0) >> 6));
          return { width, height };
        }
        if (fourcc === 'VP8 ' && buf.length >= 30) {
          const width = buf.readUInt16LE(26) & 0x3fff;
          const height = buf.readUInt16LE(28) & 0x3fff;
          return { width, height };
        }
      }
    } catch {}
    return null;
  }
async function safeDirectory(directory){
 const absolute=path.resolve(directory),[stat,real]=await Promise.all([fs.lstat(absolute),fs.realpath(absolute)]);
 if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(absolute,real)!=='')throw Error('图片处理缓存目录存在路径重定向');return absolute;
}
export async function generateImageFromImage(job,signal,{workspace,onQueued=()=>{},request=fetch,pollMs=1500,timeoutMs=17*60000}={}){
 if(job.kind!=='upscale')throw Error('图片编辑已从此版本移除；此入口仅支持高清放大');
 const dir=path.join(workspace,'images');await fs.mkdir(dir,{recursive:true});await safeDirectory(dir);
 const lockPath=path.join(dir,'.generation.lock');let lock;
 try{lock=await fs.open(lockPath,'wx');}catch{throw Error('生成程序正在使用 GPU 队列，请稍后重试');}
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,type:'upscale'}));
  const source=job.image?.input;if(!inputPattern.test(String(source)))throw Error('Invalid reference image binding');
  const inputs=await safeDirectory(path.join(workspace,'img2img')),file=path.join(inputs,source),stat=await fs.lstat(file),real=await fs.realpath(file);
  if(!stat.isFile()||stat.isSymbolicLink()||path.relative(file,real)!==''||stat.size>MAX_HD_IMAGE_BYTES)throw Error('Invalid staged image');
  const bytes=await fs.readFile(file);upscaleImageExtension(bytes);
  const workflow='qqbot-upscale',upscale=buildUpscaleGraph(job,getImageDimensions(bytes)),graph=upscale.graph;
  const send=async(route,body)=>{const r=await request(COMFY_URL+route,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});if(!r.ok)throw Error('ComfyUI HTTP '+r.status);return r.json();};
  const queue=await send('/queue');if((queue.queue_running?.length??0)+(queue.queue_pending?.length??0)>=4)throw Error('ComfyUI队列繁忙');
  const form=new FormData();form.set('image',new Blob([bytes]),source);form.set('subfolder','dsh_qq_img2img');form.set('type','input');form.set('overwrite','false');
  const uploaded=await request(COMFY_URL+"/upload/image",{method:'POST',body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  if(!uploaded.ok)throw Error('ComfyUI参考图上传失败');const upload=await uploaded.json();
  if(upload.name!==source||upload.subfolder!=='dsh_qq_img2img'||upload.type!=='input')throw Error('Unexpected reference upload metadata');
  const submitted=await send('/prompt',{prompt:graph,client_id:randomUUID(),extra_data:{dsh_qq_pipeline:true}}),id=submitted.prompt_id;
  if(!uuid.test(String(id))||Object.keys(submitted.node_errors??{}).length)throw Error('图片处理工作流校验失败');
  onQueued(id);
  const metadata={promptId:id,input:source,workflow,workflowSha256:createHash('sha256').update(JSON.stringify(graph)).digest('hex'),upscale:upscale.details};
  const metaFile=path.join(inputs,id+'.json');await fs.writeFile(metaFile,JSON.stringify(metadata));
  const stop=()=>{void request(COMFY_URL+"/queue",{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[id]}),signal:AbortSignal.timeout(5000)}).catch(()=>{});};
  signal.addEventListener('abort',stop,{once:true});
  try{
   let entry,asset;const deadline=Date.now()+timeoutMs;
   while(Date.now()<deadline){
    signal.throwIfAborted();entry=(await send('/history/'+id))[id];
    if(entry?.status?.status_str==='error'){const detail=(entry.status.messages??[]).find(m=>m[0]==='execution_error')?.[1];throw Error('图片处理执行失败'+(detail?': '+String(detail.node_type??'')+' '+String(detail.exception_message??'').slice(0,500):''));}
    asset=entry?.outputs?.['12']?.images?.[0];if(asset)break;
    await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},pollMs);signal.addEventListener('abort',abort,{once:true});});
   }
   signal.throwIfAborted();
   if(!asset)throw Error('图片处理超时，Comfy任务可能仍在运行，请勿盲目重试');
   if(asset.type!=='output'||asset.subfolder!=='dsh_qq'||!String(asset.filename).startsWith(workflow+'_')||!/^qqbot-upscale_\d+_?\.png$/.test(String(asset.filename)))throw Error('Unexpected img2img output metadata');
   const r=await request(COMFY_URL+"/view?"+new URLSearchParams(asset),{signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
   if(!r.ok||Number(r.headers.get('content-length'))>MAX_HD_IMAGE_BYTES)throw Error('图片处理下载失败或超过64MiB');
   const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>MAX_HD_IMAGE_BYTES)throw Error('图片处理超过64MiB');chunks.push(chunk);}
   const output=Buffer.concat(chunks);if(!output.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('图片处理输出不是PNG');
   signal.throwIfAborted();await fs.writeFile(path.join(dir,id+'.png'),output,{flag:'wx'});
   const assets=Object.values(entry.outputs??{}).flatMap(n=>n.images??[]).map(({filename,subfolder,type})=>({filename,subfolder,type}));
   await fs.writeFile(path.join(dir,id+'.assets.json'),JSON.stringify(assets));await fs.writeFile(metaFile,JSON.stringify({...metadata,asset}));
   return {promptId:id,seed:job.options.seed,workflow,workflowSha256:metadata.workflowSha256,upscale:{...upscale.details,...(entry?.outputs?.['4']?.upscale?.[0]??{})}};
  }finally{signal.removeEventListener('abort',stop);}
 }finally{await lock.close();await fs.unlink(lockPath);}
}
export async function clearImageInputCache({workspace,inputDirectory,request=fetch}){
 const result={removed:0,bytes:0,skipped:0},plans=[];let local;
 try{local=await safeDirectory(path.join(workspace,'img2img'));}catch(e){if(e.code==='ENOENT')return result;throw e;}
 const names=await fs.readdir(local),ids=names.filter(n=>n.endsWith('.json')&&uuid.test(n.slice(0,-5))).map(n=>n.slice(0,-5));
 if(ids.length){const r=await request(COMFY_URL+"/queue",{signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Comfy不可用，暂不清理图片处理缓存');const q=await r.json();if([...(q.queue_running??[]),...(q.queue_pending??[])].some(row=>ids.includes(String(row[1]))))throw Error('Comfy中仍有图片处理任务运行');}
 for(const name of names)if(inputPattern.test(name)||(name.endsWith('.json')&&uuid.test(name.slice(0,-5))))plans.push([local,name]);
 if(inputDirectory){if(path.basename(path.resolve(inputDirectory))!=='dsh_qq_img2img')throw Error('图片处理清理目录无效');try{const input=await safeDirectory(inputDirectory);for(const name of await fs.readdir(input))if(inputPattern.test(name))plans.push([input,name]);}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const [root,name]of plans){await safeDirectory(root);const file=path.join(root,name),stat=await fs.lstat(file);if(stat.isFile()&&!stat.isSymbolicLink()){await fs.unlink(file);result.removed++;result.bytes+=stat.size;}else result.skipped++;}
 return result;
}
