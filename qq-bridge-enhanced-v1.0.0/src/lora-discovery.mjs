import {modelManifest,PROJECT_ROOT} from '../../scripts/extension-lib.mjs';
import {entrySettings} from './lora-settings.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readDeployment,deploymentPath} from './runtime-config.mjs';
export const DEFAULT_CATALOG=fileURLToPath(new URL('../../image-workflow/loras.json',import.meta.url));
const normalized=value=>String(value).normalize('NFKC').toLowerCase();
const safeName=value=>typeof value==='string'&&/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(value);
const warningsFor=(name,side,metadata)=>{
 const messages=[];
 if(!Object.hasOwn(side,'trigger')&&!metadata.trigger)messages.push(name+'：触发词尚未确认，请核对模型作者说明；不要猜测。');
 if(side.usageConfirmed!==true)messages.push(name+'：推荐权重和特殊用法尚未确认，请核对作者说明。');
 return messages;
};
// Read only the bounded JSON header. Never load tensors or run code from a model directory.
export function safetensorsMetadata(file){
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('不是普通模型文件');
 const fd=fs.openSync(file,'r');
 try{
  const prefix=Buffer.alloc(8);if(fs.readSync(fd,prefix,0,8,0)!==8)throw Error('模型头不完整');
  const length=Number(prefix.readBigUInt64LE());if(!Number.isSafeInteger(length)||length<2||length>4*1048576||8+length>stat.size)throw Error('模型头大小无效');
  const data=Buffer.alloc(length);if(fs.readSync(fd,data,0,length,8)!==length)throw Error('模型头不完整');
  const header=JSON.parse(data.toString('utf8')),m=header.__metadata__??{};
  const version=String(m.ss_base_model_version??m.modelspec?.architecture??m['modelspec.architecture']??'').toLowerCase();
  const family=/anima/.test(version)?'anima':/sdxl|stable-diffusion-xl/.test(version)?'sdxl':null;
  const trigger=typeof m.trigger_words==='string'?m.trigger_words:typeof m['modelspec.trigger_phrase']==='string'?m['modelspec.trigger_phrase']:undefined;
  return {family,trigger};
 }finally{fs.closeSync(fd);}
}
export function discoverLoras({catalog,config=readDeployment(),rootPath=deploymentPath('.'),metadataReader=safetensorsMetadata}={}){
 const utilityLoras=new Set(modelManifest(PROJECT_ROOT).models.filter(m=>m.role==='pipeline-lora').map(m=>m.filename));
 const settings=config.comfyChat?.loras??{},pending=[],warnings=[],entries=[],categories={},descriptions={};
 if(settings.enabled===false)return {entries,pending,warnings,categories,descriptions};
 const folders=[...(settings.directories??[])];
 if(config.comfyChat?.modelsDirectory)folders.push({path:path.join(config.comfyChat.modelsDirectory,'loras')});
 if(config.comfyChat?.comfyDirectory)folders.push({path:path.join(config.comfyChat.comfyDirectory,'models','loras')});
 const names=new Set((catalog.loras??[]).map(l=>normalized(l.name))),seenFiles=new Set(),explicitFiles=new Set((catalog.loras??[]).map(l=>l.filename.replaceAll('\\','/')));
 let scanned=0;
 function walk(directory,folder,relative='',depth=0){
  if(depth>8){warnings.push('LoRA目录层级过深，已跳过');return;}
  for(const item of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   if(item.isSymbolicLink())continue;
   const file=path.join(directory,item.name),rel=relative?relative+'/'+item.name:item.name;
   if(item.isDirectory()){walk(file,folder,rel,depth+1);continue;}
   if(!item.isFile()||!item.name.endsWith('.safetensors')||utilityLoras.has(item.name))continue;
   if(++scanned>512)throw Error('LoRA扫描超过512个文件，请缩小目录范围');
   const canonical=fs.realpathSync(file);if(seenFiles.has(canonical))continue;seenFiles.add(canonical);
   const filename=(folder.comfyPrefix?folder.comfyPrefix.replaceAll('\\','/').replace(/\/$/,'')+'/':'')+rel;
   if(explicitFiles.has(filename))continue;
   try{
    const metadata=metadataReader(file),sidePath=file.replace(/\.safetensors$/,'.json');let side={};
    if(fs.existsSync(sidePath)){
     const info=fs.lstatSync(sidePath);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('补充JSON必须为小于64KiB的普通文件');
     side=JSON.parse(fs.readFileSync(sidePath,'utf8'));if(!side||typeof side!=='object'||Array.isArray(side))throw Error('补充JSON格式错误');
    }
    let base=side.base??folder.base;
    if(!base&&metadata.family){const matching=Object.entries(catalog.bases).filter(([,v])=>v.family===metadata.family);if(matching.length===1)base=matching[0][0];}
    if(!base||!catalog.bases?.[base]){pending.push({file:rel,reason:'底模未确认；在同名JSON的base或目录配置中选择底模'});continue;}
    if(catalog.bases[base].family!=='anima'){pending.push({file:rel,reason:'当前版本只启用Anima底模'});continue;}
    if(metadata.family&&catalog.bases[base].family!==metadata.family)throw Error('底模与模型元数据冲突');
    let name=side.name??path.basename(item.name,'.safetensors').normalize('NFKC').replace(/[^\p{L}\p{N}_-]/gu,'_').replace(/^[_-]+/,'').slice(0,55);
    if(!safeName(name))throw Error('名称无效，请在同名JSON设置name');
    if(names.has(normalized(name)))name=name.slice(0,54)+'_'+createHash('sha256').update(filename).digest('hex').slice(0,8);
    if(names.has(normalized(name)))throw Error('名称重复');names.add(normalized(name));
    const trigger=side.trigger??metadata.trigger??'',strengthModel=side.strengthModel??settings.defaultStrength??0.8;
    if(typeof trigger!=='string'||trigger.length>1000||/[\x00-\x1f]/.test(trigger)||!Number.isFinite(strengthModel)||strengthModel<=0||strengthModel>1.5)throw Error('触发词或权重无效');
    if(side.category!==undefined&&!['style','character','action'].includes(side.category))throw Error('分类无效');
    if(side.adminOnly!==undefined&&typeof side.adminOnly!=='boolean')throw Error('adminOnly需为布尔值');
    const entry={name,filename,base,trigger,strengthModel,...(side.category==='action'?{adminOnly:true}:side.adminOnly!==undefined?{adminOnly:side.adminOnly}:{} )};
    for(const field of ['strengthClip','promptGuidance','sampling','clipSkip','defaultNegative','characterPrompts','artistPrompt'])if(side[field]!==undefined)entry[field]=side[field];
    if(filename.length>240||/[\\\x00-\x1f:]/.test(filename)||filename.split('/').some(segment=>!segment||segment==='.'||segment==='..'))throw Error('Comfy相对文件名无效');
    if(entry.strengthClip!==undefined&&entry.strengthClip!==0)throw Error('Anima不修改文本编码器，strengthClip必须为0');
    if(entry.clipSkip!==undefined)throw Error('Anima不使用Clip Skip');
    entrySettings(entry);
    entries.push(entry);if(side.category)categories[name]=side.category;if(typeof side.description==='string')descriptions[name]=side.description;
    warnings.push(...warningsFor(name,side,metadata));
   }catch(error){pending.push({file:rel,reason:error.message});}
  }
 }
 for(const folder of folders){
  if(!folder||typeof folder.path!=='string'||!folder.path.trim())throw Error('LoRA目录配置无效');
  const directory=path.resolve(rootPath,folder.path);
  if(!fs.existsSync(directory)){warnings.push('一个LoRA目录不存在，请检查配置');continue;}
  if(!fs.statSync(directory).isDirectory())throw Error('LoRA路径不是目录');
  walk(directory,folder);
 }
 return {entries,pending,warnings,categories,descriptions};
}
export function readDiscoveredCatalog(file=DEFAULT_CATALOG){
 const local=file===DEFAULT_CATALOG?file.replace(/\.json$/,'.local.json'):file;
 const catalog=JSON.parse(fs.readFileSync(fs.existsSync(local)?local:file,'utf8'));
 if(path.resolve(file)!==path.resolve(DEFAULT_CATALOG)||catalog.version!==2)return catalog;
 const discovered=discoverLoras({catalog});
 return {...catalog,loras:[...catalog.loras,...discovered.entries],categories:{...catalog.categories,...discovered.categories},descriptions:{...catalog.descriptions,...discovered.descriptions}};
}
export function refreshLoraCatalog(){
 const local=DEFAULT_CATALOG.replace(/\.json$/,'.local.json'),catalog=JSON.parse(fs.readFileSync(fs.existsSync(local)?local:DEFAULT_CATALOG,'utf8')),report=discoverLoras({catalog});
 return {available:catalog.loras.length+report.entries.length,pending:report.pending,warnings:[...report.warnings,...report.pending.map(p=>p.file+'：'+p.reason)]};
}
