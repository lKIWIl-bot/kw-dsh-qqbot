import {ARCHIVE_PASSWORD} from '../src/comfy-archive.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createWebMedia,WEB_MEDIA_BATCH_LIMITS} from '../src/web-media.mjs';
import {inspectWebMedia,fileFormat} from '../src/web-media-fetch.mjs';
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]),mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(24)]),pdf=Buffer.from('%PDF-1.7\nfixture document');
const choices=(images,videos,files)=>[...Array.from({length:images},(_,i)=>({url:'https://example.com/image-'+i+'.png',kind:'image'})),...Array.from({length:videos},(_,i)=>({url:'https://example.com/video-'+i+'.mp4',kind:'video'})),...Array.from({length:files},(_,i)=>({url:'https://example.com/file-'+i+'.pdf',kind:'file'}))];
function fixture(t,{candidates=choices(1,1,1),...extra}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-batch-')),sent=[],notices=[],key='private:100001';
 const service=createWebMedia({root:dir,stateDir:dir,cfg:{},allowed:k=>[key,'group:200001'].includes(k),guardFor:()=>()=>{},isOwner:id=>id==='100001',notify:async(k,m)=>notices.push(m),rpc:async()=>({message_id:999}),botId:()=> '1000000002',inspect:async()=>({candidates,note:'offline'}),fetchResource:async url=>({url,buffer:url.includes('/image-')?png:url.includes('/video-')?mp4:pdf,headers:{},statusCode:200}),deliver:async(asset,k)=>{sent.push({asset,key:k});return {messageId:sent.length};},...extra});
 t.after(()=>{service.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return {service,key,dir,sent,notices};
}
async function authorize(f,text='下载这些图片、视频和文件',eventId=1){f.service.noteRequest({key:f.key,text,eventId});return f.service.inspect({key:f.key,token:'token',url:'https://example.com/'});}
async function done(f){for(let i=0;i<5000;i++){const s=f.service.status({key:f.key});if(!f.service.busy())return s;await new Promise(r=>setTimeout(r,5));}throw Error('batch did not finish');}
test('one mixed batch independently accepts 100 images, 10 videos and 100 files, sending each exactly once',{timeout:45000},async t=>{
 const f=fixture(t,{candidates:choices(100,10,100)}),r=await authorize(f);
 const result=f.service.send({key:f.key,token:'token',candidateIds:r.candidates.map(c=>c.id)});assert.equal(result.count,210);assert.equal(result.added,210);
 const duplicate=f.service.send({key:f.key,token:'token',candidateIds:r.candidates.map(c=>c.id)});assert.equal(duplicate.added,0);
 const final=await done(f);assert.equal(final.summary.sent,210);assert.equal(f.sent.length,210);assert.deepEqual(WEB_MEDIA_BATCH_LIMITS,{image:100,video:10,file:100});
 assert.equal(f.sent.filter(x=>x.asset.kind==='image').length,100);assert.equal(f.sent.filter(x=>x.asset.kind==='video').length,10);assert.equal(f.sent.filter(x=>x.asset.kind==='file').length,100);
 assert.equal(f.notices.filter(n=>n.includes('本批抓取结束')).length,1);
});
test('type limits fail atomically, are cumulative across calls, and duplicate URLs consume no extra quota',async t=>{
 const f=fixture(t,{candidates:choices(101,11,101)}),r=await authorize(f),images=r.candidates.filter(c=>c.kind==='image'),videos=r.candidates.filter(c=>c.kind==='video');
 assert.throws(()=>f.service.send({key:f.key,token:'token',candidateIds:images.map(c=>c.id)}),/图片.*上限/);assert.equal(f.service.status({key:f.key}).job,null);
 assert.throws(()=>f.service.send({key:f.key,token:'token',candidateIds:videos.map(c=>c.id)}),/视频.*上限/);assert.equal(f.service.status({key:f.key}).job,null);
 f.service.send({key:f.key,token:'token',candidateIds:videos.slice(0,10).map(c=>c.id)});
 assert.throws(()=>f.service.send({key:f.key,token:'token',candidateId:videos[10].id}),/视频.*上限/);
 const again=await f.service.inspect({key:f.key,token:'token',url:'https://example.com/'});const duplicate=f.service.send({key:f.key,token:'token',candidateId:again.candidates.find(c=>c.url===videos[0].url).id});assert.equal(duplicate.added,0);
 await done(f);assert.equal(f.sent.length,10);
});
test('batch validation rejects cross-conversation and mixed legacy/batch parameters before enqueuing',async t=>{
 const f=fixture(t),r=await authorize(f),ids=r.candidates.map(c=>c.id);
 assert.throws(()=>f.service.send({key:'group:200001',token:'token',candidateIds:ids}),/不属于/);
 assert.throws(()=>f.service.send({key:f.key,token:'token',candidateId:ids[0],candidateIds:ids}),/不能同时/);
 assert.equal(f.service.status({key:f.key}).job,null);
 const result=f.service.send({key:f.key,token:'token',candidateIds:[ids[0],ids[0]]});assert.equal(result.count,1);await done(f);assert.equal(f.sent.length,1);
});
test('queued sources survive candidate expiry and a failed item does not stop later files',async t=>{
 let clock=1000,release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);let first=true;
 const f=fixture(t,{now:()=>clock,fetchResource:async url=>{if(first){first=false;started();await gate;throw Error('fixture first failure');}return {url,buffer:pdf,headers:{}};},candidates:choices(0,0,3)});
 const r=await authorize(f);f.service.send({key:f.key,token:'token',candidateIds:r.candidates.map(c=>c.id)});await ready;clock+=600001;
 await f.service.inspect({key:f.key,token:'token',url:'https://example.com/refresh'});release();const final=await done(f);assert.equal(final.summary.failed,1);assert.equal(final.summary.sent,2);assert.equal(f.sent.length,2);
});
test('encrypted mixed files retain independent archives and one final password notice',async t=>{
 const f=fixture(t);await f.service.command({key:f.key,text:'/加密抓取',userId:'100001',eventId:0});const r=await authorize(f);
 f.service.send({key:f.key,token:'token',candidateIds:r.candidates.map(c=>c.id)});await done(f);assert.equal(f.sent.length,3);assert.ok(f.sent.every(x=>x.asset.archive));assert.equal(f.notices.filter(n=>n.includes('本批抓取结束')&&n.includes(ARCHIVE_PASSWORD)).length,1);
});
test('a mixed gallery yields all 210 candidates and non-media types remain inert file downloads',async()=>{
 const body=[...Array.from({length:100},(_,i)=>'<img src="/i'+i+'.png">'),...Array.from({length:10},(_,i)=>'<video src="/v'+i+'.mp4"></video>'),...Array.from({length:100},(_,i)=>'<a href="/f'+i+'.pdf">file</a>')].join('');
 const r=await inspectWebMedia('https://example.com/',{fetchResource:async url=>({url,buffer:Buffer.from(body),headers:{'content-type':'text/html'},statusCode:200})});assert.equal(r.candidates.length,210);assert.equal(r.candidates.filter(c=>c.kind==='file').length,100);
 assert.equal(fileFormat(pdf,{},'https://example.com/a.pdf').ext,'pdf');assert.equal(fileFormat(Buffer.from('<html>login</html>'),{'content-type':'application/octet-stream'},'https://example.com/a.pdf'),null);
});
