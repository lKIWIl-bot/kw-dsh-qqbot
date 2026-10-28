import path from 'node:path';
export function webArchiveStem(value,kind='file'){
 let stem=Array.from(String(value??'').normalize('NFKC').replace(/[^\p{L}\p{N}_-]/gu,'')).slice(0,10).join('');
 if(!stem)stem=kind==='image'?'图片文件':kind==='video'?'视频文件':'下载文件';
 if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))stem='文件'+stem;
 return Array.from(stem).slice(0,10).join('');
}
export function validWebArchiveName(value){
 if(typeof value!=='string'||!value.endsWith('.z删ip')||path.basename(value)!==value)return false;
 const stem=value.slice(0,-5);return stem.length>0&&webArchiveStem(stem)===stem&&Array.from(stem).length<=10;
}
export function availableWebArchiveName(value,kind,used){
 const stem=webArchiveStem(value,kind);let name=stem+'.z删ip';
 for(let i=2;used.has(name);i++){const suffix=String(i);name=Array.from(stem).slice(0,10-suffix.length).join('')+suffix+'.z删ip';if(i>10000)throw Error('压缩包名称重复过多，请更换简述');}
 return name;
}
