import fs from 'node:fs/promises';
import path from 'node:path';
import {looksLikeImageBuffer} from './safe-fetch.js';

export async function readQqImageCache(file,{homeDirectory,selfId,maxBytes=8*1048576}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||!homeDirectory||!/^\d{5,12}$/.test(String(selfId)))return null;
 if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>64*1048576||!/\.(?:png|jpe?g|webp|gif)$/i.test(file))return null;
 const within=(base,target)=>{const rel=path.relative(base,target);return !!rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
 const data=path.resolve(homeDirectory,'Documents','Tencent Files',String(selfId),'nt_qq','nt_data');
 const roots=[path.join(data,'Pic'),path.join(data,'Emoji','emoji-recv')],target=path.resolve(file),root=roots.find(x=>within(x,target));
 if(!root)return null;
 try{
  const [realRoot,realFile,stat]=await Promise.all([fs.realpath(root),fs.realpath(target),fs.lstat(target)]);
  if(path.relative(root,realRoot)!==''||!within(realRoot,realFile)||!stat.isFile()||stat.isSymbolicLink()||!stat.size||stat.size>maxBytes)return null;
  const handle=await fs.open(target,'r');
  try{
   const current=await handle.stat();if(!current.isFile()||!current.size||current.size>maxBytes)return null;
   const bytes=Buffer.alloc(maxBytes+1);let total=0;
   while(total<bytes.length){const part=await handle.read(bytes,total,bytes.length-total,null);if(!part.bytesRead)break;total+=part.bytesRead;}
   if(!total||total>maxBytes)return null;const image=bytes.subarray(0,total);
   return looksLikeImageBuffer(image)?image:null;
  }finally{await handle.close();}
 }catch{return null;}
}

export function createQqImageInputs({now=Date.now,ttlMs=5*60000,maxPerConversation=100}={}){
 const conversations=new Map();
 function remember(key,event,media){
  const ref=String(event?.message_id??event?.msg_id??event?.message_seq??'');
  if(!/^(?:group|private):\d+$/.test(key)||!ref||!Array.isArray(media)||!media.length)return;
  let map=conversations.get(key);if(!map){map=new Map();conversations.set(key,map);}
  map.delete(ref);map.set(ref,{ref,media,at:now()});
  for(const [id,value]of map)if(now()-value.at>ttlMs)map.delete(id);
  while(map.size>maxPerConversation)map.delete(map.keys().next().value);
  while(conversations.size>200)conversations.delete(conversations.keys().next().value);
 }
 function get(key,ref){const record=conversations.get(key)?.get(String(ref));return record&&now()-record.at<=ttlMs?record.media:[];}
 function source(key,event,hasDirectMedia=false){
  if(hasDirectMedia||!Array.isArray(event?.message))return null;
  const quoted=event.message.find(s=>s?.type==='reply'&&s.data?.id!=null)?.data.id;
  // An explicit quote always wins, even for short requests such as "解答" or just @.
  // It is a lookup candidate, not a claim that a text-only quote contains an image.
  if(quoted!=null){const ref=String(quoted);return /^-?[1-9]\d*$/.test(ref)&&Number.isSafeInteger(Number(ref))?{messageId:ref,type:'reply'}:null;}
  const text=event.message.filter(s=>s?.type==='text').map(s=>s.data?.text??'').join('');
  if(!/(?:图|照片|截图|表情|画面|看[看下]|这[个张]|识别|解答|答题|题目|这[两道]问|这道题)/.test(text))return null;
  const last=[...(conversations.get(key)?.values()??[])].reverse().find(x=>now()-x.at<=ttlMs);
  return last?{messageId:last.ref,type:'recent'}:null;
 }
 function hint(key,event,hasDirectMedia=false,{inline=false}={}){
  const ref=source(key,event,hasDirectMedia);if(!ref)return '';
  if(inline)return '\n【图片来源】'+(ref.type==='reply'?'本条引用的来源消息':'当前提问指向的图片消息')+' '+ref.messageId+'。当前聊天模式由桥接把来源图像内联到本次消息；请读取本次实际附带的image内容，不调用按需取图工具。只有本次确实附有image内容才算看到图片，不沿用上一张图或根据文字猜测。';

  return '\n【图片来源】'+(ref.type==='reply'?'本条引用的来源消息':'当前提问可能指向图片消息')+' '+ref.messageId+'。需要看图时调用 mcp__snowluma__qq_get_message_images，key='+key+'，messageId='+ref.messageId+'；引用图片支持直接读取，先取本次来源再判断内容，不要沿用上一张图或把文字提问的ID当成原图ID。';
 }

 return {remember,get,hint,source};
}

export async function recoverQqMessageMedia({key,ref,getMessage,extract,isHidden=()=>false}){
 const match=/^(group|private):(\d+)$/.exec(String(key));if(!match)return [];
 let current=String(ref),seen=new Set();
 for(let depth=0;depth<3;depth++){
  if(!/^-?[1-9]\d*$/.test(current)||!Number.isSafeInteger(Number(current))||seen.has(current))return [];seen.add(current);
  let raw;try{raw=await getMessage(Number(current));}catch{return [];}
  if(!raw||isHidden(raw,current))return [];
  const group=raw.group_id??raw.groupId,user=raw.user_id??raw.userId??raw.sender?.user_id;
  if(match[1]==='group'?group==null||String(group)!==match[2]:group!=null||user==null||String(user)!==match[2])return [];
  const media=extract(raw.message??[]);if(media.length)return media;
  const reply=Array.isArray(raw.message)?raw.message.find(s=>s?.type==='reply'&&s.data?.id!=null):null;
  if(!reply)return [];current=String(reply.data.id);
 }
 return [];
}
