import {entrySettings} from './lora-settings.mjs';
import {readDiscoveredCatalog} from './lora-discovery.mjs';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadQqbotWorkflow} from '../../qq-workspace/qqbot-workflow.mjs';

export const LORA_CATALOG_PATH=fileURLToPath(new URL('../../image-workflow/loras.json',import.meta.url));
export const MAX_LORA_ENTRIES=512;
export const MAX_SELECTED_LORAS=5;
export const ENHANCED_LORA_REFERENCE_PATH=fileURLToPath(new URL('../../image-workflow/lora-enhanced-references.json',import.meta.url));
export const AUTHOR_LORA_REFERENCE_PATH=fileURLToPath(new URL('../../image-workflow/lora-author-prompts.json',import.meta.url));
export const ENHANCED_LORA_REFERENCE_NAMES=Object.freeze([]);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=value=>String(value).normalize('NFKC').toLowerCase();
const modelName=value=>typeof value==='string'&&value.length<=240&&!/[\\\x00-\x1f:]/.test(value)&&value.endsWith('.safetensors')&&value.split('/').every(segment=>segment&&segment!=='.'&&segment!=='..');
const validId=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value);

// Backend boundary: add a family validator and a workflow builder together; never infer from filenames.
function readBases(c){
 if(c.version!==2||!c.bases||typeof c.bases!=='object'||Array.isArray(c.bases)||!Object.keys(c.bases).length)throw Error('LoRA底模配置无效');
 return new Map(Object.entries(c.bases).map(([id,item])=>{
  if(!validId(id)||!item||item.family!=='anima'||typeof item.label!=='string'||!item.label.trim()||item.label.length>64)throw Error('当前版本仅支持Anima底模');
  if(![item.unet,item.clip,item.vae].every(modelName))throw Error('Anima底模需要有效的unet、clip、vae');
  return [id,{id,family:'anima',label:item.label.trim(),unet:item.unet,clip:item.clip,vae:item.vae}];
 }));
}

function applySampling(sampler,lora){
 const s=lora.sampling;
 if(s.steps!==undefined)sampler.inputs.steps=s.steps;
 if(s.cfg!==undefined)sampler.inputs.cfg=s.cfg;
 if(s.sampler!==undefined)sampler.inputs.sampler_name=s.sampler;
 if(s.scheduler!==undefined)sampler.inputs.scheduler=s.scheduler;
}

export function readLoraCatalog(file=LORA_CATALOG_PATH){
 const c=readDiscoveredCatalog(file),bases=readBases(c);
 if(!Array.isArray(c.loras)||c.loras.length>MAX_LORA_ENTRIES)throw Error('LoRA配置无效');
 const names=new Set();
 return c.loras.map(item=>{
  if(!item||typeof item.name!=='string'||!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(item.name)||names.has(normalize(item.name))||!modelName(item.filename)||typeof item.trigger!=='string'||item.trigger.length>1000||/[\x00-\x1f]/.test(item.trigger)||!Number.isFinite(item.strengthModel)||item.strengthModel<=0||item.strengthModel>1.5)throw Error('LoRA条目无效');
  if(c.categories?.[item.name]==='action'&&item.adminOnly!==true)throw Error('动作LoRA必须配置adminOnly:true');
  const baseId=item.base;
  if(!validId(baseId)||!bases.has(baseId))throw Error('LoRA '+item.name+' 未配置有效底模');
  const base=bases.get(baseId),strengthClip=item.strengthClip??(base.family==='anima'?0:item.strengthModel);
  if(!Number.isFinite(strengthClip)||strengthClip<0||strengthClip>1.5)throw Error('LoRA文本编码器强度无效');
  if(base.family==='anima'&&strengthClip!==0)throw Error('Anima LoRA仅修改扩散模型，strengthClip必须为0或省略');
  names.add(normalize(item.name));
  if(base.family==='anima'&&item.clipSkip!==undefined)throw Error('Anima LoRA不使用SDXL Clip Skip配置');
  const entry={name:item.name,filename:item.filename,trigger:item.trigger.trim(),strengthModel:item.strengthModel,strengthClip,baseId,base,family:base.family,...entrySettings(item)};
  return {...entry,sha256:digest(entry)};
 });
}
export function findLora(name,file=LORA_CATALOG_PATH){
 const entry=readLoraCatalog(file).find(l=>normalize(l.name)===normalize(name));
 if(!entry)throw Error('没有这个LoRA，请用 /loras 查看可用名称。');return entry;
}
export function assertLoraAccess(lora,{isAdmin=false}={}){
 if(lora&&(lora.loras??[lora]).some(l=>l.adminOnly===true)&&isAdmin!==true){const error=Error('动作LoRA仅管理员可用。');error.code='LORA_ADMIN_ONLY';throw error;}
}
export function findLoraSelection(names,file=LORA_CATALOG_PATH){
 const list=Array.isArray(names)?names:typeof names==='string'?names.split('#'):[];
 if(list.length<1||list.length>MAX_SELECTED_LORAS)throw Error('每次最多选择5个LoRA。');
 if(list.some(n=>typeof n!=='string'||!n))throw Error('LoRA名称不能为空。');
 const catalog=readLoraCatalog(file);
 const entries=list.map(name=>{const entry=catalog.find(l=>normalize(l.name)===normalize(name));if(!entry)throw Error('没有这个LoRA：'+name+'，请用 /loras 查看。');return entry;});
 const first=entries[0];
 if(entries.some(l=>l.family!==first.family||digest(l.base)!==digest(first.base)))throw Error('所选LoRA必须使用同一底模配置。');
 if(entries.length===1)return first;
 return {...first,name:entries.map(l=>l.name).join('#'),loras:entries,sha256:digest({loras:entries.map(l=>({name:l.name,sha256:l.sha256}))})};
}
export function resolveLoraRequest(description,file=LORA_CATALOG_PATH){
 let text=String(description??'').trim();
 if(!text.startsWith('#'))return {description:text,lora:null};
 const names=[];
 while(text.startsWith('#')){
  const m=/^#([^\s#]+)/.exec(text);
  if(!m)throw Error('格式：/生图 #名称1#名称2#名称3 描述');
  names.push(m[1]);text=text.slice(m[0].length).trimStart();
  if(names.length>MAX_SELECTED_LORAS)throw Error('每次最多选择5个LoRA。');
 }
 if(!text)throw Error('请在LoRA名称后填写描述。');
 return {description:text,lora:findLoraSelection(names,file)};
}
// Optional prompt guidance is selected only by the real request, never by a tool argument.
// Keep the model selection and fingerprint untouched so the generation workflow is identical.
export function resolveEnhancedLoraReferences(lora,file=ENHANCED_LORA_REFERENCE_PATH){
 if(!lora)throw Error('增强参考需要先选择LoRA。');
 const config=readDiscoveredCatalog(file);
 if(config.version!==1||!config.references||typeof config.references!=='object'||Array.isArray(config.references)||Object.keys(config.references).length>512)throw Error('增强LoRA参考配置无效');
 const selected={};
 for(const item of lora.loras??[lora]){
  const reference=config.references[item.name];if(!reference)continue;
  if(!reference||typeof reference.expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(reference.expectedSha256)||typeof reference.promptGuidance!=='string'||!reference.promptGuidance.trim()||reference.promptGuidance.length>4800||/\x00/.test(reference.promptGuidance))throw Error('增强LoRA参考配置无效');
  if(reference.expectedSha256!==item.sha256)throw Error('LoRA '+item.name+' 的配置已更新，请管理员核对增强参考；未提交生图。');
  selected[item.name]=reference.promptGuidance;
 }
 return selected;
}
export function resolveReducedLoraReferences(lora,file=LORA_CATALOG_PATH){
 if(!lora)throw Error('减弱参考需要先选择LoRA。');
 const config=readDiscoveredCatalog(file);
 return [...new Set((lora.loras??[lora]).filter(l=>config.categories?.[l.name]==='style').map(l=>l.name))];
}
export function resolveAuthorLoraReferences(lora,{catalogFile=LORA_CATALOG_PATH,referenceFile=AUTHOR_LORA_REFERENCE_PATH}={}){
 const names=new Set(resolveReducedLoraReferences(lora,catalogFile)),config=JSON.parse(fs.readFileSync(referenceFile,'utf8')),selected={};
 if(config.version!==1||!config.references||typeof config.references!=='object'||Array.isArray(config.references))throw Error('LoRA作者参考配置无效');
 for(const item of lora.loras??[lora]){if(!names.has(item.name))continue;const ref=config.references[item.name];if(!ref)continue;if(ref.filename!==item.filename||typeof ref.promptGuidance!=='string'||!ref.promptGuidance.trim()||ref.promptGuidance.length>2000||/\x00/.test(ref.promptGuidance))throw Error('LoRA作者参考需要核对：'+item.name);selected[item.name]=ref.promptGuidance;}
 return selected;
}
function reducedReferenceNames(lora,referenceMode,catalogFile){
 if(!['default','reduced'].includes(referenceMode))throw Error('LoRA参考模式无效');
 return referenceMode==='reduced'?new Set(resolveReducedLoraReferences(lora,catalogFile)):new Set();
}
export function loraPrompt(prompt,lora,{referenceMode='default',catalogFile=LORA_CATALOG_PATH}={}){
 reducedReferenceNames(lora,referenceMode,catalogFile);
 const entries=lora.loras??[lora],triggers=[],active=new Set(),reserved=new Set();
 const artistKeys=new Set(entries.filter(l=>l.artistPrompt).map(l=>l.artistPrompt.replace(/^artist:/,'').normalize('NFKC').toLowerCase().replace(/_/g,' ').replace(/\s+/g,' ').trim()));
 for(const l of entries){
  for(const part of [...(l.trigger??'').split(','),...(l.artistPrompt?[l.artistPrompt]:[])]){const tag=part.trim(),key=tag.toLowerCase();if(tag&&!active.has(key)){active.add(key);triggers.push(tag);}if(tag)reserved.add(key);}
  for(const tag of l.obsoleteTriggers??[])reserved.add(tag.trim().toLowerCase());
 }
 const body=String(prompt).trim().split(',').map(t=>t.trim()).filter(t=>t&&!reserved.has(t.toLowerCase())&&!artistKeys.has(t.normalize('NFKC').toLowerCase().replace(/^(?:artist\s*:|by\s+)/,'').replace(/_/g,' ').replace(/\s+/g,' ').trim()));
 const combined=[...triggers,...body].join(', ');
 if(combined.length>4000)throw Error('追加LoRA触发词后提示词超过4000字符，请缩短描述。');return combined;
}
function characterPromptHint(l,description){
 if(!l.characterPrompts)return '';
 const text=normalize(description??'');
 const selected=l.characterPrompts.filter(c=>[c.name,...c.aliases].some(alias=>{
  const key=normalize(alias);let at=text.indexOf(key);
  while(at>=0){if(!/^[a-z0-9]/.test(key)||(!/[a-z0-9_]/.test(text[at-1]??'')&&!/[a-z0-9_]/.test(text[at+key.length]??'')))return true;at=text.indexOf(key,at+1);}return false;
 }));
 if(!selected.length)return '\n【可选角色】'+l.characterPrompts.map(c=>c.name).join('、')+'。本条未匹配明确角色名，不默认加入整套角色；仅在本次需求明确选择时使用对应身份。';
 return '\n【本条匹配的角色参考】以下仅为本次明确人物的参考；核心身份应使用，互斥外貌按本条择一，人数与特征归属按用户要求。原装服饰只在未指定穿着或明确要求原装时选用；指定新衣服时不要叠加原装。'+selected.map(c=>'\n'+c.name+'：身份与外貌：'+c.core+'。按需原装：'+c.outfit+'。').join('');
}
function singleLoraHint(l,description){
 const label='Anima',workflow='qqbot-lora-anima';
 return '\n【本条LoRA：'+l.name+'】本条使用'+label+'兼容文生图工作流'+workflow+'，底模为'+l.base.label+'；后台按配置加载LoRA'+(l.trigger?'并强制追加配套触发词 '+l.trigger+'，无需自行重复写入':(l.characterPrompts?'，本合集没有统一触发词，请按本条角色参考使用对应人物身份词':'，此LoRA无需触发词'))+'。请将用户描述整理为英文画面提示词；不把#名称当作画面内容，不沿用上一条消息的LoRA，不改变LoRA、底模、强度或工作流。'+(l.artistPrompt?'\n【自动画师词】后台强制追加 '+l.artistPrompt+'，本条选中即生效；不要省略、改写或重复堆其他画师。':'')+(l.promptGuidance?'\n【本条LoRA提示词参考】\n'+l.promptGuidance:'')+characterPromptHint(l,description);
}
export function loraHint(binding){
 if(!binding.lora)return '';
 const selected=binding.enhancedLoraReferences;
 const reduced=new Set(binding.loraReferenceMode==='reduced'?binding.reducedLoraNames??[]:[]);
 const originals=binding.lora.loras??[binding.lora];
 const entries=originals.map(l=>selected&&Object.hasOwn(selected,l.name)?{...l,promptGuidance:selected[l.name]}:l);
 const references=[...new Map(entries.filter(l=>!reduced.has(l.name)).map(l=>[normalize(l.name),l])).values()];
 const reducedHint=binding.loraReferenceMode==='reduced'?'\n【本条减弱参考】'+(reduced.size?'以下画风LoRA按原权重加载：'+[...reduced].join('、')+'。保留后台已绑定的强制触发词、已配置画师名和下方已核实作者推荐词，推荐的可选词按本次需求选择，不整套强加；不提供或使用额外整理的普通/增强参考，不根据名称翻译或扩写线条、上色、光影、构图等画风词，已配置画师词由后台去重追加，不额外增加其他画师，不从历史消息或记忆补回额外参考。只整理用户本次明确的画面需求，用户自己明确要求的画法仍保留。\n'+originals.filter(l=>reduced.has(l.name)&&l.trigger).map(l=>'【保留触发词：'+l.name+'】'+l.trigger).filter((v,i,a)=>a.indexOf(v)===i).join('\n')+originals.filter(l=>reduced.has(l.name)&&l.artistPrompt).map(l=>'\n【保留画师词：'+l.name+'】'+l.artistPrompt).filter((v,i,a)=>a.indexOf(v)===i).join('')+Object.entries(binding.authorLoraReferences??{}).filter(([name])=>reduced.has(name)).map(([name,text])=>'\n【作者推荐词：'+name+'】'+text).join(''):'本条没有匹配画风LoRA，选中项继续使用原规则。')+'其他角色、动作保持原规则。减弱仅作用本条提示词参考，不降低模型权重，不修改采样或底模。':'';
 const enhanced=reducedHint+(selected?'\n【本条增强参考】'+(Object.keys(selected).length?'仅以下已选LoRA使用增强参考：'+Object.keys(selected).join('、')+'；其余项保持当前参考。':'本条选中的LoRA没有匹配已配置的增强项，各自保持当前参考。')+'增强只影响本条提示词参考，不改变模型、强度、触发词、工作流或其他参数；不继承到下一条。':'');
 return enhanced+(entries.length>1?'\n【本条LoRA组合】'+entries.map(l=>l.name).join(' + ')+'；本条共同选中的LoRA全部生效，按标签顺序串联、各用配置强度。重复项按次数分别加载，每次占一个手选名额；同项触发词与参考只写一次。采样、默认负面词和Clip Skip只采用第一个LoRA的配置，后面各项仅叠加权重与提示词参考。风格作用于本次画面，角色外貌与服装按本次需求归属；选择多个角色LoRA不代表自动增加人物数量，不把不同人物的外貌混成同一个人。以下各条不沿用其他LoRA的说明指上一条消息，不能忽略本条同时选中的LoRA。':'')+references.map(l=>singleLoraHint(l,binding.description)).join('');
}
export function loraList(file=LORA_CATALOG_PATH,{family,category,isAdmin=false}={}){
 if(family!==undefined&&!['all','anima'].includes(family))throw Error('LoRA列表家族无效');
 if(category!==undefined&&!['character','style','action'].includes(category))throw Error('LoRA列表分类无效');
 if(category==='action'&&isAdmin!==true)assertLoraAccess({adminOnly:true});
 const catalog=readLoraCatalog(file),c=readDiscoveredCatalog(file);
 // Display-only fields never enter generation bindings or their fingerprints.
 const descriptions=c.descriptions??{},categories=c.categories??{};
 if(typeof categories!=='object'||Array.isArray(categories))throw Error('LoRA分类配置无效');
 const entries=catalog.filter(l=>(l.adminOnly!==true||isAdmin===true)&&(!family||family==='all'||l.family===family)&&(!category||categories[l.name]===category));
 const brief=name=>typeof descriptions[name]==='string'?descriptions[name].replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,32):'';
 // Keep the unfiltered internal helper compatible; QQ commands always select a family.
 if(family===undefined&&category===undefined){
  const title='可用LoRA（同底模最多5个）：';
  return entries.length?title+'\n'+entries.map(l=>'#'+l.name+' ['+'Anima'+']'+(brief(l.name)?' — '+brief(l.name):'')).join('\n')+'\n用法：/生图 #名称1#名称2#名称3 描述':title+'\n暂无匹配LoRA。';
 }
 const familyLabel=()=> 'Anima';
 const title=(family&&family!=='all'?familyLabel(family):'全部')+' LoRA（'+entries.length+'项）';
 if(!entries.length)return title+'\n暂无匹配LoRA。';
 const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
 const compare=(a,b)=>collator.compare(a.name,b.name)||(a.name<b.name?-1:a.name>b.name?1:0);
 const sections=[];
 for(const f of ['anima'])for(const [key,label]of [['character','角色'],['style','画风'],['action','动作'],['unclassified','待分类']]){
  const group=entries.filter(l=>l.family===f&&(key==='unclassified'?!['character','style','action'].includes(categories[l.name]):categories[l.name]===key)).sort(compare);
  if(!group.length)continue;
  const heading=(!family||family==='all'?familyLabel(f)+' · ':'')+label;
  sections.push('【'+heading+' · '+group.length+'】\n'+group.map(l=>'#'+l.name+(brief(l.name)?'｜'+brief(l.name):'')).join('\n'));
 }
 return [title,...sections,'生图：/生图 #名称 描述\n详情：/lora 名称；同底模最多5个'].join('\n\n');
}

// Human-readable introductions are display-only; never add them to generation bindings.
export function loraDetail(name,file=LORA_CATALOG_PATH,{isAdmin=false}={}){
 const l=findLora(name,file),c=readDiscoveredCatalog(file),detail=c.details?.[l.name]??{};
 assertLoraAccess(l,{isAdmin});
 const clean=value=>value.replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
 const field=(value,fallback)=>{if(value===undefined)return fallback;if(typeof value!=='string'||value.length>600||!clean(value))throw Error('LoRA介绍配置无效');return clean(value);};
 const list=(value,fallback)=>{if(value===undefined)return fallback;if(!Array.isArray(value)||value.length>12)throw Error('LoRA介绍配置无效');return value.map(v=>field(v,''));};
 const short=(value,max)=>{const chars=Array.from(value);return chars.length<=max?value:chars.slice(0,max-1).join('')+'…';};
 if(!detail||typeof detail!=='object'||Array.isArray(detail))throw Error('LoRA介绍配置无效');
 const style=field(detail.style,field(c.descriptions?.[l.name],'暂无单独介绍。')),appearance=field(detail.appearance,'可在描述中指定形象。');
 const outfits=list(detail.outfits,['可自定义服装。']),accessories=list(detail.accessories,[]),options=list(detail.options,[]);list(detail.notes,[]);
 const isAction=c.categories?.[l.name]==='action',isStyle=c.categories?.[l.name]==='style',brief=isStyle?field(c.descriptions?.[l.name],style):style;
 const lines=['【LoRA：'+l.name+'】','适用：'+'Anima','简介：'+short(brief,120)];
 if(l.adminOnly)lines.push('权限：仅管理员');
 if(!isStyle)lines.push((isAction?'动作：':'形象：')+short(appearance,180));
 if(l.characterPrompts?.length)lines.push('可选角色：'+l.characterPrompts.map(p=>p.name).join('、'));
 lines.push('','可选项：');
 if(isStyle||isAction){lines.push(...(options.length?options:[isAction?'人物、服装、表情与场景可按需指定。':'人物、服装、构图、背景和光照可按需指定。']).map(v=>'· '+short(v,120)));}
 else{if(outfits.length)lines.push('服装：',...outfits.map(v=>'· '+short(v,110)));if(accessories.length)lines.push('配饰：'+accessories.map(v=>short(v,90)).join('；'));if(options.length)lines.push(...options.map(v=>'· '+short(v,120)));lines.push('服装择一，可自定义换装；配饰按需。');}
 lines.push('','用法：/生图 #'+l.name+' 描述');return lines.join('\n');
}

function loadAnimaLora(options,lora){
 const base=loadQqbotWorkflow(options),graph=base.prompt;
 const samplers=Object.values(graph).filter(n=>n.class_type==='KSamplerAdvanced'),clips=Object.values(graph).filter(n=>n.class_type==='CLIPLoader'),vaes=Object.values(graph).filter(n=>n.class_type==='VAELoader');
 if(samplers.length!==1||clips.length!==1||vaes.length!==1)throw Error('Anima基础工作流绑定发生变化');
 const sampler=samplers[0],modelLink=sampler.inputs.model,model=graph[modelLink?.[0]];
 applySampling(sampler,lora);if(options.steps!==undefined)sampler.inputs.steps=options.steps;
 if(options.negative===undefined&&lora.defaultNegative!==undefined){const negative=graph[sampler.inputs.negative?.[0]];if(negative?.class_type!=='CLIPTextEncode')throw Error('Anima负面词绑定变化');negative.inputs.text=lora.defaultNegative;}
 if(model?.class_type!=='UNETLoader'||modelLink[1]!==0)throw Error('Anima基础模型绑定发生变化');
 model.inputs.unet_name=lora.base.unet;clips[0].inputs.clip_name=lora.base.clip;vaes[0].inputs.vae_name=lora.base.vae;
 const adapterId=String(Math.max(...Object.keys(graph).map(Number))+1);
 graph[adapterId]={class_type:'LoraLoaderModelOnly',inputs:{model:[...modelLink],lora_name:lora.filename,strength_model:lora.strengthModel}};
 sampler.inputs.model=[adapterId,0];graph[base.outputId].inputs.filename_prefix='dsh_qq/qqbot-lora-anima';
 return {...base,prompt:graph,defaults:{...base.defaults,steps:sampler.inputs.steps},name:'qqbot-lora-anima',sha256:digest({base:base.sha256,lora}),models:[lora.base.unet,lora.base.clip,lora.base.vae,lora.filename]};
}
export function loadLoraWorkflow(options={},name,{catalogFile=LORA_CATALOG_PATH,expectedSha256,referenceMode='default'}={}){
 const selection=findLoraSelection(name,catalogFile);
 if(expectedSha256!==undefined&&selection.sha256!==expectedSha256)throw Error('LoRA配置已更新，请重新发送生成指令');
 const entries=selection.loras??[selection],first=entries[0],reduced=reducedReferenceNames(selection,referenceMode,catalogFile);
 const promptOptions=referenceMode==='reduced'&&options.prompt!==undefined?{...options,prompt:loraPrompt(options.prompt,selection,{referenceMode,catalogFile})}:options;
 const firstSettings=reduced.has(first.name)?{...first,defaultNegative:undefined}:first;
 const backends={anima:loadAnimaLora},builder=backends[first.family];if(!builder)throw Error('此LoRA底模尚未启用');
 const base=builder(promptOptions,firstSettings);
 const finish=workflow=>workflow;
 if(entries.length===1)return finish(base);
 const graph=base.prompt;
 let nextId=Math.max(...Object.keys(graph).map(Number))+1;
 if(first.family==='anima'){
  const sampler=Object.values(graph).find(n=>n.class_type==='KSamplerAdvanced');
  let model=sampler.inputs.model;
  for(const entry of entries.slice(1)){const id=String(nextId++);graph[id]={class_type:'LoraLoaderModelOnly',inputs:{model:[...model],lora_name:entry.filename,strength_model:entry.strengthModel}};model=[id,0];}
  sampler.inputs.model=model;
 }

 return finish({...base,sha256:digest({base:base.sha256,selection:selection.sha256}),models:[...base.models,...entries.slice(1).map(l=>l.filename)]});
}
