import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {releaseFiles} from './release.mjs';
import {inspectVideoDirectory,installVideo} from './extension-lib.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),args=process.argv.slice(2),index=args.indexOf('--from');
try{
 const source=index>=0?args[index+1]:path.join(root,'addons/video');if(!source||!fs.existsSync(source))throw Error('请提供video扩展解压目录：test-video.mjs --from 目录');inspectVideoDirectory(source);
 const dependencies=path.join(root,'qq-bridge-enhanced-v1.0.0/node_modules');if(!fs.existsSync(dependencies))throw Error('请先npm ci --prefix qq-bridge-enhanced-v1.0.0');
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'qq-video-offline-'));
 for(const f of releaseFiles()){const target=path.join(stage,f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,f),target);}
 fs.cpSync(dependencies,path.join(stage,'qq-bridge-enhanced-v1.0.0/node_modules'),{recursive:true});
 installVideo(source,stage);
 const r=spawnSync(process.execPath,[path.join(stage,'scripts/test-public.mjs')],{cwd:stage,stdio:'inherit',windowsHide:true});process.exitCode=r.status??1;
 if(r.status===0){const absolute=path.resolve(stage),parent=path.resolve(os.tmpdir());if(path.dirname(absolute)!==parent||!path.basename(absolute).startsWith('qq-video-offline-')||fs.lstatSync(absolute).isSymbolicLink())throw Error('临时清理路径无效');fs.rmSync(absolute,{recursive:true,force:false,maxRetries:3,retryDelay:100});console.log('视频离线测试通过，临时副本已清理；未启动服务或真实生成');}else console.log('失败副本保留于：'+stage);
}catch(e){console.error(e.message);process.exitCode=1;}
