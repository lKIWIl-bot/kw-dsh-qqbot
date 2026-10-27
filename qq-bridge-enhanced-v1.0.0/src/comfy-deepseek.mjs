import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadQqbotWorkflow} from '../../qq-workspace/qqbot-workflow.mjs';
const promptFile=fileURLToPath(new URL('../../image-workflow/deepseek-prompt.txt',import.meta.url));
const identityTags=new Set(['deepseek_whale_girl','blue hair','very long hair','wavy hair','gradient blue hair','bangs','ahoge','blue eyes','whale fin ears','blue hair bows','blue whale tail','starry tail pattern']);
export function deepseekReference(){
 const source=fs.readFileSync(promptFile,'utf8').trim();if(!source||source.length>2000||/\x00/.test(source))throw Error('鲸鱼娘配套提示词无效');
 const tags=source.split(',').map(s=>s.trim()).filter(Boolean);
 const core=tags.filter(t=>identityTags.has(t.toLowerCase())),outfit=tags.filter(t=>!identityTags.has(t.toLowerCase()));
 if(!core.includes('deepseek_whale_girl'))throw Error('鲸鱼娘核心触发词缺失');return {core:core.join(', '),defaultOutfit:outfit.join(', ')};
}
export function deepseekPrompt(prompt){
 const reference=deepseekReference(),text=reference.core+', '+String(prompt).trim();
 if(text.length>4000)throw Error('场景描述过长，追加鲸鱼娘核心提示词后不能超过4000字符');return text;
}
export function deepseekHint(){
 const reference=deepseekReference();
 return '使用qqbot-ds鲸鱼娘专用文生图，固定LoRA由后台加载。核心角色特征由后台追加，不需要重复写入prompt。不要获取或使用任何附图、引用图。请根据本条用户描述组织场景、动作、构图与服装提示词。未指定穿着时使用以下默认女仆装参考：'+reference.defaultOutfit+'。用户指定泳装、便服、换装、无服装等其他穿着状态时，按用户要求选择适用词，不加入冲突的默认女仆装、头饰、围裙、袜子或鞋子，不把全部配套词一股脑追加；可按需在negative排除冲突衣饰。';
}
export function loadDeepseekWorkflow(options={}){
 const base=loadQqbotWorkflow(options),graph=base.prompt;
 if(graph['3']?.class_type!=='UNETLoader'||graph['9']?.class_type!=='KSamplerAdvanced')throw Error('qqbot model bindings changed');
 graph['20']={class_type:'LoraLoaderModelOnly',inputs:{model:['3',0],lora_name:'deepseek_whale_girl_maid_anima_lora_clean.safetensors',strength_model:0.85}};
 graph['9'].inputs.model=['20',0];graph['13'].inputs.filename_prefix='dsh_qq/qqbot-ds';
 return {...base,prompt:graph,name:'qqbot-ds',sha256:createHash('sha256').update(JSON.stringify({base:base.sha256,lora:graph['20'].inputs.lora_name,strength:0.85})).digest('hex')};
}
