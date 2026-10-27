export function groupPlainText(event){
 if(Array.isArray(event?.message))return event.message.filter(s=>s?.type==='text').map(s=>String(s.data?.text??'')).join(' ');
 return typeof event?.message==='string'?event.message:'';
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function isExplicitlyAtSelf(event,selfId){
 const id=String(selfId??event?.self_id??'');
 return !!id&&Array.isArray(event?.message)&&event.message.some(s=>s?.type==='at'&&String(s.data?.qq)===id);
}
export function isAddressedGroupMessage(event,{selfId,selfName}={}){
 if(isExplicitlyAtSelf(event,selfId))return true;
 const name=String(selfName??'').trim().normalize('NFKC');if(!name)return false;
 const text=groupPlainText(event).normalize('NFKC');
 return /^[a-z0-9_]+$/i.test(name)?new RegExp('(^|[^a-z0-9_])'+escape(name)+'($|[^a-z0-9_])','i').test(text):text.toLowerCase().includes(name.toLowerCase());
}
export function addressedCommandText(event,selfName){
 let text=groupPlainText(event).trim();const name=String(selfName??'').trim();
 if(name)text=text.replace(new RegExp('^@?'+escape(name)+'[\\s，,:：]+','i'),'');
 return text.trim();
}
