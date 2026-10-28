import fs from 'node:fs';
import path from 'node:path';
import {parentPort,workerData} from 'node:worker_threads';
import {writeWebMediaZip64} from './web-media-zip64.mjs';
import {validWebArchiveName} from './web-media-names.mjs';
try{
 const {directory,file,output,ext}=workerData,root=fs.realpathSync(directory);
 if(!/^[a-z0-9]{1,12}$/.test(ext)||path.dirname(file)!==directory||path.dirname(output)!==directory||!/^media\.[a-z0-9]+$/.test(path.basename(file))||!validWebArchiveName(path.basename(output)))throw Error('Invalid archive job');
 const maxBytes=['png','jpg','webp','gif'].includes(ext)?24*1048576:4*1024**3;
 const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync(file)!==path.join(root,path.basename(file))||info.size>maxBytes)throw Error('Invalid cached media');
 const result=await writeWebMediaZip64(file,output,ext,{maxBytes});
 parentPort.postMessage({ok:true,bytes:result.bytes});
}catch(e){parentPort.postMessage({ok:false,error:e.message});}

