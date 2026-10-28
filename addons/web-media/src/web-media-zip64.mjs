import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {ARCHIVE_PASSWORD} from './comfy-archive.mjs';
// Single stored entry, streamed ZipCrypto + ZIP64. Compressed videos need no second compression pass.
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export async function writeWebMediaZip64(file,output,ext,{password=ARCHIVE_PASSWORD,maxBytes=4*1024**3,signal}={}){
 if(!/^[a-z0-9]{1,12}$/.test(ext)||typeof password!=='string'||!password||Buffer.byteLength(password)>128)throw Error('Invalid archive input');
 const info=await fsp.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>maxBytes)throw Error('Invalid archive size');
 const size=BigInt(info.size),compressed=size+12n,name=Buffer.from('media-01.'+ext);
 const stamp=new Date(),year=Math.max(1980,Math.min(2107,stamp.getFullYear())),date=((year-1980)<<9)|((stamp.getMonth()+1)<<5)|stamp.getDate(),time=(stamp.getHours()<<11)|(stamp.getMinutes()<<5)|(stamp.getSeconds()>>1);
 const extra=Buffer.alloc(20);extra.writeUInt16LE(1);extra.writeUInt16LE(16,2);extra.writeBigUInt64LE(size,4);extra.writeBigUInt64LE(compressed,12);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(45,4);local.writeUInt16LE(0x809,6);local.writeUInt16LE(time,10);local.writeUInt16LE(date,12);local.writeUInt32LE(0xffffffff,18);local.writeUInt32LE(0xffffffff,22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(extra.length,28);
 let k0=0x12345678,k1=0x23456789,k2=0x34567890,crc=0xffffffff;
 const update=b=>{k0=(table[(k0^b)&255]^(k0>>>8))>>>0;k1=(Math.imul((k1+(k0&255))>>>0,134775813)+1)>>>0;k2=(table[(k2^(k1>>>24))&255]^(k2>>>8))>>>0;};
 for(const b of Buffer.from(password))update(b);
 const encrypt=(bytes,checksum=false)=>{for(let i=0;i<bytes.length;i++){const b=bytes[i];if(checksum)crc=table[(crc^b)&255]^(crc>>>8);const temp=(k2|2)>>>0;bytes[i]=b^((Math.imul(temp,temp^1)>>>8)&255);update(b);}return bytes;};
 let handle,owned=false,complete=false,offset=0n;
 const write=async bytes=>{signal?.throwIfAborted();let done=0;while(done<bytes.length){const r=await handle.write(bytes,done,bytes.length-done);if(!r.bytesWritten)throw Error('Archive write failed');done+=r.bytesWritten;}offset+=BigInt(bytes.length);};
 try{
  signal?.throwIfAborted();handle=await fsp.open(output,'wx');owned=true;
  await write(local);await write(name);await write(extra);
  const cryptoHeader=randomBytes(12);cryptoHeader[11]=time>>>8;await write(encrypt(cryptoHeader));
  let readBytes=0;for await(const chunk of fs.createReadStream(file,{highWaterMark:256*1024,signal})){readBytes+=chunk.length;if(readBytes>info.size)throw Error('Cached media changed');await write(encrypt(chunk,true));}
  const after=await fsp.lstat(file);if(readBytes!==info.size||after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.isSymbolicLink())throw Error('Cached media changed');
  crc=(crc^0xffffffff)>>>0;
  const descriptor=Buffer.alloc(24);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeBigUInt64LE(compressed,8);descriptor.writeBigUInt64LE(size,16);await write(descriptor);
  const directoryOffset=offset,central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(45,4);central.writeUInt16LE(45,6);central.writeUInt16LE(0x809,8);central.writeUInt16LE(time,12);central.writeUInt16LE(date,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(0xffffffff,20);central.writeUInt32LE(0xffffffff,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(extra.length,30);
  await write(central);await write(name);await write(extra);const directorySize=offset-directoryOffset,endOffset=offset;
  const end64=Buffer.alloc(56);end64.writeUInt32LE(0x06064b50);end64.writeBigUInt64LE(44n,4);end64.writeUInt16LE(45,12);end64.writeUInt16LE(45,14);end64.writeBigUInt64LE(1n,24);end64.writeBigUInt64LE(1n,32);end64.writeBigUInt64LE(directorySize,40);end64.writeBigUInt64LE(directoryOffset,48);await write(end64);
  const locator=Buffer.alloc(20);locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(endOffset,8);locator.writeUInt32LE(1,16);await write(locator);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(0xffff,8);end.writeUInt16LE(0xffff,10);end.writeUInt32LE(0xffffffff,12);end.writeUInt32LE(0xffffffff,16);await write(end);
  complete=true;return {bytes:Number(offset)};
 }finally{await handle?.close();if(owned&&!complete)await fsp.unlink(output).catch(()=>{});}
}

