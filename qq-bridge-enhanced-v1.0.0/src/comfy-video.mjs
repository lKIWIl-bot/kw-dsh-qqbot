// Stable optional-extension boundary; no video worker or workflow is bundled in the base release.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {installedVideo} from '../../scripts/extension-lib.mjs';
export {videoImageExtension,resolveQqVideoImage,readQqVideoCache,fetchQqVideoImage} from './qq-image-source.mjs';
const found=installedVideo();
const extension=found?await import(pathToFileURL(path.join(found.directory,found.manifest.entry)).href):null;
export const VIDEO_INSTALLED=!!extension;
export const VIDEO_HELP=extension?.VIDEO_HELP??'图生视频扩展未安装；正式版仅提供生图和高清。';
export function parseVideoCommand(text){
 if(extension)return extension.parseVideoCommand(text);
 const raw=String(text??'').trim();
 if(/^\/生成视频/.test(raw))return {type:'removed-generation',error:'文生视频已从此版本移除；图生视频需另装video扩展。'};
 if(/^\/(?:图生视频|视频状态|取消视频)/.test(raw))return {type:'removed-generation',error:VIDEO_HELP};
 return null;
}
function required(){if(!extension)throw Error(VIDEO_HELP);return extension;}
export const validateVideoParams=(...args)=>required().validateVideoParams(...args);
export const buildVideoGraph=(...args)=>required().buildVideoGraph(...args);
export const stageVideoInput=(...args)=>required().stageVideoInput(...args);
export const generateVideo=(...args)=>required().generateVideo(...args);
