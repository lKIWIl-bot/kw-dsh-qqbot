import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setUpscaleMode} from '../scripts/upscale.mjs';
import {validateUpscaleOptions} from '../qq-bridge-enhanced-v1.0.0/src/upscale-options.mjs';
import {buildUpscaleGraph,loadUpscaleConfig} from '../qq-bridge-enhanced-v1.0.0/src/comfy-upscale.mjs';
test('高清直接分块为新部署默认值；两模式与两块大小均实际绑定至提交图',()=>{
 assert.equal(loadUpscaleConfig().processing,'tiled');
 for(const processing of ['full-first','tiled'])for(const tile of [128,256]){
  const config={...loadUpscaleConfig(),processing,tile};validateUpscaleOptions(config);
  const r=buildUpscaleGraph({image:{input:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png'},upscale:{longEdge:2048}},{width:512,height:512,config});
  assert.equal(r.graph['4'].inputs.processing,processing);assert.equal(r.graph['4'].inputs.tile,tile);assert.equal(r.graph['5'].inputs.width,2048);
 }
 for(const c of [{processing:'other'},{tile:64},{tile:'128'}])assert.throws(()=>validateUpscaleOptions({...loadUpscaleConfig(),...c}),/配置无效/);
});
test('切换高清模式同步2K/4K模板，不修改QQ配置；有任务时拒绝切换',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-upscale-mode-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
 const dir=path.join(root,'image-workflow');fs.mkdirSync(dir);const state=path.join(root,'qq-bridge-enhanced-v1.0.0/state');fs.mkdirSync(state,{recursive:true});
 fs.writeFileSync(path.join(dir,'upscale.json'),JSON.stringify(loadUpscaleConfig()));
 for(const edge of ['2k','4k'])fs.writeFileSync(path.join(dir,'qqbot-upscale-'+edge+'.api.json'),JSON.stringify({'4':{class_type:'DshIllustrationUpscale',inputs:{}}}));
 const file=path.join(root,'qq-bridge-enhanced-v1.0.0/config.json');fs.writeFileSync(file,'{"fixture":"keep"}');
 setUpscaleMode('full-first',{root,tile:128});assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'upscale.json'))).tile,128);
 for(const edge of ['2k','4k'])assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'qqbot-upscale-'+edge+'.api.json')))['4'].inputs.processing,'full-first');
 assert.equal(fs.readFileSync(file,'utf8'),'{"fixture":"keep"}');
 fs.writeFileSync(path.join(state,'comfy-chat.json'),JSON.stringify({jobs:[{kind:'upscale',state:'generating'}]}));assert.throws(()=>setUpscaleMode('tiled',{root}),/队列尚未结束/);
});
