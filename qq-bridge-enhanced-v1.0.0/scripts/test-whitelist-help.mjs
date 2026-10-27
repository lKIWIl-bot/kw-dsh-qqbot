import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseOwnerCommand} from '../src/admin/owner-commands.js';
import {planWhitelistCommand} from '../src/admin/whitelist.mjs';
import {USER_HELP} from '../src/chat-help.mjs';
import {createComfyChat,parseComfyCommand} from '../src/comfy-chat.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const admin='1000000001',user='100001',group='10001234',target='100002',bot='1000000002',tick=()=>new Promise(r=>setImmediate(r));
async function harness(t){
 const h=await bridgeHarness({config:{admin:{allowL3:false},ownerQQ:admin,allow:{private:[admin,user],groups:[group]},groupReply:{onlyAddressed:true}}});
 await h.initControllerOnce('chat');h.setMode('chat');h.setBotIdentity(bot,'鲸鱼');
 t.after(async()=>{h.ext.controller.stop();await h.close();});return h;
}
const event=(who,text,kind='private')=>({self_id:bot,user_id:who,message_id:Math.floor(Math.random()*1e8),message:kind==='group'?[{type:'at',data:{qq:bot}},{type:'text',data:{text:' '+text}}]:[{type:'text',data:{text}}],sender:{nickname:'测试成员'}});
test('白名单斜杠指令解析与格式拒绝；/help区分普通和管理员列表',()=>{
 assert.deepEqual(parseOwnerCommand('/添加用户 '+target),{type:'whitelist',action:'add',kind:'private',id:target});
 assert.equal(parseOwnerCommand('/白名单 移除 群 '+group).kind,'groups');assert.equal(parseOwnerCommand('/白名单').action,'list');
 for(const text of ['/添加用户 abc','/添加群 0','/白名单 添加 群 10001234 extra'])assert.equal(parseOwnerCommand(text).type,'error');
 assert.equal(parseOwnerCommand('/help 管理').type,'help');assert.equal(parseOwnerCommand('/help'),null);assert.equal(parseComfyCommand('/help').type,'public-help');
 assert.equal(parseComfyCommand('/生图队列').type,'status');assert.equal(parseComfyCommand('/我的额度').type,'quota');
 for(const hidden of ['/添加用户','/移除群','/level','/生图n'])assert.ok(!USER_HELP.includes(hidden));
});
test('白名单计划保留所有其他配置、幂等，拒绝覆盖黑名单或开放所有模式',()=>{
 const file={allow:{private:[admin],groups:[]},deny:{groups:['10005678']},dsh:{reasoningEffort:'off'},ownerQQ:admin,other:{untouched:true}};
 const add=planWhitelistCommand(file,parseOwnerCommand('/添加群 '+group));assert.deepEqual(add.file.dsh,file.dsh);assert.deepEqual(add.file.other,file.other);assert.equal(file.allow.groups.length,0);
 assert.equal(planWhitelistCommand(add.file,parseOwnerCommand('/添加群 '+group)).changed,false);
 assert.equal(planWhitelistCommand(add.file,parseOwnerCommand('/移除群 '+group)).removedKey,'group:'+group);
 assert.throws(()=>planWhitelistCommand(file,parseOwnerCommand('/添加群 10005678')),/黑名单/);
 assert.throws(()=>planWhitelistCommand({...file,allowAllWhenEmpty:true},parseOwnerCommand('/添加用户 '+target)),/放行所有/);
});
test('真实owner私聊更新并落盘；非owner和群聊不能修改；命令不投递模型',async t=>{
 const h=await harness(t),send=(who,text,kind='private')=>h.handleIncoming(kind,kind==='group'?group:who,event(who,text,kind),h.cfg);
 await send(user,'/添加用户 '+target);assert.ok(!h.cfg.allow.private.includes(target));
 await send(admin,'/添加群 10005678','group');assert.ok(!h.cfg.allow.groups.includes('10005678'));
 await send(admin,'/添加用户 '+target);assert.ok(h.cfg.allow.private.includes(target));assert.ok(JSON.parse(fs.readFileSync(path.join(h.temp,'config.json'))).allow.private.includes(target));
 await send(admin,'/添加群 10005678');assert.ok(h.cfg.allow.groups.includes('10005678'));
 await send(admin,'/移除群 10005678');assert.ok(!h.cfg.allow.groups.includes('10005678'));
 await send(admin,'/移除用户 '+target);assert.ok(!h.cfg.allow.private.includes(target));assert.equal(h.calls.prompts.length,0);
 await send(admin,'/白名单');assert.ok(h.calls.sent.some(s=>String(s.text).includes('聊天白名单')));
});
test('移除会话后撤销映射和旧会话；重新添加需重建，不能复用旧会话',async t=>{
 const h=await harness(t);const key='private:'+user,old=await h.ensureSession(key);
 await h.handleIncoming('private',admin,event(admin,'/移除用户 '+user),h.cfg);assert.equal(h.state.sessions[key],undefined);assert.equal(h.modeAllowed(key,'private',Number(user),h.cfg,'chat'),false);await tick();
 await h.handleIncoming('private',admin,event(admin,'/添加用户 '+user),h.cfg);const next=await h.ensureSession(key);assert.notEqual(next,old);
 const file=path.join(h.temp,'config.json'),saved=JSON.parse(fs.readFileSync(file));saved.allow.private=saved.allow.private.filter(id=>id!==user);fs.writeFileSync(file,JSON.stringify(saved));
 await h.handleIncoming('private',admin,event(admin,'/移除用户 '+user),h.cfg);assert.equal(h.state.sessions[key],undefined);assert.ok(!h.cfg.allow.private.includes(user));
});
test('真实入口/help无需Comfy或模型，非owner拿不到管理列表，owner私聊可查看',async t=>{
 const h=await harness(t);
 await h.handleIncoming('private',user,event(user,'/help'),h.cfg);assert.ok(h.calls.sent.some(s=>String(s.id)===user&&String(s.text).includes('普通用户指令')));
 h.calls.sent.length=0;await h.handleIncoming('group',group,event(user,'/help','group'),h.cfg);assert.ok(h.calls.sent.some(s=>s.kind==='group'&&String(s.text).includes('普通用户指令')));
 h.calls.sent.length=0;await h.handleIncoming('private',user,event(user,'/help 管理'),h.cfg);assert.ok(!h.calls.sent.some(s=>String(s.text).includes('/添加用户')));
 await h.handleIncoming('private',admin,event(admin,'/help 管理'),h.cfg);assert.ok(h.calls.sent.some(s=>String(s.id)===admin&&String(s.text).includes('/添加用户')));assert.ok(!h.calls.sent.some(s=>String(s.text).includes('/level L1|L2|L3')));assert.equal(h.calls.prompts.length,0);
});
test('移除白名单同时撤销生图授权、取消生成和排队任务，退还额度，重新添加旧ticket仍不可用',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comfy-revoke-')),cfg={ownerQQ:admin,allow:{private:[user],groups:[]},comfyChat:{enabled:true}};
 let stopped=false;
 const c=createComfyChat({cfg,root:dir,stateDir:dir,notify:async()=>{},run:(j,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{stopped=true;reject(new Error('cancelled'));},{once:true})),deliver:async()=>{throw new Error('must not send');}});
 t.after(async()=>{c.close();await tick();fs.rmSync(dir,{recursive:true,force:true});});
 const r=await c.onMessage({kind:'private',id:user,userId:user,text:'/生图 小鲸鱼',eventId:1});c.call({ticket:r.ticket,prompt:'a whale'});await tick();
 const second=await c.onMessage({kind:'private',id:user,userId:user,text:'/生图 小鲸鱼',eventId:2});c.call({ticket:second.ticket,prompt:'another whale'});assert.equal(c.quota(user).used,2);
 cfg.allow.private=[];c.revoke('private:'+user);await tick();assert.equal(stopped,true);assert.equal(c.quota(user).used,0);assert.equal(c.status(user).state,'cancelled');
 cfg.allow.private=[user];assert.throws(()=>c.call({ticket:r.ticket,prompt:'a whale'}),/授权/);
});
