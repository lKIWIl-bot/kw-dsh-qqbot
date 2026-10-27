import {videoImageExtension} from '../../../qq-bridge-enhanced-v1.0.0/src/qq-image-source.mjs';
import {fileURLToPath} from 'node:url';
import {COMFY_URL} from '../../../qq-bridge-enhanced-v1.0.0/src/runtime-config.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export const VIDEO_HELP='/图生视频 [时长=3] [帧率=16] [像素=0.24] [种子=整数] 描述，并附图或引用一张图片';
export function parseVideoCommand(text){
 const t=String(text??'').trim();
 let m=/^\/(视频状态|取消视频)(?:\s+([a-f0-9-]{8,36}))?$/.exec(t);
 if(m)return {type:m[1]==='视频状态'?'video-status':'video-cancel',id:m[2]};
 if(/^\/(?:视频状态|取消视频)/.test(t))return {type:'video-syntax',error:'格式：/视频状态 [任务编号] 或 /取消视频 [任务编号]。省略编号查询最近视频；编号使用排队提示中的8位编号，例如 97412932，不是第几个任务。'};
 if(/^\/生成视频/.test(t))return {type:'removed-generation',error:'文生视频已从此版本移除；视频请用 /图生视频 并附图或引用图片。'};
 if(!/^\/图生视频/.test(t))return null;
 const mode='i2v';
 try{
  if(!/^\/图生视频(?:\s|$)/.test(t))throw Error(VIDEO_HELP);
  let rest=t.slice(5).trim(),params={seconds:3,fps:16,megapixels:0.24},seen=new Set();
  const mapping={时长:'seconds',帧率:'fps',像素:'megapixels',种子:'seed'};
  while((m=/^(\S+?)=([^\s]+)(?:\s+|$)/.exec(rest))){
   const k=mapping[m[1]],v=Number(m[2]);
   if(!k||seen.has(k)||!Number.isFinite(v))throw Error('参数错误或重复。'+VIDEO_HELP);
   params[k]=v;seen.add(k);rest=rest.slice(m[0].length).trim();
  }
  validateVideoParams(params);
  if(!rest||rest.length>2000)throw Error('请填写 1~2000 字的动作与镜头描述。'+VIDEO_HELP);
  return {type:'video-request',mode,description:rest,params};
 }catch(e){return {type:'video-syntax',error:e.message};}
}
export function validateVideoParams(p){
 if(!p||!Number.isFinite(p.seconds)||p.seconds<1||p.seconds>10)throw Error('时长须为 1~10 秒');
 if(!Number.isInteger(p.fps)||p.fps<8||p.fps>24)throw Error('帧率须为 8~24 的整数');
 if(!Number.isFinite(p.megapixels)||p.megapixels<0.12||p.megapixels>0.35)throw Error('像素须为 0.12~0.35（百万像素）');
 if(p.seed!==undefined&&(!Number.isInteger(p.seed)||p.seed<0||p.seed>4294967295))throw Error('种子须为 0~4294967295 的整数');
 return Math.max(9,Math.round((p.seconds*p.fps-1)/4)*4+1);
}
export async function stageVideoInput(workspace,bytes){
 const ext=videoImageExtension(bytes),input=randomUUID()+'.'+ext,dir=path.join(workspace,'videos');
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,input),bytes,{flag:'wx'});return {input};
}
export function buildVideoGraph(template,{prompt,negative,seed,input,params,mode='i2v'}){
 if(mode!=='i2v')throw Error('此版本只支持图生视频');
 validateVideoParams(params);
 if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(input))throw Error('Invalid staged video image');
 const graph=structuredClone(template);
 const experts={1:'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',4:'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'};
 for(const [id,name]of Object.entries(experts))if(graph[id]?.class_type!=='UNETLoader'||graph[id].inputs.unet_name!==name)throw Error('公开Wan图生视频专家模型绑定变化');
 for(const [id,expert,stage]of [['2','1','high'],['5','4','low']])if(graph[id]?.class_type!=='LoraLoaderModelOnly'||graph[id].inputs.model?.[0]!==expert||graph[id].inputs.lora_name!=='wan2.2_i2v_lightx2v_4steps_lora_v1_'+stage+'_noise.safetensors'||graph[id].inputs.strength_model!==1)throw Error('Wan加速LoRA必须成对匹配专家');
 if(graph['3']?.inputs.model?.[0]!=='2'||graph['6']?.inputs.model?.[0]!=='5'||graph['13']?.inputs.steps!==4||graph['14']?.inputs.steps!==4||graph['13'].inputs.end_at_step!==2||graph['14'].inputs.start_at_step!==2||graph['14'].inputs.end_at_step!==4)throw Error('Wan四步采样分段配置变化');
 const required={'9':'CLIPTextEncode','10':'CLIPTextEncode','11':'LoadImage','12':'WanImageToVideo','13':'KSamplerAdvanced','14':'KSamplerAdvanced','16':'CreateVideo','17':'SaveVideo','21':'ImageScaleToTotalPixels'};
 for(const [id,type]of Object.entries(required))if(graph[id]?.class_type!==type)throw Error('qqbot-video template changed: '+id);
 graph['9'].inputs.text=prompt;if(negative!==undefined)graph['10'].inputs.text=negative;
 graph['11'].inputs.image='dsh_qq_video/'+input;
 graph['12'].inputs.length=validateVideoParams(params);graph['12'].inputs.batch_size=1;
 graph['13'].inputs.noise_seed=params.seed??seed;
 graph['16'].inputs.fps=params.fps;graph['21'].inputs.megapixels=params.megapixels;
 graph['17'].inputs.filename_prefix='dsh_qq_video/qqbot-video';
 return graph;
}
export async function generateVideo(job,signal,options={}){
 const directory=path.join(options.workspace,'images');await fs.mkdir(directory,{recursive:true});
 const lockPath=path.join(directory,'.generation.lock');let lock;
 try{lock=await fs.open(lockPath,'wx');}catch{throw Error('生成程序正在使用 GPU 队列，请稍后重试');}
 try{await lock.writeFile(JSON.stringify({pid:process.pid,type:'video'}));return await runVideo(job,signal,options);}
 finally{await lock.close();await fs.unlink(lockPath);}
}
async function runVideo(job,signal,{workspace,request=fetch,onQueued=()=>{},pollMs=1500,timeoutMs=35*60000}={}){
 const params=job.video.params,source=job.video.input,mode=job.video.mode??'i2v';
 if(mode!=='i2v')throw Error('此版本只支持图生视频');
 const workflow='qqbot-video',outputId='17';
 await fs.mkdir(path.join(workspace,'videos'),{recursive:true});
 const templateFile=fileURLToPath(new URL('../video-workflow/'+workflow+'.api.json',import.meta.url));
 const template=await fs.readFile(templateFile),sha256=createHash('sha256').update(template).digest('hex');
 const graph=buildVideoGraph(JSON.parse(template),{...job.options,input:source,params,mode});
 const api=async(route,body)=>{
  const r=await request(COMFY_URL+route,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  if(!r.ok)throw Error('ComfyUI HTTP '+r.status);return r.json();
 };
 const file=path.join(workspace,'videos',source),st=await fs.lstat(file);
 if(!st.isFile()||st.isSymbolicLink())throw Error('Invalid staged video input');
 const bytes=await fs.readFile(file);videoImageExtension(bytes);
 const form=new FormData();form.set('image',new Blob([bytes]),source);form.set('subfolder','dsh_qq_video');form.set('type','input');form.set('overwrite','false');
 const uploaded=await request(COMFY_URL+"/upload/image",{method:'POST',body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
 if(!uploaded.ok)throw Error('ComfyUI image upload failed');
 const info=await uploaded.json();if(info.name!==source||info.subfolder!=='dsh_qq_video'||info.type!=='input')throw Error('Unexpected image upload metadata');
 const submitted=await api('/prompt',{prompt:graph,client_id:randomUUID(),extra_data:{dsh_qq_pipeline:true}});
 const promptId=submitted.prompt_id;if(!/^[a-f0-9-]{36}$/.test(String(promptId))||Object.keys(submitted.node_errors??{}).length)throw Error('Video workflow rejected');
 onQueued(promptId);
 const metadata=path.join(workspace,'videos',promptId+'.json');
 await fs.writeFile(metadata,JSON.stringify({promptId,input:source,params,workflow,mode,workflowSha256:sha256}));
 const stop=()=>{void request(COMFY_URL+"/queue",{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[promptId]}),signal:AbortSignal.timeout(5000)}).catch(()=>{});};
 signal.addEventListener('abort',stop,{once:true});
 try{
  const deadline=Date.now()+timeoutMs;let asset;
  while(Date.now()<deadline){
   signal.throwIfAborted();const entry=(await api('/history/'+promptId))[promptId];
   if(entry?.status?.status_str==='error'){
    const detail=(entry.status.messages??[]).find(m=>m[0]==='execution_error')?.[1];
    throw Error('ComfyUI video execution failed'+(detail?': '+String(detail.node_type??'')+' '+String(detail.exception_message??'').slice(0,600):''));
   }
   const output=entry?.outputs?.[outputId];asset=[...(output?.images??[]),...(output?.gifs??[]),...(output?.videos??[])].find(v=>/\.mp4$/i.test(v.filename??''));
   if(asset)break;
   await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},pollMs);signal.addEventListener('abort',abort,{once:true});});
  }
  if(!asset)throw Error('Video generation timeout; do not resubmit blindly');
  if(asset.type!=='output'||asset.subfolder!=='dsh_qq_video'||!new RegExp('^'+workflow+'_\\d+_?\\.mp4$').test(asset.filename))throw Error('Unexpected video output metadata');
  const response=await request(COMFY_URL+"/view?"+new URLSearchParams({filename:asset.filename,subfolder:asset.subfolder,type:'output'}),{signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
  if(!response.ok||Number(response.headers.get('content-length'))>100*1048576)throw Error('Video download failed or exceeds 100 MiB');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>100*1048576){throw Error('Video exceeds 100 MiB');}chunks.push(chunk);}
  const data=Buffer.concat(chunks);if(data.length<12||data.toString('ascii',4,8)!=='ftyp')throw Error('Output is not MP4');
  await fs.writeFile(path.join(workspace,'videos',promptId+'.mp4'),data,{flag:'wx'});
  await fs.writeFile(metadata,JSON.stringify({promptId,input:source,params,asset,workflow,mode,workflowSha256:sha256}));
  return {promptId,seed:params.seed??job.options.seed,workflow,mode,workflowSha256:sha256};
 }finally{signal.removeEventListener('abort',stop);}
}

