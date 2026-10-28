import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {ARCHIVE_PASSWORD} from '../../../qq-bridge-enhanced-v1.0.0/src/comfy-archive.mjs';
export {ARCHIVE_PASSWORD};
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
// Traditional ZIP encryption for compatibility with standard archive readers.
function encryptZip(data,password,crc){
 let k0=0x12345678,k1=0x23456789,k2=0x34567890;
 const update=b=>{k0=(table[(k0^b)&255]^(k0>>>8))>>>0;k1=(Math.imul((k1+(k0&255))>>>0,134775813)+1)>>>0;k2=(table[(k2^(k1>>>24))&255]^(k2>>>8))>>>0;};
 for(const b of Buffer.from(password,'utf8'))update(b);
 const header=Buffer.alloc(12);randomBytes(11).copy(header);header[11]=crc>>>24;
 const plain=Buffer.concat([header,data]),out=Buffer.alloc(plain.length);
 for(let i=0;i<plain.length;i++){const temp=(k2|2)>>>0;out[i]=plain[i]^((Math.imul(temp,temp^1)>>>8)&255);update(plain[i]);}
 return out;
}
// Only in-memory, fixed image entries; never traverse directories or accept caller paths.
export function imageZip(images,options={}){return mediaZip(images,{...options,video:false});}
export function videoZip(bytes,{password=ARCHIVE_PASSWORD}={}){return mediaZip([{bytes,ext:'mp4'}],{password,video:true});}
export function webMediaZip(files,{password=ARCHIVE_PASSWORD}={}){return mediaZip(files,{password,web:true});}
function mediaZip(images,{password=null,video=false,web=false}={}){
 if(password!==null&&(typeof password!=='string'||!password.length||Buffer.byteLength(password)>128))throw new Error('Invalid archive password');
 if(!Array.isArray(images)||!images.length||images.length>20)throw new Error('Invalid archive image count');
 // ZIP stores local wall time with two-second precision in both headers.
 const stamp=new Date(),year=Math.max(1980,Math.min(2107,stamp.getFullYear()));
 const date=((year-1980)<<9)|((stamp.getMonth()+1)<<5)|stamp.getDate();
 const time=(stamp.getHours()<<11)|(stamp.getMinutes()<<5)|(stamp.getSeconds()>>1);
 const local=[],central=[];let offset=0,total=0;
 for(const [i,image] of images.entries()){
  if(!Buffer.isBuffer(image.bytes)||!(web?['png','jpg','webp','gif','mp4','webm','mov','mkv']:video?['mp4']:['png','jpg','webp']).includes(image.ext))throw new Error('Invalid archive image');
  if(!video&&!web&&image.bytes.length>64*1024*1024)throw new Error('Archive image exceeds 64 MiB');
  total+=image.bytes.length;if(total>(web?128:video?100:256)*1024*1024)throw new Error('Archive size limit exceeded');
  const name=Buffer.from(`${web?'media':video?'video':'image'}-${String(i+1).padStart(2,'0')}.${image.ext}`),crc=crc32(image.bytes),compressed=deflateRawSync(image.bytes),data=password===null?compressed:encryptZip(compressed,password,crc),flags=password===null?0x800:0x801;
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(flags,6);h.writeUInt16LE(8,8);h.writeUInt16LE(time,10);h.writeUInt16LE(date,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(image.bytes.length,22);h.writeUInt16LE(name.length,26);
  local.push(h,name,data);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt16LE(8,10);c.writeUInt16LE(time,12);c.writeUInt16LE(date,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(image.bytes.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(images.length,8);end.writeUInt16LE(images.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}

// Read only ZIPs created by this bot, in memory. No paths are extracted to disk.
function decryptImageZip(data,password,crc){
 let k0=0x12345678,k1=0x23456789,k2=0x34567890;
 const update=b=>{k0=(table[(k0^b)&255]^(k0>>>8))>>>0;k1=(Math.imul((k1+(k0&255))>>>0,134775813)+1)>>>0;k2=(table[(k2^(k1>>>24))&255]^(k2>>>8))>>>0;};
 for(const b of Buffer.from(password,'utf8'))update(b);
 if(data.length<12)throw Error('压缩包加密数据不完整。');
 const plain=Buffer.alloc(data.length);
 for(let i=0;i<data.length;i++){const temp=(k2|2)>>>0;plain[i]=data[i]^((Math.imul(temp,temp^1)>>>8)&255);update(plain[i]);}
 if(plain[11]!==crc>>>24)throw Error('压缩包密码不匹配。');
 return plain.subarray(12);
}
export function readImageZip(bytes,{password=ARCHIVE_PASSWORD}={}){
 try{
  if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>258*1024*1024)throw Error('invalid size');
  const end=bytes.length-22;
  if(bytes.readUInt32LE(end)!==0x06054b50||bytes.readUInt16LE(end+20)!==0||bytes.readUInt32LE(end+4)!==0)throw Error('invalid footer');
  const count=bytes.readUInt16LE(end+10),directorySize=bytes.readUInt32LE(end+12),directoryOffset=bytes.readUInt32LE(end+16);
  if(count<1||count>20||bytes.readUInt16LE(end+8)!==count||directoryOffset+directorySize!==end)throw Error('invalid directory');
  let pos=directoryOffset,total=0,localEnd=0;const images=[],names=new Set();
  for(let i=0;i<count;i++){
   if(pos+46>end||bytes.readUInt32LE(pos)!==0x02014b50)throw Error('invalid entry');
   const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),crc=bytes.readUInt32LE(pos+16),compressedSize=bytes.readUInt32LE(pos+20),size=bytes.readUInt32LE(pos+24),nameLength=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42);
   if(![0x800,0x801].includes(flags)||method!==8||size<1||size>64*1024*1024||pos+46+nameLength+extra+comment>end||bytes.readUInt16LE(pos+34)!==0)throw Error('unsupported entry');
   const name=bytes.toString('utf8',pos+46,pos+46+nameLength),match=/^image-\d{2}\.(png|jpg|webp)$/.exec(name);
   if(!match||names.has(name))throw Error('non-image or duplicate entry');names.add(name);total+=size;if(total>256*1024*1024)throw Error('batch limit');
   if(offset!==localEnd||offset+30>directoryOffset||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method||bytes.readUInt32LE(offset+14)!==crc||bytes.readUInt32LE(offset+18)!==compressedSize||bytes.readUInt32LE(offset+22)!==size)throw Error('invalid local header');
   const localName=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),start=offset+30+localName+localExtra;
   if(start+compressedSize>directoryOffset||bytes.toString('utf8',offset+30,offset+30+localName)!==name)throw Error('invalid local name');
   const encrypted=bytes.subarray(start,start+compressedSize),data=flags&1?decryptImageZip(encrypted,password,crc):encrypted;
   const image=inflateRawSync(data,{maxOutputLength:size});if(image.length!==size||crc32(image)!==crc)throw Error('checksum mismatch');
   images.push({bytes:image,ext:match[1]});localEnd=start+compressedSize;pos+=46+nameLength+extra+comment;
  }
  if(pos!==end||localEnd!==directoryOffset)throw Error('unexpected trailing data');return images;
 }catch(error){if(String(error.message).startsWith('压缩包'))throw error;throw Error('压缩包格式异常或不是本机器人生成的图片压缩包。');}
}
