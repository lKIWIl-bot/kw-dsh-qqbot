import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const PROJECT_ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const BRIDGE_ROOT=path.join(PROJECT_ROOT,'qq-bridge-enhanced-v1.0.0');
export const CONFIG_PATH=path.join(BRIDGE_ROOT,'config.json');
export function readDeployment(){
 try{return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}
}
export function deploymentPath(value,fallback){return path.resolve(PROJECT_ROOT,value||fallback);}
const config=readDeployment();
export const COMFY_URL=String(config.comfyChat?.url||'http://127.0.0.1:8188').replace(/\/+$/,'');
export const PYTHON_PATH=config.comfyChat?.pythonPath||'python';
export function featureEnabled(name){return readDeployment().comfyChat?.features?.[name]!==false;}
