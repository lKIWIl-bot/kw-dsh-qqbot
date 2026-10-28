import {validateUpscaleOptions} from './upscale-options.mjs';
import {COMFY_URL} from './runtime-config.mjs';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {getImageDimensions,generateImageFromImage} from './comfy-img2img.mjs';
import {longEdgeSize} from './image-options.mjs';
export const UPSCALE_CONFIG=fileURLToPath(new URL('../../image-workflow/upscale.json',import.meta.url));
export const MAX_HD_IMAGE_BYTES=64*1048576;
export function loadUpscaleConfig(){
 const c=JSON.parse(readFileSync(UPSCALE_CONFIG,'utf8'));
 return validateUpscaleOptions(c);
}
export function upscaleImageExtension(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>MAX_HD_IMAGE_BYTES)throw Error('高清原图需为64MiB以内的PNG/JPEG/WebP');
 const ext=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216?'jpg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
 if(!ext)throw Error('高清只支持PNG、JPEG和WebP');
 const d=getImageDimensions(bytes);if(!d||!d.width||!d.height||d.width*d.height>64000000)throw Error('高清原图尺寸无效或超过6400万像素');return ext;
}
export async function stageUpscaleInput(workspace,bytes){
 const ext=upscaleImageExtension(bytes),input=randomUUID()+'.'+ext,dir=path.join(workspace,'img2img');
 await fs.mkdir(dir,{recursive:true});const st=await fs.lstat(dir),real=await fs.realpath(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||path.relative(dir,real)!=='')throw Error('高清缓存目录重定向');
 await fs.writeFile(path.join(dir,input),bytes,{flag:'wx'});return {input,mode:'upscale'};
}
export async function checkUpscaleReady(request=fetch){
 const config=loadUpscaleConfig(),r=await request(COMFY_URL+"/object_info",{signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('ComfyUI暂不可连接');const o=await r.json();
 for(const n of ['UpscaleModelLoader','DshIllustrationUpscale','ImageScale','LoadImage','SaveImage'])if(!o[n])throw Error('缺少高清节点：'+n);
 const spec=o.UpscaleModelLoader.input.required.model_name,choices=Array.isArray(spec[0])?spec[0]:spec[1]?.options??[];
 if(!choices.includes(config.model))throw Error('IllustrationJaNai高清模型尚未就绪，请管理员完成安装');return true;
}
export function buildUpscaleGraph(job,{width,height,config=loadUpscaleConfig()}){
 if(!/^[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(job.image?.input??''))throw Error('高清原图绑定无效');
 const target=longEdgeSize(width,height,job.upscale?.longEdge),graph={
 '1':{class_type:'LoadImage',inputs:{image:'dsh_qq_img2img/'+job.image.input}},
 '12':{class_type:'SaveImage',inputs:{images:['5',0],filename_prefix:'dsh_qq/qqbot-upscale'}}};
 let image=['1',0];
 if(Math.max(width,height)<job.upscale.longEdge){
  graph['3']={class_type:'UpscaleModelLoader',inputs:{model_name:config.model}};
  graph['4']={class_type:'DshIllustrationUpscale',inputs:{upscale_model:['3',0],image,scale:job.upscale.longEdge<=Math.max(width,height)*2?2:4,tile:config.tile,processing:config.processing}};image=['4',0];
 }
 graph['5']={class_type:'ImageScale',inputs:{image,upscale_method:'lanczos',...target,crop:'disabled'}};
 return {graph,details:{...target,longEdge:job.upscale.longEdge,model:config.model,neuralUpscale:!!graph['4']}};
}
export function upscaleSource(job){
 let source=job;
 for(let i=0;i<4&&source?.kind==='upscale'&&source.upscale?.source;i++)source=source.upscale.source;
 if(!source)return null;
 return {kind:source.kind??'default',lora:source.lora??null,options:{prompt:String(source.options?.prompt??''),negative:source.options?.negative},archive:!!source.archive};
}
export async function upscaleGeneratedImage(generated,longEdge,signal,{workspace,onQueued=()=>{},run=generateImageFromImage}={}){
 if(!/^[a-f0-9-]{36}$/.test(generated.promptId))throw Error('基础图结果编号无效');
 let bytes;
 for(const ext of ['png','jpg','webp']){
  const file=path.join(workspace,'images',generated.promptId+'.'+ext);
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_HD_IMAGE_BYTES)throw Error('基础图文件无效');bytes=await fs.readFile(file);break;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(!bytes)throw Error('找不到基础图');
 const image=await stageUpscaleInput(workspace,bytes);
 const result=await run({kind:'upscale',image,upscale:{longEdge},options:{}},signal,{workspace,onQueued});
 return {...generated,...result,seed:generated.seed,basePromptId:generated.promptId};
}
