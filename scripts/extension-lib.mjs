import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const PROJECT_ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const VIDEO_FILES=['src/comfy-video.mjs','video-workflow/qqbot-video.api.json','model-manifest.json','tests/test-comfy-video.mjs','tests/model-sources.test.mjs','README.md','LICENSE','NOTICE.md'];
export const WEB_MEDIA_FILES=['src/web-media.mjs','src/web-media-fetch.mjs','src/web-media-hls.mjs','src/web-media-names.mjs','src/web-media-archive-worker.mjs','src/web-media-restore-worker.mjs','src/web-media-restore.mjs','src/web-media-zip64.mjs','src/web-fetch-result.mjs','src/safe-fetch.js','src/public-dns.mjs','src/comfy-archive.mjs','src/comfy-delivery.mjs','tests/web-media.test.mjs','tests/web-media-batch.test.mjs','tests/web-media-large.test.mjs','tests/web-media-restore.test.mjs','README.md','LICENSE','NOTICE.md'];
export const EXTENSION_IDS=['video','web-media'];
function spec(id){
 if(id==='video')return {files:VIDEO_FILES,entry:'src/comfy-video.mjs',coreVersion:'0.1.0'};
 if(id==='web-media')return {files:WEB_MEDIA_FILES,entry:'src/web-media.mjs',coreVersion:'0.1.1'};
 throw Error('未知扩展：'+id);
}
function regular(file,base){
 const relative=path.relative(base,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('扩展路径越界');
 let current=base;for(const part of relative.split(path.sep).filter(Boolean)){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('扩展不接受链接');}
 const st=fs.lstatSync(file);if(!st.isFile()||st.size>4*1024*1024)throw Error('扩展文件类型或大小无效');return fs.readFileSync(file);
}
function directory(dir){const abs=path.resolve(dir);if(!fs.lstatSync(abs).isDirectory()||path.relative(abs,fs.realpathSync(abs))!=='')throw Error('扩展目录重定向');return abs;}
export function inspectExtensionDirectory(folder,id){
 const s=spec(id),dir=directory(folder),manifest=JSON.parse(regular(path.join(dir,'manifest.json'),dir));
 if(manifest.id!==id||manifest.apiVersion!==1||manifest.coreVersion!==s.coreVersion||manifest.entry!==s.entry)throw Error('不兼容的'+id+'扩展');
 if(!Array.isArray(manifest.files)||manifest.files.length!==s.files.length||new Set(manifest.files.map(f=>f.path)).size!==s.files.length)throw Error('扩展文件清单无效');
 for(const f of manifest.files){if(!s.files.includes(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('扩展文件清单含不允许的路径');const data=regular(path.join(dir,...f.path.split('/')),dir);if(createHash('sha256').update(data).digest('hex')!==f.sha256)throw Error('扩展文件校验失败：'+f.path);}
 return {directory:dir,manifest};
}
export const inspectVideoDirectory=folder=>inspectExtensionDirectory(folder,'video');
export function installedExtension(id,root=PROJECT_ROOT){
 spec(id);const parent=path.join(root,'extensions'),dir=path.join(parent,id);
 if(!fs.existsSync(parent))return null;directory(parent);
 if(!fs.existsSync(dir))return null;return inspectExtensionDirectory(dir,id);
}
export const installedVideo=(root=PROJECT_ROOT)=>installedExtension('video',root);
export function modelManifest(root=PROJECT_ROOT){
 const base=JSON.parse(fs.readFileSync(path.join(root,'model-manifest.json'),'utf8')),video=installedVideo(root);
 if(video){const extra=JSON.parse(fs.readFileSync(path.join(video.directory,'model-manifest.json'),'utf8'));base.models.push(...extra.models);}
 return base;
}
export function assertExtensionIdle(root=PROJECT_ROOT){
 const state=path.join(root,'qq-bridge-enhanced-v1.0.0','state'),record=path.join(state,'managed-bridge.json');
 if(fs.existsSync(record)){const r=JSON.parse(fs.readFileSync(record));if(Number.isInteger(r.pid)&&r.pid>0){let live=false;try{process.kill(r.pid,0);live=true;}catch(e){if(e.code!=='ESRCH')throw e;}if(live)throw Error('请先停止此项目桥接，再管理扩展');}}
 for(const [name,pending]of [['comfy-chat.json',j=>j.kind==='video'&&!['sent','failed','cancelled','interrupted','delivery-unknown'].includes(j.state)],['web-media.json',j=>['queued','downloading','sending'].includes(j.state)]]){
  const file=path.join(state,name);if(!fs.existsSync(file))continue;const jobs=JSON.parse(fs.readFileSync(file)).jobs;if(!Array.isArray(jobs))throw Error('队列状态无效');if(jobs.some(pending))throw Error(name==='web-media.json'?'下载队列尚未结束，请先等待':'视频队列尚未结束，请先等待或清理管线');
 }
}
export function installExtension(id,source,root=PROJECT_ROOT){
 assertExtensionIdle(root);const verified=inspectExtensionDirectory(source,id),parent=path.join(root,'extensions');
 fs.mkdirSync(parent,{recursive:true});directory(parent);const target=path.join(parent,id);if(fs.existsSync(target))throw Error(id+'扩展已存在；请先停用并移除旧版本');
 const stage=path.join(parent,'.'+id+'-install-'+randomUUID());fs.mkdirSync(stage);
 for(const name of ['manifest.json',...spec(id).files]){const dest=path.join(stage,...name.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,regular(path.join(verified.directory,...name.split('/')),verified.directory),{flag:'wx'});}
 inspectExtensionDirectory(stage,id);fs.renameSync(stage,target);return {installed:true,enabled:false};
}
export const installVideo=(source,root=PROJECT_ROOT)=>installExtension('video',source,root);
export function setExtensionEnabled(id,enabled,root=PROJECT_ROOT){
 spec(id);assertExtensionIdle(root);if(enabled&&!installedExtension(id,root))throw Error('请先安装'+id+'扩展');
 const file=path.join(root,'qq-bridge-enhanced-v1.0.0','config.json'),c=JSON.parse(fs.readFileSync(file,'utf8'));
 if(id==='video'){c.comfyChat??={};c.comfyChat.features??={};c.comfyChat.features.video=enabled;}
 else {c.webMedia??={};c.webMedia.enabled=enabled;}
 const temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(c,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);return {enabled};
}
export const setVideoEnabled=(enabled,root=PROJECT_ROOT)=>setExtensionEnabled('video',enabled,root);
export function removeExtension(id,root=PROJECT_ROOT){
 assertExtensionIdle(root);const verified=installedExtension(id,root);if(!verified)return {removed:false};
 const config=path.join(root,'qq-bridge-enhanced-v1.0.0','config.json');if(fs.existsSync(config)){const c=JSON.parse(fs.readFileSync(config));if(id==='video'?c.comfyChat?.features?.video===true:c.webMedia?.enabled===true)throw Error('请先停用'+id+'扩展');}
 const owned=['manifest.json',...spec(id).files],found=[];
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('扩展中存在链接，未移除');if(e.isDirectory())walk(f);else found.push(path.relative(verified.directory,f).split(path.sep).join('/'));}}
 walk(verified.directory);if(found.some(f=>!owned.includes(f)))throw Error('扩展目录含额外文件，未移除');
 const dirs=new Set();for(const f of owned){const file=path.join(verified.directory,...f.split('/'));regular(file,verified.directory);dirs.add(path.dirname(file));}
 // All removal paths are resolved and checked within this exact extension directory.
 for(const f of owned)fs.unlinkSync(path.join(verified.directory,...f.split('/')));
 for(const dir of [...dirs].sort((a,b)=>b.length-a.length))if(dir!==verified.directory&&!fs.readdirSync(dir).length)fs.rmdirSync(dir);
 if(!fs.readdirSync(verified.directory).length)fs.rmdirSync(verified.directory);return {removed:true};
}
export const removeVideo=(root=PROJECT_ROOT)=>removeExtension('video',root);
