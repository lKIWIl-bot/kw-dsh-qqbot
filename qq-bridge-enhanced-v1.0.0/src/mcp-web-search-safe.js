// 安全版 Web Search / Fetch MCP server（stdio）。由 DSH 的 MCP 客户端 spawn。
//
// 安全设计：
// - 只暴露只读工具 `web_search`、`web_fetch` 与 `web_fetch_image`：查网络用语/梗/黑话、抓取网页正文。
// - 不暴露任何本地文件、命令执行、写操作。
// - 查询词做基础清洗：去 CQ 码、控制字符、超长截断。
// - 搜索：优先走 **DSH 同一路 DeepSeek 联网搜索**（src/web-search.js：同一端点/模型/
//   服务端 web_search 工具，凭据取 config/env/DSH 的 .credentials.yaml），
//   不可用时回退 Bing（RSS 优先）。搜索词不再默认发给 Bing。
// - `web_fetch` 仅允许 http/https：
//   - 禁止 URL 内嵌凭据；
//   - 禁止 localhost / .local / 私有 IP / 环回 / 链路本地 / CGNAT 等内网地址；
//   - 域名会先做 DNS 解析并检查全部解析结果，避免解析到内网；
//   - 手动跟随重定向，每一跳都重新校验；
//   - 响应体按字节流限量读取，避免超大响应拖垮进程。
// - 搜索结果/抓取结果仅作为“候选解释”，最终是否入库仍由控制台人工确认。
import path from 'node:path';
import { safeFetch, safeFetchBuffer } from './safe-fetch.js';
import { formatWebFetchResult, formatWebImageResult } from './web-fetch-result.mjs';
import { webSearch } from './web-search.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * 项目根目录（用于读 config.json 的 webSearch 段）。
 *
 * 不能用 `import.meta.url`：离线测试会把本文件塞进 vm 上下文执行（那里没有 import.meta，
 * 直接是语法错误）。DSH 以 `node <本文件绝对路径>` 启动 MCP，所以 argv[1] 就是本文件；
 * 取它的上一级 `src/` 的父目录即可。取不到时退回 cwd（测试环境正好从仓库根运行）。
 */
function projectRoot() {
  try {
    const entry = String(process.argv[1] ?? '');
    if (entry) {
      const dir = path.dirname(path.resolve(entry));
      if (path.basename(dir) === 'src') return path.dirname(dir);
    }
  } catch {}
  return process.cwd();
}

function sanitizeQuery(query) {
  return String(query ?? '')
    // 去掉 CQ 码（[CQ:xxx]）
    .replace(/\[CQ:[^\]]*\]/gi, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const server = new McpServer({ name: 'web-search-safe', version: '1.0.0' });

server.tool(
  'web_search',
  '只读联网搜索：优先使用与 DSH 相同的 DeepSeek 联网搜索（结果更准、不把群里的词发给搜索引擎广告网络），不可用时自动回退 Bing。返回标题/URL/摘要，不执行任何本地操作。适合查网络用语、梗、事实性问题和热点。',
  { query: z.string().describe('要搜索确认的网络用语/黑话/梗/事实性问题') },
  async ({ query }) => {
    const clean = sanitizeQuery(query);
    if (!clean) {
      return { content: [{ type: 'text', text: '查询词为空，已拒绝。' }], isError: true };
    }
    try {
      const result = await webSearch(clean, { root: projectRoot() });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `搜索失败：${error?.message ?? error}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'web_fetch',
  '只读抓取 HTTP(S) 网页，返回原始文本/HTML前50000字符、HTTP状态和候选图片images。要看网页图片，选相关images URL再调用web_fetch_image；HTML/alt不等于已经看图。验证页、反爬、非2xx会明确标为失败，不能据此认定网站被墙或全网不可用。正文须自行核实出处，HTTP200不代表官方。禁止访问内网/本机地址，不执行本地操作。',
  { url: z.string().describe('要抓取的 http(s) URL') },
  async ({ url }) => {
    try {
      const result = await safeFetch(url);
      return formatWebFetchResult(result);
    } catch (error) {
      return {
        content: [{ type: 'text', text: `抓取失败：${error?.message ?? error}。本次没有取得正文；请按具体错误区分连接、DNS或超时问题，不把一次抓取失败概括成网站被墙。` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'web_fetch_image',
  '查看公开网页图片：传入图片直链（可来自web_fetch的images候选列表或用户提供的图片URL），实际下载并以image内容交给视觉模型。每次一张，通常只看最相关的1张；不把网页地址、alt、文件名或搜索摘要当作看过图片。支持PNG/JPEG/GIF/WebP，最大8MiB。与web_fetch相同的公网URL、DNS及每跳重定向校验；不能绕过人机验证，不读取QQ消息或本地文件，不会往QQ发送图片。',
  { url: z.string().describe('公开HTTP(S)图片直链；网页地址须先用web_fetch找图片，不传QQ消息ID、本地路径或data URL') },
  async ({url}) => {
    try {
      return formatWebImageResult(await safeFetchBuffer(url));
    } catch(error) {
      return {content:[{type:'text',text:'网页图片读取失败：'+(error?.message??error)+'。没有取得图像内容；不可根据URL、alt或记忆编造图中细节。验证页/403不等于整个网站被墙。'}],isError:true};
    }
  }
);

await server.connect(new StdioServerTransport());
