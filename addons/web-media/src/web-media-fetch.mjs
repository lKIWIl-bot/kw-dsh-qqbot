import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {validateFetchUrl} from './safe-fetch.js';
import {extractWebImages,formatWebFetchResult} from './web-fetch-result.mjs';

export const WEB_MEDIA_LIMITS=Object.freeze({imageBytes:24*1048576,videoBytes:4*1024**3,bufferBytes:24*1048576,pageBytes:1048576,playlistBytes:4*1048576,segmentBytes:16*1048576,maxSegments:14400,maxDuration:120*60,maxCandidates:24,maxPages:4});
const redirects=new Set([301,302,303,307,308]);
export function publicMediaUrl(raw,base){
 const u=new URL(String(raw??'').trim(),base);
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.href.length>8192)throw Error('仅支持无内嵌账号密码的公开HTTP(S)网址');
 u.hash='';return u.href;
}
export function mediaError(error){
 return String(error?.message??error).replace(/https?:\/\/[^\s"<>]+/gi,'[网址]').replace(/(?:[A-Za-z]:[\\/])[^\r\n]+/g,'[缓存路径]').replace(/((?:token|password|authorization)\s*[=:]\s*)\S+/gi,'$1[已隐藏]').slice(0,350);
}
function oneRequest(url,address,{maxBytes,timeoutMs,truncate,referer,range,signal}){
 return new Promise((resolve,reject)=>{
  let req,res,settled=false;const chunks=[];let size=0;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value);};
  const abort=()=>{const e=Error('下载已取消或超时');finish(e);req?.destroy();res?.destroy();};
  const timer=setTimeout(abort,timeoutMs);
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  const headers={host:url.host,'user-agent':'Mozilla/5.0','accept':'*/*','accept-encoding':'identity'};
  if(referer)headers.referer=publicMediaUrl(referer);
  if(range)headers.range=`bytes=${range.offset}-${range.offset+range.length-1}`;
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  req=(url.protocol==='https:'?https:http).request({hostname:address,port:url.port||(url.protocol==='https:'?443:80),path:url.pathname+url.search,headers,method:'GET',servername:url.protocol==='https:'&&!net.isIP(hostname)?hostname:undefined,rejectUnauthorized:true},response=>{
   res=response;const statusCode=Number(res.statusCode),base={url:url.href,statusCode,headers:res.headers};
   if(redirects.has(statusCode)||statusCode<200||statusCode>=300){finish(null,{...base,buffer:Buffer.alloc(0),truncated:false});res.destroy();return;}
   if(range&&(statusCode!==206||!String(res.headers['content-range']??'').startsWith(`bytes ${range.offset}-${range.offset+range.length-1}/`))){finish(Error('站点不支持所需的视频分段字节范围'));res.destroy();return;}
   const declared=Number(res.headers['content-length']);if(!truncate&&declared>maxBytes){finish(Error('资源超过大小上限'));res.destroy();return;}
   res.on('data',chunk=>{
    if(settled)return;
    const next=size+chunk.length;
    if(next>maxBytes){
     if(truncate){chunks.push(chunk.subarray(0,maxBytes-size));size=maxBytes;finish(null,{...base,buffer:Buffer.concat(chunks,size),truncated:true});}
     else finish(Error('资源超过大小上限'));
     res.destroy();return;
    }
    size=next;chunks.push(chunk);
   });
   res.on('end',()=>finish(null,{...base,buffer:Buffer.concat(chunks,size),truncated:false}));
   res.on('error',e=>finish(e));res.on('aborted',()=>finish(Error('下载连接中断')));
  });
  req.on('error',e=>finish(e));req.end();
 });
}
async function streamedRequest(url,address,{maxBytes,timeoutMs,referer,range,signal,destination}){
 const controller=new AbortController(),abort=()=>controller.abort();
 const timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let handle,owned=false,complete=false;
 try{
  controller.signal.throwIfAborted();
  const headers={host:url.host,'user-agent':'Mozilla/5.0',accept:'*/*','accept-encoding':'identity'};
  if(referer)headers.referer=publicMediaUrl(referer);if(range)headers.range=`bytes=${range.offset}-${range.offset+range.length-1}`;
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  const res=await new Promise((resolve,reject)=>{
   const req=(url.protocol==='https:'?https:http).request({hostname:address,port:url.port||(url.protocol==='https:'?443:80),path:url.pathname+url.search,headers,method:'GET',servername:url.protocol==='https:'&&!net.isIP(hostname)?hostname:undefined,rejectUnauthorized:true,signal:controller.signal},response=>{clearTimeout(connectTimer);resolve(response);});
   const connectTimer=setTimeout(()=>req.destroy(Error('下载连接超时')),15000);
   req.setTimeout(30000,()=>req.destroy(Error('下载连接空闲超时')));
   req.on('error',e=>{clearTimeout(connectTimer);reject(e);});req.end();
  });
  res.on('error',()=>{}); // Opening the destination is asynchronous; pipeline attaches its own handler next.
  const base={url:url.href,statusCode:Number(res.statusCode),headers:res.headers};
  if(redirects.has(base.statusCode)||base.statusCode<200||base.statusCode>=300){res.destroy();return {...base,buffer:Buffer.alloc(0),truncated:false};}
  const declared=Number(res.headers['content-length']);if(declared>maxBytes){res.destroy();throw Error('资源超过大小上限（视频4GiB）');}
  if(range&&(base.statusCode!==206||!String(res.headers['content-range']??'').startsWith(`bytes ${range.offset}-${range.offset+range.length-1}/`))){res.destroy();throw Error('站点不支持所需的视频分段字节范围');}
  // Own a new file before writing; never overwrite or remove a caller's existing file.
  try{handle=await fs.open(destination,'wx');owned=true;}catch(e){res.destroy();throw e;}
  let bytes=0,prefixBytes=0;const prefix=[];
  const meter=new Transform({transform(chunk,encoding,callback){
   bytes+=chunk.length;if(bytes>maxBytes){callback(Error('资源超过大小上限（视频4GiB）'));return;}
   if(prefixBytes<65536){const part=chunk.subarray(0,65536-prefixBytes);prefix.push(Buffer.from(part));prefixBytes+=part.length;}
   callback(null,chunk);
  }});
  await pipeline(res,meter,handle.createWriteStream(),{signal:controller.signal});
  if(Number.isFinite(declared)&&declared>=0&&res.headers['content-length']!==undefined&&bytes!==declared)throw Error('下载文件不完整');
  complete=true;return {...base,file:destination,bytes,prefix:Buffer.concat(prefix,prefixBytes),truncated:false};
 }catch(e){if(controller.signal.aborted)throw Error('下载已取消或超时');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);await handle?.close().catch(()=>{});if(owned&&!complete)await fs.unlink(destination).catch(()=>{});}
}
// Every URL/redirect is DNS-validated and pinned to the approved address. Large media uses disk-backed streams.
export async function fetchWebMedia(raw,{maxBytes=WEB_MEDIA_LIMITS.pageBytes,timeoutMs=20000,truncate=false,referer,range,signal,destination,validate=validateFetchUrl,request}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>WEB_MEDIA_LIMITS.videoBytes+1048576)throw Error('无效下载大小限制');
 if(!destination&&!truncate&&maxBytes>WEB_MEDIA_LIMITS.bufferBytes)throw Error('大文件必须使用流式下载');
 if(destination&&(typeof destination!=='string'||truncate))throw Error('无效流式下载目标');
 request??=destination?streamedRequest:oneRequest;
 if(range&&(!Number.isSafeInteger(range.offset)||range.offset<0||!Number.isSafeInteger(range.length)||range.length<1||range.length>maxBytes))throw Error('无效分段范围');
 let current=publicMediaUrl(raw);const started=Date.now();
 for(let hop=0;hop<=5;hop++){
  signal?.throwIfAborted();const verified=await validate(current),url=verified.url;
  let result,last;
  const addresses=verified.addresses??[verified.ip];
  for(const address of addresses.slice(0,3)){
   const remaining=timeoutMs-(Date.now()-started);if(remaining<=0)throw Error('下载超时');
   try{result=await request(url,address,{maxBytes,timeoutMs:destination?remaining:Math.min(remaining,addresses.length>1?12000:remaining),truncate,referer,range,signal,destination});break;}catch(e){last=e;if(/上限|范围|取消/.test(e.message)||['EEXIST','ENOSPC','EACCES'].includes(e.code))throw e;}
  }
  if(!result)throw last??Error('下载失败');
  if(redirects.has(result.statusCode)){
   if(!result.headers.location)throw Error('网页跳转缺少目标地址');
   current=publicMediaUrl(result.headers.location,url);continue;
  }
  if(result.statusCode<200||result.statusCode>=300)throw Error('资源请求失败：HTTP '+result.statusCode);
  return {...result,url:url.href};
 }
 throw Error('网页跳转次数过多');
}
export function mediaFormat(bytes,mime=''){
 if(!Buffer.isBuffer(bytes)||bytes.length<12)return null;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {kind:'image',ext:'png'};
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {kind:'image',ext:'jpg'};
 if(['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return {kind:'image',ext:'gif'};
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {kind:'image',ext:'webp'};
 if(bytes.toString('ascii',4,8)==='ftyp'){const brand=bytes.toString('ascii',8,12);return /^M4[AB]/i.test(brand)?{kind:'file',ext:'m4a'}:{kind:'video',ext:brand==='qt  '?'mov':'mp4'};}
 if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return {kind:'video',ext:/matroska/i.test(mime)?'mkv':'webm'};
 if(bytes.toString('utf8',0,100).replace(/^\uFEFF/,'').trimStart().startsWith('#EXTM3U'))return {kind:'video',ext:'m3u8'};
 return null;
}
function decode(value){return String(value??'').replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,v=>{
 const map={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};if(map[v.toLowerCase()])return map[v.toLowerCase()];const code=v[2].toLowerCase()==='x'?parseInt(v.slice(3,-1),16):Number(v.slice(2,-1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):v;
});}
export function htmlAttributes(tag){const out={};for(const m of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))out[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);return out;}
const fileExtensions=new Set('pdf zip 7z rar gz bz2 xz tar txt csv json xml yaml yml md doc docx xls xlsx ppt pptx epub mobi azw3 mp3 m4a wav flac ogg opus aac srt ass vtt exe msi apk dmg iso bin'.split(' '));
export function fileFormat(bytes,headers={},url=''){
 if(!Buffer.isBuffer(bytes)||!bytes.length)return null;
 const start=bytes.toString('utf8',0,Math.min(1024,bytes.length)).trimStart();if(/^(?:<!doctype\s+html|<(?:html|head|body|title|script|meta|form|div)\b)/i.test(start))return null;
 const mime=String(headers?.['content-type']??'').split(';')[0].trim().toLowerCase(),disposition=String(headers?.['content-disposition']??'');
 if(mime==='text/html'||/^(?:image|video)\//.test(mime))return null;
 let ext;if(bytes.toString('ascii',0,5)==='%PDF-')ext='pdf';else if(bytes[0]===0x50&&bytes[1]===0x4b)ext='zip';else if(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&0xe0)===0xe0)ext='mp3';else if(bytes.toString('ascii',0,4)==='fLaC')ext='flac';else if(bytes.toString('ascii',0,4)==='OggS')ext='ogg';else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')ext='wav';
 const named=/filename\*?\s*=\s*(?:UTF-8''|["'])?([^;"'\r\n]+)/i.exec(disposition)?.[1]??new URL(url||'https://example.invalid/').pathname;
 let suffix;try{suffix=/\.([a-z0-9]{1,12})$/i.exec(decodeURIComponent(named).split(/[\\/]/).at(-1))?.[1].toLowerCase();}catch{}
 const mimeExt={'application/pdf':'pdf','application/zip':'zip','application/json':'json','application/xml':'xml','text/plain':'txt','text/csv':'csv','audio/mpeg':'mp3','audio/flac':'flac','audio/wav':'wav','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx'}[mime];
 // Office packages are ZIP containers, but retain the document extension.
 if(ext==='zip'&&['docx','xlsx','pptx','epub'].includes(suffix))ext=suffix;
 ext??=mimeExt??(fileExtensions.has(suffix)?suffix:null);
 if(!ext&&(/attachment/i.test(disposition)||/^(?:application|audio|text)\//.test(mime)))ext=suffix&&/^[a-z0-9]{1,12}$/.test(suffix)?suffix:'bin';
 return ext?{kind:'file',ext}:null;
}
export function extractWebFiles(body,pageUrl){
 const rows=[],seen=new Set();for(const match of String(body).replace(/<!--[\s\S]*?-->/g,'').matchAll(/<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)){
  const a=htmlAttributes(match[0]);if(!a.href)continue;
  try{const url=publicMediaUrl(a.href,pageUrl),suffix=/\.([a-z0-9]{1,12})$/i.exec(new URL(url).pathname)?.[1].toLowerCase();if(!fileExtensions.has(suffix)&&!/^<a\b[^>]*\bdownload(?:\s|=|>)/i.test(match[0]))continue;if(seen.has(url))continue;seen.add(url);rows.push({url,kind:'file',source:'download-link',label:a.title??''});if(rows.length>=210)break;}catch{}
 }return rows;
}
export function extractWebVideos(body,pageUrl){
 const html=String(body).replace(/<!--[\s\S]*?-->/g,''),out=[],seen=new Set();
 const add=(raw,source,label='')=>{try{const url=publicMediaUrl(raw,pageUrl);if(!raw||seen.has(url)||out.length>=24)return;seen.add(url);out.push({url,source,label:String(label).slice(0,140)});}catch{}};
 for(const m of html.matchAll(/<(video|source|meta)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)){
  const a=htmlAttributes(m[0]),tag=m[1].toLowerCase();
  if(tag==='meta'&&/^(?:og:video(?::(?:url|secure_url))?|twitter:player:stream)$/i.test(a.property??a.name??''))add(a.content,'social-video');
  else if(tag==='video'||tag==='source'&&(/^(?:video\/|application\/(?:vnd\.apple\.mpegurl|x-mpegurl))/i.test(a.type??'')||/\.(?:mp4|webm|m3u8|mov)(?:[?#]|$)/i.test(a.src??'')))add(a.src||a['data-src'],'video-source',a.label??'');
 }
 for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{
  const walk=(v,depth=0)=>{if(depth>8||!v||typeof v!=='object')return;if(Array.isArray(v)){for(const item of v.slice(0,50))walk(item,depth+1);return;}if(String(v['@type']).includes('VideoObject')&&typeof v.contentUrl==='string')add(v.contentUrl,'structured-video',v.name);for(const child of Object.values(v))if(typeof child==='object')walk(child,depth+1);};walk(JSON.parse(script[1]));
 }catch{}
 // Common player configs: literal resource URLs only; never eval JavaScript.
 for(const m of html.matchAll(/["'](?:file|videoUrl|video_url|playUrl|hls|src)["']\s*:\s*["']((?:https?:)?(?:\\?\/){2}[^"'\s<>]{1,4096}|[^"'\s<>]{1,4096}\.(?:mp4|webm|m3u8)(?:\?[^"'\s<>]*)?)["']/gi)){
  const raw=m[1].replace(/\\u002[fF]/g,'/').replace(/\\\//g,'/').replace(/\\u0026/g,'&');if(/\.(?:mp4|webm|m3u8)(?:[?#]|$)/i.test(raw))add(decode(raw),'player-config');
 }
 return out;
}
export async function inspectWebMedia(url,{kind='auto',fetchResource=fetchWebMedia,signal}={}){
 if(!['auto','image','video','file'].includes(kind))throw Error('资源类型无效');
 const pages=new Set(),candidates=[],seen=new Set();
 const add=(row,page)=>{if(candidates.length>=210||seen.has(row.url)||kind!=='auto'&&row.kind!==kind)return;seen.add(row.url);candidates.push({...row,referer:page});};
 const visit=async(raw,depth)=>{
  if(pages.size>=4)return;const target=publicMediaUrl(raw);if(pages.has(target))return;pages.add(target);
  const response=await fetchResource(target,{maxBytes:WEB_MEDIA_LIMITS.pageBytes,truncate:true,timeoutMs:15000,signal});
  const type=mediaFormat(response.buffer,String(response.headers?.['content-type']??''))??fileFormat(response.buffer,response.headers,response.url);
  if(type){add({url:response.url,...type,source:'direct',label:type.kind==='video'?'视频':type.kind==='image'?'图片':'文件'},response.url);return;}
  const body=response.buffer.toString('utf8'),view=formatWebFetchResult({url:response.url,statusCode:response.statusCode,body,truncated:response.truncated});
  if(view.isError)throw Error('站点返回验证或访问限制页面，未取得媒体');
  for(const row of extractWebVideos(body,response.url))add({...row,kind:'video'},response.url);
  for(const row of extractWebImages(body,response.url,{limit:210}))add({...row,kind:'image',label:row.alt},response.url);
  for(const row of extractWebFiles(body,response.url))add(row,response.url);
  if(depth<2&&(kind!=='image')&&!candidates.some(c=>c.kind==='video'))for(const m of body.matchAll(/<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)){
   const src=htmlAttributes(m[0]).src;if(src&&pages.size<4)try{await visit(publicMediaUrl(src,response.url),depth+1);}catch{} // An unsupported embedded player is not a reason to execute page code.
  }
 };
 await visit(url,0);
 return {candidates,pages:pages.size,note:candidates.length?'这些是候选资源，尚未完成下载或看图；按本次需求选取。':'未找到公开媒体地址。动态blob播放器、登录/验证或受保护视频可能无法解析。'};
}


