import fs from 'node:fs/promises';
import path from 'node:path';
export function videoImageExtension(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10*1048576)throw Error('起始图片须小于 10 MiB');
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
 throw Error('起始图片仅支持 PNG、JPG 或 WebP');
}
// Only current OneBot segments or a reply verified to belong to this conversation.
export async function resolveQqVideoImage({segments=[],kind,id,selfId,extract,findMedia,getMessage,fetchImage}){
 let media=extract(segments).filter(m=>m.kind==='image');
 if(!media.length){
  const replies=segments.filter(s=>s.type==='reply');
  if(replies.length!==1)throw Error('请同条附一张图片，或引用一张图片后发送指令');
  const ref=String(replies[0].data?.id??'');
  if(!/^-?\d{1,16}$/.test(ref)||!Number.isSafeInteger(Number(ref)))throw Error('引用消息编号无效');
  media=(findMedia(ref)??[]).filter(m=>m.kind==='image');
  if(!media.length){
   const raw=await getMessage(Number(ref));
   const group=raw?.group_id??raw?.groupId,user=raw?.user_id??raw?.userId??raw?.sender?.user_id;
   if(!raw||(kind==='group'?String(group)!==String(id):group!=null||user==null||![String(id),String(selfId)].includes(String(user))))throw Error('无法确认引用图片属于当前会话');
   media=extract(raw.message??[]).filter(m=>m.kind==='image');
  }
 }
 if(media.length!==1)throw Error('每次生成视频请只选择一张起始图片');
 const image=await fetchImage(media[0]);
 if(!image?.buffer)throw Error('无法获取起始图片，请重新附图');
 videoImageExtension(image.buffer);return image.buffer;
}
// Only a gateway-returned file within this robot account's QQ picture cache.
// QQ paths and URLs provided by a user/model never reach this reader directly.
export async function readQqVideoCache(file,{homeDirectory,selfId,maxBytes=10*1048576}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||!/^\d{5,12}$/.test(String(selfId))||!homeDirectory)return null;
 if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>10*1048576)return null;
 const root=path.resolve(homeDirectory,'Documents','Tencent Files',String(selfId),'nt_qq','nt_data','Pic');
 const within=(base,target)=>{const rel=path.relative(base,target);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
 const target=path.resolve(file);if(!within(root,target)||! /\.(?:png|jpe?g|webp)$/i.test(target))return null;
 try{
  const [realRoot,realFile,stat]=await Promise.all([fs.realpath(root),fs.realpath(target),fs.lstat(target)]);
  if(path.relative(root,realRoot)!==''||!within(realRoot,realFile)||!stat.isFile()||stat.isSymbolicLink()||!stat.size||stat.size>maxBytes)return null;
  const handle=await fs.open(target,'r');
  try{
   const current=await handle.stat();if(!current.isFile()||current.size>maxBytes||!current.size)return null;
   const bytes=Buffer.alloc(maxBytes+1);let total=0;
   while(total<bytes.length){const {bytesRead}=await handle.read(bytes,total,bytes.length-total,null);if(!bytesRead)break;total+=bytesRead;}
   if(total>maxBytes||!total)return null;
   const image=bytes.subarray(0,total);videoImageExtension(image);return image;
  }finally{await handle.close();}
 }catch{return null;}
}

// Dedicated video compatibility path. Shared recognition/sticker fetcher is unchanged.
export async function fetchQqVideoImage(media,{getImage,readCache,validate,fallback}){
 const name=String(media?.file??'').trim();
 const safe=name.length>0&&name.length<=512&&!/[\\/\u0000-\u001f\u007f]/.test(name)&&!name.includes('..')&&/^[\w.+=@-]+$/.test(name);
 if(media?.kind==='image'&&safe){
  try{
   const info=await getImage(name);
   if(typeof info?.file==='string'){
    const bytes=await readCache(info.file);
    if(bytes){const image=validate(bytes);if(image)return image;}
   }
  }catch{} // Preserve the regular bounded gateway/network fallback.
 }
 return fallback();
}

