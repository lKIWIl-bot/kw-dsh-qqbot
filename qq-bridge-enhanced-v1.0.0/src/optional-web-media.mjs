import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {installedExtension} from '../../scripts/extension-lib.mjs';
export async function createOptionalWebMedia(options){
 if(options.cfg.webMedia?.enabled!==true)return null;
 const root=path.resolve(options.root,'..'),extension=installedExtension('web-media',root);
 if(!extension)throw Error('web-media扩展未安装，请安装配套扩展或将webMedia.enabled关闭');
 const {createWebMedia,bridgeMediaRpc,parseWebMediaCommand}=await import(pathToFileURL(path.join(extension.directory,extension.manifest.entry)).href);
 return Object.assign(createWebMedia({...options,rpc:options.rpc??((action,params)=>bridgeMediaRpc(options.bot())(action,params))}),{isCommand:text=>!!parseWebMediaCommand(text),isArchiveName:name=>typeof name==='string'&&/^[\p{L}\p{N}_-]{1,10}\.z删ip$/u.test(name)});
}
export function downloadHelp(admin=false){
 return admin?'\n\n【网页下载管理】\n/正常抓取 —— 当前会话直接发送\n/加密抓取 —— 当前会话密码打包\n/清除抓取缓存 —— 清理已结束的下载缓存':'\n\n【网页下载】\n/下载图片 链接 [序号] —— 下载图片\n/下载视频 链接 [序号] —— 下载视频\n/下载文件 链接 [序号] —— 下载其他文件';
}
