import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {clearComfyPipeline} from '../src/comfy-pipeline.mjs';import {createComfyChat,parseComfyCommand} from '../src/comfy-chat.mjs';
const OWNER='1000000001',USER='100001',GROUP='10001234',tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
function files(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-pipeline-'));fs.mkdirSync(path.join(root,'images'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const empty={removedQueued:0,interrupted:0,removedLocks:0,liveLocks:0,remaining:0,queueUnavailable:false};
function chat(t,extra={}){const root=files(t),notices=[];const c=createComfyChat({root:path.join(root,'bridge'),stateDir:root,cooldownMs:0,cfg:{ownerQQ:OWNER,allow:{private:[OWNER,USER],groups:[GROUP]},comfyChat:{enabled:true}},notify:async(key,text)=>notices.push(text),...extra});t.after(()=>c.close());let event=0;const message=(text,opts={})=>c.onMessage({kind:'private',id:USER,userId:USER,text,eventId:++event,resolveGenerationImage:async()=>null,...opts});return{c,message,notices,root};}
test('pipeline cleanup removes only owned pending prompts, uses targeted interrupt, and clears only a dead lock',async t=>{
 const root=files(t),run=randomUUID(),pending=randomUUID(),foreign=randomUUID(),calls=[];fs.writeFileSync(path.join(root,'images','.generation.lock'),JSON.stringify({pid:99999999}));fs.writeFileSync(path.join(root,'images','last-job.json'),JSON.stringify({id:run}));let q={queue_running:[[0,run]],queue_pending:[[1,pending,{}, {dsh_qq_pipeline:true}],[2,foreign]]};
 const request=async(url,opts)=>{if(opts.method==='POST'){const body=JSON.parse(opts.body);calls.push({url,body});if(url.endsWith('/queue'))q.queue_pending=q.queue_pending.filter(row=>!body.delete.includes(row[1]));if(url.endsWith('/interrupt'))q.queue_running=q.queue_running.filter(row=>row[1]!==body.prompt_id);}return {ok:true,json:async()=>q};};
 const report=await clearComfyPipeline({workspace:root,promptIds:[],request,isProcessAlive:()=>false,sleep:async()=>{}});assert.equal(report.removedQueued,1);assert.equal(report.interrupted,1);assert.equal(report.removedLocks,1);assert.equal(report.remaining,0);assert.deepEqual(q.queue_pending,[[2,foreign]]);assert.equal(fs.existsSync(path.join(root,'images','.generation.lock')),false);assert.deepEqual(calls.find(c=>c.url.endsWith('/interrupt')).body,{prompt_id:run});assert.ok(calls.every(c=>!c.body.clear));
});
test('manual running prompts and locks held by live processes survive cleanup',async t=>{
 const root=files(t),foreign=randomUUID(),lock=path.join(root,'images','.generation.lock');fs.writeFileSync(lock,JSON.stringify({pid:123}));let mutations=0;const r=await clearComfyPipeline({workspace:root,promptIds:[randomUUID()],isProcessAlive:()=>true,request:async(url,opts)=>{if(opts.method==='POST')mutations++;return {ok:true,json:async()=>({queue_running:[[0,foreign]],queue_pending:[]})};}});assert.equal(r.liveLocks,1);assert.equal(mutations,0);assert.ok(fs.existsSync(lock));
});
test('Comfy offline is reported while local dead locks can still be cleared; generated files are preserved',async t=>{
 const root=files(t),lock=path.join(root,'images','.generation.lock'),image=path.join(root,'images','keep.png');fs.writeFileSync(lock,JSON.stringify({pid:123}));fs.writeFileSync(image,'keep');const r=await clearComfyPipeline({workspace:root,isProcessAlive:()=>false,request:async()=>{throw Error('offline');}});assert.equal(r.queueUnavailable,true);assert.equal(r.removedLocks,1);assert.equal(fs.readFileSync(image,'utf8'),'keep');
});
test('only exact command and owner private or explicitly mentioned owner group calls can clean the pipeline',async t=>{
 assert.equal(parseComfyCommand('/清理管线').type,'pipeline-clear');assert.equal(parseComfyCommand('/清理管线 abc'),null);let cleaned=0;const f=chat(t,{clearPipeline:async()=>{cleaned++;return empty;}});
 await f.message('/清理管线');assert.equal(cleaned,0);await f.message('/清理管线',{kind:'group',id:GROUP,userId:OWNER,explicitAt:false});assert.equal(cleaned,0);
 await f.message('/清理管线',{userId:OWNER,id:OWNER});assert.equal(cleaned,1);await f.message('/清理管线',{kind:'group',id:GROUP,userId:OWNER,explicitAt:true});assert.equal(cleaned,2);
});
test('owner cleanup aborts generating jobs, cancels queued jobs, refunds usage, and invalidates preexisting tickets',async t=>{
 let runs=0,helperCalled=0;const id=randomUUID(),f=chat(t,{run:async(j,signal,context)=>{runs++;context.onQueued(id);await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));},clearPipeline:async opts=>{helperCalled++;assert.ok(opts.promptIds.includes(id));await opts.waitForWorker();return empty;}});
 const a=await f.message('/生图 海边');f.c.call({ticket:a.ticket,prompt:'a beach'});await tick();const b=await f.message('/生图 山顶');f.c.call({ticket:b.ticket,prompt:'a mountain'});const uncalled=await f.message('/生图 花园');assert.equal(f.c.quota(USER).used,2);
 await f.message('/清理管线',{userId:OWNER,id:OWNER});await tick();assert.equal(runs,1);assert.equal(helperCalled,1);assert.equal(f.c.quota(USER).used,0);assert.equal(f.c.status(USER).state,'cancelled');assert.throws(()=>f.c.call({ticket:uncalled.ticket,prompt:'garden'}),/授权无效/);assert.ok(f.notices.some(n=>n.includes('取消 2 个机器人任务')));
});
test('messages still being resolved cannot publish old generation tickets after cleanup',async t=>{
 let release;const f=chat(t,{clearPipeline:async()=>empty});const pending=f.message('/生图 花园',{resolveGenerationImage:()=>new Promise(r=>{release=r;})});await tick();await f.message('/清理管线',{userId:OWNER,id:OWNER});release(null);const result=await pending;assert.equal(result.ticket,undefined);assert.equal(result.handled,true);
});
test('QQ sends already in progress remain single-send and keep their receipt',async t=>{
 let release,sends=0;const f=chat(t,{run:async()=>({promptId:randomUUID(),workflow:'test'}),deliver:async()=>{sends++;return new Promise(r=>{release=r;});},clearPipeline:async()=>empty});const r=await f.message('/生图 花园');f.c.call({ticket:r.ticket,prompt:'garden'});await tick();assert.equal(f.c.status(USER).state,'sending');await f.message('/清理管线',{id:OWNER,userId:OWNER});assert.equal(f.c.status(USER).state,'sending');assert.ok(f.notices.some(n=>n.includes('继续等待回执')));release({messageId:123});await tick();assert.equal(sends,1);assert.equal(f.c.status(USER).state,'sent');
});
