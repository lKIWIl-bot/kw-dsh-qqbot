import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const OWNER='1000000001',USER='100001',GROUP='10001234',OTHER='10005678',BOT='1000000002';
const text=value=>({type:'text',data:{text:value}}),at={type:'at',data:{qq:BOT}};
async function fixture(t){
 const h=await bridgeHarness({config:{ownerQQ:OWNER,admin:{allowL3:false},allow:{private:[OWNER,USER],groups:[GROUP,OTHER]},groupReply:{onlyAddressed:true}}});
 await h.initControllerOnce('chat');h.setMode('chat');h.setBotIdentity(BOT,'鲸鱼');
 t.after(async()=>{h.ext.controller.stop();await h.close();});
 h.incoming=(message,who=OWNER,kind='group',id=GROUP)=>h.handleIncoming(kind,id,{self_id:BOT,user_id:who,message_id:Math.random()*1e8,message,sender:{card:'管理员'}},h.cfg);
 return h;
}
for(const [name,message]of [
 ['真实@后的/reset',[at,text(' /reset ')]],
 ['昵称前缀的/reset',[text('鲸鱼，/reset')]],
 ['真实@后的/new别名',[at,text(' /new')]],
])test(name+'由管理员重置当前群，停止并归档旧会话，下一次新建，其他群保持',async t=>{
 const h=await fixture(t),key='group:'+GROUP,otherKey='group:'+OTHER;
 const old=await h.ensureSession(key),other=await h.ensureSession(otherKey);
 await h.incoming(message);assert.equal(h.state.sessions[key],undefined);assert.equal(h.state.sessions[otherKey],other);
 assert.ok(h.calls.cancelled.includes(old));assert.ok(h.calls.archived.includes(old));assert.ok(!h.calls.archived.includes(other));assert.equal(h.calls.prompts.length,0);
 assert.ok(h.calls.sent.some(s=>s.kind==='group'&&String(s.id)===GROUP&&String(s.text).includes('已重置会话')));
 assert.notEqual(await h.ensureSession(key),old);
});
test('没有唤醒时忽略，普通成员即使昵称为管理员也不能重置，未开放群拒绝',async t=>{
 const h=await fixture(t),key='group:'+GROUP,old=await h.ensureSession(key);
 await h.incoming([text('/reset')]);assert.equal(h.state.sessions[key],old);assert.equal(h.calls.sent.length,0);
 await h.incoming([at,text(' /reset')],USER);assert.equal(h.state.sessions[key],old);assert.ok(h.calls.sent.some(s=>String(s.text).includes('仅管理员')));assert.equal(h.calls.prompts.length,0);
 h.cfg.allow.groups=[];await h.incoming([at,text(' /reset')]);assert.equal(h.state.sessions[key],old);assert.ok(!h.calls.archived.includes(old));
});
test('reset先于挂起问题处理，取消提问而不把reset当成回答或模型提示',async t=>{
 const h=await fixture(t),key='group:'+GROUP,old=await h.ensureSession(key),timer=setTimeout(()=>{},10000);t.after(()=>clearTimeout(timer));
 h.pending.set(key,{kind:'question',timer,clientId:'fixture-client',eventId:'fixture-question',questions:[{id:'q',options:[]}]});
 await h.incoming([at,text(' /reset')]);assert.equal(h.state.sessions[key],undefined);assert.equal(h.pending.has(key),false);assert.ok(h.calls.cancelled.includes(old));
 const replies=h.calls.responds.filter(r=>r.eventId==='fixture-question');assert.ok(replies.length);assert.ok(replies.every(r=>r.outcome.value.answers.length===0));assert.equal(h.calls.prompts.length,0);
});
test('空群会话也给出明确回执，私聊reset保持可用',async t=>{
 const h=await fixture(t);await h.incoming([at,text('/reset')]);assert.ok(h.calls.sent.some(s=>String(s.text).includes('当前没有已创建的会话')));assert.equal(h.calls.created.length,0);
 const key='private:'+OWNER,old=await h.ensureSession(key);await h.incoming([text(' /reset ')],OWNER,'private',OWNER);assert.equal(h.state.sessions[key],undefined);assert.ok(h.calls.archived.includes(old));assert.equal(h.calls.prompts.length,0);
});
