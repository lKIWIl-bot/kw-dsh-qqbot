import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {discoverLoras,safetensorsMetadata} from '../qq-bridge-enhanced-v1.0.0/src/lora-discovery.mjs';
import {parseComfyCommand} from '../qq-bridge-enhanced-v1.0.0/src/comfy-chat.mjs';
import {loadQqbotWorkflow} from '../qq-workspace/qqbot-workflow.mjs';
import {readLoraCatalog,loadLoraWorkflow,loraPrompt} from '../qq-bridge-enhanced-v1.0.0/src/comfy-loras.mjs';
import {createComfyChat} from '../qq-bridge-enhanced-v1.0.0/src/comfy-chat.mjs';
import {checkDeployment} from '../scripts/doctor.mjs';
import {checkRelease} from '../scripts/release.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog={version:2,bases:{anima:{family:'anima',label:'Anima',unet:'base.safetensors',clip:'clip.safetensors',vae:'vae.safetensors'}},loras:[]};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-public-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function model(file,metadata){const bytes=Buffer.from(JSON.stringify({__metadata__:metadata})),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(bytes.length));fs.writeFileSync(file,Buffer.concat([prefix,bytes]));}
const config=dir=>({comfyChat:{loras:{directories:[{path:dir}],defaultStrength:0.8}}});

test('默认/生图使用官方Anima Base，旧别名和提示词skill入口不再提供',()=>{
 assert.equal(parseComfyCommand('/生图 小鲸鱼').type,'request');assert.notEqual(parseComfyCommand('/生图base 小鲸鱼')?.type,'request');
 assert.equal(parseComfyCommand('/skills'),null);assert.equal(parseComfyCommand('/lorasill'),null);
 const graph=loadQqbotWorkflow({prompt:'a whale'});assert.equal(graph.prompt['3'].inputs.unet_name,'anima-base-v1.0.safetensors');
 assert.equal(graph.prompt['9'].inputs.model[0],'3');assert.ok(!Object.values(graph.prompt).some(n=>n.class_type.startsWith('LoraLoader')));
});
test('放入目录即可发现Anima模型，使用文件名和默认权重，缺触发词及用法会提醒',t=>{
 const dir=fixture(t);model(path.join(dir,'新画风.safetensors'),{ss_base_model_version:'anima'});
 const found=discoverLoras({catalog,config:config(dir)});assert.equal(found.entries[0].name,'新画风');assert.equal(found.entries[0].strengthModel,.8);assert.equal(found.warnings.length,2);assert.equal(found.pending.length,0);
});
test('可选同名JSON设置别名、触发词、权重、分类和特殊用法，动作强制管理员权限',t=>{
 const dir=fixture(t);model(path.join(dir,'style.safetensors'),{});fs.writeFileSync(path.join(dir,'style.json'),JSON.stringify({name:'风格A',base:'anima',trigger:'my_style',strengthModel:.7,category:'action',usageConfirmed:true,promptGuidance:'Use the verified author guidance.'}));
 const result=discoverLoras({catalog,config:config(dir)});assert.equal(result.entries[0].name,'风格A');assert.equal(result.entries[0].trigger,'my_style');assert.equal(result.entries[0].adminOnly,true);assert.equal(result.warnings.length,0);
});
test('不能从文件名猜底模；未知或冲突底模留在待确认列表，不自动启用',t=>{
 const dir=fixture(t);model(path.join(dir,'anima-looking.safetensors'),{});let result=discoverLoras({catalog,config:config(dir)});assert.equal(result.entries.length,0);assert.equal(result.pending.length,1);
 model(path.join(dir,'other.safetensors'),{ss_base_model_version:'sdxl_base_v1-0'});const c=config(dir);c.comfyChat.loras.directories[0].base='anima';result=discoverLoras({catalog,config:c});assert.equal(result.entries.length,1);assert.equal(result.pending.length,1);
});
test('递归扫描、重名区分、坏JSON隔离、拒绝大模型头；不将JSON视为可执行指令',t=>{
 const dir=fixture(t);fs.mkdirSync(path.join(dir,'sub'));model(path.join(dir,'same.safetensors'),{ss_base_model_version:'anima'});model(path.join(dir,'sub/same.safetensors'),{ss_base_model_version:'anima'});
 let result=discoverLoras({catalog,config:config(dir)});assert.equal(new Set(result.entries.map(e=>e.name)).size,2);assert.ok(result.entries.some(e=>e.filename==='sub/same.safetensors'));
 fs.writeFileSync(path.join(dir,'same.json'),'{bad');result=discoverLoras({catalog,config:config(dir)});assert.equal(result.pending.length,1);assert.equal(result.entries.length,1);
 const large=path.join(dir,'broken.safetensors'),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(999999999n);fs.writeFileSync(large,prefix);assert.throws(()=>safetensorsMetadata(large),/模型头/);
});
test('LoRA目录新增或移除文件，下一次扫描立即更新，不需要agent注册',t=>{
 const dir=fixture(t);assert.equal(discoverLoras({catalog,config:config(dir)}).entries.length,0);
 model(path.join(dir,'new.safetensors'),{ss_base_model_version:'anima'});assert.equal(discoverLoras({catalog,config:config(dir)}).entries.length,1);
 fs.unlinkSync(path.join(dir,'new.safetensors'));assert.equal(discoverLoras({catalog,config:config(dir)}).entries.length,0);
});
test('发现的LoRA实际绑定文件、Anima底模和权重；配置改变后旧指纹拒绝执行',t=>{
 const dir=fixture(t);fs.mkdirSync(path.join(dir,'sub'));model(path.join(dir,'sub/style.safetensors'),{ss_base_model_version:'anima',trigger_words:'known_style'});
 const found=discoverLoras({catalog,config:config(dir)}),file=path.join(dir,'catalog.json');fs.writeFileSync(file,JSON.stringify({...catalog,loras:found.entries}));
 const entry=readLoraCatalog(file)[0],workflow=loadLoraWorkflow({prompt:'a whale'},entry.name,{catalogFile:file,expectedSha256:entry.sha256});
 const node=Object.values(workflow.prompt).find(n=>n.class_type==='LoraLoaderModelOnly');assert.equal(node.inputs.lora_name,'sub/style.safetensors');assert.equal(node.inputs.strength_model,.8);assert.equal(workflow.prompt['3'].inputs.unet_name,'base.safetensors');assert.equal(loraPrompt('a whale',entry),'known_style, a whale');
 const changed={...catalog,loras:found.entries.map(e=>({...e,strengthModel:.6}))};fs.writeFileSync(file,JSON.stringify(changed));assert.throws(()=>loadLoraWorkflow({},entry.name,{catalogFile:file,expectedSha256:entry.sha256}),/配置已更新/);
});
test('坏的可选用法仅隔离对应LoRA，不隐藏其他可用文件',t=>{
 const dir=fixture(t);for(const name of ['good','bad'])model(path.join(dir,name+'.safetensors'),{ss_base_model_version:'anima'});
 fs.writeFileSync(path.join(dir,'bad.json'),JSON.stringify({sampling:{steps:999}}));const found=discoverLoras({catalog,config:config(dir)});
 assert.equal(found.entries.length,1);assert.equal(found.entries[0].name,'good');assert.equal(found.pending.length,1);
});
test('可选功能关闭先于外部调用；高清不绕过基础生图关闭',async t=>{
 const dir=fixture(t),USER='1000000003',OWNER='1000000001',notices=[],cfg={ownerQQ:OWNER,allow:{private:[OWNER,USER]},comfyChat:{enabled:true,features:{image:false,upscale:true}}};
 const c=createComfyChat({cfg,root:path.join(dir,'bridge'),stateDir:dir,notify:async(key,text)=>notices.push(text),upscaleReady:async()=>{throw Error('must not check upscale');}});
 try{
  const blocked=await c.onMessage({kind:'private',id:USER,userId:USER,text:'/生图 高清 小猫'});assert.equal(blocked.handled,true);assert.match(notices.at(-1),/尚未配置/);assert.equal(c.quota(USER).used,0);
  cfg.comfyChat.features.image=true;const cap=await c.onMessage({kind:'private',id:USER,userId:USER,text:'/生图 小猫'});assert.ok(cap.ticket);cfg.comfyChat.features.image=false;assert.throws(()=>c.call({ticket:cap.ticket,prompt:'a cat'}),/尚未配置/);
 }finally{c.close();}
});
test('部署向导不会覆盖已有配置；缺配置诊断有明确错误而不采用本机私人设置',async t=>{
 const dir=fixture(t),report=await checkDeployment({rootPath:dir,offline:true});assert.ok(report.errors.some(e=>e.includes('config.json')));
 const script=path.join(root,'scripts/manage.mjs');const result=spawnSync(process.execPath,[script,'help'],{encoding:'utf8'});assert.equal(result.status,0);assert.match(result.stdout,/setup/);
});
test('在线doctor不把运行时图片占位符当成缺文件，仍报告真正缺失的模型选项',async t=>{
 const dir=fixture(t),bridge=path.join(dir,'qq-bridge-enhanced-v1.0.0');fs.mkdirSync(bridge);fs.mkdirSync(path.join(dir,'image-workflow'));
 const c={ownerQQ:'1000000001',botQQ:'1000000002',allowAllWhenEmpty:false,allow:{private:['1000000001']},snowluma:{wsUrl:'ws://127.0.0.1:3001',httpUrl:'http://127.0.0.1:3000'},comfyChat:{enabled:true,url:'http://127.0.0.1:8188',archivePassword:'sample-password',features:{image:true},loras:{enabled:false}}};
 fs.writeFileSync(path.join(bridge,'config.json'),JSON.stringify(c));fs.writeFileSync(path.join(dir,'image-workflow/loras.json'),JSON.stringify(catalog));
 fs.writeFileSync(path.join(dir,'image-workflow/qqbot.api.json'),JSON.stringify({'1':{class_type:'LoadImage',inputs:{image:'runtime-upload.png'}},'2':{class_type:'UNETLoader',inputs:{unet_name:'missing.safetensors'}}}));
 const report=await checkDeployment({rootPath:dir,request:async()=>({ok:true,json:async()=>({LoadImage:{input:{required:{image:[['existing.png']]}}},UNETLoader:{input:{required:{unet_name:['COMBO',{options:['installed.safetensors']}]}}}})})});
 assert.ok(report.errors.some(e=>e.includes('missing.safetensors')));assert.ok(!report.errors.some(e=>e.includes('runtime-upload.png')));
});
test('发布清单包含全部运行目录，排除本机配置、生成数据和依赖目录',()=>{
 const files=checkRelease();assert.ok(files.includes('qq-workspace/comfy-qq.mjs'));assert.ok(!files.some(f=>f.startsWith('video-workflow/')||f.startsWith('extensions/video/')));assert.ok(files.includes('AGENTS.md'));
 assert.ok(!files.some(f=>/(^|\/)(state|node_modules|images|\.tools)\//.test(f)||f.endsWith('/config.json')||f.endsWith('loras.local.json')));
});
