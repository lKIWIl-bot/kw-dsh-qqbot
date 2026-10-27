import {VIDEO_INSTALLED} from '../comfy-video.mjs';
// owner 私聊管理通道的命令解析（纯函数，不执行任何操作）。
//
// 这些命令由桥接在消息交给模型**之前**拦截并直接执行；模型看不到它们，也无法伪造它们
// （伪造需要以 ownerQQ 的身份在 QQ 私聊里发消息，模型做不到）。
//
// 只在 owner 私聊里生效。群里出现这些命令一律拒绝（防止群友围观确认码、防止误触）。

const MODE_WORDS = {
  chat: 'chat',
  reserved: 'reserved',
  reserved2: 'reserved2',
  simulation: 'reserved2',
  sim: 'reserved2',
  群友: 'reserved2',
  agent: 'closed-agent',
  'closed-agent': 'closed-agent',
  运维: 'closed-agent',
};

const PERMISSION_WORDS = {
  'read-only': 'L1',
  readonly: 'L1',
  只读: 'L1',
  'workspace-write': 'L2',
  workspace: 'L2',
  工作区: 'L2',
  'qq-full-ask': 'L3',
  full: 'L3',
  完全访问: 'L3',
};

/** 能改变权限/沙箱/preset/运行状态的斜杠命令：一律由桥接接管或拒绝，**绝不**透传给 DSH。 */
export const PRIVILEGED_SLASH = new Set([
  'permission', 'permissions', 'perm', 'sandbox', 'approval', 'approvals', 'preset', 'presets',
  'agent', 'yolo', 'mode', 'level', 'plan', 'goal', 'model', 'export',
]);

function parseLevel(word) {
  const w = String(word ?? '').trim();
  if (/^L[0-3]$/i.test(w)) return w.toUpperCase();
  return PERMISSION_WORDS[w.toLowerCase()] ?? PERMISSION_WORDS[w] ?? null;
}

/**
 * 解析 owner 私聊消息。返回 null 表示不是管理命令（交给正常流程/模型）。
 * @returns {null|{type:string,[k:string]:any}}
 */
export function parseOwnerCommand(text, { naturalLanguage = true } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const t = raw.replace(/\s+/g, ' ');

  if (/^(?:确认|确定|\/confirm)\s*\d{4,8}(?:\s+\d{6})?$/i.test(t)) return { type: 'confirm', text: t };
  if (/^\/(?:panic|紧急关闭)$/i.test(t) || /^紧急关闭$/.test(t)) return { type: 'panic' };
  if (/^\/cancel$/i.test(t) || /^取消申请$/.test(t)) return { type: 'cancel' };

  if(/^\/help\s+管理$/i.test(t))return {type:'help'};
  const shortWhitelist=/^\/(添加|移除)(用户|群|群聊)\s+([1-9]\d{4,11})$/.exec(t);
  if(shortWhitelist)return {type:'whitelist',action:shortWhitelist[1]==='添加'?'add':'remove',kind:shortWhitelist[2]==='用户'?'private':'groups',id:shortWhitelist[3]};
  if(/^\/白名单(?:\s+(?:查看|列表))?$/.test(t))return {type:'whitelist',action:'list'};
  const fullWhitelist=/^\/白名单\s+(添加|移除)\s+(用户|群|群聊)\s+([1-9]\d{4,11})$/.exec(t);
  if(fullWhitelist)return {type:'whitelist',action:fullWhitelist[1]==='添加'?'add':'remove',kind:fullWhitelist[2]==='用户'?'private':'groups',id:fullWhitelist[3]};
  if(/^\/(?:白名单|(?:添加|移除)(?:用户|群|群聊))(?:\s|$)/.test(t))return {type:'error',text:'格式：/添加用户 QQ号、/移除用户 QQ号、/添加群 群号、/移除群 群号、/白名单；号码须为5~12位数字。'};

  let m = /^\/mode(?:\s+(\S+))?(?:\s+(\S+))?$/i.exec(t);
  if (m) {
    if (!m[1] || m[1] === 'status') return { type: 'status' };
    const mode = MODE_WORDS[m[1].toLowerCase()] ?? MODE_WORDS[m[1]] ?? null;
    if (!mode) return { type: 'error', text: `未知模式「${m[1]}」。可用：chat / reserved / reserved2（simulation）/ agent（closed-agent）` };
    const level = m[2] ? parseLevel(m[2]) : null;
    if (m[2] && !level) return { type: 'error', text: `未知权限级别「${m[2]}」。可用：L1 / L2 / L3` };
    return { type: 'mode', mode, level };
  }
  m = /^\/(?:level|perm|permission|permissions)(?:\s+(\S+))?$/i.exec(t);
  if (m) {
    if (!m[1]) return { type: 'status' };
    if (/^danger-full-access$/i.test(m[1])) {
      return { type: 'error', text: '不允许从 QQ 开启 danger-full-access：它的审批策略是 never（不弹审批直接执行）。需要高权限请用 /level L3（完全访问 + 每次审批，需 TOTP）。' };
    }
    const level = parseLevel(m[1]);
    if (!level) return { type: 'error', text: `未知权限级别「${m[1]}」。可用：L1（只读）/ L2（工作区）/ L3（完全访问+审批）/ L0（回到群友模式）` };
    if (level === 'L0') return { type: 'mode', mode: null, level: 'L0' };
    return { type: 'mode', mode: 'closed-agent', level };
  }
  if (/^\/approvals$/i.test(t)) return { type: 'approvals' };
  m = /^\/audit(?:\s+(\d{1,3}))?$/i.exec(t);
  if (m) return { type: 'audit', count: m[1] ? Number(m[1]) : 10 };
  if (/^\/(?:admin|管理|adminhelp)$/i.test(t)) return { type: 'help' };

  // ── 人物档案 ──
  m = /^\/whois\s+(\d{1,12})$/i.exec(t);
  if (m) return { type: 'whois', userId: m[1] };
  m = /^\/people(?:\s+(.+))?$/i.exec(t);
  if (m) return { type: 'people', query: m[1] ?? '' };
  m = /^\/person\s+(\d{1,12})\s+(name|称呼)\s+(.+)$/i.exec(t);
  if (m) return { type: 'person-name', userId: m[1], name: m[3] };
  m = /^\/person\s+(\d{1,12})\s+(?:level|熟悉度)\s+(listed|observed|talked|familiar)$/i.exec(t);
  if (m) return { type: 'person-acq', userId: m[1], level: m[2].toLowerCase() };
  m = /^\/person\s+(\d{1,12})\s+(?:avoid|不喜欢)\s+(teasing|proactiveChat|poke|recallPast)$/i.exec(t);
  if (m) return { type: 'person-pref', userId: m[1], key: m[2], value: 'avoid' };
  m = /^\/person\s+(\d{1,12})\s+(?:ok|可以)\s+(teasing|proactiveChat|poke|recallPast)$/i.exec(t);
  if (m) return { type: 'person-pref', userId: m[1], key: m[2], value: 'ok' };
  m = /^\/person\s+(\d{1,12})\s+alias\s+(\d{1,12})$/i.exec(t);
  if (m) return { type: 'person-alias', userId: m[1], alias: m[2] };
  m = /^\/person\s+(\d{1,12})\s+(?:forget|删除)$/i.exec(t);
  if (m) return { type: 'person-forget', userId: m[1] };
  m = /^\/note\s+(\d{1,12})\s+(.+)$/i.exec(t);
  if (m) return { type: 'note-global', userId: m[1], text: m[2] };
  m = /^\/note-del\s+(\d{1,12})\s+(n\d+)$/i.exec(t);
  if (m) return { type: 'note-del', userId: m[1], noteId: m[2] };
  m = /^\/share\s+(approve|reject|批准|驳回)\s+(\d{1,12})\s+(n\d+)$/i.exec(t);
  if (m) return { type: 'share-review', approve: /approve|批准/i.test(m[1]), userId: m[2], noteId: m[3] };
  if (/^\/review$/i.test(t)) return { type: 'review' };

  // ── 代为发言（原话转发到白名单群；会在她的记忆里标注「受管理员之托」）──
  m = /^\/say\s+(\d{1,12})\s+([\s\S]+)$/i.exec(raw);
  if (m) return { type: 'say', groupId: m[1], text: m[2].trim() };

  // 其余特权斜杠命令：拦截，不透传。
  m = /^\/([a-z][a-z0-9_-]*)/i.exec(t);
  if (m && PRIVILEGED_SLASH.has(m[1].toLowerCase())) {
    return { type: 'blocked-slash', name: m[1].toLowerCase() };
  }

  if (naturalLanguage) {
    const chineseModes = {
      '聊天模式': { type: 'mode', mode: 'chat', level: null, natural: true },
      '切换聊天模式': { type: 'mode', mode: 'chat', level: null, natural: true },
      '仿真模式': { type: 'mode', mode: 'reserved2', level: null, natural: true },
      '远程模式': { type: 'mode', mode: 'closed-agent', level: 'L2', natural: true },
      '只读模式': { type: 'mode', mode: 'closed-agent', level: 'L1', natural: true },
      '退出远程': { type: 'mode', mode: null, level: 'L0', natural: true },
      '退出远程模式': { type: 'mode', mode: null, level: 'L0', natural: true },
      '查看模式': { type: 'status' },
      '待审批': { type: 'approvals' },
      '管理帮助': { type: 'help' },
    };
    if (chineseModes[t]) return chineseModes[t];
    // 确定性的自然语言意图（正则，不经过模型）。只会**登记申请**或执行降级，不会直接提权。
    if (/^(?:请)?(?:帮我)?(?:切换?到|切回|进入|开启|打开)\s*(?:agent|运维|closed-agent|管理)\s*模式[。！!]?$/i.test(t)) {
      return { type: 'mode', mode: 'closed-agent', level: null, natural: true };
    }
    if (/^(?:请)?(?:帮我)?(?:切回|回到|退出agent|退出 agent|恢复)\s*(?:群友|聊天|仿真|二代)?\s*模式[。！!]?$/i.test(t) || /^退出\s*agent\s*模式[。！!]?$/i.test(t)) {
      return { type: 'mode', mode: null, level: 'L0', natural: true };
    }
    m = /^(?:请)?(?:把)?权限(?:提升|调|改|切换?)?到\s*(L[1-3]|只读|工作区|完全访问)[。！!]?$/i.exec(t);
    if (m) return { type: 'mode', mode: 'closed-agent', level: parseLevel(m[1]), natural: true };
  }
  return null;
}

export function buildAdminHelp(allowL3=true){
 const levels=allowL3?'L1|L2|L3':'L1|L2';
 return [
  '【管理员指令｜私聊】',
  '',
  '一、通用与会话',
  '/help —— 查看普通用户指令',
  '/help 管理 —— 查看管理员指令',
  '/status —— 查看当前会话状态',
  '引用机器人消息＋撤回 —— 撤回该条消息',
  '/reset —— 重置当前会话（群内需@或提及昵称）',
  '/role 名称 —— 切换已有角色',
  '/role off —— 清除角色',
  '/silent —— 暂停普通用户回复',
  '/active —— 恢复普通用户回复',
  '',
  '二、聊天白名单',
  '/添加用户 QQ号 —— 开放该用户私聊',
  '/移除用户 QQ号 —— 关闭该用户私聊',
  '/添加群 群号 —— 开放该群聊天',
  '/移除群 群号 —— 关闭该群聊天',
  '/白名单 —— 查看当前白名单',
  '',
  '三、模式与权限',
  '/mode —— 查看模式和权限',
  '/mode chat —— 切换普通聊天',
  '/mode reserved2 —— 切换二代仿真',
  '/mode reserved —— 切换一代仿真',
  '/mode agent '+levels+' —— 申请远程模式',
  '/level '+levels+'|L0 —— 调整权限等级',
  '确认 确认码'+(allowL3?' [动态码]':'')+' —— 确认权限申请',
  '/cancel —— 取消待确认申请',
  '/panic —— 立即退出远程模式',
  '/approvals —— 查看待审批操作',
  '通过 #编号 —— 批准对应操作',
  '拒绝 #编号 —— 拒绝对应操作',
  '',
  '四、生图与额度',
  '/刷新模型 —— 扫描LoRA并列出缺项提醒',
  '/关闭生图 —— 关闭普通用户Comfy生成（私聊/群内@）',
  '/开启生图 —— 恢复普通用户Comfy生成（私聊/群内@）',
  '/生图n 描述 —— 连续生成n张',
  '/tag生图n PST/正面词 NGT/负面词 —— 原样生成n张',
  ...(VIDEO_INSTALLED?['/图生视频 [参数] 描述 —— 附图生成视频（需启用扩展）','视频参数：时长、帧率、像素、种子。','/视频状态 [编号] —— 查看视频任务','/取消视频 [编号] —— 取消视频任务']:[]),
  '/loras [角色|画风] —— Anima列表',
  '/lora 名称 —— 查看风格、形象与服饰',
  '/生图 #名称1#名称2#名称3 描述 —— 同底模最多5个LoRA',
  '/生图额度 昵称 n —— 增加本小时额度（群内@）',
  '/-生图 描述 —— 私聊临时预览，压缩内容双发，直发图90秒撤回',
  '/解压 —— 引用机器人图片压缩包，直发图片90秒撤回（私聊/群聊）',
  '/清除生图缓存 —— 清理生成文件（私聊）',
  '/清理管线 —— 清空生成队列并清失效锁（私聊/群内@）',
  '设置默认生图额度 n —— 修改普通用户默认额度',
  '设置生图额度 QQ号 n —— 设置指定用户额度',
  '恢复默认生图额度 QQ号 —— 取消用户单独额度',
  '查看生图额度 QQ号 —— 查看指定用户额度',
  '',
  '五、人物与记忆',
  '/whois QQ号 —— 查看人物档案',
  '/people [关键词] —— 查找人物',
  '/person QQ号 name 称呼 —— 设置人物称呼',
  '/person QQ号 level 熟悉度 —— 设置熟悉程度',
  '/person QQ号 avoid 偏好 —— 标记不喜欢的互动',
  '/person QQ号 ok 偏好 —— 标记可接受的互动',
  '/person QQ号 alias QQ号 —— 标注关联账号',
  '/person QQ号 forget —— 删除人物记录',
  '/note QQ号 内容 —— 添加共享记忆',
  '/note-del QQ号 编号 —— 删除记忆',
  '/review —— 查看待审核记录',
  '/share approve QQ号 编号 —— 批准共享记忆',
  '/share reject QQ号 编号 —— 驳回共享记忆',
  '',
  '六、转述与审计',
  '/say 群号 内容 —— 向白名单群转述',
  '/audit [条数] —— 查看管理操作记录',
 ].join('\n');
}
export const ADMIN_HELP=buildAdminHelp();
