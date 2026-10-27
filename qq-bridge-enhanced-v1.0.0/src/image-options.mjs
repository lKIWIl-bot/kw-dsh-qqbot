export const IMAGE_FRAMES=Object.freeze({
 '竖图':Object.freeze({width:832,height:1216}),
 '横图':Object.freeze({width:1216,height:832}),
 '方图':Object.freeze({width:1024,height:1024}),
 '长竖图':Object.freeze({width:768,height:1344}),
});
export const UPSCALE_HELP='/高清 或 /高清 2K；/高清4K 或 /高清 4K。附图或引用单张图片，保持比例，长边2048/4096。';
export function qualityEdge(token){
 if(/^(?:高清|2k)$/i.test(token))return 2048;
 if(/^(?:4k|高清4k)$/i.test(token))return 4096;
 return null;
}
export function takeImageOptions(text){
 let description=String(text??'').trim(),framing,hd,match;
 while((match=/^(\S+)(?:\s+|$)/.exec(description))){
  const name=match[1],edge=qualityEdge(name);
  if(Object.hasOwn(IMAGE_FRAMES,name)){
   if(framing)throw Error('请只选择一种画面比例：竖图、横图、方图、长竖图');framing=name;
  }else if(edge){
   if(hd)throw Error('请只选择一个高清档位：2K/高清，或4K/高清4K');hd=edge;
  }else break;
  description=description.slice(match[0].length);
 }
 return {description,...(framing?{framing}:{}),...(hd?{hd}:{})};
}
export function parseUpscaleCommand(raw){
 if(!/^\/(?:高清|2k|4k)/i.test(raw))return null;
 const m=/^\/(高清4k|高清|2k|4k)(?:\s+(高清4k|高清|2k|4k))?$/i.exec(raw);
 if(!m)return {type:'upscale-syntax',error:UPSCALE_HELP};
 const head=qualityEdge(m[1]),tail=m[2]?qualityEdge(m[2]):null;
 if(tail&&m[1]!=='高清'&&head!==tail)return {type:'upscale-syntax',error:'高清档位冲突。'+UPSCALE_HELP};
 return {type:'upscale-request',longEdge:tail??head,count:1};
}
export function frameSize(name='竖图'){
 const size=IMAGE_FRAMES[name];if(!size)throw Error('不支持的画面比例');return {...size};
}
export function longEdgeSize(width,height,longEdge){
 if(![width,height].every(n=>Number.isInteger(n)&&n>0)||![2048,4096].includes(longEdge))throw Error('高清尺寸无效');
 const scale=longEdge/Math.max(width,height);
 return {width:Math.max(2,Math.round(width*scale/2)*2),height:Math.max(2,Math.round(height*scale/2)*2)};
}
