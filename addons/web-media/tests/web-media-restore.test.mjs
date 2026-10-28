import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {writeWebMediaZip64} from '../src/web-media-zip64.mjs';import {restoreOwnWebArchive} from '../src/web-media-restore.mjs';import {webMediaZip} from '../src/comfy-archive.mjs';import {createWebMedia} from '../src/web-media.mjs';import {availableWebArchiveName,validWebArchiveName} from '../src/web-media-names.mjs';
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(120)]);
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-web-restore-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
test('own ZIP32 and ZIP64 media archives restore with bounded streaming and exact CRC',async t=>{
 for(const kind of ['zip32','zip64']){
  const dir=temp(t),source=path.join(dir,'source.mp4'),archive=path.join(dir,'测试视频.z删ip');fs.writeFileSync(source,mp4);
  if(kind==='zip32')fs.writeFileSync(archive,webMediaZip([{bytes:mp4,ext:'mp4'}]));else await writeWebMediaZip64(source,archive,'mp4');
  const result=await restoreOwnWebArchive(archive,dir);assert.equal(result.ext,'mp4');assert.ok(fs.readFileSync(result.file).equals(mp4));
  await assert.rejects(restoreOwnWebArchive(archive,dir),/已存在/);assert.ok(fs.readFileSync(result.file).equals(mp4));
 }
});
test('corruption and wrong passwords never publish a restored media file',async t=>{
 const dir=temp(t),archive=path.join(dir,'坏包.z删ip');const bytes=webMediaZip([{bytes:mp4,ext:'mp4'}]);bytes[bytes.length-24]^=1;fs.writeFileSync(archive,bytes);
 await assert.rejects(restoreOwnWebArchive(archive,dir));assert.equal(fs.existsSync(path.join(dir,'media.mp4')),false);
 fs.writeFileSync(archive,webMediaZip([{bytes:mp4,ext:'mp4'}],{password:'wrong'}));await assert.rejects(restoreOwnWebArchive(archive,dir));assert.equal(fs.existsSync(path.join(dir,'media.mp4')),false);
});
test('missing local cache is recovered only through the quoted bot-file handle, without resending or source-site search',async t=>{
 const dir=temp(t),key='private:100001',sent=[],rpcCalls=[];let archiveBytes;
 const service=createWebMedia({root:dir,stateDir:dir,cfg:{},allowed:k=>k===key,guardFor:()=>()=>{},isOwner:id=>id==='100001',notify:async()=>{},botId:()=> '1000000002',rpc:async(action,params)=>{rpcCalls.push({action,params});assert.equal(action,'get_private_file_url');assert.equal(params.file_id,'quoted-id');return {url:'https://qq.test/archive'};},inspect:async()=>({candidates:[{url:'https://example.com/video.mp4',kind:'video'}]}),fetchResource:async url=>({url,buffer:url==='https://qq.test/archive'?archiveBytes:mp4,headers:{}}),deliver:async asset=>{sent.push(asset);return {messageId:901};}});t.after(()=>service.close());
 await service.command({key,text:'/加密抓取',userId:'100001',eventId:1});service.noteRequest({key,text:'下载视频',eventId:2});const choices=await service.inspect({key,token:'t',url:'https://example.com/'});service.send({key,token:'t',candidateId:choices.candidates[0].id,description:'测试视频'});
 for(let i=0;i<1000&&service.busy();i++)await new Promise(r=>setTimeout(r,5));assert.equal(sent.length,1);archiveBytes=fs.readFileSync(sent[0].file);assert.equal(path.basename(sent[0].file),'测试视频.z删ip');
 const jobDir=path.dirname(sent[0].file);assert.ok(path.resolve(jobDir).startsWith(path.resolve(dir)+path.sep));for(const file of fs.readdirSync(jobDir))fs.unlinkSync(path.join(jobDir,file));fs.rmdirSync(jobDir);
 const quoted={message_id:901,message:[{type:'file',data:{name:'测试视频.z删ip',file_id:'quoted-id',file_size:archiveBytes.length}}]};
 const restored=await service.loadArchivePreview('测试视频.z删ip',{key,quoted,actorQQ:'100001'});assert.equal(restored.kind,'video');assert.ok(fs.readFileSync(restored.file).equals(mp4));restored.release();assert.equal(rpcCalls.length,1);assert.equal(sent.length,1);
});
test('descriptive package names are safe, at most ten characters, and resolve collisions without random names',()=>{
 const used=new Set(['猫咪打滚.z删ip']);const name=availableWebArchiveName('猫咪打滚','video',used);assert.equal(name,'猫咪打滚2.z删ip');assert.equal(validWebArchiveName(name),true);
 const long=availableWebArchiveName('../../星空壁纸漂亮的夜晚和银河','image',new Set());assert.ok(Array.from(long.slice(0,-5)).length<=10);assert.equal(validWebArchiveName(long),true);
 for(const invalid of ['../视频.z删ip',path.resolve('视频.z删ip'),'CON.z删ip','超过十个汉字的文件名称说明.z删ip'])assert.equal(validWebArchiveName(invalid),false);
});
