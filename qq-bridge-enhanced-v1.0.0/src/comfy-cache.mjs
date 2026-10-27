import {COMFY_URL} from './runtime-config.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const imagePattern=new RegExp('^('+uuid+')\\.(png|jpg|webp|assets\\.json)$','i');
const archivePattern=new RegExp('^(?:images-'+uuid+'|[a-f0-9]{10})\\.(?:zip|z删ip)$','i');
const within=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
async function safeDirectory(dir){
 if(!dir)return null;
 const absolute=path.resolve(dir);
 try{
  const stat=await fs.lstat(absolute),real=await fs.realpath(absolute);
  if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(absolute,real)!=='')throw new Error('清理目录存在链接或路径重定向，已停止');
  return absolute;
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
// Delete individual generated files only. No recursive deletion or caller-supplied QQ paths.
export async function clearComfyCache({workspace,outputDirectory,tempDirectory,promptIds=[],request,extraCleanup}){
 const base=await safeDirectory(workspace);if(!base)throw new Error('生图工作区不存在');
 let images=await safeDirectory(path.join(base,'images'));
 if(!images){await fs.mkdir(path.join(base,'images'));images=await safeDirectory(path.join(base,'images'));}
 const lockPath=path.join(images,'.generation.lock');let lock;
 try{lock=await fs.open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('生图程序正在使用缓存，请稍后重试');throw e;}
 const result={removed:0,bytes:0,skipped:0,previewUnavailable:false},planned=new Map();
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,type:'cache-cleanup'}));
  const archives=await safeDirectory(path.join(base,'archives'));
  if(outputDirectory&&path.basename(path.resolve(outputDirectory))!=='dsh_qq')throw new Error('Comfy清理仅允许dsh_qq专用目录');
  const output=await safeDirectory(outputDirectory),temp=await safeDirectory(tempDirectory);
  const ids=new Set(promptIds.filter(id=>new RegExp('^'+uuid+'$','i').test(id)));
  const assets=[];
  async function plan(root,name){
   if(!root||typeof name!=='string')return;
   const file=path.resolve(root,name);if(!within(root,file)){result.skipped++;return;}
   if(!await safeDirectory(path.dirname(file)))return;
   try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()){result.skipped++;return;}planned.set(file,{root,size:stat.size});}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  for(const name of await fs.readdir(images)){
   const match=imagePattern.exec(name);
   if(match){ids.add(match[1]);if(name.endsWith('.assets.json')){
    const file=path.join(images,name),stat=await fs.lstat(file);
    if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<262144){try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(Array.isArray(saved))assets.push(...saved);}catch{result.skipped++;}}
   }await plan(images,name);}
   else if(['last-job.json','last-result.json'].includes(name))await plan(images,name);
  }
  if(archives)for(const name of await fs.readdir(archives))if(archivePattern.test(name))await plan(archives,name);
  if(output)for(const name of await fs.readdir(output))if(/^(?:qqbot|qqbot-ds|qqbot-base|qqbot-upscale|image)_\d+_\.(?:png|jpg|webp)$/i.test(name))await plan(output,name);
  const signal=AbortSignal.timeout(7000);
  const read=request??(async route=>{
   const response=await fetch(COMFY_URL+route,{signal});if(!response.ok)throw new Error('Comfy unavailable');return response.json();
  });
  let queue;
  try{queue=await read('/queue');}catch{result.previewUnavailable=true;}
  if(queue&&[...(queue.queue_running??[]),...(queue.queue_pending??[])].some(row=>ids.has(String(row[1]))))throw new Error('Comfy中仍有本机器人任务运行，请结束后重试');
  if(queue){
   const pending=[...ids];
   for(let start=0;start<pending.length;start+=4){
    await Promise.all(pending.slice(start,start+4).map(async id=>{try{
     const history=await read('/history/'+id);
     for(const node of Object.values(history[id]?.outputs??{}))if(Array.isArray(node.images))assets.push(...node.images);
    }catch{result.previewUnavailable=true;}}));
    if(signal.aborted){result.previewUnavailable=true;break;}
   }
  }
  for(const asset of assets){
   if(!asset||typeof asset.filename!=='string'||path.basename(asset.filename)!==asset.filename||asset.filename.includes('\\')){result.skipped++;continue;}
   const folder=String(asset.subfolder??'');if(path.isAbsolute(folder)||path.win32.isAbsolute(folder)||folder.split(/[\\/]/).includes('..')){result.skipped++;continue;}
   // SaveVideo exposes MP4 results in its 'images' history field. Video cleanup owns these.
   if(asset.type==='output'&&folder==='dsh_qq_video'&&/^qqbot-(?:text-)?video_\d+_?\.mp4$/.test(asset.filename))continue;
   if(! /\.(?:png|jpg|webp)$/i.test(asset.filename)){result.skipped++;continue;}
   if(asset.type==='temp'&&temp)await plan(temp,path.join(folder,asset.filename));
  }
  const extra=await extraCleanup?.();if(extra){result.removed+=extra.removed;result.bytes+=extra.bytes;result.skipped+=extra.skipped;}
  // All target paths have been resolved and contained before the first deletion.
  for(const [file,entry]of planned){
   if(!within(entry.root,file)||!await safeDirectory(path.dirname(file)))throw new Error('清理目标路径变化，已停止');
   try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()){result.skipped++;continue;}await fs.unlink(file);result.removed++;result.bytes+=stat.size;}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return result;
 }finally{await lock.close();await fs.unlink(lockPath);}
}

// Video cache uses dedicated, fixed-name directories; no recursive deletion.
export async function clearVideoCache({workspace,outputDirectory,inputDirectory,request=fetch}){
 const result={removed:0,bytes:0,skipped:0};
 const videos=await safeDirectory(path.join(workspace,'videos'));if(!videos)return result;
 const ids=new Set();
 for(const name of await fs.readdir(videos)){
  const m=new RegExp('^('+uuid+')\\.json$','i').exec(name);if(m)ids.add(m[1]);
 }
 if(ids.size){
  const r=await request(COMFY_URL+"/queue",{signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Comfy不可用，暂不清理视频缓存');const queue=await r.json();
  if([...(queue.queue_running??[]),...(queue.queue_pending??[])].some(row=>ids.has(String(row[1]))))throw Error('Comfy中仍有机器人视频任务，请结束后再清理');
 }
 const plans=[];
 for(const name of await fs.readdir(videos))if(new RegExp('^'+uuid+'\\.(?:png|jpg|webp|json|mp4)$','i').test(name))plans.push([videos,name]);
 const output=outputDirectory?await safeDirectory(path.join(path.dirname(outputDirectory),'dsh_qq_video')):null;
 if(inputDirectory&&path.basename(path.resolve(inputDirectory))!=='dsh_qq_video')throw Error('视频输入清理路径无效');
 const input=await safeDirectory(inputDirectory);
 if(output)for(const name of await fs.readdir(output))if(/^qqbot-(?:text-)?video_\d+_?\.mp4$/.test(name))plans.push([output,name]);
 if(input)for(const name of await fs.readdir(input))if(new RegExp('^'+uuid+'\\.(png|jpg|webp)$','i').test(name))plans.push([input,name]);
 for(const [root,name]of plans){const file=path.resolve(root,name);if(!within(root,file)||!await safeDirectory(root))throw Error('视频清理路径变化');const stat=await fs.lstat(file);if(stat.isFile()&&!stat.isSymbolicLink()){await fs.unlink(file);result.removed++;result.bytes+=stat.size;}else result.skipped++;}
 return result;
}
