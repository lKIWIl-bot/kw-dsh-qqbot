import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {randomBytes} from 'node:crypto';
import {checkDeployment} from './doctor.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),bridge=path.join(root,'qq-bridge-enhanced-v1.0.0'),configFile=path.join(bridge,'config.json');
const [command='help',...args]=process.argv.slice(2);
const option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const readConfig=()=>JSON.parse(fs.readFileSync(configFile,'utf8'));
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
async function setup(){
 if(fs.existsSync(configFile)){console.log('配置已存在，保留所有设置。修改后运行 doctor；不会自动覆盖。');return;}
 let owner=option('owner'),bot=option('bot');
 if((!owner||!bot)&&stdin.isTTY){const rl=createInterface({input:stdin,output:stdout});try{owner??=await rl.question('管理员QQ：');bot??=await rl.question('机器人QQ：');}finally{rl.close();}}
 for(const value of [owner,bot])if(!/^[1-9]\d{4,11}$/.test(value??''))throw Error('请提供5~12位QQ号：setup --owner 管理员QQ --bot 机器人QQ');
 if(owner===bot)throw Error('管理员QQ与机器人QQ不能相同');
 const c=JSON.parse(fs.readFileSync(path.join(bridge,'config.example.json'),'utf8'));
 c.ownerQQ=owner;c.botQQ=bot;c.allow.private=[owner];c.consoleToken=randomBytes(24).toString('hex');c.comfyChat.archivePassword=randomBytes(6).toString('hex');
 if(option('comfy')){c.comfyChat.enabled=true;c.comfyChat.url=option('comfy');}
 if(option('comfy-dir'))c.comfyChat.comfyDirectory=option('comfy-dir');
 if(option('models'))c.comfyChat.modelsDirectory=option('models');
 if(option('lora-dir'))c.comfyChat.loras.directories=[{path:option('lora-dir'),base:'anima'}];
 atomic(configFile,c);
 const localCatalog=path.join(root,'image-workflow/loras.local.json');if(!fs.existsSync(localCatalog))fs.copyFileSync(path.join(root,'image-workflow/loras.json'),localCatalog);
 console.log('已创建本机配置，仅开放管理员私聊。请在配置文件填写OneBot令牌，核对Comfy目录，再运行 doctor。');
}
function recordPath(kind){return path.join(bridge,'state','managed-'+kind+'.json');}
function ownProcess(record){
 if(!record||!Number.isInteger(record.pid)||record.pid<1)return false;
 try{process.kill(record.pid,0);}catch{return false;}
 if(process.platform!=='win32')throw Error('此维护入口首版仅支持Windows');
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}'; if($p){ $p | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress }`],{encoding:'utf8',windowsHide:true});
 try{const info=JSON.parse(result.stdout);return path.resolve(info.ExecutablePath).toLowerCase()===path.resolve(record.executable).toLowerCase()&&String(info.CommandLine).includes(record.entry);}catch{return false;}
}
const loadRecord=kind=>{try{return JSON.parse(fs.readFileSync(recordPath(kind),'utf8'));}catch{return null;}};
async function available(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error('端口 '+port+' 已被占用，请先检查已有服务')));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
async function start(kind){
 if(!fs.existsSync(configFile))throw Error('请先运行 setup');
 const report=await checkDeployment({offline:true});if(report.errors.length)throw Error(report.errors.join('\n'));
 if(ownProcess(loadRecord(kind))){console.log('此项目服务已启动');return;}
 const config=readConfig(),port=kind==='bridge'?(config.consolePort??3100):3099;await available(port);
 const entry=path.join(bridge,kind==='bridge'?'src/bridge.js':'src/launcher/control-center.mjs');
 const state=path.join(bridge,'state');fs.mkdirSync(state,{recursive:true});
 const out=fs.openSync(path.join(state,kind+'.out.log'),'a'),err=fs.openSync(path.join(state,kind+'.err.log'),'a');
 const child=spawn(process.execPath,[entry,...(kind==='console'?['--no-open']:[])],{cwd:bridge,detached:true,windowsHide:true,stdio:['ignore',out,err]});
 fs.closeSync(out);fs.closeSync(err);await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 atomic(recordPath(kind),{pid:child.pid,entry,executable:process.execPath});child.unref();console.log('已启动 '+kind+'，日志位于桥接 state 目录。');
}
async function stop(){
 const queue=path.join(bridge,'state','comfy-chat.json');
 if(fs.existsSync(queue)&&JSON.parse(fs.readFileSync(queue,'utf8')).jobs.some(j=>!['sent','failed','cancelled','interrupted','delivery-unknown'].includes(j.state)))throw Error('生成或发送队列尚未结束，请等待，或由管理员先执行 /清理管线');
 const downloads=path.join(bridge,'state','web-media.json');
 if(fs.existsSync(downloads)&&JSON.parse(fs.readFileSync(downloads,'utf8')).jobs.some(j=>['queued','downloading','sending'].includes(j.state)))throw Error('下载或发送尚未结束，请先等待');
 for(const kind of ['bridge','console']){const record=loadRecord(kind);if(ownProcess(record)){process.kill(record.pid,'SIGTERM');console.log('已停止此项目 '+kind);}else console.log(kind+' 没有可确认归属的运行进程，未执行停止。');}
}
async function status(){
 for(const kind of ['bridge','console'])console.log(kind+': '+(ownProcess(loadRecord(kind))?'运行中':'未由此入口启动'));
}
async function main(){
 if(command==='setup')return setup();
 if(command==='doctor'||command==='loras'){
  const report=await checkDeployment({offline:args.includes('--offline'),lorasOnly:command==='loras'});
  for(const msg of report.errors)console.log('错误：'+msg);for(const msg of report.warnings)console.log('提醒：'+msg);for(const msg of report.checks)console.log('通过：'+msg);
  if(report.loras)console.log('LoRA可用 '+report.loras.available+' 项，待确认 '+report.loras.pending.length+' 项');
  if(report.errors.length)process.exitCode=1;return;
 }
 if(command==='start')return start('bridge');if(command==='console')return start('console');if(command==='stop')return stop();if(command==='status')return status();
 if(command==='logs'){for(const name of ['bridge.out.log','bridge.err.log']){const file=path.join(bridge,'state',name);if(fs.existsSync(file))console.log(fs.readFileSync(file,'utf8').split(/\r?\n/).slice(-40).join('\n'));}return;}
 if(command==='setup-dsh'){
  if(!fs.existsSync(configFile))throw Error('先运行 setup');
  const profile=option('profile');if(profile&&!/^[a-zA-Z0-9_-]+$/.test(profile))throw Error('profile名称无效');
  const result=spawnSync(process.execPath,[path.join(bridge,'scripts/setup-dsh.mjs'),...(profile?[profile]:[])],{cwd:bridge,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1;return;
 }
 console.log('命令：setup、doctor [--offline]、loras、setup-dsh [--profile desktop]、start、console、stop、status、logs');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
