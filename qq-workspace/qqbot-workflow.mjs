import {readDeployment,deploymentPath} from '../qq-bridge-enhanced-v1.0.0/src/runtime-config.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const QQBOT_PATH=deploymentPath(readDeployment().comfyChat?.workflowPath,'image-workflow/qqbot.api.json');
const allowed=new Set(['UNETLoader','CLIPLoader','CLIPTextEncode','VAELoader','KSamplerAdvanced','EmptyLatentImage','VAEDecode','PreviewImage','SaveImage']);
export function buildQqbotWorkflow(source,overrides={}){
 const ui=typeof source==='string'?JSON.parse(source):structuredClone(source),graph={};
 if(!Array.isArray(ui.nodes)){
  for(const [id,node]of Object.entries(ui)){if(!allowed.has(node.class_type))throw Error('Unsupported qqbot API node: '+node.class_type);graph[id]=node;}
  const sample=Object.values(graph).find(n=>n.class_type==='KSamplerAdvanced');
  if(!sample)throw Error('qqbot API requires KSamplerAdvanced');
  const positive=graph[sample.inputs.positive?.[0]],negative=graph[sample.inputs.negative?.[0]],latent=graph[sample.inputs.latent_image?.[0]];
  const savers=Object.entries(graph).filter(([,n])=>n.class_type==='SaveImage');
  if(positive?.class_type!=='CLIPTextEncode'||negative?.class_type!=='CLIPTextEncode'||latent?.class_type!=='EmptyLatentImage'||savers.length!==1)throw Error('qqbot API bindings invalid');
  for(const key of ['prompt','negative'])if(overrides[key]!==undefined)(key==='prompt'?positive:negative).inputs.text=overrides[key];
  if(overrides.seed!==undefined)sample.inputs.noise_seed=overrides.seed;if(overrides.steps!==undefined)sample.inputs.steps=overrides.steps;
  for(const key of ['width','height'])if(overrides[key]!==undefined)latent.inputs[key]=overrides[key];latent.inputs.batch_size=1;
  savers[0][1].inputs.filename_prefix='dsh_qq/qqbot';
  return {prompt:graph,outputId:savers[0][0],defaults:{width:latent.inputs.width,height:latent.inputs.height,steps:sample.inputs.steps},models:Object.values(graph).flatMap(n=>['unet_name','clip_name','vae_name'].filter(k=>n.inputs[k]!==undefined).map(k=>n.inputs[k]))};
 }

 if(!Array.isArray(ui.nodes)||!Array.isArray(ui.links))throw new Error('qqbot must be a saved ComfyUI workflow');
 const links=new Map(ui.links.map(link=>[link[0],link]));
 for(const node of ui.nodes){
  if(!allowed.has(node.type)||node.mode!==0)throw new Error('Unsupported qqbot node/mode: '+node.type);
  const inputs={},values=node.widgets_values??[];let index=0;
  for(const input of node.inputs??[]){
   if(input.widget){
    inputs[input.name]=values[index++];
    if(input.name==='noise_seed'&&['fixed','randomize','increment','decrement'].includes(values[index]))index++;
   }
   if(input.link!==null&&input.link!==undefined){const link=links.get(input.link);if(!link||String(link[3])!==String(node.id))throw new Error('Broken qqbot link');inputs[input.name]=[String(link[1]),link[2]];}
  }
  if(index!==values.length)throw new Error('Unsupported qqbot widget layout: '+node.type);
  graph[String(node.id)]={class_type:node.type,inputs};
 }
 for(const node of Object.values(graph))for(const value of Object.values(node.inputs))if(Array.isArray(value)&&!graph[value[0]])throw new Error('Missing qqbot dependency');
 const samplers=Object.values(graph).filter(n=>n.class_type==='KSamplerAdvanced'),savers=Object.entries(graph).filter(([,n])=>n.class_type==='SaveImage');
 if(samplers.length!==1||savers.length!==1)throw new Error('qqbot requires one sampler and one SaveImage');
 const sampler=samplers[0],positive=graph[sampler.inputs.positive?.[0]],negative=graph[sampler.inputs.negative?.[0]],latent=graph[sampler.inputs.latent_image?.[0]];
 if(positive?.class_type!=='CLIPTextEncode'||negative?.class_type!=='CLIPTextEncode'||latent?.class_type!=='EmptyLatentImage')throw new Error('Unsupported qqbot prompt/latent bindings');
 if(overrides.prompt!==undefined)positive.inputs.text=overrides.prompt;
 if(overrides.negative!==undefined)negative.inputs.text=overrides.negative;
 if(overrides.seed!==undefined)sampler.inputs.noise_seed=overrides.seed;
 if(overrides.steps!==undefined)sampler.inputs.steps=overrides.steps;
 for(const key of ['width','height'])if(overrides[key]!==undefined)latent.inputs[key]=overrides[key];
 latent.inputs.batch_size=1;
 savers[0][1].inputs.filename_prefix='dsh_qq/qqbot';
 return {prompt:graph,outputId:savers[0][0],defaults:{width:latent.inputs.width,height:latent.inputs.height,steps:sampler.inputs.steps},models:Object.values(graph).flatMap(n=>['unet_name','clip_name','vae_name'].filter(k=>n.inputs[k]!==undefined).map(k=>n.inputs[k]))};
}
export function loadQqbotWorkflow(overrides={}){
 const source=readFileSync(QQBOT_PATH,'utf8');
 return {...buildQqbotWorkflow(source,overrides),name:'qqbot',sha256:createHash('sha256').update(source).digest('hex')};
}
