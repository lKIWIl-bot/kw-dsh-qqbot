// SnowLuma 安装目录的识别、版本检查与「更新数据迁移」。
//
// 合规边界（SnowLuma EULA v1.1 §5.4，中文为准）：
//   「将其并入第三方安装包或 Docker 镜像、通过自动化脚本部署……均须事先取得书面授权。」
// 所以这里：
//   ✅ 读取用户自己安装的 SnowLuma 目录里的 package.json / config/runtime.json（只读）；
//   ✅ 查询 GitHub 上 SnowLuma 的最新 Release 版本号，给出官方下载页链接；
//   ✅ 用户自己下载、解压新版本后，把**用户数据**（config/、data/）备份并复制到新目录；
//   ❌ 不下载、不解压、不复制、不修改 SnowLuma 的任何程序文件或专有组件（native/*.node/.dll）；
//   ❌ 不自动启动 —— 启动只在用户点击「启动 SnowLuma」时发生（见 control-center.mjs）。
//
// SnowLuma 的数据位置（对照 1.14.22 源码 packages/common/src/runtime.ts 等，都是相对它的安装目录）：
//   config/   账号、OneBot 实例配置（onebot_<QQ号>.json）、runtime.json、WebUI 密码与证书
//   data/     按 QQ 号分的运行数据
//   logs/     日志（迁移时可选）
// AI 的记忆、人物库、会话在桥接的 state/ 与 DSH 的 .dsh 里，聊天记录在 QQ 客户端里 —— 都与 SnowLuma 版本无关。

import fs from 'node:fs';
import path from 'node:path';
import { pickDialog } from './pick-dialog.mjs';

export const SNOWLUMA_RELEASES_API = 'https://api.github.com/repos/SnowLuma/SnowLuma/releases/latest';
export const SNOWLUMA_RELEASES_PAGE = 'https://github.com/SnowLuma/SnowLuma/releases';
export const USER_DATA_DIRS = ['config', 'data'];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

/** 比较 1.14.22 这样的版本号；返回 -1 / 0 / 1。 */
export function compareVersions(a, b) {
  const pa = String(a ?? '').replace(/^v/i, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b ?? '').replace(/^v/i, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 检查一个目录是不是 SnowLuma 的发行包目录。
 * @returns {{ok:boolean, error?:string, dir, version, edition:'full'|'lite', hasNodeExe, launcher, webui:{host,port}, dataDirs:string[]}}
 */
export function inspectSnowLumaDir(dir) {
  const d = path.resolve(String(dir ?? ''));
  if (!dir || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) return { ok: false, error: '目录不存在' };
  const pkg = readJson(path.join(d, 'package.json'));
  if (!pkg || pkg.name !== '@snowluma/runtime') {
    return { ok: false, error: '这不是 SnowLuma 的发行包目录（找不到 name 为 @snowluma/runtime 的 package.json）。请选择解压后含 launcher.bat、index.mjs 的那一层目录。' };
  }
  const launcher = path.join(d, 'launcher.bat');
  const entry = path.join(d, 'index.mjs');
  if (!fs.existsSync(entry)) return { ok: false, error: '目录里缺少 index.mjs' };
  const hasNodeExe = fs.existsSync(path.join(d, 'node.exe'));
  const runtime = readJson(path.join(d, 'config', 'runtime.json')) ?? {};
  const port = Number(runtime.webuiPort) > 0 && Number(runtime.webuiPort) < 65536 ? Number(runtime.webuiPort) : 5099;
  const host = typeof runtime.webuiHost === 'string' && runtime.webuiHost ? runtime.webuiHost : '127.0.0.1';
  const tls = !!runtime.webuiTls?.enabled;
  return {
    ok: true,
    dir: d,
    version: String(pkg.version ?? '未知'),
    edition: hasNodeExe ? 'full' : 'lite',
    hasNodeExe,
    launcher: fs.existsSync(launcher) ? launcher : null,
    webui: { host, port, url: `${tls ? 'https' : 'http'}://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}/` },
    dataDirs: USER_DATA_DIRS.filter((x) => fs.existsSync(path.join(d, x))),
    accounts: (() => {
      try { return fs.readdirSync(path.join(d, 'config')).map((n) => /^onebot_(\d+)\.json$/.exec(n)?.[1]).filter(Boolean); } catch { return []; }
    })(),
  };
}

/**
 * 启动命令：按 SnowLuma 自带 launcher.bat 的做法运行（先校验 Node 版本，再 node ./index.mjs），
 * 以发行包原样提供的形式运行，不改任何文件。完整版用包里自带的 node.exe，Lite 版用系统 PATH 里的 node。
 */
export function snowlumaLaunchSpec(info) {
  if (!info?.ok) return { error: info?.error ?? '未选择 SnowLuma 目录' };
  if (info.launcher && process.platform === 'win32') {
    return {
      command: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
      args: ['/d', '/s', '/c', 'launcher.bat'],
      cwd: info.dir,
      display: `${path.join(info.dir, 'launcher.bat')}`,
    };
  }
  const node = info.hasNodeExe ? path.join(info.dir, 'node.exe') : 'node';
  return { command: node, args: ['./index.mjs'], cwd: info.dir, display: `${node} ./index.mjs（${info.dir}）` };
}

/** 查询最新 Release（只读）。 */
export async function checkSnowLumaUpdate(currentVersion, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const res = await fetchImpl(SNOWLUMA_RELEASES_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'qq-bridge-enhanced-control-center' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GitHub API 返回 HTTP ${res.status}`);
  const rel = await res.json();
  const latest = String(rel.tag_name ?? '').replace(/^v/i, '');
  const assets = Array.isArray(rel.assets) ? rel.assets.map((a) => String(a.name ?? '')) : [];
  return {
    current: currentVersion ?? null,
    latest: latest || null,
    updateAvailable: !!latest && !!currentVersion && compareVersions(latest, currentVersion) > 0,
    publishedAt: rel.published_at ?? null,
    pageUrl: rel.html_url || SNOWLUMA_RELEASES_PAGE,
    notes: String(rel.body ?? '').slice(0, 4000),
    // 只告诉用户该下载哪个文件（完整版 = win-x64，不含 lite），不下载。
    suggestedAsset: assets.find((n) => /win-x64\.zip$/i.test(n) && !/lite/i.test(n)) ?? null,
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const t = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, t);
    else if (ent.isFile()) fs.copyFileSync(s, t);
  }
}

function countFiles(dir) {
  let n = 0;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) n += ent.isDirectory() ? countFiles(path.join(dir, ent.name)) : 1;
  } catch {}
  return n;
}

/**
 * 「更新数据迁移」：把旧 SnowLuma 目录的用户数据带到用户已经解压好的新版本目录。
 *   1. 校验两个目录都是 SnowLuma、新目录版本不低于旧目录、两者不是同一个目录；
 *   2. 把旧目录的 config/、data/（可选 logs/）完整备份到 backupRoot/<时间>/；
 *   3. 新目录里如已有同名目录，先改名为 .before-migrate-<时间> 保留（不删除）；
 *   4. 复制旧数据到新目录；校验文件数一致。
 * 只碰用户数据目录，不碰任何程序文件。调用方负责确保 SnowLuma 已停止。
 */
export function migrateSnowLumaData({ fromDir, toDir, backupRoot, includeLogs = false, now = Date.now }) {
  const from = inspectSnowLumaDir(fromDir);
  const to = inspectSnowLumaDir(toDir);
  if (!from.ok) return { ok: false, error: `旧目录无效：${from.error}` };
  if (!to.ok) return { ok: false, error: `新目录无效：${to.error}` };
  if (path.resolve(from.dir).toLowerCase() === path.resolve(to.dir).toLowerCase()) return { ok: false, error: '新旧目录是同一个' };
  if (compareVersions(to.version, from.version) < 0) return { ok: false, error: `新目录版本 ${to.version} 低于旧目录 ${from.version}，不迁移（防止降级覆盖）` };
  const dirs = [...USER_DATA_DIRS, ...(includeLogs ? ['logs'] : [])].filter((x) => fs.existsSync(path.join(from.dir, x)));
  if (!dirs.length) return { ok: false, error: '旧目录里没有可迁移的数据（config/、data/ 都不存在）' };
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, `snowluma-${from.version}-${stamp}`);
  for (const x of dirs) copyDir(path.join(from.dir, x), path.join(backupDir, x));
  const moved = [];
  for (const x of dirs) {
    const target = path.join(to.dir, x);
    if (fs.existsSync(target)) {
      const keep = `${target}.before-migrate-${stamp}`;
      fs.renameSync(target, keep);
      moved.push(path.basename(keep));
    }
    copyDir(path.join(from.dir, x), target);
  }
  const check = dirs.map((x) => ({ dir: x, source: countFiles(path.join(from.dir, x)), copied: countFiles(path.join(to.dir, x)) }));
  const okCount = check.every((c) => c.source === c.copied);
  return { ok: okCount, error: okCount ? undefined : '复制后文件数不一致，请检查（旧目录和备份都还在）', from: from.version, to: to.version, dirs, backupDir, keptInNewDir: moved, check };
}

/** 系统原生「选择文件夹」窗口（Windows / macOS，只在用户点击按钮时调用）。返回所选路径或 null。实现见 pick-dialog.mjs。 */
export function pickFolderDialog({ initialDir = '', title = '选择 SnowLuma 的解压目录（含 launcher.bat 的那一层）' } = {}) {
  return pickDialog({ kind: 'folder', title, initialDir });
}
