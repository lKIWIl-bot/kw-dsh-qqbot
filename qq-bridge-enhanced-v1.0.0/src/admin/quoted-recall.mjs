const validId=id=>/^-?[1-9]\d{0,15}$/.test(String(id))&&Number.isSafeInteger(Number(id));
export function parseQuotedRecall(event,{botId}={}){
 const segments=event?.message;if(!Array.isArray(segments))return null;
 const replies=segments.filter(s=>s?.type==='reply');
 if(replies.length!==1||!validId(replies[0].data?.id))return null;
 if(segments.some(s=>!['text','reply','at'].includes(s?.type)||s.type==='at'&&(!botId||String(s.data?.qq)!==String(botId))))return null;
 const text=segments.filter(s=>s.type==='text').map(s=>String(s.data?.text??'')).join('').trim();
 return text==='撤回'?{messageId:String(replies[0].data.id)}:null;
}
export async function getQuotedBotMessage({key,messageId,botId,getMessage,getPrivateHistory}){
 const match=/^(group|private):([1-9]\d{4,11})$/.exec(String(key));
 if(!match||!validId(messageId)||!/^\d{5,12}$/.test(String(botId)))throw Error('无法确认撤回目标。');
 const raw=await getMessage(Number(messageId));
 if(!raw||String(raw.sender?.user_id??raw.user_id)!==String(botId))throw Error('只能撤回机器人自己发送的消息。');
 if(raw.message_id==null||String(raw.message_id)!==String(messageId))throw Error('无法确认被引用的消息。');
 if(match[1]==='group'){
  if(String(raw.group_id??raw.groupId)!==match[2]||raw.message_type&&raw.message_type!=='group')throw Error('只能撤回当前会话中的机器人消息。');
 }else{
  if(raw.group_id!=null||raw.groupId!=null||raw.message_type&&raw.message_type!=='private')throw Error('只能撤回当前会话中的机器人消息。');
  // Outgoing get_msg has the bot as user_id and no recipient. Confirm the
  // target in this private peer's history instead of inferring its recipient.
  const history=await getPrivateHistory(match[2],raw.message_seq??raw.real_seq);
  if(!Array.isArray(history)||!history.some(m=>String(m.message_id)===String(messageId)&&String(m.sender?.user_id??m.user_id)===String(botId)&&m.group_id==null))throw Error('无法确认该消息属于当前私聊，未撤回。');
 }
 return raw;
}
export async function recallQuotedBotMessage({remove,...options}){
 await getQuotedBotMessage(options);
 await remove(Number(options.messageId));return {recalled:true,messageId:String(options.messageId)};
}
