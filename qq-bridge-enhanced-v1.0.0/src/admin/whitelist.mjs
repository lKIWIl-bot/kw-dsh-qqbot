const list=value=>Array.isArray(value)?[...new Set(value.map(String))]:[];
export const WHITELIST_HELP='/添加用户 QQ号\n/移除用户 QQ号\n/添加群 群号\n/移除群 群号\n/白名单';
export function planWhitelistCommand(file,cmd){
 const allow={private:list(file.allow?.private??file.allow?.privates),groups:list(file.allow?.groups??file.allow?.group)};
 if(cmd.action==='list')return {changed:false,reply:`【聊天白名单】\n私聊用户（${allow.private.length}）：${allow.private.join('、')||'空'}\nQQ群（${allow.groups.length}）：${allow.groups.join('、')||'空'}\n${WHITELIST_HELP}`};
 if(!['add','remove'].includes(cmd.action)||!['private','groups'].includes(cmd.kind)||! /^[1-9]\d{4,11}$/.test(String(cmd.id)))throw new Error('白名单参数无效');
 if(file.allowAllWhenEmpty===true)throw new Error('当前为空名单放行所有模式，请先在控制台关闭 allowAllWhenEmpty 后使用白名单指令。');
 const denied=list(file.deny?.[cmd.kind]??file.deny?.[cmd.kind==='private'?'privates':'group']);
 if(cmd.action==='add'&&denied.includes(cmd.id))throw new Error('该目标在黑名单中；请先在控制台解除黑名单。');
 const exists=allow[cmd.kind].includes(cmd.id),label=cmd.kind==='private'?'用户':'群';
 if(exists===(cmd.action==='add'))return {changed:false,allow,removedKey:cmd.action==='remove'?(cmd.kind==='private'?'private:':'group:')+cmd.id:null,reply:`${label} ${cmd.id} ${exists?'已在':'不在'}聊天白名单中。`};
 allow[cmd.kind]=cmd.action==='add'?[...allow[cmd.kind],cmd.id]:allow[cmd.kind].filter(id=>id!==cmd.id);
 return {changed:true,file:{...file,allow},allow,removedKey:cmd.action==='remove'?(cmd.kind==='private'?'private:':'group:')+cmd.id:null,reply:`已${cmd.action==='add'?'添加':'移除'}${label} ${cmd.id}，聊天白名单已立即生效。`};
}
