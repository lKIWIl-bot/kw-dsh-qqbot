import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {releaseFiles} from './release.mjs';
import {EXTENSION_IDS,installExtension,inspectExtensionDirectory} from './extension-lib.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),args=process.argv.slice(2),id=args[0]??'all';
try{
 const ids=id==='all'?EXTENSION_IDS:[id];if(ids.some(i=>!EXTENSION_IDS.includes(i)))throw Error('支持video、web-media或all');
 const from=args.indexOf('--from');if(from>=0&&ids.length!==1)throw Error('--from只用于单个扩展');
 const sources=ids.map(i=>({id:i,source:from<0?path.join(root,'addons',i):args[from+1]}));
 for(const x of sources)inspectExtensionDirectory(x.source,x.id);
 const dependencies=path.join(root,'qq-bridge-enhanced-v1.0.0/node_modules');if(!fs.existsSync(dependencies))throw Error('请先安装桥接依赖');
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'qq-addons-offline-'));
 for(const f of releaseFiles()){const dest=path.join(stage,f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,f),dest);}
 fs.cpSync(dependencies,path.join(stage,'qq-bridge-enhanced-v1.0.0/node_modules'),{recursive:true});
 for(const x of sources)installExtension(x.id,x.source,stage);
 const r=spawnSync(process.execPath,[path.join(stage,'scripts/test-public.mjs')],{cwd:stage,stdio:'inherit',windowsHide:true});process.exitCode=r.status??1;
 if(r.status===0){const absolute=path.resolve(stage),parent=fs.realpathSync(os.tmpdir());if(path.dirname(absolute)!==parent||!path.basename(absolute).startsWith('qq-addons-offline-')||fs.lstatSync(absolute).isSymbolicLink())throw Error('临时清理路径无效');fs.rmSync(absolute,{recursive:true,force:false,maxRetries:3,retryDelay:100});console.log('扩展联合离线测试通过，隔离副本已清理。未访问真实QQ或GPU。');}else console.log('失败副本保留于：'+stage);
}catch(e){console.error(e.message);process.exitCode=1;}
