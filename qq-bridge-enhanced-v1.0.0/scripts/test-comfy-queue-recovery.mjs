import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createComfyChat} from '../src/comfy-chat.mjs';
const OWNER='1000000001',USER='100001';
const tick=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const empty={removedQueued:0,interrupted:0,removedLocks:0,liveLocks:0,remaining:0,queueUnavailable:false};
function fixture(t,extra={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-queue-recovery-'));
 fs.mkdirSync(path.join(root,'images'));
 const notices=[];let event=0;
 const c=createComfyChat({root:path.join(root,'bridge'),stateDir:root,cooldownMs:0,cfg:{ownerQQ:OWNER,allow:{private:[OWNER,USER]},comfyChat:{enabled:true}},notify:async(k,text)=>notices.push(text),clearPipeline:async()=>empty,...extra});
 t.after(()=>{c.close();fs.rmSync(root,{recursive:true,force:true});});
 return {c,root,notices,message:(text,owner=false)=>c.onMessage({kind:'private',id:owner?OWNER:USER,userId:owner?OWNER:USER,text,eventId:++event,resolveGenerationImage:async()=>null})};
}
function blockRenames(t,root,count){
 const original=fs.renameSync;let failures=0;
 fs.renameSync=function(from,to){if(to===path.join(root,'comfy-chat.json')&&failures<count){failures++;throw Object.assign(Error('simulated Windows sharing violation'),{code:'EPERM'});}return original.apply(this,arguments);};
 t.after(()=>{fs.renameSync=original;});
 return ()=>{fs.renameSync=original;return failures;};
}
test('transient EPERM retries atomically and still starts exactly one job',async t=>{
 let runs=0;const f=fixture(t,{run:async()=>{runs++;return {promptId:randomUUID()};},deliver:async()=>({messageId:123})});
 const cap=await f.message('/生图 海边');f.c.call({ticket:cap.ticket,prompt:'a beach'});
 const restore=blockRenames(t,f.root,2);await tick();assert.equal(restore(),2);assert.equal(runs,1);assert.equal(f.c.status(USER).state,'sent');
 assert(!fs.readdirSync(f.root).some(n=>n.endsWith('.tmp')));
});
test('exhausted startup-save retry never starts GPU work and does not wedge the next job',async t=>{
 let runs=0;const f=fixture(t,{run:async()=>{runs++;return {promptId:randomUUID()};},deliver:async()=>({messageId:123})});
 const cap=await f.message('/生图 海边');f.c.call({ticket:cap.ticket,prompt:'a beach'});
 const restore=blockRenames(t,f.root,5);await tick();assert.equal(restore(),5);assert.equal(runs,0);assert.equal(f.c.status(USER).state,'failed');assert.equal(f.c.quota(USER).used,0);
 const next=await f.message('/生图 山顶');f.c.call({ticket:next.ticket,prompt:'a mountain'});await tick();assert.equal(runs,1);assert.equal(f.c.status(USER).state,'sent');
});
test('cleanup releases a confirmed idle cancelled slot; late completion cannot clear a newer slot',async t=>{
 const releases=[];let runs=0;
 const f=fixture(t,{run:async()=>{runs++;return new Promise(resolve=>releases.push(()=>resolve({promptId:randomUUID()})));},deliver:async()=>({messageId:123})});
 const one=await f.message('/生图 第一张');f.c.call({ticket:one.ticket,prompt:'first'});await tick();assert.equal(runs,1);
 await f.message('/清理管线',true);assert.equal(f.c.status(USER).state,'cancelled');assert(f.notices.some(n=>n.includes('失效调度占位')));
 const two=await f.message('/生图 第二张');f.c.call({ticket:two.ticket,prompt:'second'});await tick();assert.equal(runs,2);
 releases[0]();await tick();
 const three=await f.message('/生图 第三张');f.c.call({ticket:three.ticket,prompt:'third'});await tick();assert.equal(runs,2);
 releases[1]();await tick();assert.equal(runs,3);releases[2]();await tick();assert.equal(f.c.status(USER).state,'sent');
});
test('cleanup does not release a cancelled slot when Comfy ownership check is unavailable',async t=>{
 let release,runs=0;const f=fixture(t,{run:async()=>{runs++;return new Promise(resolve=>{release=()=>resolve({promptId:randomUUID()});});},clearPipeline:async()=>({...empty,queueUnavailable:true}),deliver:async()=>({messageId:123})});
 const a=await f.message('/生图 第一张');f.c.call({ticket:a.ticket,prompt:'first'});await tick();await f.message('/清理管线',true);
 const b=await f.message('/生图 第二张');f.c.call({ticket:b.ticket,prompt:'second'});await tick();assert.equal(runs,1);release();await tick();assert.equal(runs,2);release();await tick();
});
