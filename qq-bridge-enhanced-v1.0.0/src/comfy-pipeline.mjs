import {COMFY_URL} from './runtime-config.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id);
const processAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;return true;}};
export async function clearComfyPipeline({workspace,promptIds=[],request=fetch,isProcessAlive=processAlive,waitForWorker=async()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const root=path.resolve(workspace),images=path.join(root,'images'),report={removedQueued:0,interrupted:0,removedLocks:0,liveLocks:0,remaining:0,queueUnavailable:false};
 const directory=await fs.lstat(images);if(!directory.isDirectory()||directory.isSymbolicLink()||path.relative(images,await fs.realpath(images))!=='')throw Error('生图目录存在重定向，停止清理');
 const ids=new Set(promptIds.filter(validId));
 const owned=row=>ids.has(String(row[1]))||row[3]?.dsh_qq_pipeline===true;
 try{const last=JSON.parse(await fs.readFile(path.join(images,'last-job.json'),'utf8'));if(validId(last.id))ids.add(last.id);}catch{}
 async function api(route,body){const r=await request(COMFY_URL+route,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Comfy HTTP '+r.status);if(body===undefined)return r.json();}
 try{
  const queue=await api('/queue');const pending=(queue.queue_pending??[]).filter(owned),running=(queue.queue_running??[]).filter(owned);
  if(pending.length){await api('/queue',{delete:pending.map(row=>String(row[1]))});report.removedQueued=pending.length;}
  // ComfyUI 0.38 supports prompt_id; never send an unscoped global interrupt or clear:true.
  for(const row of running){await api('/interrupt',{prompt_id:String(row[1])});report.interrupted++;}
  for(let i=0;i<10;i++){const q=await api('/queue');report.remaining=[...(q.queue_running??[]),...(q.queue_pending??[])].filter(owned).length;if(!report.remaining)break;await sleep(200);}
 }catch{report.queueUnavailable=true;}
 await waitForWorker();
 const lock=path.join(images,'.generation.lock');
 try{
  const stat=await fs.lstat(lock);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error('无法核实生图锁，已保留');
  const raw=await fs.readFile(lock,'utf8');let data;try{data=JSON.parse(raw);}catch{throw Error('锁信息损坏，已保留');}
  if(!Number.isSafeInteger(data.pid)||data.pid<=0)throw Error('锁进程信息无效，已保留');
  if(await isProcessAlive(data.pid)){report.liveLocks++;return report;}
  if(await fs.readFile(lock,'utf8')!==raw)throw Error('生图锁已变化，已保留');
  await fs.unlink(lock);report.removedLocks++;
 }catch(e){if(e.code!=='ENOENT')throw e;}
 return report;
}
