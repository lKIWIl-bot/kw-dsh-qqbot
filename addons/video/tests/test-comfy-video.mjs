import * as hdDelivery from '../../../qq-bridge-enhanced-v1.0.0/src/hd-delivery.mjs';
import {mediaSendTimeoutMs} from '../../../qq-bridge-enhanced-v1.0.0/src/comfy-delivery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createComfyChat,parseComfyCommand} from '../../../qq-bridge-enhanced-v1.0.0/src/comfy-chat.mjs';
import {parseVideoCommand,validateVideoParams,resolveQqVideoImage,generateVideo} from '../../../qq-bridge-enhanced-v1.0.0/src/comfy-video.mjs';
import {videoZip,ARCHIVE_PASSWORD} from '../../../qq-bridge-enhanced-v1.0.0/src/comfy-archive.mjs';
import {bridgeHarness} from '../../../qq-bridge-enhanced-v1.0.0/scripts/audit-bridge-harness.mjs';
import {clearComfyCache,clearVideoCache} from '../../../qq-bridge-enhanced-v1.0.0/src/comfy-cache.mjs';
const OWNER='1000000001',USER='100001',GROUP='10001234',BOT='1000000002';
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const mp4=Buffer.from('0000ftypisom');
const tick=()=>new Promise(r=>setImmediate(r));
async function flush(){for(let i=0;i<8;i++)await tick();}
function fixture(t,{hold=false,rating='safe'}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qq-video-')),root=path.join(temp,'repo');fs.mkdirSync(root);
 const runs=[],sends=[],notices=[];let inputs=0,event=0,release;
 const run=async(job,signal)=>{runs.push(job);if(hold)await new Promise((r,j)=>{release=r;signal.addEventListener('abort',()=>j(Error('cancelled')),{once:true});});return {promptId:job.id,workflow:job.kind==='video'?'qqbot-video':'qqbot',seed:job.options.seed};};
 const c=createComfyChat({root,stateDir:path.join(root,'state'),cfg:{ownerQQ:OWNER,allow:{private:[OWNER,USER],groups:[GROUP]},comfyChat:{enabled:true,semanticRouting:true}},cooldownMs:0,
 notify:async(key,text,user)=>notices.push({key,text,user}),assess:async()=>rating,
 stageVideo:async()=>({input:randomUUID()+'.png'}),run,runVideo:run,
 deliver:async(r,key)=>{sends.push({r,key});return {messageId:1};},deliverVideo:async(r,key)=>{sends.push({r,key});return r.archive?{uploaded:true}:{messageId:2};}});
 t.after(async()=>{c.close();await flush();fs.rmSync(temp,{recursive:true,force:true});});
 const message=(text='/图生视频 风吹树林，镜头缓慢前推',extra={})=>c.onMessage({kind:'private',id:OWNER,userId:OWNER,text,eventId:++event,displayName:'鲸鱼',resolveVideoImage:async()=>{inputs++;return png;},...extra});
 return {c,runs,sends,notices,message,release:()=>release?.(),inputs:()=>inputs};
}
test('视频参数与边界：默认3秒，允许10秒，4n+1帧，拒绝越界重复及未知参数',()=>{
 assert.deepEqual(parseVideoCommand('/图生视频 山间云雾').params,{seconds:3,fps:16,megapixels:.24});
 const p=parseComfyCommand('/图生视频 时长=10 帧率=24 像素=0.35 种子=721 白云缓慢移动');assert.equal(p.type,'video-request');assert.equal(p.params.seed,721);assert.equal(validateVideoParams(p.params),241);
 for(const s of ['时长=11','时长=0','帧率=25','帧率=8.5','像素=0.5','种子=-1','foo=5','时长=2 时长=3'])assert.equal(parseVideoCommand('/图生视频 '+s+' 风吹树林').type,'video-syntax',s);
 assert.equal(parseVideoCommand('/图生视频').type,'video-syntax');
});
test('普通用户与昵称触发在获取图片和DSH前拒绝；无白名单不处理',async t=>{
 const f=fixture(t);await f.message(undefined,{id:USER,userId:USER,displayName:'管理员'});
 await f.message(undefined,{kind:'group',id:GROUP,explicitAt:false});await f.message(undefined,{kind:'group',id:'99999999',explicitAt:true});
 assert.equal(f.inputs(),0);assert.equal(f.runs.length,0);assert.equal(f.c.quota(USER).remaining,5);
});
test('管理员ticket绑定起始图和参数，重复调用不重复提交，DSH仅提供正负面提示词',async t=>{
 const f=fixture(t),r=await f.message('/图生视频 时长=10 帧率=12 像素=0.12 种子=88 树叶飘动',{kind:'group',id:GROUP,explicitAt:true,eventId:100});
 assert.match(r.hint,/qq_comfy_generate/);assert.match(r.hint,/qqbot-video/);
 assert.throws(()=>f.c.call({ticket:r.ticket,prompt:'leaves move',width:1024}),/绑定/);
 const job=f.c.call({ticket:r.ticket,prompt:'leaves move',negative:'flicker'});assert.equal(f.c.call({ticket:r.ticket,prompt:'other'}).duplicate,true);await flush();
 assert.equal(f.runs.length,1);assert.equal(f.runs[0].video.params.seconds,10);assert.equal(f.runs[0].video.params.seed,88);assert.equal(f.runs[0].options.prompt,'leaves move');assert.equal(f.sends[0].key,'group:'+GROUP);
 assert.equal((await f.message(undefined,{eventId:100,kind:'group',id:GROUP,explicitAt:true})).job.id,job.job.id);
 assert.ok(f.notices.some(n=>n.user===OWNER&&n.text==='发送成功，共 1 段视频。'));
});
for(const rating of ['sensitive','unknown'])test('视频忽略旧语义结果 '+rating+'，普通正面词不压缩',async t=>{
 const f=fixture(t,{rating}),r=await f.message();f.c.call({ticket:r.ticket,prompt:'leaves move'});await flush();assert.equal(f.sends[0].r.archive,false);assert.ok(f.notices.some(n=>n.text==='发送成功，共 1 段视频。'));
});
test('图像与视频共用一个串行队列，取消阻止视频发送',async t=>{
 const f=fixture(t,{hold:true}),r=await f.message();f.c.call({ticket:r.ticket,prompt:'leaves move'});await flush();
 await f.message('/tag生图 PST/whale NGT/blurry');await flush();assert.equal(f.runs.length,1);
 await f.message('/取消视频');await flush();assert.equal(f.sends.length,0);assert.equal(f.runs.length,2);assert.equal(f.runs[1].kind,undefined);
 f.release();await flush();assert.equal(f.sends.length,1);
});
test('撤销目标后ticket不可生成，图片缺失不交给DSH',async t=>{
 const f=fixture(t);const missing=await f.message(undefined,{resolveVideoImage:async()=>null});assert.equal(missing.handled,true);
 const r=await f.message();f.c.revoke('private:'+OWNER);assert.throws(()=>f.c.call({ticket:r.ticket,prompt:'leaves move'}),/授权/);assert.equal(f.runs.length,0);
});
test('视频缓存只删本机器人文件，并在共享锁内清理；Comfy遗留任务存在时不删文件',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'video-cache-')),workspace=path.join(temp,'qq-workspace');
 const videos=path.join(workspace,'videos'),images=path.join(workspace,'images'),outputDirectory=path.join(temp,'output','dsh_qq'),outputVideo=path.join(temp,'output','dsh_qq_video'),inputDirectory=path.join(temp,'input','dsh_qq_video');
 for(const p of [videos,images,outputDirectory,outputVideo,inputDirectory])fs.mkdirSync(p,{recursive:true});
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const id=randomUUID(),input=randomUUID()+'.png';
 fs.writeFileSync(path.join(videos,id+'.json'),JSON.stringify({promptId:id,input}));fs.writeFileSync(path.join(videos,id+'.mp4'),mp4);fs.writeFileSync(path.join(videos,input),png);fs.writeFileSync(path.join(videos,'keep.txt'),'keep');
 fs.writeFileSync(path.join(outputVideo,'qqbot-video_00001_.mp4'),mp4);fs.writeFileSync(path.join(outputVideo,'unrelated.mp4'),mp4);fs.writeFileSync(path.join(inputDirectory,input),png);fs.writeFileSync(path.join(inputDirectory,'original.png'),png);
 const busy=async()=>Response.json({queue_running:[[1,id]],queue_pending:[]});
 await assert.rejects(clearVideoCache({workspace,outputDirectory,inputDirectory,request:busy}),/仍有/);assert.ok(fs.existsSync(path.join(videos,id+'.mp4')));
 const result=await clearComfyCache({workspace,outputDirectory,request:async()=>({queue_running:[],queue_pending:[]}),extraCleanup:()=>{
  assert.ok(fs.existsSync(path.join(images,'.generation.lock')));
  return clearVideoCache({workspace,outputDirectory,inputDirectory,request:async()=>Response.json({queue_running:[],queue_pending:[]})});
 }});
 assert.equal(result.removed,5);assert.ok(fs.existsSync(path.join(videos,'keep.txt')));assert.ok(fs.existsSync(path.join(outputVideo,'unrelated.mp4')));assert.ok(fs.existsSync(path.join(inputDirectory,'original.png')));assert.equal(fs.existsSync(path.join(images,'.generation.lock')),false);
});
test('附图优先、同会话引用可用，跨群/跨私聊/多图/无图拒绝',async()=>{
 const image={type:'image',data:{file:'safe.png'}},reply={type:'reply',data:{id:'100'}};
 const defaults={kind:'group',id:GROUP,selfId:BOT,extract:segments=>segments.filter(s=>s.type==='image').map(s=>({kind:'image',file:s.data.file})),findMedia:()=>[],fetchImage:async()=>({buffer:png}),getMessage:async()=>({group_id:GROUP,message:[image]})};
 assert.deepEqual(await resolveQqVideoImage({...defaults,segments:[image]}),png);assert.deepEqual(await resolveQqVideoImage({...defaults,segments:[reply]}),png);
 await assert.rejects(resolveQqVideoImage({...defaults,segments:[reply],getMessage:async()=>({group_id:'99999',message:[image]})}),/当前会话/);
 await assert.rejects(resolveQqVideoImage({...defaults,kind:'private',id:OWNER,segments:[reply],getMessage:async()=>({user_id:USER,message:[image]})}),/当前会话/);
 for(const segments of [[],[image,image]])await assert.rejects(resolveQqVideoImage({...defaults,segments}));
});
test('视频worker上传绑定图、固定工作流、读取本次history并保存MP4，不发送QQ',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'video-worker-')),workspace=path.join(temp,'qq-workspace');
 fs.mkdirSync(path.join(workspace,'videos'),{recursive:true});
 const source=randomUUID()+'.png',id=randomUUID();fs.writeFileSync(path.join(workspace,'videos',source),png);
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));let graph,queued;
 const request=async(url,options)=>{
  const route=new URL(url).pathname;
  if(route==='/upload/image')return Response.json({name:source,subfolder:'dsh_qq_video',type:'input'});
  if(route==='/prompt'){graph=JSON.parse(options.body).prompt;return Response.json({prompt_id:id});}
  if(route==='/history/'+id)return Response.json({[id]:{outputs:{'17':{images:[{filename:'qqbot-video_00001_.mp4',subfolder:'dsh_qq_video',type:'output'}]}}}});
  if(route==='/view')return new Response(mp4);throw Error('unexpected '+url);
 };
 const r=await generateVideo({video:{input:source,params:{seconds:10,fps:24,megapixels:.12,seed:7}},options:{prompt:'leaves move',seed:8}},new AbortController().signal,{workspace,request,onQueued:id=>queued=id});
 assert.equal(r.promptId,id);assert.equal(queued,id);assert.equal(graph['12'].inputs.length,241);assert.equal(graph['13'].inputs.noise_seed,7);assert.equal(graph['11'].inputs.image,'dsh_qq_video/'+source);assert.deepEqual(fs.readFileSync(path.join(workspace,'videos',id+'.mp4')),mp4);assert.equal(fs.existsSync(path.join(workspace,'images','.generation.lock')),false);
});
test('视频发送：压缩只上传.z删ip，普通视频走video段；失败无自动重发',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'video-send-')),root=path.join(temp,'qq-workspace'),calls=[];
 fs.mkdirSync(path.join(root,'videos'),{recursive:true});fs.mkdirSync(path.join(temp,'qq-bridge-enhanced-v1.0.0'));fs.writeFileSync(path.join(temp,'qq-bridge-enhanced-v1.0.0','config.json'),JSON.stringify({allow:{groups:[GROUP]}}));
 const id=randomUUID();fs.writeFileSync(path.join(root,'videos',id+'.mp4'),mp4);t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const source=fs.readFileSync(new URL('../../../qq-workspace/comfy-qq.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function deliveryTarget(key)')).replace(/^export /gm,'');
 let fail=false;const context=vm.createContext({...hdDelivery,fs:fsp,readFileSync:fs.readFileSync,path,pathToFileURL,ROOT:root,Buffer,mediaSendTimeoutMs,randomUUID,videoZip,ARCHIVE_PASSWORD,onebot:async()=>({rpc:async(action,params)=>{calls.push({action,params});if(fail)throw Error('upload failed');return {message_id:1};},close:()=>{}})});
 vm.runInContext(code+'\nglobalThis.deliver=deliverGeneratedVideo;',context);
 const r=await context.deliver(id,'group:'+GROUP,{archive:true});assert.match(r.archiveName,/^[a-f0-9]{10}\.z删ip$/);assert.equal(r.archiveName.length,15);assert.equal(calls[0].action,'upload_group_file');const zip=fs.readFileSync(calls[0].params.file);assert.equal(zip.readUInt16LE(6)&1,1);assert.ok(zip.includes(Buffer.from('video-01.mp4')));
 await context.deliver(id,'group:'+GROUP);assert.equal(calls[1].params.message[0].type,'video');assert.match(calls[1].params.message[0].data.file,/^file:\/\//);
 fail=true;await assert.rejects(context.deliver(id,'group:'+GROUP,{archive:true}),/upload failed/);assert.equal(calls.length,3);
 await assert.rejects(context.deliver(id,'group:9999999'),/allowlisted/);assert.equal(calls.length,3);
});
test('真实桥接入口：仅管理员真实@可解析附图，普通用户不触发模型',async t=>{
 const observed=[],instances=[];
 const h=await bridgeHarness({config:{ownerQQ:OWNER,allow:{private:[OWNER,USER],groups:[GROUP]},groupReply:{onlyAddressed:true},comfyChat:{enabled:true}},globals:{createComfyChat:options=>{
  const c=createComfyChat({...options,notify:async()=>{},stageVideo:async()=>({input:randomUUID()+'.png'})});instances.push(c);
  return {...c,onMessage:async input=>{const r=await c.onMessage(input);observed.push({input,r});return r.ticket?{handled:true}:r;}};
 },resolveQqVideoImage:async args=>{assert.equal(args.kind,'group');return png;}}});
 t.after(async()=>{instances.forEach(c=>c.close());await flush();h.ext.controller.stop();await h.close();});
 await h.initControllerOnce('chat');h.setMode('chat');h.setBotIdentity(BOT,'鲸鱼');
 const incoming=async(user,message,n)=>h.handleIncoming('group',GROUP,{self_id:BOT,user_id:user,message_id:n,message,sender:{card:'测试'}},h.cfg);
 const at={type:'at',data:{qq:BOT}},text={type:'text',data:{text:' /图生视频 风吹树林'}};
 await incoming(USER,[at,text],1);assert.equal(observed.at(-1).r.ticket,undefined);
 await incoming(OWNER,[{type:'text',data:{text:'鲸鱼，/图生视频 风吹树林'}}],2);assert.equal(observed.at(-1).r.ticket,undefined);
 await incoming(OWNER,[at,text,{type:'image',data:{file:'test.png'}}],3);assert.ok(observed.at(-1).r.ticket);assert.equal(h.calls.prompts.length,0);
});
