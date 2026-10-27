import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createComfyChat,parseComfyCommand} from '../src/comfy-chat.mjs';
import {parseOwnerCommand} from '../src/admin/owner-commands.js';
const tick=()=>new Promise(r=>setImmediate(r));
const OWNER='1000000001',A='100001',B='100002',GROUP='10001234';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comfy-chat-test-'));let clock=1000000000,event=0,active=0,maxActive=0;
 const notices=[],starts=[],sends=[],waiters=new Map(),timers=new Set();
 const cfg={ownerQQ:OWNER,comfyChat:{enabled:true,defaultHourlyLimit:5},allow:{private:[OWNER,A,B],groups:[GROUP,'10005678']}};
 const c=createComfyChat({cfg,root:dir,stateDir:dir,now:()=>clock,
  notify:async(key,text,mention)=>notices.push({key,text,mention}),
  run:(job,signal)=>new Promise((resolve,reject)=>{active++;maxActive=Math.max(active,maxActive);starts.push(job);waiters.set(job.id,{resolve:()=>{active--;resolve({promptId:job.id});},reject:()=>{active--;reject(new Error('fake failure'));}});signal.addEventListener('abort',()=>{if(waiters.has(job.id)){active--;waiters.delete(job.id);reject(new Error('cancelled'));}},{once:true});}),
  deliver:async(result,key)=>{sends.push({id:result.promptId,key});return {messageId:100+sends.length};},
  schedule:(fn,ms)=>{const timer={fn,at:clock+ms};timers.add(timer);return timer;},unschedule:timer=>timers.delete(timer),
 });
 t.after(async()=>{c.close();await tick();fs.rmSync(dir,{recursive:true,force:true});});
 async function message(user,text,name='昵称'+user,key='group:'+GROUP,extra={}){const [kind,id]=key.split(':');return c.onMessage({kind,id,userId:user,text,displayName:name,eventId:++event,explicitAt:true,...extra});}
 async function submit(user,name='昵称'+user,key='group:'+GROUP,extra={}){const r=await message(user,'/生图 一只蓝色小鲸鱼',name,key);assert.ok(r.ticket);return c.call({ticket:r.ticket,prompt:'a small blue whale',...extra});}
 async function finish(){const j=starts.at(-1);const w=waiters.get(j.id);waiters.delete(j.id);w.resolve();await tick();await tick();}
 async function advance(ms){clock+=ms;for(const timer of [...timers])if(timer.at<=clock){timers.delete(timer);timer.fn();}await tick();}
 return {c,cfg,dir,notices,starts,sends,waiters,message,submit,finish,advance,max:()=>maxActive};
}
test('普通任务串行且输出后等60秒，管理员插队并跳过间隔；群内完成通知绑定实际发起人',async t=>{
 const f=await fixture(t);const a=await f.submit(A,'小明');await tick();const b=await f.submit(B,'小红');const admin=await f.submit(OWNER,'群主');await tick();assert.equal(f.starts.length,1);
 await f.finish();assert.equal(f.starts[1].id,admin.job.id);assert.equal(f.starts[1].user,OWNER);
 await f.finish();assert.equal(f.starts.length,2);await f.advance(59999);assert.equal(f.starts.length,2);await f.advance(1);assert.equal(f.starts[2].id,b.job.id);await f.finish();
 assert.equal(f.max(),1);assert.deepEqual(f.sends.map(x=>x.id),[a.job.id,admin.job.id,b.job.id]);
 assert.ok(f.notices.some(n=>n.mention===A));assert.ok(f.notices.some(n=>n.mention===B));
 const queue=f.notices.find(n=>n.text.includes('小红')&&n.text.includes('已排队')).text;assert.match(queue,/1 分钟/);assert.ok(!queue.includes(A)&&!queue.includes(B));
});
test('跨群私聊共用5张额度，预占挡并发超额，同一消息重复提交幂等',async t=>{
 const f=await fixture(t);const ticket=(await f.message(A,'/生图 小猫','猫友')).ticket;
 const first=f.c.call({ticket,prompt:'a cat'});const again=f.c.call({ticket,prompt:'another cat'});assert.equal(again.job.id,first.job.id);assert.equal(f.c.quota(A).used,1);
 for(let i=0;i<4;i++)await f.submit(A,'猫友',i%2?'private:'+A:'group:10005678');
 assert.equal(f.c.quota(A).remaining,0);const r=await f.message(A,'/生图 小狗','猫友');assert.equal(r.handled,true);assert.ok(!r.ticket);assert.equal(f.c.quota(A).used,5);
});
test('额度只能管理员私聊修改，冒用群昵称无效；管理员不限额，0额度停用',async t=>{
 const f=await fixture(t);await f.message(A,'设置默认生图额度 99','管理员');assert.equal(f.c.quota(B).limit,5);
 await f.message(OWNER,'设置默认生图额度 8','群主');assert.equal(f.c.quota(B).limit,5);
 await f.message(OWNER,'设置默认生图额度 8','群主','private:'+OWNER);assert.equal(f.c.quota(B).limit,8);
 await f.message(OWNER,'设置生图额度 '+A+' 0','群主','private:'+OWNER);assert.equal(f.c.quota(A).remaining,0);assert.equal(f.c.quota(OWNER).limit,null);
 await f.message(OWNER,'恢复默认生图额度 '+A,'群主','private:'+OWNER);assert.equal(f.c.quota(A).limit,8);
});
test('失败及取消退还额度，成功记录跨重启保留且滚动60分钟到期',async t=>{
 const f=await fixture(t);await f.submit(A);await tick();const job=f.starts[0];const w=f.waiters.get(job.id);f.waiters.delete(job.id);w.reject();await tick();assert.equal(f.c.quota(A).used,0);
 const b=await f.submit(A);await tick();await f.message(A,'取消生图 '+b.job.id);await tick();assert.equal(f.c.quota(A).used,0);assert.equal(f.sends.length,0);
 await f.submit(A);await tick();await f.finish();assert.equal(f.c.quota(A).used,1);
 const persisted=JSON.parse(fs.readFileSync(path.join(f.dir,'comfy-chat.json')));assert.equal(persisted.usage.length,1);assert.equal(persisted.usage[0].state,'used');
 const restarted=createComfyChat({cfg:f.cfg,root:f.dir,stateDir:f.dir,notify:async()=>{},now:()=>1000000000});assert.equal(restarted.quota(A).used,1);restarted.close();
 await f.advance(3600000);assert.equal(f.c.quota(A).used,0);
});
test('授权不可伪造或选择目标/工作流；移除白名单后旧授权失效',async t=>{
 const f=await fixture(t);assert.throws(()=>f.c.call({ticket:'a'.repeat(48),prompt:'cat'}),/授权/);
 const r=await f.message(A,'/生图 小猫');assert.throws(()=>f.c.call({ticket:r.ticket,prompt:'cat',target:'group:99999'}),/参数/);
 assert.throws(()=>f.c.call({ticket:r.ticket,prompt:'cat',workflowPath:'C:/Windows'}),/参数/);
 assert.throws(()=>f.c.call({ticket:r.ticket,prompt:'cat',width:1536,height:1536}),/尺寸/);
 f.cfg.allow.groups=[];assert.throws(()=>f.c.call({ticket:r.ticket,prompt:'cat'}),/授权/);
});
test('队列名单用群昵称，同一队列不泄露其他群的昵称；不能取消他人任务',async t=>{
 const f=await fixture(t);const a=await f.submit(A,'秘密群昵称','group:10005678');await tick();const b=await f.submit(B,'本群昵称');assert.ok(b.queue.includes('其他会话任务'));assert.ok(!b.queue.includes('秘密群昵称'));
 await f.message(B,'取消生图 '+a.job.id,'本群昵称');assert.equal(f.c.status(A).state,'generating');assert.equal(f.c.quota(A).used,1);
});
test('普通任务冷却期中新到管理员可以立即开始',async t=>{
 const f=await fixture(t);await f.submit(A);await tick();await f.finish();await f.submit(B);await tick();assert.equal(f.starts.length,1);
 await f.submit(OWNER);await tick();assert.equal(f.starts.length,2);assert.equal(f.starts[1].user,OWNER);await f.finish();
});
test('中文模式别名保留原确认流程，普通中文聊天不误触发',()=>{
 assert.deepEqual(parseOwnerCommand('远程模式'),{type:'mode',mode:'closed-agent',level:'L2',natural:true});
 assert.equal(parseOwnerCommand('聊天模式').mode,'chat');assert.equal(parseOwnerCommand('退出远程').mode,null);assert.equal(parseOwnerCommand('退出远程').level,'L0');
 assert.equal(parseOwnerCommand('查看模式').type,'status');assert.equal(parseComfyCommand('你支持生图吗'),null);
 assert.equal(parseComfyCommand('/生图：一只猫').type,'request');assert.equal(parseComfyCommand('我的额度').type,'quota');
 assert.equal(parseComfyCommand('生图 一只猫'),null);assert.equal(parseComfyCommand('请帮我画一只猫'),null);assert.equal(parseComfyCommand('/生图').type,'help');
});

test('群内生图必须实际@；昵称触发聊天不授予生图权限，私聊不需要@',async t=>{
 const f=await fixture(t);
 for(const text of ['/生图 小猫','/生图']){
  const r=await f.message(A,text,'猫友','group:'+GROUP,{explicitAt:false});
  assert.equal(r.handled,true);assert.ok(!r.ticket);
 }
 assert.equal(f.notices.length,2);assert.ok(f.notices.every(n=>n.text.includes('QQ 的@列表')));assert.equal(f.starts.length,0);assert.equal(f.c.quota(A).used,0);
 const denied=await f.c.onMessage({kind:'group',id:GROUP,userId:A,text:'/生图 小猫',eventId:900});
 assert.equal(denied.handled,true);assert.ok(!denied.ticket);
 assert.ok((await f.message(A,'/生图 小猫')).ticket);
 assert.ok((await f.message(A,'/生图 小猫','猫友','private:'+A,{explicitAt:false})).ticket);
});
