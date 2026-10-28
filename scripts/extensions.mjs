import {EXTENSION_IDS,installedExtension,installExtension,setExtensionEnabled,removeExtension} from './extension-lib.mjs';
const [command='list',id,...args]=process.argv.slice(2);
try{
 if(command==='list')for(const name of EXTENSION_IDS){const x=installedExtension(name);console.log(x?name+' 已安装，版本 '+x.manifest.version+'；启用状态以本机config.json为准':name+' 未安装');}
 else{
  if(!EXTENSION_IDS.includes(id))throw Error('支持的扩展：'+EXTENSION_IDS.join('、'));
  if(command==='install'){const index=args.indexOf('--from');if(index<0||!args[index+1])throw Error('用法：install '+id+' --from 扩展解压目录');installExtension(id,args[index+1]);console.log(id+'已安装，默认未启用；核对依赖后再执行enable '+id);}
  else if(command==='enable'||command==='disable'){setExtensionEnabled(id,command==='enable');console.log(id+'已'+(command==='enable'?'启用':'停用')+'；重启桥接并重新加载DSH的QQ MCP后生效');}
  else if(command==='remove'){removeExtension(id);console.log(id+'扩展已移除；模型、下载文件和生成结果保留');}
  else throw Error('命令：list、install <id> --from 目录、enable <id>、disable <id>、remove <id>');
 }
}catch(e){console.error(e.message);process.exitCode=1;}
