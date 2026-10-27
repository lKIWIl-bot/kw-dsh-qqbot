import {ARCHIVE_PASSWORD} from '../src/comfy-archive.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createComfyChat,parseComfyCommand} from '../src/comfy-chat.mjs';
const admin='1000000001',other='100001',group='10001234',tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comfy-batch-')),notices=[],starts=[],sends=[];let n=0,current,max=0,active=0;
 const cfg={ownerQQ:admin,allow:{private:[admin,other],groups:[group]},comfyChat:{enabled:true}};
 const c=createComfyChat({cfg,root:dir,stateDir:dir,notify:async(key,text,user)=>notices.push({key,text,user}),
  run:(job,signal)=>new Promise((resolve,reject)=>{active++;max=Math.max(max,active);starts.push(job);current={resolve:()=>{active--;resolve({promptId:randomUUID()});},reject:()=>{active--;reject(new Error('render failed'));}};signal.addEventListener('abort',()=>{active--;reject(new Error('cancelled'));},{once:true});}),
  deliver:async(result,key)=>{sends.push({result,key});return result.archive?{uploaded:true,archiveName:'batch.zip'}:{messageId:100};},
 });
 t.after(()=>{c.close();fs.rmSync(dir,{recursive:true,force:true});});
 const message=(user,text,explicitAt=true,kind='private')=>c.onMessage({kind,id:kind==='group'?group:user,userId:user,text,explicitAt,displayName:'猫友',eventId:++n});
 const submit=async(text,user=admin,prompt='a blue whale')=>{const r=await message(user,text);assert.ok(r.ticket);const result=c.call({ticket:r.ticket,prompt,seed:10});await tick();return {r,result};};
 const finish=async()=>{current.resolve();await tick();await tick();};
 return {c,notices,starts,sends,message,submit,finish,max:()=>max,current:()=>current};
}
test('管理员批量数量绑定原始消息，串行生成不同seed，全部完成前不发送',async t=>{
 const f=await fixture(t);const {r,result}=await f.submit('/生图3 蓝色小鲸鱼');
 assert.equal(result.job.count,3);assert.match(r.hint,/绑定生成 3 张/);
 assert.equal(f.c.call({ticket:r.ticket,prompt:'a cat'}).job.id,result.job.id);
 assert.throws(()=>f.c.call({ticket:r.ticket,prompt:'cat',count:10}),/参数/);
 await f.finish();assert.equal(f.sends.length,0);await f.finish();assert.equal(f.sends.length,0);await f.finish();
 assert.equal(f.max(),1);assert.deepEqual(f.starts.map(j=>j.options.seed),[10,11,12]);
 assert.equal(f.sends.length,1);assert.equal(f.sends[0].result.promptIds.length,3);assert.equal(f.sends[0].result.archive,false);assert.equal(f.c.status(admin).state,'sent');
});
test('原始描述成人标记不覆盖最终普通正面提示词',async t=>{
 const f=await fixture(t);await f.submit('/生图 成人内容标记');await f.finish();
 assert.equal(f.sends.length,1);assert.equal(f.sends[0].result.archive,false);assert.equal(f.sends[0].result.promptIds.length,1);assert.equal(f.c.status(admin).state,'sent');
});
test('成人标记整批全部放同一个ZIP，完成通知绑定发起人',async t=>{
 const f=await fixture(t);await f.submit('/生图3 成人内容标记',admin,'nude figure');await f.finish();await f.finish();await f.finish();
 assert.equal(f.sends.length,1);assert.equal(f.sends[0].result.archive,true);assert.equal(f.sends[0].result.promptIds.length,3);assert.ok(f.notices.some(x=>x.user===admin&&x.text===`发送成功，共 3 张。剩余额度：不限。解压密码：${ARCHIVE_PASSWORD}。`));
});
test('模型正向提示词命中也打包；负向提示词不将普通图标为成人',async t=>{
 const f=await fixture(t);const r=await f.message(admin,'/生图 小鲸鱼');f.c.call({ticket:r.ticket,prompt:'nude figure'});await tick();await f.finish();assert.equal(f.sends[0].result.archive,true);
 const second=await f.message(admin,'/生图 小鲸鱼');f.c.call({ticket:second.ticket,prompt:'a blue whale',negative:'nsfw, nudity'});await tick();await f.finish();assert.equal(f.sends[1].result.archive,false);
});
test('普通用户不能批量；张数越界不授权；群内批量也需真实@',async t=>{
 const f=await fixture(t);
 for(const [user,text] of [[other,'/生图2 小猫'],[admin,'/生图0 小猫'],[admin,'/生图11 小猫']]){const r=await f.message(user,text);assert.equal(r.handled,true);assert.ok(!r.ticket);}
 assert.ok(!(await f.message(admin,'/生图2 小猫',false,'group')).ticket);
 assert.ok((await f.message(admin,'/生图2 小猫',true,'group')).ticket);
 assert.equal(parseComfyCommand('/生图3：小猫').count,3);assert.equal(parseComfyCommand('/生图 小猫').count,1);
 assert.equal(f.starts.length,0);
});
test('批量中途取消或生成失败不发送部分图片',async t=>{
 const f=await fixture(t);await f.submit('/生图3 小猫');await f.finish();await f.message(admin,'取消生图');await tick();assert.equal(f.sends.length,0);assert.equal(f.c.status(admin).state,'cancelled');
 await f.submit('/生图2 小猫');f.current().reject();await tick();assert.equal(f.sends.length,0);assert.equal(f.c.status(admin).state,'failed');
});

test('发送成功通知只含张数和当前剩余额度，提及真实请求者，无身份说明',async t=>{
 const f=await fixture(t);await f.submit('/生图 小鲸鱼',other);await f.finish();
 assert.ok(f.notices.some(x=>x.user===other&&x.text==='发送成功，共 1 张。剩余额度：4 张。'));
 await f.submit('/生图 小鲸鱼');await f.finish();
 assert.ok(f.notices.some(x=>x.user===admin&&x.text==='发送成功，共 1 张。剩余额度：不限。'));
 for(const n of f.notices.filter(n=>n.text.startsWith('发送成功')))assert.ok(!/管理员|QQ|ZIP|z删ip/.test(n.text));
});

test('压缩发送才在成功提示追加固定密码；单张批量共用规则',async t=>{
 const f=await fixture(t);await f.submit('/生图 成人内容标记',admin,'nude figure');await f.finish();
 assert.ok(f.notices.some(x=>x.user===admin&&x.text===`发送成功，共 1 张。剩余额度：不限。解压密码：${ARCHIVE_PASSWORD}。`));
 assert.ok(f.notices.filter(x=>x.text.startsWith('发送成功')).every(x=>!x.text.includes('管理员')));
});
