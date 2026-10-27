import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Client} from '../qq-bridge-enhanced-v1.0.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../qq-bridge-enhanced-v1.0.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('锁定MCP版本可初始化服务，Comfy开关重载后正确公开生图授权工具', {timeout:30000},async t=>{
 for(const [script,expected]of [['mcp-snowluma-safe.js','qq_status'],['mcp-host-server.js','snowluma_status'],['mcp-web-search-safe.js','web_fetch_image']]){
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'qq-bridge-enhanced-v1.0.0/src',script)],cwd:path.join(root,'qq-bridge-enhanced-v1.0.0'),stderr:'pipe'}),client=new Client({name:'public-release-test',version:'0.1.0'});
  try{await client.connect(transport);const listed=await client.listTools();const tool=listed.tools.find(t=>t.name===expected);assert.ok(tool,script+': '+expected);if(expected==='qq_comfy_generate'){assert.ok(tool.inputSchema.required.includes('ticket'));assert.ok(!Object.hasOwn(tool.inputSchema.properties,'maskTarget'));}}
  finally{await client.close();await transport.close();}
 }
 const bridge=path.join(root,'qq-bridge-enhanced-v1.0.0'),parent=path.join(bridge,'.build');fs.mkdirSync(parent,{recursive:true});const fixture=fs.mkdtempSync(path.join(parent,'mcp-register-'));fs.mkdirSync(path.join(fixture,'src'));
 t.after(()=>{if(path.dirname(path.resolve(fixture))!==path.resolve(parent)||!path.basename(fixture).startsWith('mcp-register-'))throw Error('Unsafe cleanup');fs.rmSync(fixture,{recursive:true,force:false});});
 for(const file of ['mcp-snowluma-safe.js','sensitive.js','qq-model-view.js'])fs.copyFileSync(path.join(bridge,'src',file),path.join(fixture,'src',file));
 for(const enabled of [false,true]){
  fs.writeFileSync(path.join(fixture,'config.json'),JSON.stringify({comfyChat:{enabled},allow:{private:[],groups:[]}}));
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(fixture,'src/mcp-snowluma-safe.js')],cwd:fixture,stderr:'pipe'}),client=new Client({name:'comfy-tool-test',version:'0.1.0'});
  try{await client.connect(transport);const listed=await client.listTools(),tool=listed.tools.find(t=>t.name==='qq_comfy_generate');assert.equal(!!tool,enabled);if(tool){assert.ok(tool.inputSchema.required.includes('ticket'));assert.ok(!Object.hasOwn(tool.inputSchema.properties,'maskTarget'));}}finally{await client.close();await transport.close();}
 }
});
