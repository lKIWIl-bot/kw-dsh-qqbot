import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildVideoGraph} from '../src/comfy-video.mjs';
import {discoverLoras} from '../../../qq-bridge-enhanced-v1.0.0/src/lora-discovery.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),manifest=JSON.parse(fs.readFileSync(path.join(root,'model-manifest.json'),'utf8'));
test('图生视频专家、加速LoRA和采样分段成套，不能混回旧私人模型',()=>{
 const template=JSON.parse(fs.readFileSync(path.join(root,'video-workflow/qqbot-video.api.json'),'utf8')),opts={prompt:'a mountain',seed:1,input:'11111111-1111-4111-8111-111111111111.png',params:{seconds:3,fps:16,megapixels:.24}};
 const graph=buildVideoGraph(template,opts);assert.equal(graph['13'].inputs.end_at_step,2);assert.equal(graph['14'].inputs.start_at_step,2);assert.equal(graph['14'].inputs.end_at_step,4);
 for(const id of ['1','2','4','5']){const bad=structuredClone(template);bad[id].inputs[id==='1'||id==='4'?'unet_name':'lora_name']='unknown.safetensors';assert.throws(()=>buildVideoGraph(bad,opts),/模型|LoRA/);}
 const bad=structuredClone(template);bad['14'].inputs.end_at_step=6;assert.throws(()=>buildVideoGraph(bad,opts),/分段/);
});
test('工作流内部Wan加速LoRA不被识别成Anima画风',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-model-source-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bytes=Buffer.from(JSON.stringify({__metadata__:{ss_base_model_version:'anima'}})),header=Buffer.alloc(8);header.writeBigUInt64LE(BigInt(bytes.length));
 for(const m of manifest.models.filter(m=>m.role==='pipeline-lora'))fs.writeFileSync(path.join(dir,m.filename),Buffer.concat([header,bytes]));
 const result=discoverLoras({catalog:{version:2,bases:{anima:{family:'anima'}},loras:[]},config:{comfyChat:{loras:{directories:[{path:dir,base:'anima'}]}}}});assert.equal(result.entries.length,0);assert.equal(result.pending.length,0);
});

test('视频扩展六项权重均有固定公开来源，覆盖工作流全部权重选择',()=>{
 assert.equal(manifest.models.length,6);for(const m of manifest.models){assert.match(m.url,/^https:\/\/huggingface\.co\//);assert.ok(m.url.includes(m.revision));assert.match(m.sha256,/^[a-f0-9]{64}$/);assert.ok(m.bytes>0);}
 const graph=JSON.parse(fs.readFileSync(path.join(root,'video-workflow/qqbot-video.api.json'),'utf8'));
 for(const n of Object.values(graph))for(const [k,v]of Object.entries(n.inputs??{}))if(/^(unet_name|clip_name|vae_name|lora_name)$/.test(k))assert.ok(manifest.models.some(m=>m.filename===v),v);
});
