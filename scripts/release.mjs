import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ignored=new Set(['node_modules','state','.git','.build','.tools','.backups','dist','images','videos','img2img','archives','audio','lora-examples','__pycache__']);
const roots=['model-manifest.json','package.json','package-lock.json','README.md','EXTENSIONS.md','RELEASE_NOTES.md','THIRD_PARTY.md','LICENSE','NOTICE.md','AGENTS.md','.gitignore','.gitattributes','install.cmd','start.cmd','console.cmd','scripts','tests','docs','.github','qq-bridge-enhanced-v1.0.0','qq-workspace','image-workflow','tools','comfy-nodes'];
const forbiddenName=name=>name==='config.json'||name==='loras.local.json'||/\.local\.|\.(?:log|bak|tmp|safetensors|gguf|ckpt|pt|pth|exe|dll|node|zip|z删ip)$/i.test(name);
export function releaseFiles(){
 const files=[];
 function walk(relative){const absolute=path.resolve(root,relative);if(!fs.existsSync(absolute))return;const stat=fs.lstatSync(absolute);if(stat.isSymbolicLink())throw Error('Release contains link: '+relative);if(stat.isDirectory()){for(const name of fs.readdirSync(absolute).sort())if(!ignored.has(name))walk(relative+'/'+name);}else if(stat.isFile()&&!forbiddenName(path.basename(relative)))files.push(relative);}
 for(const item of roots)walk(item);return files.sort();
}
export function checkRelease(){
 const files=releaseFiles(),issues=[];
 const dependencyLock=JSON.parse(fs.readFileSync(path.join(root,'qq-bridge-enhanced-v1.0.0/package-lock.json'),'utf8'));if(Object.keys(dependencyLock.packages).some(p=>p.includes('node_modules/@snowluma/')))issues.push('Removed SDK dependency returned');
 for(const required of ['README.md','AGENTS.md','scripts/manage.mjs','scripts/doctor.mjs','qq-workspace/comfy-qq.mjs','qq-workspace/qqbot-workflow.mjs','image-workflow/qqbot.api.json','qq-bridge-enhanced-v1.0.0/src/bridge.js','qq-bridge-enhanced-v1.0.0/package-lock.json'])if(!files.includes(required))issues.push('Missing '+required);
 for(const relative of files){
  const bytes=fs.readFileSync(path.join(root,relative));if(bytes.includes(0))continue;const text=bytes.toString('utf8');
  for(const pattern of [/C:[/\\]+Users[/\\]+rog\b/i,/D:[/\\]+codex[/\\]+dsh-qq(?!-public)/i,/D:[/\\]+Comfy-Desktop/i,new RegExp(['34598'+'42898','13912'+'51454'].join('|')),/\bsk-[A-Za-z0-9_-]{24,}/])if(pattern.test(text))issues.push('Private binding in '+relative);
 }
 if(issues.length)throw Error([...new Set(issues)].join('\n'));
 return files;
}
async function main(){
 const baseFiles=checkRelease(),addon=process.argv.includes('--addon'),source=process.argv.includes('--source');if(addon&&source)throw Error('Choose addon or source');
 const {inspectVideoDirectory}=await import('./extension-lib.mjs');const video=(addon||source)?inspectVideoDirectory(path.join(root,'addons/video')):null;if(addon&&!video)throw Error('video扩展源码不存在');
 const videoFiles=video?['manifest.json',...video.manifest.files.map(f=>f.path)].map(f=>'addons/video/'+f):[];
 const files=addon?videoFiles:source?[...baseFiles,...videoFiles]:baseFiles;
 if(addon||source){for(const f of videoFiles){const s=fs.readFileSync(path.join(root,f),'utf8');if(/(?:[A-Z]:[/\\]|sk-[A-Za-z0-9_-]{24,})/.test(s))throw Error('扩展包含本机路径或凭据：'+f);}}
 if(process.argv.includes('--check')){console.log('Release source checks passed: '+files.length+' files');return;}
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),version=pkg.version;
 if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(pkg.name))throw Error('Invalid project name');
 const name=pkg.name+(addon?'-video':source?'-source':'')+'-'+version;
 const stageParent=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-qq-release-')),stage=path.join(stageParent,name);fs.mkdirSync(stage);
 for(const relative of files){const target=path.join(stage,addon?relative.slice('addons/video/'.length):relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target);}
 const directory=path.join(root,'dist');fs.mkdirSync(directory,{recursive:true});const archive=path.join(directory,name+'-'+randomUUID().slice(0,8)+'.zip');
 const tar=process.platform==='win32'?path.join(process.env.SystemRoot||'C:/Windows','System32/tar.exe'):'tar';
 const result=spawnSync(tar,['-a','-cf',archive,name],{cwd:stageParent,stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error('Archive build failed; staged sources retained at '+stageParent);
 const digest=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');fs.writeFileSync(archive+'.sha256',digest+'  '+path.basename(archive)+'\n');
 // Stage is retained for extraction/comparison checks; it contains public sources only.
 console.log(JSON.stringify({archive,sha256:digest,files:files.length,stagedSources:stage}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
