// Legacy helper retained for older callers; current image/video delivery uses the narrow rule below.
// Negative prompts are deliberately excluded: "no nudity" must not mark every job.
const adult=/成人(?:内容|向|图|生图)?|色情|情色|十八禁|18\s*禁|露点|裸体|全裸|赤裸|性爱|性行为|性交|做爱|生殖器|阴茎|阴道|外阴|乳头|私密部位|情趣|\b(?:nsfw|r[\s_-]?18(?:g)?|18\+|porn(?:ography|ographic)?|hentai|erotic|nude|naked|nudity|uncensored|genitals?|penis|vagina|nipples?)\b|\b(?:adult\s+content|sex(?:ual)?\s+(?:act|activity|intercourse))\b/i;
export function isAdultDescription(text,extraKeywords=[]){
 const s=String(text??'').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'');
 return /性暗示|半裸|脱衣|只穿内衣|衣不蔽体|挑逗|情趣|性感.*(?:内衣|泳装)|\b(?:undressing|topless|bottomless|lingerie|suggestive|seductive|fetish)\b/i.test(String(text??''))||/(?:^|[^0-9])18\+(?:$|\s)/.test(s)||adult.test(s)||(Array.isArray(extraKeywords)&&extraKeywords.some(word=>typeof word==='string'&&word.trim()&&s.toLowerCase().includes(word.normalize('NFKC').toLowerCase().trim())));
}

// Image/video delivery uses only the final positive prompt sent to the selected ComfyUI workflow.
// Style/rating tags, swimwear and suggestive clothing alone are not explicit content.
export function isExplicitGenerationPrompt(text){
 let s=String(text??'').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/_/g,' ');
 // Common exclusions and the colour adjective "nude" do not describe exposure.
 s=s.replace(/\b(?:non[- ]|(?:no|not|without|avoid|excluding)\s+)(?:explicit\s+)?(?:nudity|nude|naked|nipples?|genitals?|sex|sexual\s+(?:acts?|activity|intercourse))\b/g,' ')
  .replace(/(?:无|不含|没有|避免|禁止|不要|非)(?:任何)?(?:裸体|全裸|赤裸|裸露|露点|性行为|性交|性爱|色情)/g,' ')
  .replace(/\bnude\s+(?:(?:colou?r|toned?)[- ]*)?(?:lipstick|makeup|nails?|polish|shoes?|heels?|dress|fabric|palette|swimsuit|bikini)\b/g,' ')
  .replace(/\bnude[- ](?:colou?r(?:ed)?|toned?)\b/g,' ')
  .replace(/\bsex\s*[:=]\s*(?:male|female)\b/g,' ');
 return /裸体|全裸|赤裸|半裸|裸上身|上身赤膊|露点|露乳|露阴|(?:裸露|露出|暴露)(?:的)?(?:乳房|胸部|乳头|生殖器|阴部|私处|下体)|性爱|性行为|性交|做爱|口交|肛交|自慰|手淫|生殖器|阴茎|阴道|外阴|乳头|\b(?:nude|naked|nudity|topless|bottomless|genitals?|penis|vagina|vulva|nipples?|intercourse|sex|masturbat(?:ion|ing|e)|fellatio|cunnilingus|penetration)\b|\b(?:bare|exposed|uncovered)\s+(?:breasts?|chest|genitals?|crotch)\b|\bsexually\s+explicit\b/i.test(s);
}

// Backward-compatible name for image workers and existing extensions.
export const isExplicitImagePrompt=isExplicitGenerationPrompt;

