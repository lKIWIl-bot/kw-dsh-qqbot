import {modelManifest} from './extension-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),args=process.argv.slice(2);
const option=name=>{const i=args.indexOf('--'+name);if(i>=0&&!args[i+1])throw Error('缺少参数 --'+name);return i<0?undefined:args[i+1];};
async function main(){
 const manifest=modelManifest(root),feature=option('feature');
 const features=new Set(manifest.models.flatMap(m=>m.features));if(feature&&!features.has(feature))throw Error('可选功能：'+[...features].join(', '));
 const entries=manifest.models.filter(m=>!feature||m.features.includes(feature)),directory=option('models-dir');let failed=0;
 for(const m of entries){
  console.log(m.target+' | '+(m.bytes/1073741824).toFixed(2)+' GiB');
  if(!directory){console.log(m.url);continue;}
  const base=path.resolve(directory),file=path.resolve(base,...m.target.split('/'));if(!file.startsWith(base+path.sep))throw Error('清单包含越界路径');
  if(!fs.existsSync(file)){console.log('  缺失');failed++;continue;}
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==m.bytes){console.log('  文件类型或大小不符');failed++;continue;}
  if(args.includes('--hash')){const hash=createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);if(hash.digest('hex')!==m.sha256){console.log('  SHA256不符');failed++;continue;}console.log('  大小及SHA256通过');}
  else console.log('  大小通过；未校验SHA256');
 }
 console.log('共 '+entries.length+' 个文件，合计 '+(entries.reduce((n,m)=>n+m.bytes,0)/1073741824).toFixed(2)+' GiB；不含程序、缓存和生成结果。');
 if(!directory)console.log('本命令只列出来源，不下载模型。加 --models-dir 路径 检查本地文件；加 --hash 计算完整校验。');
 if(failed)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
