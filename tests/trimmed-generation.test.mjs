import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createComfyChat,parseComfyCommand} from '../qq-bridge-enhanced-v1.0.0/src/comfy-chat.mjs';
import {resolveQqGenerationImage,generateImageFromImage,clearImageInputCache} from '../qq-bridge-enhanced-v1.0.0/src/comfy-img2img.mjs';
import {stageUpscaleInput} from '../qq-bridge-enhanced-v1.0.0/src/comfy-upscale.mjs';
import {buildVideoGraph,VIDEO_INSTALLED} from '../qq-bridge-enhanced-v1.0.0/src/comfy-video.mjs';
const OWNER='1000000001',USER='1000000003',GROUP='10001234',BOT='1000000002';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
async function flush(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));}
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-trimmed-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(t){
 const dir=temp(t),notices=[],runs=[],sends=[];let event=0;
 const cfg={ownerQQ:OWNER,allow:{private:[OWNER,USER],groups:[GROUP]},comfyChat:{enabled:true}};
 const c=createComfyChat({root:path.join(dir,'bridge'),stateDir:dir,cfg,cooldownMs:0,notify:async(key,text)=>notices.push(text),run:async job=>{runs.push(job);return {promptId:job.id};},runUpscale:async job=>{runs.push(job);return {promptId:job.id};},deliver:async r=>{sends.push(r);return {messageId:42};},upscaleReady:async()=>{}});
 t.after(async()=>{c.close();await flush();});
 return {c,notices,runs,sends,message:(text,extra={})=>c.onMessage({kind:'private',id:USER,userId:USER,text,eventId:++event,...extra})};
}
test('已移除的文生视频和修手明确拒绝，不读取图片、不发授权、不占额度',async t=>{
 const f=fixture(t);let reads=0;
 for(const user of [USER,OWNER])for(const text of ['/生成视频 小猫走路','/生成视频 时长=3 小猫','/修手','/修手 高清']){
  assert.equal(parseComfyCommand(text).type,'removed-generation');
  const r=await f.message(text,{id:user,userId:user,resolveGenerationImage:async()=>{reads++;return png;},resolveVideoImage:async()=>{reads++;return png;}});
  assert.equal(r.handled,true);assert.equal(r.ticket,undefined);assert.match(f.notices.at(-1),/移除/);
 }
 await flush();assert.equal(reads,0);assert.equal(f.runs.length,0);assert.equal(f.c.quota(USER).used,0);
});
test('附图或引用图片的生图/tag明确拒绝，取图失败也不回退文生图',async t=>{
 const f=fixture(t);
 for(const text of ['/生图 变换衣服','/tag生图 PST/blue sky NGT/blurry','/生图2 海边']){
  const r=await f.message(text,{id:OWNER,userId:OWNER,resolveGenerationImage:async()=>png});
  assert.equal(r.handled,true);assert.equal(r.ticket,undefined);assert.match(f.notices.at(-1),/图片编辑已.*移除/);
 }
 const r=await f.message('/生图 海边',{resolveGenerationImage:async()=>{throw Error('无法获取参考图');}});assert.equal(r.ticket,undefined);assert.match(f.notices.at(-1),/无法获取/);
 await flush();assert.equal(f.runs.length,0);assert.equal(f.c.quota(USER).used,0);
 const plain=await f.message('/生图 小鲸鱼',{resolveGenerationImage:async()=>null});assert.ok(plain.ticket);assert.match(plain.hint,/官方Anima Base/);assert.doesNotMatch(plain.hint,/Qwen|maskTarget|自动遮罩/);
 assert.throws(()=>f.c.call({ticket:plain.ticket,prompt:'a whale',maskTarget:'hair'}),/参数/);
 f.c.call({ticket:plain.ticket,prompt:'a whale'});await flush();assert.equal(f.runs.length,1);assert.equal(f.sends.length,1);assert.equal(f.c.quota(USER).used,1);
});
test('群生图仍要求真实@，未授权或未开放群不读取附图',async t=>{
 const f=fixture(t);let reads=0;
 for(const extra of [{id:GROUP,explicitAt:false},{id:'99999999',explicitAt:true}])await f.message('/生图 鲸鱼',{kind:'group',...extra,resolveGenerationImage:async()=>{reads++;return png;}});
 assert.equal(reads,0);assert.equal(f.c.quota(USER).used,0);
});
test('保留的QQ图片解析只接受本条或同会话引用，多图及跨会话拒绝',async()=>{
 const image={type:'image',data:{file:'photo.png'}},reply={type:'reply',data:{id:'100'}};
 const base={kind:'group',id:GROUP,selfId:BOT,extract:s=>s.filter(x=>x.type==='image').map(x=>({kind:'image',file:x.data.file})),findMedia:()=>[],getMessage:async()=>({group_id:GROUP,message:[image]}),fetchImage:async()=>({buffer:png})};
 assert.equal(await resolveQqGenerationImage({...base,segments:[]}),null);
 assert.deepEqual(await resolveQqGenerationImage({...base,segments:[image,reply],getMessage:()=>{throw Error('must prefer current');}}),png);
 assert.deepEqual(await resolveQqGenerationImage({...base,segments:[reply]}),png);
 for(const raw of [{group_id:'99999999',message:[image]},{message:[image]},null])await assert.rejects(resolveQqGenerationImage({...base,segments:[reply],getMessage:async()=>raw}),/当前会话/);
 await assert.rejects(resolveQqGenerationImage({...base,kind:'private',id:USER,segments:[reply],getMessage:async()=>({user_id:'99999999',message:[image]})}),/当前会话/);
 await assert.rejects(resolveQqGenerationImage({...base,segments:[image,image]}),/一张/);
 await assert.rejects(resolveQqGenerationImage({...base,segments:[image],fetchImage:async()=>null}),/无法获取/);
});
test('高清仍可附图排队和发送，图片编辑移除不改变高清入口',async t=>{
 const f=fixture(t),r=await f.message('/高清',{resolveUpscaleImage:async()=>png});await flush();
 assert.equal(r.handled,true);assert.equal(f.runs.length,1);assert.equal(f.runs[0].kind,'upscale');assert.equal(f.runs[0].upscale.longEdge,2048);assert.equal(f.sends.length,1);assert.equal(f.c.quota(USER).used,1);
});
test('高清worker仍上传绑定图、保存输出和共享锁，缓存清理保留在用任务',async t=>{
 const dir=temp(t),staged=await stageUpscaleInput(dir,png),id=randomUUID();let graph,uploaded=false;
 const request=async(url,options)=>{
  const route=new URL(url).pathname;
  if(route==='/queue')return Response.json({queue_running:[],queue_pending:[]});
  if(route==='/upload/image'){uploaded=true;assert.equal(options.body.get('subfolder'),'dsh_qq_img2img');return Response.json({name:staged.input,subfolder:'dsh_qq_img2img',type:'input'});}
  if(route==='/prompt'){graph=JSON.parse(options.body).prompt;assert.ok(fs.existsSync(path.join(dir,'images','.generation.lock')));return Response.json({prompt_id:id});}
  if(route==='/history/'+id)return Response.json({[id]:{outputs:{'12':{images:[{filename:'qqbot-upscale_00001_.png',subfolder:'dsh_qq',type:'output'}]}}}});
  if(route==='/view')return new Response(png);throw Error('Unexpected route');
 };
 const result=await generateImageFromImage({kind:'upscale',image:staged,upscale:{longEdge:2048},options:{seed:1}},new AbortController().signal,{workspace:dir,request});
 assert.equal(result.workflow,'qqbot-upscale');assert.equal(result.upscale.longEdge,2048);assert.ok(uploaded);assert.equal(graph['4'].class_type,'DshIllustrationUpscale');assert.ok(fs.existsSync(path.join(dir,'images',id+'.png')));assert.ok(!fs.existsSync(path.join(dir,'images','.generation.lock')));
 await assert.rejects(clearImageInputCache({workspace:dir,request:async()=>Response.json({queue_running:[[0,id]],queue_pending:[]})}),/仍有/);
 const report=await clearImageInputCache({workspace:dir,request:async()=>Response.json({queue_running:[],queue_pending:[]})});assert.equal(report.removed,2);
});
test('共享图片worker拒绝旧编辑任务，图生视频拒绝T2V模式',async()=>{
 let calls=0;await assert.rejects(generateImageFromImage({kind:'img2img'},new AbortController().signal,{request:async()=>{calls++;throw Error('must not call');}}),/仅支持高清/);assert.equal(calls,0);
 if(VIDEO_INSTALLED){const template=JSON.parse(fs.readFileSync(new URL('../extensions/video/video-workflow/qqbot-video.api.json',import.meta.url)));assert.throws(()=>buildVideoGraph(template,{mode:'t2v',prompt:'a cat',params:{seconds:3,fps:16,megapixels:.24}}),/图生视频|模式|i2v/);}else assert.throws(()=>buildVideoGraph({}),/未安装/);
});
