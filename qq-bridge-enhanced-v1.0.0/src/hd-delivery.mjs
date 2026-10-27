import {PYTHON_PATH} from './runtime-config.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const MAX_HD_BYTES=64*1048576;
export const MAX_BATCH_BYTES=256*1048576;
export const INLINE_BYTES=20*1048576;
const python=PYTHON_PATH;
const previewScript=fileURLToPath(new URL('../../tools/make-image-preview.py',import.meta.url));
export function needsImageFileDelivery(images){return images.some(i=>i.bytes.length>INLINE_BYTES);}
export async function inlinePreviewImages(images){
 const result=[];
 for(const image of images){
  if(image.bytes.length<=INLINE_BYTES){result.push(image);continue;}
  if(image.bytes.length>MAX_HD_BYTES)throw Error('高清图片超过64MiB');
  const bytes=await new Promise((resolve,reject)=>{
   const child=spawn(python,[previewScript],{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[];let size=0,errorText='',finished=false;
   const stop=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(value);};
   const timer=setTimeout(()=>stop(Error('临时预览缩放超时')),30000);
   child.on('error',e=>stop(e));child.stdin.on('error',()=>{});
   child.stdout.on('data',b=>{size+=b.length;if(size>INLINE_BYTES)stop(Error('临时预览仍超过20MiB'));else chunks.push(b);});
   child.stderr.on('data',b=>{errorText=(errorText+b.toString()).slice(-400);});
   child.on('close',code=>{if(code!==0)stop(Error('临时预览缩放失败：'+errorText));else{const output=Buffer.concat(chunks);if(!output.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))stop(Error('预览不是PNG'));else stop(null,output);}});
   child.stdin.end(image.bytes);
  });
  result.push({bytes,ext:'png'});
 }
 return result;
}
