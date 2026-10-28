import {parentPort,workerData} from 'node:worker_threads';
import {restoreOwnWebArchive} from './web-media-restore.mjs';
try{parentPort.postMessage({ok:true,...await restoreOwnWebArchive(workerData.archive,workerData.directory,{maxBytes:workerData.maxBytes})});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
