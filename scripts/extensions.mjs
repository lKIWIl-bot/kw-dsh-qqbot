import {installedVideo,installVideo,setVideoEnabled,removeVideo} from './extension-lib.mjs';
const [command='list',id,...args]=process.argv.slice(2);
try{
 if(command==='list'){const v=installedVideo();console.log(v?'video 已安装，版本 '+v.manifest.version+'；启用状态以本机config.json为准':'video 未安装；正式版仅提供生图和高清');}
 else{
  if(id!=='video')throw Error('仅支持video扩展');
  if(command==='install'){const index=args.indexOf('--from');if(index<0||!args[index+1])throw Error('用法：install video --from 扩展解压目录');installVideo(args[index+1]);console.log('video已安装，默认未启用；核对模型后再执行enable video');}
  else if(command==='enable'||command==='disable'){setVideoEnabled(command==='enable');console.log('video已'+(command==='enable'?'启用':'停用')+'；重新启动桥接后生效');}
  else if(command==='remove'){removeVideo();console.log('video扩展已移除；模型和生成文件保留');}
  else throw Error('命令：list、install video --from 目录、enable video、disable video、remove video');
 }
}catch(e){console.error(e.message);process.exitCode=1;}
