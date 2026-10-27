import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomInt} from 'node:crypto';
import {findLora,LORA_CATALOG_PATH} from './comfy-loras.mjs';

export const LORA_EXAMPLES_PATH=fileURLToPath(new URL('../../image-workflow/lora-examples.json',import.meta.url));
export const LORA_EXAMPLES_ROOT=fileURLToPath(new URL('../../image-workflow/lora-examples',import.meta.url));
const inside=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
const MAX_BYTES=8*1024*1024;
export function inspectLoraExampleImage(bytes,ext){
 if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>MAX_BYTES)throw Error('LoRA图例文件无效');
 let width,height;
 if(ext==='png'){
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw Error('LoRA图例不是PNG');
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
 }else if(ext==='jpg'||ext==='jpeg'){
  if(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('LoRA图例不是完整JPEG');
  let offset=2,found=false,scan=false;
  while(offset<bytes.length-2){
   if(bytes[offset++]!==255)throw Error('LoRA图例JPEG标记无效');
   while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];
   if(marker===0||marker===216||marker===217||marker===1||marker>=208&&marker<=215)throw Error('LoRA图例JPEG段无效');
   if(offset+2>bytes.length)throw Error('LoRA图例JPEG截断');
   const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length-2)throw Error('LoRA图例JPEG截断');
   if([192,193,194].includes(marker)){
    if(found||length<8)throw Error('LoRA图例JPEG尺寸无效');
    const components=bytes[offset+7];if(![1,3,4].includes(components)||length!==8+3*components)throw Error('LoRA图例JPEG帧无效');
    height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);found=true;
   }else if(marker===218){if(!found||length<6)throw Error('LoRA图例JPEG无有效帧');scan=true;break;}
   offset+=length;
  }
  if(!found||!scan)throw Error('LoRA图例JPEG无有效图像');
 }else throw Error('LoRA图例格式不支持');
 if(width<1||height<1||width>8192||height>8192||width*height>24000000)throw Error('LoRA图例尺寸无效');
 return {width,height};
}

// A QQ name can select only a configured style. Paths come exclusively from the local manifest.
export function selectLoraExample(name,{catalogFile=LORA_CATALOG_PATH,manifestFile=LORA_EXAMPLES_PATH,examplesRoot=LORA_EXAMPLES_ROOT,random=randomInt}={}){
 const l=findLora(name,catalogFile),catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
 if(catalog.categories?.[l.name]!=='style')return null;
 let config;try{config=JSON.parse(fs.readFileSync(manifestFile,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(config.version!==1||!config.examples||typeof config.examples!=='object'||Array.isArray(config.examples))throw Error('LoRA图例清单无效');
 const entries=config.examples[l.name];if(entries===undefined)return null;
 if(!Array.isArray(entries)||!entries.length||entries.length>32)throw Error('LoRA图例清单无效');
 const index=random(entries.length);if(!Number.isInteger(index)||index<0||index>=entries.length)throw Error('LoRA图例选择无效');
 const entry=entries[index];
 if(!entry||typeof entry.file!=='string'||entry.file.length>200||entry.file.includes('\\')||entry.file.includes(':')||/[\x00-\x1f]/.test(entry.file))throw Error('LoRA图例路径无效');
 const parts=entry.file.split('/');
 if(parts.length!==2||parts[0]!==l.name||!/\.(png|jpe?g)$/.test(parts[1])||parts.some(p=>!p||p==='.'||p==='..'))throw Error('LoRA图例路径无效');
 if(!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isInteger(entry.bytes)||entry.bytes<24||entry.bytes>MAX_BYTES)throw Error('LoRA图例校验信息无效');
 const root=path.resolve(examplesRoot),file=path.resolve(root,...parts);
 if(!inside(root,file))throw Error('LoRA图例路径越界');
 for(const node of [root,path.dirname(file),file]){const stat=fs.lstatSync(node);if(stat.isSymbolicLink())throw Error('LoRA图例不能使用链接');}
 const realRoot=fs.realpathSync(root),realFile=fs.realpathSync(file),stat=fs.statSync(file);
 if(!inside(realRoot,realFile)||!stat.isFile()||stat.size!==entry.bytes||stat.size>MAX_BYTES)throw Error('LoRA图例文件无效');
 const bytes=fs.readFileSync(file);
 if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('LoRA图例校验失败');
 const ext=path.extname(parts[1]).slice(1),{width,height}=inspectLoraExampleImage(bytes,ext);
 if(width!==entry.width||height!==entry.height)throw Error('LoRA图例尺寸无效');
 return {bytes,ext};
}
