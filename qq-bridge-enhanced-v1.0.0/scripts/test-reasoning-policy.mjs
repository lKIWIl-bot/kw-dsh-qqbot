import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/bridge.js',import.meta.url),'utf8');
const normalize=source.match(/function normalizeReasoningEffort\(value\) \{[\s\S]*?\n\}/)[0];
const apply=source.match(/async function ensureChatModel\(sessionId\) \{[\s\S]*?\n  \}/)[0];
test('真实模型选择逻辑：聊天off、L2 high、退出off；重复会话不重复写模型设置',async()=>{
 const calls=[];
 const context=vm.createContext({cfg:{dsh:{provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'off',agentReasoningEffort:'high'}},currentMode:'chat',currentLevel:'L0',modelSelectionEpoch:0,modelAppliedSessions:new Map(),REASONING_EFFORT_DEFAULT:'off',REASONING_EFFORT_OPTIONS:['off','low','high','max'],unwrap:x=>x,log:()=>{},api:{sessions:{selectModel:async params=>{calls.push(params);return {selected:params};}}},setTimeout,clearTimeout});
 vm.runInContext(normalize+'\n'+apply+'\nglobalThis.applyModel=ensureChatModel;',context);
 await context.applyModel('chat1');await context.applyModel('chat1');
 context.currentMode='closed-agent';context.currentLevel='L2';await context.applyModel('agent1');
 context.currentMode='chat';context.currentLevel='L0';await context.applyModel('chat2');
 assert.deepEqual(calls.map(x=>x.reasoningEffort),['off','high','off']);
 assert.equal(calls[1].provider,'deepseek-account');
});
test('off是合法档位，未知档位继续被拒绝',()=>{
 const c=vm.createContext({REASONING_EFFORT_OPTIONS:['off','low','high','max']});vm.runInContext(normalize+'\nglobalThis.normalize=normalizeReasoningEffort;',c);
 assert.equal(c.normalize(' OFF '),'off');assert.throws(()=>c.normalize('never'));
});
