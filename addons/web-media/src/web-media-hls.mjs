import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fetchWebMedia,publicMediaUrl,WEB_MEDIA_LIMITS} from './web-media-fetch.mjs';

export const WEB_MEDIA_FFMPEG=process.env.KW_DSH_FFMPEG_PATH||'ffmpeg';
function attrs(line){const out={};for(const m of line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g))out[m[1]]=m[2]??m[3];return out;}
function byteRange(value,previousEnd){
 if(!value)return undefined;const m=/^(\d+)(?:@(\d+))?$/.exec(value);if(!m)throw Error('不支持的视频分段范围');
 const length=Number(m[1]),offset=m[2]===undefined?previousEnd:Number(m[2]);
 if(!Number.isSafeInteger(length)||length<1||length>WEB_MEDIA_LIMITS.segmentBytes||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(offset+length))throw Error('视频分段范围超限');
 return {length,offset};
}
export function parseHlsPlaylist(text,url){
 const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(lines[0]!=='#EXTM3U')throw Error('不是有效的m3u8播放列表');
 if(lines.some(l=>new RegExp('^#EXT-X-(?:SESSION-)?KEY:').test(l)&&attrs(l).METHOD!=='NONE'))throw Error('暂不支持加密或DRM视频');
 const variants=[],audio=[],segments=[];let pendingVariant,pendingDuration,pendingRange,map,totalDuration=0,previousUri='',previousEnd;
 for(const line of lines){
  if(line.startsWith('#EXT-X-STREAM-INF:'))pendingVariant=attrs(line);
  else if(line.startsWith('#EXT-X-MEDIA:')){const a=attrs(line);if(a.TYPE==='AUDIO'&&a.URI)audio.push({...a,url:publicMediaUrl(a.URI,url)});}
  else if(line.startsWith('#EXTINF:')){pendingDuration=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(pendingDuration)||pendingDuration<=0)throw Error('视频分段时长无效');}
  else if(line.startsWith('#EXT-X-BYTERANGE:'))pendingRange=line.slice(17);
  else if(line.startsWith('#EXT-X-MAP:')){const a=attrs(line);if(!a.URI)throw Error('视频初始化段缺少地址');const entry={url:publicMediaUrl(a.URI,url),range:byteRange(a.BYTERANGE,0)};if(map&&JSON.stringify(map)!==JSON.stringify(entry))throw Error('暂不支持中途更换初始化格式的视频');map=entry;}
  else if(!line.startsWith('#')){
   const absolute=publicMediaUrl(line,url);
   if(pendingVariant){variants.push({...pendingVariant,url:absolute});pendingVariant=undefined;continue;}
   if(pendingDuration===undefined)throw Error('视频分段缺少时长');
   const range=byteRange(pendingRange,absolute===previousUri?previousEnd:undefined);
   segments.push({url:absolute,duration:pendingDuration,range});totalDuration+=pendingDuration;
   previousUri=absolute;previousEnd=range?range.offset+range.length:undefined;pendingDuration=undefined;pendingRange=undefined;
  }
 }
 if(variants.length)return {kind:'master',variants,audio};
 if(!lines.includes('#EXT-X-ENDLIST'))throw Error('暂不下载直播或持续更新的视频流');
 if(!segments.length||segments.length>WEB_MEDIA_LIMITS.maxSegments||totalDuration>WEB_MEDIA_LIMITS.maxDuration)throw Error('视频超过120分钟或14400个分段上限');
 return {kind:'media',segments,map,totalDuration};
}
export function selectHlsVariant(variants){
 const sorted=[...variants].sort((a,b)=>Number(a.BANDWIDTH??0)-Number(b.BANDWIDTH??0));
 const preferred=sorted.filter(v=>{const height=Number(v.RESOLUTION?.split('x')[1]??0);return height?height<=720:Number(v.BANDWIDTH??0)<=5000000;});
 return preferred.at(-1)??sorted[0];
}
export async function downloadHls(url,directory,{referer,signal,fetchResource=fetchWebMedia,ffmpeg=WEB_MEDIA_FFMPEG,runMux=muxLocalHls}={}){
 const visited=new Set();let budget=0;
 const playlist=async(url,depth=0)=>{
  signal?.throwIfAborted();if(depth>3||visited.has(url))throw Error('视频播放列表嵌套过深或循环');visited.add(url);
  const r=await fetchResource(url,{maxBytes:WEB_MEDIA_LIMITS.playlistBytes,timeoutMs:20000,referer,signal});
  const p=parseHlsPlaylist(r.buffer.toString('utf8'),r.url);
  if(p.kind==='media')return {...p,url:r.url};
  const variant=selectHlsVariant(p.variants),media=await playlist(variant.url,depth+1);
  const group=p.audio.filter(a=>a['GROUP-ID']===variant.AUDIO),external=group.find(a=>a.DEFAULT==='YES')??group[0];
  if(external)media.externalAudio=await playlist(external.url,depth+1);
  return media;
 };
 const media=await playlist(publicMediaUrl(url));
 const writeTrack=async(track,prefix)=>{
  const output=['#EXTM3U','#EXT-X-VERSION:7','#EXT-X-TARGETDURATION:'+Math.ceil(Math.max(...track.segments.map(s=>s.duration))),'#EXT-X-MEDIA-SEQUENCE:0'];
  const get=async(entry,name)=>{
   signal?.throwIfAborted();const left=WEB_MEDIA_LIMITS.videoBytes-budget;if(left<=0)throw Error('视频超过4GiB限制');
   const r=await fetchResource(entry.url,{maxBytes:Math.min(WEB_MEDIA_LIMITS.segmentBytes,left),timeoutMs:30000,referer:referer??track.url,range:entry.range,signal});
   budget+=r.buffer.length;if(budget>WEB_MEDIA_LIMITS.videoBytes||!r.buffer.length)throw Error('视频分段为空或总大小超限');
   await fs.writeFile(path.join(directory,name),r.buffer,{flag:'wx'});
  };
  if(track.map){await get(track.map,prefix+'-init.mp4');output.push('#EXT-X-MAP:URI="'+prefix+'-init.mp4"');}
  for(let i=0;i<track.segments.length;i++){
   const s=track.segments[i],name=prefix+'-'+String(i).padStart(4,'0')+(track.map?'.m4s':'.ts');
   await get(s,name);output.push('#EXTINF:'+s.duration+',',name);
  }
  output.push('#EXT-X-ENDLIST');const file=path.join(directory,prefix+'.m3u8');await fs.writeFile(file,output.join('\n')+'\n',{flag:'wx'});return file;
 };
 const video=await writeTrack(media,'video'),audio=media.externalAudio?await writeTrack(media.externalAudio,'audio'):null;
 const output=path.join(directory,'media.mp4');await runMux({ffmpeg,video,audio,output,signal});
 const stat=await fs.stat(output);if(stat.size<12||stat.size>WEB_MEDIA_LIMITS.videoBytes)throw Error('合并后的视频为空或超过4GiB');
 return {file:output,kind:'video',ext:'mp4',bytes:stat.size,duration:media.totalDuration};
}
export async function muxLocalHls({ffmpeg,video,audio,output,signal}){
 if(/[\\/]/.test(ffmpeg))await fs.access(ffmpeg);
 return new Promise((resolve,reject)=>{
  // FFmpeg sees only locally generated playlists. No remote URL can reach its protocol handlers.
  const args=['-nostdin','-hide_banner','-loglevel','error','-threads','1','-protocol_whitelist','file','-allowed_extensions','ALL','-i',video];
  if(audio)args.push('-protocol_whitelist','file','-allowed_extensions','ALL','-i',audio);
  args.push('-map','0:v:0','-map',audio?'1:a:0':'0:a:0?','-c','copy','-movflags','+faststart','-n',output);
  let message='',settled=false;const child=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const done=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
  const abort=()=>{child.kill();done(Error('视频合并已取消或超时'));};const timer=setTimeout(abort,600000);
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  child.stderr.on('data',b=>{message=(message+b.toString()).slice(-400);});child.on('error',()=>done(Error('无法启动FFmpeg；请安装到PATH或设置webMedia.ffmpegPath')));child.on('close',code=>done(code===0?null:Error('视频编码/封装暂不支持，合并失败：'+message)));
 });
}
