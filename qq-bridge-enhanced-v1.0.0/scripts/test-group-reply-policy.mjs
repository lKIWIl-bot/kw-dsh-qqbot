import test from 'node:test';
import assert from 'node:assert/strict';
import {isExplicitlyAtSelf,isAddressedGroupMessage as yes,addressedCommandText} from '../src/group-reply-policy.mjs';
const id='1000000002',identity={selfId:id,selfName:'ISS'};
const t=text=>({type:'text',data:{text}}),at=qq=>({type:'at',data:{qq}}),e=(...message)=>({self_id:id,message});
test('只有实际@本人或正文中的当前昵称才触发，@全体/其他人/引用都不算',()=>{
 assert.equal(yes(e(at(id),t('你好')),identity),true);
 assert.equal(yes(e(at('all'),t('你好')),identity),false);assert.equal(yes(e(at('1000000001'),t('你好')),identity),false);
 assert.equal(yes(e(t('ISS 你好')),identity),true);assert.equal(yes(e(t('iss，生图 一只猫')),identity),true);
 assert.equal(yes(e(t('missile')),identity),false);assert.equal(yes(e({type:'reply',data:{id:'1',text:'ISS'}},t('看看这个')),identity),false);
 assert.equal(yes(e(t('[CQ:at,qq='+id+']')),identity),false);assert.equal(yes(e(t('你好')),identity),false);
});
test('中文昵称和改名后的身份匹配；移除@后的生图中文命令可直接解析',()=>{
 assert.equal(yes(e(t('小鲸鱼你好')),{selfId:id,selfName:'小鲸鱼'}),true);
 assert.equal(yes(e(t('ISS你好')),{selfId:id,selfName:'新昵称'}),false);
 assert.equal(addressedCommandText(e(at(id),t(' /生图 一只猫')),'ISS'),'/生图 一只猫');
 assert.equal(addressedCommandText(e(t('ISS，/生图 一只猫')),'ISS'),'/生图 一只猫');
});

test('生图的实际@判定拒绝全体、其他人、昵称和伪造CQ文本',()=>{
 for(const event of [e(t('/生图 猫')),e(t('ISS，/生图 猫')),e(at('all'),t('/生图 猫')),e(at('1000000001'),t('/生图 猫')),e(t('[CQ:at,qq='+id+'] /生图 猫'))])assert.equal(isExplicitlyAtSelf(event,id),false);
 assert.equal(isExplicitlyAtSelf(e(at(id),t('/生图 猫')),id),true);
});

test('真实群进线将实际@传递给生图授权，昵称聊天不能生图',async()=>{
 const {bridgeHarness}=await import('./audit-bridge-harness.mjs');
 const {createComfyChat}=await import('../src/comfy-chat.mjs');
 const results=[];
 const h=await bridgeHarness({config:{allow:{private:[123],groups:[10001234]},groupReply:{onlyAddressed:true},comfyChat:{enabled:true}},globals:{createComfyChat:options=>{
  const c=createComfyChat({...options,notify:async()=>{}});
  return {...c,onMessage:async message=>{const result=await c.onMessage(message);results.push({message,result});return {...result,handled:true};}};
 }}});
 try{
  h.setMode('chat');h.setBotIdentity(id,'ISS');
  const incoming=message=>h.handleIncoming('group','10001234',{self_id:id,user_id:123,message_id:results.length+100,message,sender:{card:'猫友'}},h.cfg);
  await incoming([t('/生图 小猫')]);assert.equal(results.length,0);
  await incoming([t('ISS，/生图 小猫')]);
  assert.equal(results.length,1);assert.equal(results[0].message.explicitAt,false);assert.ok(!results[0].result.ticket);
  await incoming([at(id),t('/生图 小猫')]);
  assert.equal(results.length,2);assert.equal(results[1].message.explicitAt,true);assert.ok(results[1].result.ticket);
 }finally{await h.close();}
});
