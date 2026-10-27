import {VIDEO_INSTALLED} from '../src/comfy-video.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createComfyChat,parseComfyCommand} from '../src/comfy-chat.mjs';
import {buildAdminHelp} from '../src/admin/owner-commands.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const OWNER='1000000001',USER='100001',GROUP='10001234';
const tick=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t,extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-generation-access-')),notices=[],runs=[];let event=0;
 const cfg={ownerQQ:OWNER,allow:{private:[OWNER,USER],groups:[GROUP]},comfyChat:{enabled:true}};
 const options={root:path.join(dir,'bridge'),stateDir:dir,cfg,cooldownMs:0,
  notify:async(key,text)=>notices.push({key,text}),run:async job=>{runs.push(job);return {promptId:job.id};},deliver:async()=>({messageId:123}),
  upscaleReady:async()=>{},
  stageUpscale:async()=>({input:'11111111-1111-4111-8111-111111111111.png',width:512,height:512}),...extra};
 const c=createComfyChat(options);
 t.after(async()=>{c.close();await tick();fs.rmSync(dir,{recursive:true,force:true});});
 const message=(user,text,details={})=>c.onMessage({kind:'private',id:user,userId:user,text,eventId:++event,...details});
 return {c,dir,cfg,options,notices,runs,message,toggle:enabled=>message(OWNER,enabled?'/开启生图':'/关闭生图')};
}

test('开关精确解析，格式错误不交给模型，管理帮助列出两条指令',()=>{
 assert.deepEqual(parseComfyCommand('/关闭生图'),{type:'generation-access',enabled:false});
 assert.deepEqual(parseComfyCommand('/开启生图'),{type:'generation-access',enabled:true});
 assert.equal(parseComfyCommand('/关闭生图 多余参数').type,'generation-access-syntax');
 assert.equal(parseComfyCommand('请关闭生图'),null);
 assert.match(buildAdminHelp(false),/\/关闭生图/);assert.match(buildAdminHelp(false),/\/开启生图/);
});

test('只认管理员QQ身份，群内必须实际@，群设置同时作用于私聊',async t=>{
 const f=fixture(t);
 await f.message(USER,'/关闭生图',{displayName:'管理员'});
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'comfy-chat.json'))).publicGenerationEnabled,true);
 await f.message(OWNER,'/关闭生图',{kind:'group',id:GROUP,explicitAt:false});
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'comfy-chat.json'))).publicGenerationEnabled,true);
 await f.message(OWNER,'/关闭生图',{kind:'group',id:GROUP,explicitAt:true});
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'comfy-chat.json'))).publicGenerationEnabled,false);
 await f.message(USER,'/开启生图');
 assert.equal((await f.message(USER,'/生图 小猫')).handled,true);
 assert.ok(f.notices.some(n=>n.text.includes('生成功能已关闭')));
});

test('关闭拦截所有Comfy生成入口且不取图/查模型/预占额度，查询取消和聊天仍可用',async t=>{
 const unexpected=()=>{throw Error('disabled request reached an external dependency');};
 const f=fixture(t,{upscaleReady:unexpected});await f.toggle(false);
 const commands=['/生图 小猫','/生图 高清 小猫','/生图 小猫','/生成ds 小鲸鱼','/画图 增强#测试 小猫','/画图 减弱#测试 小猫','/-生图 小猫','/tag生图 PST/cat NGT/blur','/高清','/高清4K','/图生视频 小猫走路'];
 for(const text of commands){
  const before=f.notices.length;
  const result=await f.message(USER,text,{resolveGenerationImage:unexpected,resolveUpscaleImage:unexpected,resolveVideoImage:unexpected});
  assert.equal(result.handled,true,text);assert.ok(!result.ticket,text);assert.match(f.notices[before].text,text.startsWith('/图生视频')&&!VIDEO_INSTALLED?/未安装/:/生成功能已关闭/,text);
 }
 assert.equal(f.c.quota(USER).used,0);assert.equal(f.runs.length,0);
 for(const text of ['/我的额度','/生图状态','/生图队列','/取消生图'])assert.equal((await f.message(USER,text)).handled,true);
 assert.deepEqual(await f.message(USER,'你好'),{});
});

test('管理员可继续生成，普通用户恢复后保留原额度、白名单和视频权限限制',async t=>{
 const f=fixture(t);await f.message(OWNER,'设置生图额度 '+USER+' 7');await f.toggle(false);
 const admin=await f.message(OWNER,'/tag生图 PST/cat NGT/blur');assert.ok(admin.job);await tick();assert.equal(f.runs.length,1);
 await f.toggle(true);const ordinary=await f.message(USER,'/tag生图 PST/cat NGT/blur');assert.ok(ordinary.job);await tick();
 assert.equal(f.c.quota(USER).limit,7);assert.equal(f.c.quota(USER).used,1);assert.deepEqual(f.cfg.allow.private,[OWNER,USER]);
 const video=await f.message(USER,'/图生视频 小猫走路');assert.ok(!video.ticket);assert.match(f.notices.at(-1).text,VIDEO_INSTALLED?/仅管理员/:/未安装/);
});

test('关闭撤销尚未提交的授权，重开后旧授权仍无效，新授权可提交',async t=>{
 const f=fixture(t),old=await f.message(USER,'/生图 小猫');assert.ok(old.ticket);
 await f.toggle(false);assert.throws(()=>f.c.call({ticket:old.ticket,prompt:'cat'}),/授权|关闭/);
 await f.toggle(true);assert.throws(()=>f.c.call({ticket:old.ticket,prompt:'cat'}),/授权/);
 const fresh=await f.message(USER,'/生图 小猫');assert.ok(f.c.call({ticket:fresh.ticket,prompt:'cat'}).ok);await tick();
});

test('开关关闭后，已排队任务仍完成；已绑定任务的旧授权也不能重复调用',async t=>{
 const first=deferred();let count=0;
 const f=fixture(t,{run:async job=>{count++;if(count===1)await first.promise;return {promptId:job.id};}});
 const cap=await f.message(USER,'/生图 小猫');f.c.call({ticket:cap.ticket,prompt:'cat'});await tick();
 await f.message(USER,'/tag生图 PST/dog NGT/blur');await f.toggle(false);
 assert.throws(()=>f.c.call({ticket:cap.ticket,prompt:'cat'}),/生成功能已关闭/);
 first.resolve();await tick();assert.equal(count,2);assert.equal(f.c.status(USER).state,'sent');assert.equal(f.c.quota(USER).used,2);
});

test('取图过程中关闭再开启，也不能为关闭前的普通请求发放新授权',async t=>{
 for(const command of ['/生图 小猫','/tag生图 PST/cat NGT/blur','/高清']){
  const f=fixture(t),entered=deferred(),release=deferred();
  const resolver=async()=>{entered.resolve();await release.promise;return Buffer.from('fixture image');};
  const pending=f.message(USER,command,{resolveGenerationImage:resolver,resolveUpscaleImage:resolver});
  await entered.promise;await f.toggle(false);await f.toggle(true);release.resolve();
  const result=await pending;assert.equal(result.handled,true,command);assert.ok(!result.ticket,command);assert.ok(!result.job,command);
  assert.equal(f.c.quota(USER).used,0);assert.equal(f.runs.length,0);
 }
});

test('关闭状态跨重启保留，旧版缺省状态默认开启',async t=>{
 const f=fixture(t);await f.toggle(false);f.c.close();
 const restarted=createComfyChat(f.options);
 try{const result=await restarted.onMessage({kind:'private',id:USER,userId:USER,text:'/生图 小猫'});assert.equal(result.handled,true);assert.ok(!result.ticket);}finally{restarted.close();}
 const stored=JSON.parse(fs.readFileSync(path.join(f.dir,'comfy-chat.json')));delete stored.publicGenerationEnabled;fs.writeFileSync(path.join(f.dir,'comfy-chat.json'),JSON.stringify(stored));
 const legacy=createComfyChat(f.options);
 try{assert.ok((await legacy.onMessage({kind:'private',id:USER,userId:USER,text:'/生图 小猫'})).ticket);}finally{legacy.close();}
});

test('保存失败不会谎报成功或改变内存开关',async t=>{
 const f=fixture(t),original=fs.renameSync;
 fs.renameSync=function(from,to){if(to===path.join(f.dir,'comfy-chat.json'))throw Object.assign(Error('simulated sharing violation'),{code:'EPERM'});return original.apply(this,arguments);};
 try{await f.toggle(false);}finally{fs.renameSync=original;}
 assert.match(f.notices.at(-1).text,/保存失败/);assert.ok((await f.message(USER,'/生图 小猫')).ticket);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'comfy-chat.json'))).publicGenerationEnabled,true);
});

test('真实消息入口拦截开关和关闭后的生成指令，不送入DSH',async t=>{
 const notices=[];
 const h=await bridgeHarness({config:{ownerQQ:OWNER,admin:{allowL3:false},allow:{private:[OWNER,USER],groups:[GROUP]},comfyChat:{enabled:true},groupReply:{onlyAddressed:true}},globals:{createComfyChat:options=>createComfyChat({...options,notify:async(key,text)=>notices.push({key,text})})}});
 await h.initControllerOnce('chat');h.setMode('chat');h.setBotIdentity('1000000002','鲸鱼');
 t.after(async()=>{h.comfyChat.close();h.ext.controller.stop();await tick();await h.close();});
 let eventId=0;
 const send=(user,text)=>h.handleIncoming('private',user,{self_id:'1000000002',user_id:user,message_id:++eventId,message:[{type:'text',data:{text}}],sender:{nickname:'测试成员'}},h.cfg);
 await send(OWNER,'/关闭生图');await send(USER,'/生图 小猫');
 assert.equal(JSON.parse(fs.readFileSync(path.join(h.temp,'state/comfy-chat.json'))).publicGenerationEnabled,false);
 assert.ok(notices.some(s=>String(s.text).includes('生成功能已关闭')));assert.equal(h.calls.prompts.length,0);
 await send(OWNER,'/开启生图');assert.equal(JSON.parse(fs.readFileSync(path.join(h.temp,'state/comfy-chat.json'))).publicGenerationEnabled,true);
});
