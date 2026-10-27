import {installedVideo} from './extension-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),bridge=path.join(root,'qq-bridge-enhanced-v1.0.0');
export async function checkDeployment({offline=false,lorasOnly=false,rootPath=root,request=fetch}={}){
 const dir=path.join(rootPath,'qq-bridge-enhanced-v1.0.0'),file=path.join(dir,'config.json'),report={errors:[],warnings:[],checks:[]};
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<22||major===22&&minor<13)report.errors.push('需要Node.js 22.13或更新版本');
 if(!fs.existsSync(file)){report.errors.push('缺少本机config.json，请先运行 setup');return report;}
 let c;try{c=JSON.parse(fs.readFileSync(file,'utf8'));}catch{report.errors.push('配置不是有效JSON');return report;}
 for(const key of ['ownerQQ','botQQ'])if(!/^[1-9]\d{4,11}$/.test(String(c[key]??'')))report.errors.push(key+'须为5~12位QQ号');
 if(String(c.ownerQQ)===String(c.botQQ))report.errors.push('管理员和机器人QQ不能相同');
 if(c.allowAllWhenEmpty!==false)report.errors.push('allowAllWhenEmpty应为false');
 if(c.admin?.allowL3===true)report.warnings.push('完全访问权限已启用，请核对权限确认及审批配置');
 if(!(c.allow?.private??[]).map(String).includes(String(c.ownerQQ)))report.errors.push('管理员必须在私聊白名单内');
 for(const key of ['wsUrl','httpUrl']){
  try{const url=new URL(c.snowluma?.[key]);if(!(key==='wsUrl'?['ws:','wss:']:['http:','https:']).includes(url.protocol))throw Error();if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))report.warnings.push('OneBot配置使用非本机地址，请确认访问控制');}catch{report.errors.push('OneBot '+key+'无效');}
 }
 if(!c.snowluma?.accessToken)report.warnings.push('OneBot令牌为空，请与QQ后端保持一致并确认访问控制');
 if(c.comfyChat?.enabled||lorasOnly){
  const feature=c.comfyChat.features??{};
  try{const url=new URL(c.comfyChat.url);if(!['http:','https:'].includes(url.protocol))throw Error();}catch{report.errors.push('Comfy地址无效');}
  if(typeof c.comfyChat.archivePassword!=='string'||!c.comfyChat.archivePassword||Buffer.byteLength(c.comfyChat.archivePassword)>128)report.errors.push('请设置有效的压缩密码');
  if(c.comfyChat.archivePassword==='change-me')report.warnings.push('仍使用示例压缩密码，请自行修改');
  const templates=[];
  if(feature.image!==false)templates.push(c.comfyChat.workflowPath||'image-workflow/qqbot.api.json');
  if(feature.video){try{if(!installedVideo(rootPath))report.errors.push('video扩展未安装；请先安装扩展或停用features.video');else templates.push('extensions/video/video-workflow/qqbot-video.api.json');}catch(error){report.errors.push('video扩展校验失败：'+error.message);}}
  if(feature.upscale)templates.push('image-workflow/qqbot-upscale-2k.api.json','image-workflow/qqbot-upscale-4k.api.json');
  const graphs=[];let availableLoras=[];
  for(const relative of templates){try{let graph=JSON.parse(fs.readFileSync(path.resolve(rootPath,relative),'utf8'));if(Array.isArray(graph.nodes)){const {buildQqbotWorkflow}=await import('../qq-workspace/qqbot-workflow.mjs');graph=buildQqbotWorkflow(graph).prompt;}graphs.push({relative,graph});}catch{report.errors.push('工作流缺失或无效：'+relative);}}
  try{
   const {discoverLoras}=await import('../qq-bridge-enhanced-v1.0.0/src/lora-discovery.mjs');
   const catalog=JSON.parse(fs.readFileSync(path.join(rootPath,fs.existsSync(path.join(rootPath,'image-workflow/loras.local.json'))?'image-workflow/loras.local.json':'image-workflow/loras.json'),'utf8'));
   const found=discoverLoras({catalog,config:c,rootPath});availableLoras=[...catalog.loras,...found.entries];report.loras={available:availableLoras.length,pending:found.pending};
   report.warnings.push(...found.warnings,...found.pending.map(p=>p.file+'：'+p.reason));
   if(!c.comfyChat.modelsDirectory&&!c.comfyChat.comfyDirectory&&!c.comfyChat.loras?.directories?.length)report.warnings.push('尚未配置LoRA目录；配置modelsDirectory、comfyDirectory或loras.directories即可扫描');
  }catch(error){report.errors.push('LoRA配置检查失败：'+error.message);}
  if(!offline&&!lorasOnly){
   try{
    const base=c.comfyChat.url.replace(/\/+$/,'');const response=await request(base+'/object_info',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const nodes=await response.json();
    for(const {relative,graph}of graphs)for(const node of Object.values(graph)){
     const spec=nodes[node.class_type];if(!spec){report.errors.push(relative+' 缺少节点：'+node.class_type);continue;}
     for(const [key,value]of Object.entries(node.inputs??{})){if(node.class_type==='LoadImage'&&key==='image')continue;const field=spec.input?.required?.[key]??spec.input?.optional?.[key],choices=field?.[0]==='COMBO'?field?.[1]?.options:field?.[0];if(Array.isArray(choices)&&typeof value==='string'&&!choices.some(v=>String(v).replaceAll('\\','/')===value.replaceAll('\\','/')))report.errors.push(relative+' 缺少选择项：'+node.class_type+'.'+key+'='+value);}
    }
    if(availableLoras.length){const spec=nodes.LoraLoaderModelOnly?.input?.required?.lora_name,choices=spec?.[0]==='COMBO'?spec?.[1]?.options:spec?.[0];if(!Array.isArray(choices))report.errors.push('Comfy缺少可用的Anima LoRA加载节点');else for(const lora of availableLoras)if(!choices.some(name=>String(name).replaceAll('\\','/')===lora.filename.replaceAll('\\','/')))report.errors.push('机器人已发现但Comfy尚不可见的LoRA：'+lora.name);}
    report.checks.push('Comfy节点和模板模型选择已核对（未执行生成）');
   }catch{report.errors.push('Comfy尚未连接；聊天可独立运行，启用生成前启动Comfy并重跑doctor');}
  }
 }else report.checks.push('Comfy功能未启用，聊天可独立部署');
 if(offline)report.warnings.push('离线检查未确认QQ登录、DSH连接、实际模型可加载性和GPU生成');
 if(!report.errors.length)report.checks.push('配置静态检查通过');return report;
}
