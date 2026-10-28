import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertExtensionIdle} from './extension-lib.mjs';
import {validateUpscaleOptions} from '../qq-bridge-enhanced-v1.0.0/src/upscale-options.mjs';
export function setUpscaleMode(mode,{tile,root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))}={}){
 if(!['full-first','tiled'].includes(mode)||tile!==undefined&&![128,256].includes(tile))throw Error('用法：node scripts/upscale.mjs tiled|full-first [--tile 128|256]');
 assertExtensionIdle(root);
 const dir=path.join(root,'image-workflow'),file=path.join(dir,'upscale.json'),c=JSON.parse(fs.readFileSync(file,'utf8'));
 c.processing=mode;if(tile!==undefined)c.tile=tile;validateUpscaleOptions(c);
 const plans=[{file,data:c}];
 for(const name of ['qqbot-upscale-2k.api.json','qqbot-upscale-4k.api.json']){
  const target=path.join(dir,name),graph=JSON.parse(fs.readFileSync(target,'utf8'));const nodes=Object.values(graph).filter(n=>n.class_type==='DshIllustrationUpscale');
  if(nodes.length!==1)throw Error('高清模板绑定无效：'+name);Object.assign(nodes[0].inputs,{processing:mode,tile:c.tile});plans.push({file:target,data:graph});
 }
 const queue=path.join(root,'qq-bridge-enhanced-v1.0.0/state/comfy-chat.json');
 if(fs.existsSync(queue)&&JSON.parse(fs.readFileSync(queue)).jobs.some(j=>!['sent','failed','cancelled','interrupted','delivery-unknown'].includes(j.state)))throw Error('生成队列尚未结束，请先等待');
 const prepared=plans.map(p=>({...p,temp:p.file+'.'+randomUUID()+'.tmp'}));
 try{for(const p of prepared)fs.writeFileSync(p.temp,JSON.stringify(p.data,null,2)+'\n',{flag:'wx'});for(const p of prepared)fs.renameSync(p.temp,p.file);}finally{for(const p of prepared)if(fs.existsSync(p.temp))fs.unlinkSync(p.temp);}
 return {processing:mode,tile:c.tile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),mode=args[0]??'show',i=args.indexOf('--tile');
  if(mode==='show'){const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));console.log(JSON.stringify(validateUpscaleOptions(JSON.parse(fs.readFileSync(path.join(root,'image-workflow/upscale.json'),'utf8'))),null,2));}
  else{if(i>=0&&!args[i+1])throw Error('--tile需要128或256');console.log(JSON.stringify(setUpscaleMode(mode,{tile:i<0?undefined:Number(args[i+1])})));console.log('已同步机器人配置与2K/4K模板；重新启动桥接后生效。未启动GPU任务。');}
 }catch(e){console.error(e.message);process.exitCode=1;}
}
