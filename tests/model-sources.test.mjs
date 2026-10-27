import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildVideoGraph} from '../qq-bridge-enhanced-v1.0.0/src/comfy-video.mjs';
import {discoverLoras} from '../qq-bridge-enhanced-v1.0.0/src/lora-discovery.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),manifest=JSON.parse(fs.readFileSync(path.join(root,'model-manifest.json'),'utf8'));
test('标准工作流每项权重都有公开来源、固定版本、大小、SHA256和受控目标目录',()=>{
 assert.equal(manifest.models.length,4);const targets=new Set();
 for(const m of manifest.models){assert.match(m.url,/^https:\/\/huggingface\.co\//);assert.ok(m.url.includes(m.revision));assert.match(m.sha256,/^[a-f0-9]{64}$/);assert.ok(m.bytes>0);assert.ok(!targets.has(m.target));targets.add(m.target);assert.ok(!m.target.split('/').includes('..'));assert.equal(m.access,'public-at-verification');}
 for(const dir of ['image-workflow'])for(const name of fs.readdirSync(path.join(root,dir)).filter(f=>f.endsWith('.api.json'))){
  for(const node of Object.values(JSON.parse(fs.readFileSync(path.join(root,dir,name),'utf8'))))for(const [key,value]of Object.entries(node.inputs??{})){
   if(!/^(unet_name|clip_name|vae_name|lora_name|model_name|ckpt_name)$/.test(key))continue;
   assert.ok(manifest.models.some(m=>m.filename===value),dir+'/'+name+': '+value);
  }
 }
});
test('模型清单命令只列出模型，未知功能明确拒绝',()=>{
 const command=path.join(root,'scripts/models.mjs'),result=spawnSync(process.execPath,[command,'--feature','image'],{encoding:'utf8'});assert.equal(result.status,0);assert.match(result.stdout,/5\.24 GiB/);assert.match(result.stdout,/不下载/);
 const bad=spawnSync(process.execPath,[command,'--feature','unknown'],{encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/可选功能/);
});
