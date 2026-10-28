import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import {Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createInflateRaw} from 'node:zlib';import {ARCHIVE_PASSWORD} from './comfy-archive.mjs';
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export async function restoreOwnWebArchive(archive,directory,{maxBytes=4*1024**3,password=ARCHIVE_PASSWORD}={}){
 const parent=await fsp.lstat(directory),info=await fsp.lstat(archive);if(parent.isSymbolicLink()||!parent.isDirectory()||!info.isFile()||info.isSymbolicLink()||path.dirname(archive)!==directory||info.size<22||info.size>4*1024**3+1048576)throw Error('压缩包缓存无效。');
 const handle=await fsp.open(archive,'r');let output,owned=false,success=false;
 const read=async(offset,size)=>{if(!Number.isSafeInteger(offset)||offset<0||size<0||size>8192||offset+size>info.size)throw Error('压缩包边界无效。');const b=Buffer.alloc(size);const r=await handle.read(b,0,size,offset);if(r.bytesRead!==size)throw Error('压缩包数据不完整。');return b;};
 try{
  const end=await read(info.size-22,22);if(end.readUInt32LE(0)!==0x06054b50||end.readUInt16LE(20)!==0||end.readUInt32LE(4)!==0)throw Error('压缩包格式不受支持。');
  let directoryOffset=end.readUInt32LE(16),directorySize=end.readUInt32LE(12),count=end.readUInt16LE(10),footer=info.size-22;
  if(directoryOffset===0xffffffff){const ext=await read(info.size-98,76);if(ext.readUInt32LE(0)!==0x06064b50||ext.readBigUInt64LE(4)!==44n||ext.readUInt32LE(56)!==0x07064b50||ext.readBigUInt64LE(64)!==BigInt(info.size-98)||ext.readBigUInt64LE(24)!==1n||ext.readBigUInt64LE(32)!==1n)throw Error('压缩包ZIP64目录无效。');directoryOffset=Number(ext.readBigUInt64LE(48));directorySize=Number(ext.readBigUInt64LE(40));count=1;footer=info.size-98;}
  if(count!==1||!Number.isSafeInteger(directoryOffset)||directoryOffset+directorySize!==footer||directorySize>1024)throw Error('压缩包必须只有一个已登记媒体文件。');
  const central=await read(directoryOffset,directorySize);if(central.readUInt32LE(0)!==0x02014b50||central.readUInt32LE(42)!==0)throw Error('压缩包目录无效。');
  const flags=central.readUInt16LE(8),method=central.readUInt16LE(10),crc=central.readUInt32LE(16),nameLength=central.readUInt16LE(28),extraLength=central.readUInt16LE(30);
  if(![0x801,0x809].includes(flags)||![0,8].includes(method)||46+nameLength+extraLength!==directorySize)throw Error('压缩包条目不受支持。');
  const name=central.toString('utf8',46,46+nameLength),ext=/^media-01\.(png|jpg|webp|gif|mp4|webm|mov|mkv)$/.exec(name)?.[1];if(!ext)throw Error('压缩包内不是支持预览的图片或视频。');
  let compressed=central.readUInt32LE(20),size=central.readUInt32LE(24);
  if(compressed===0xffffffff||size===0xffffffff){const extra=central.subarray(46+nameLength);if(extra.length!==20||extra.readUInt16LE(0)!==1||extra.readUInt16LE(2)!==16)throw Error('压缩包ZIP64大小无效。');size=Number(extra.readBigUInt64LE(4));compressed=Number(extra.readBigUInt64LE(12));}
  if(!Number.isSafeInteger(size)||size<1||size>maxBytes||!Number.isSafeInteger(compressed)||compressed<12||compressed>4*1024**3+1048576)throw Error('压缩包内容大小超限。');
  const local=await read(0,30);if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(6)!==flags||local.readUInt16LE(8)!==method)throw Error('压缩包本地目录无效。');
  const localNameLength=local.readUInt16LE(26),localExtra=local.readUInt16LE(28),dataStart=30+localNameLength+localExtra;
  if((await read(30,localNameLength)).toString()!==name||dataStart+compressed+(flags&8?24:0)!==directoryOffset)throw Error('压缩包条目偏移无效。');
  if(flags&8){const d=await read(dataStart+compressed,24);if(d.readUInt32LE(0)!==0x08074b50||d.readUInt32LE(4)!==crc||d.readBigUInt64LE(8)!==BigInt(compressed)||d.readBigUInt64LE(16)!==BigInt(size))throw Error('压缩包校验目录无效。');}
  let k0=0x12345678,k1=0x23456789,k2=0x34567890,header=0,total=0,actualCrc=0xffffffff;
  const update=b=>{k0=(table[(k0^b)&255]^(k0>>>8))>>>0;k1=(Math.imul((k1+(k0&255))>>>0,134775813)+1)>>>0;k2=(table[(k2^(k1>>>24))&255]^(k2>>>8))>>>0;};for(const b of Buffer.from(password))update(b);
  const check=flags&8?local.readUInt16LE(10)>>>8:crc>>>24;
  const decrypt=new Transform({transform(chunk,e,cb){let skip=0;for(let i=0;i<chunk.length;i++){const t=(k2|2)>>>0,b=chunk[i]^((Math.imul(t,t^1)>>>8)&255);update(b);chunk[i]=b;if(header<12){header++;skip++;if(header===12&&b!==check){cb(Error('压缩包密码校验失败。'));return;}}}cb(null,chunk.subarray(skip));}});
  const meter=new Transform({transform(chunk,e,cb){total+=chunk.length;if(total>size){cb(Error('压缩包展开大小超限。'));return;}for(const b of chunk)actualCrc=table[(actualCrc^b)&255]^(actualCrc>>>8);cb(null,chunk);}});
  const part=path.join(directory,'media.part');output=await fsp.open(part,'wx');owned=true;
  const stages=[fs.createReadStream(archive,{start:dataStart,end:dataStart+compressed-1,highWaterMark:256*1024}),decrypt,...(method===8?[createInflateRaw()]:[]),meter,output.createWriteStream()];await pipeline(...stages);
  if(header!==12||total!==size||((actualCrc^0xffffffff)>>>0)!==crc)throw Error('压缩包CRC或大小校验失败。');
  const file=path.join(directory,'media.'+ext);try{await fsp.access(file);throw Error('压缩包恢复目标已存在。');}catch(e){if(e.code!=='ENOENT')throw e;}
  await fsp.rename(part,file);success=true;return {file,ext,bytes:size};
 }finally{await handle.close();await output?.close().catch(()=>{});if(owned&&!success)await fsp.unlink(path.join(directory,'media.part')).catch(()=>{});}
}
