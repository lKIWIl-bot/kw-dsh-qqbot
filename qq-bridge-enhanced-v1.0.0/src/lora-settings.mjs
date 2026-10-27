export function entrySettings(item){
 if(item.adminOnly!==undefined&&typeof item.adminOnly!=='boolean')throw Error('LoRA权限配置无效');
 const guidance=item.promptGuidance??'';
 if(typeof guidance!=='string'||guidance.length>4800||/\x00/.test(guidance))throw Error('LoRA提示词参考无效');
 const artistPrompt=item.artistPrompt;
 if(artistPrompt!==undefined&&(typeof artistPrompt!=='string'||!artistPrompt.slice(7).trim()||!/^artist:[^,<>\x00-\x1f]{1,120}$/.test(artistPrompt)))throw Error('LoRA画师提示词配置无效');
 const obsoleteTriggers=item.obsoleteTriggers??[];
 if(!Array.isArray(obsoleteTriggers)||obsoleteTriggers.length>16||obsoleteTriggers.some(t=>typeof t!=='string'||!t.trim()||t.length>80||/[,\x00-\x1f]/.test(t)))throw Error('LoRA旧触发词配置无效');
 const characterPrompts=item.characterPrompts;
 if(characterPrompts!==undefined&&(!Array.isArray(characterPrompts)||characterPrompts.length<1||characterPrompts.length>40||characterPrompts.some(c=>!c||typeof c.name!=='string'||!c.name.trim()||c.name.length>64||!Array.isArray(c.aliases)||c.aliases.length>8||c.aliases.some(a=>typeof a!=='string'||!a.trim()||a.length>80)||typeof c.core!=='string'||c.core.length>1000||typeof c.outfit!=='string'||c.outfit.length>1000||[c.name,...c.aliases,c.core,c.outfit].some(t=>/[\x00-\x1f]/.test(t)))))throw Error('LoRA角色参考配置无效');
 const sampling=item.sampling??{};
 if(!sampling||typeof sampling!=='object'||Array.isArray(sampling)||Object.keys(sampling).some(k=>!['steps','cfg','sampler','scheduler'].includes(k)))throw Error('LoRA采样配置无效');
 if(sampling.steps!==undefined&&(!Number.isInteger(sampling.steps)||sampling.steps<1||sampling.steps>40))throw Error('LoRA采样步数无效');
 if(sampling.cfg!==undefined&&(!Number.isFinite(sampling.cfg)||sampling.cfg<1||sampling.cfg>15))throw Error('LoRA CFG无效');
 for(const key of ['sampler','scheduler'])if(sampling[key]!==undefined&&(typeof sampling[key]!=='string'||!/^[a-z0-9_]{1,64}$/.test(sampling[key])))throw Error('LoRA采样器配置无效');
 const clipSkip=item.clipSkip;
 if(clipSkip!==undefined&&(!Number.isInteger(clipSkip)||clipSkip<1||clipSkip>12))throw Error('LoRA Clip Skip无效');
 const defaultNegative=item.defaultNegative;
 if(defaultNegative!==undefined&&(typeof defaultNegative!=='string'||defaultNegative.length>2000||/\x00/.test(defaultNegative)))throw Error('LoRA默认负面词无效');
 return {...(item.adminOnly!==undefined?{adminOnly:item.adminOnly}:{}),...(artistPrompt!==undefined?{artistPrompt:artistPrompt.trim()}:{}),...(characterPrompts!==undefined?{characterPrompts:characterPrompts.map(c=>({name:c.name.trim(),aliases:c.aliases.map(a=>a.trim()),core:c.core.trim(),outfit:c.outfit.trim()}))}:{}),...(clipSkip!==undefined?{clipSkip}:{}),promptGuidance:guidance.trim(),obsoleteTriggers:obsoleteTriggers.map(t=>t.trim()),sampling:{...sampling},...(defaultNegative!==undefined?{defaultNegative}:{})};
}
