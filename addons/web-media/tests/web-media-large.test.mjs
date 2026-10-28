import {ARCHIVE_PASSWORD} from '../src/comfy-archive.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fetchWebMedia,WEB_MEDIA_LIMITS,mediaFormat} from '../src/web-media-fetch.mjs';
import {writeWebMediaZip64} from '../src/web-media-zip64.mjs';
const chunk=Buffer.alloc(65536,1);chunk.writeUInt32BE(24);chunk.write('ftypisom',4);
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-large-media-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
async function fixture(t){
 const server=http.createServer((req,res)=>{
  res.on('error',()=>{});
  if(req.url==='/header-over'){res.writeHead(200,{'content-length':String(WEB_MEDIA_LIMITS.videoBytes+1)});res.end();return;}
  if(req.url==='/body-over'){res.writeHead(200);res.end(Buffer.alloc(256*1024));return;}
  if(req.url==='/slow'){res.writeHead(200);res.write(chunk);const timer=setInterval(()=>res.write(chunk),25);res.on('close',()=>clearInterval(timer));return;}
  if(req.url==='/redirect'){res.writeHead(302,{location:'/video'});res.end();return;}
  res.writeHead(200,{'content-length':String(chunk.length*32),'content-type':'video/mp4'});for(let i=0;i<32;i++)res.write(chunk);res.end();
 });
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const base='http://fixture.invalid:'+server.address().port,validate=async raw=>({url:new URL(raw),addresses:['127.0.0.1']});
 return {base,validate};
}
test('4GiB video bound uses a file-backed stream with only a bounded signature prefix',async t=>{
 const dir=temp(t),f=await fixture(t),file=path.join(dir,'media.part');assert.equal(WEB_MEDIA_LIMITS.videoBytes,4294967296);
 const r=await fetchWebMedia(f.base+'/redirect',{validate:f.validate,destination:file,maxBytes:WEB_MEDIA_LIMITS.videoBytes});
 assert.equal(r.bytes,chunk.length*32);assert.equal(r.buffer,undefined);assert.equal(r.prefix.length,65536);assert.equal(mediaFormat(r.prefix).ext,'mp4');
 assert.equal(fs.statSync(file).size,r.bytes);assert.ok(fs.readFileSync(file).equals(Buffer.concat(Array(32).fill(chunk))));
 await assert.rejects(fetchWebMedia(f.base+'/video',{validate:f.validate,maxBytes:WEB_MEDIA_LIMITS.videoBytes}),/流式下载/);
});
test('declared and actual streaming overflows abort and remove only owned partial files',async t=>{
 const dir=temp(t),f=await fixture(t),header=path.join(dir,'header.part'),body=path.join(dir,'body.part');
 await assert.rejects(fetchWebMedia(f.base+'/header-over',{validate:f.validate,destination:header,maxBytes:WEB_MEDIA_LIMITS.videoBytes}),/大小上限/);assert.ok(!fs.existsSync(header));
 await assert.rejects(fetchWebMedia(f.base+'/body-over',{validate:f.validate,destination:body,maxBytes:128*1024}),/大小上限/);assert.ok(!fs.existsSync(body));
 const existing=path.join(dir,'existing.part');fs.writeFileSync(existing,'keep');await assert.rejects(fetchWebMedia(f.base+'/video',{validate:f.validate,destination:existing,maxBytes:WEB_MEDIA_LIMITS.videoBytes}),e=>e.code==='EEXIST');assert.equal(fs.readFileSync(existing,'utf8'),'keep');
});
test('cancelled streaming downloads close and remove their partial file',async t=>{
 const dir=temp(t),f=await fixture(t),file=path.join(dir,'cancel.part');
 await assert.rejects(fetchWebMedia(f.base+'/slow',{validate:f.validate,destination:file,maxBytes:WEB_MEDIA_LIMITS.videoBytes,signal:AbortSignal.timeout(60)}),/取消|超时/);assert.ok(!fs.existsSync(file));
});
test('streamed encrypted ZIP64 is compatible with standard ZIP readers and preserves exact media bytes',async t=>{
 const dir=temp(t),file=path.join(dir,'media.mp4'),out=path.join(dir,'archive.zip');fs.writeFileSync(file,Buffer.concat(Array(16).fill(chunk)));
 const result=await writeWebMediaZip64(file,out,'mp4');assert.equal(result.bytes,fs.statSync(out).size);
 const end=fs.readFileSync(out).subarray(-98);assert.equal(end.readUInt32LE(0),0x06064b50);assert.equal(end.readUInt32LE(56),0x07064b50);
 const python=process.env.PYTHON||'python';
 const checked=spawnSync(python,['-B','-c',"import sys,zipfile,pathlib; z=zipfile.ZipFile(sys.argv[1]); i=z.infolist()[0]; assert i.extract_version==45 and i.flag_bits&1; assert z.read(i,pwd=sys.argv[3].encode())==pathlib.Path(sys.argv[2]).read_bytes()",out,file,ARCHIVE_PASSWORD],{windowsHide:true,encoding:'utf8'});if(checked.error?.code==='ENOENT')t.diagnostic('Python不可用，跳过额外的标准库ZIP互操作检查');else assert.equal(checked.status,0,checked.stderr);
 await assert.rejects(writeWebMediaZip64(file,out,'mp4'),e=>e.code==='EEXIST');assert.equal(fs.statSync(out).size,result.bytes);
});
test('ZIP64 cancellation and file limits fail before publishing an archive',async t=>{
 const dir=temp(t),file=path.join(dir,'media.mp4'),out=path.join(dir,'archive.zip');fs.writeFileSync(file,chunk);
 await assert.rejects(writeWebMediaZip64(file,out,'mp4',{maxBytes:chunk.length-1}),/size/);assert.ok(!fs.existsSync(out));
 const controller=new AbortController();controller.abort();await assert.rejects(writeWebMediaZip64(file,out,'mp4',{signal:controller.signal}));assert.ok(!fs.existsSync(out));
});
