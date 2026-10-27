import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {VIDEO_FILES,installedVideo,inspectVideoDirectory,installVideo,setVideoEnabled,removeVideo,modelManifest} from '../scripts/extension-lib.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-extension-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'base'),source=path.join(dir,'addon'),bridge=path.join(root,'qq-bridge-enhanced-v1.0.0');fs.mkdirSync(bridge,{recursive:true});fs.mkdirSync(source);
 const config={ownerQQ:'1000000001',botQQ:'1000000002',snowluma:{accessToken:'fixture-only'},allow:{private:['1000000001'],groups:[]},comfyChat:{enabled:true,features:{image:true,upscale:true,video:false}}};
 const configFile=path.join(bridge,'config.json');fs.writeFileSync(configFile,JSON.stringify(config));fs.writeFileSync(path.join(root,'model-manifest.json'),JSON.stringify({models:[{filename:'base',features:['image']}]}));
 const files=VIDEO_FILES.map(name=>{const data=name==='model-manifest.json'?JSON.stringify({models:[{filename:'video',features:['videoImage']}]}):'fixture '+name;const target=path.join(source,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);return {path:name,sha256:digest(data)};});
 const manifest={id:'video',version:'0.1.0',coreVersion:'0.1.0',apiVersion:1,entry:'src/comfy-video.mjs',files};fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
 return {root,source,config,configFile,manifest,saveManifest:()=>fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest)),state:path.join(bridge,'state')};
}
test('视频扩展安装默认不启用，清单按安装状态合并，停用和移除保留其他配置及外部模型',t=>{
 const f=fixture(t),before=fs.readFileSync(f.configFile);assert.equal(installedVideo(f.root),null);assert.equal(modelManifest(f.root).models.length,1);
 installVideo(f.source,f.root);assert.deepEqual(fs.readFileSync(f.configFile),before);assert.equal(modelManifest(f.root).models.length,2);assert.throws(()=>installVideo(f.source,f.root),/已存在/);
 setVideoEnabled(true,f.root);let c=JSON.parse(fs.readFileSync(f.configFile));assert.equal(c.comfyChat.features.video,true);delete c.comfyChat.features.video;const old=structuredClone(f.config);delete old.comfyChat.features.video;assert.deepEqual(c,old);
 assert.throws(()=>removeVideo(f.root),/停用/);setVideoEnabled(false,f.root);const model=path.join(f.root,'shared-model.safetensors');fs.writeFileSync(model,'shared');
 removeVideo(f.root);assert.equal(installedVideo(f.root),null);assert.equal(modelManifest(f.root).models.length,1);assert.equal(fs.readFileSync(model,'utf8'),'shared');assert.equal(JSON.parse(fs.readFileSync(f.configFile)).comfyChat.features.image,true);
 assert.throws(()=>setVideoEnabled(true,f.root),/先安装/);
});
test('扩展拒绝未知版本、越界清单、损坏和篡改文件，不部分安装',t=>{
 const f=fixture(t);f.manifest.apiVersion=999;f.saveManifest();assert.throws(()=>installVideo(f.source,f.root),/不兼容/);f.manifest.apiVersion=1;
 f.manifest.files[0].path='../outside.mjs';f.saveManifest();assert.throws(()=>installVideo(f.source,f.root),/路径/);f.manifest.files[0].path=VIDEO_FILES[0];f.saveManifest();
 fs.appendFileSync(path.join(f.source,VIDEO_FILES[0]),'tampered');assert.throws(()=>installVideo(f.source,f.root),/校验失败/);assert.equal(installedVideo(f.root),null);
});
test('有运行中桥接或未结束视频任务时拒绝扩展变更',t=>{
 const f=fixture(t);fs.mkdirSync(f.state);const record=path.join(f.state,'managed-bridge.json');fs.writeFileSync(record,JSON.stringify({pid:process.pid}));assert.throws(()=>installVideo(f.source,f.root),/先停止/);fs.unlinkSync(record);
 fs.writeFileSync(path.join(f.state,'comfy-chat.json'),JSON.stringify({jobs:[{kind:'video',state:'generating'}]}));assert.throws(()=>installVideo(f.source,f.root),/队列尚未结束/);assert.equal(installedVideo(f.root),null);
});
test('移除扩展先确认全部文件归属，遇到用户额外文件时保持原样',t=>{
 const f=fixture(t);installVideo(f.source,f.root);const dir=installedVideo(f.root).directory;fs.writeFileSync(path.join(dir,'personal.txt'),'keep');assert.throws(()=>removeVideo(f.root),/额外文件/);assert.ok(fs.existsSync(path.join(dir,'src/comfy-video.mjs')));assert.equal(fs.readFileSync(path.join(dir,'personal.txt'),'utf8'),'keep');
});
