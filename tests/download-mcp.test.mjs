import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '../qq-bridge-enhanced-v1.0.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../qq-bridge-enhanced-v1.0.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('下载MCP只在已安装且启用时公开，关闭tools.webMedia后隐藏', {timeout:30000},async t=>{
 const bridge=path.join(root,'qq-bridge-enhanced-v1.0.0'),parent=path.join(bridge,'.build');fs.mkdirSync(parent,{recursive:true});
 const fixture=fs.mkdtempSync(path.join(parent,'download-mcp-')),dir=path.join(fixture,'project/qq-bridge-enhanced-v1.0.0'),entry=path.join(dir,'src/mcp-snowluma-safe.js'),addon=path.join(fixture,'project/extensions/web-media');fs.mkdirSync(path.dirname(entry),{recursive:true});
 t.after(()=>{assert.equal(path.dirname(path.resolve(fixture)),path.resolve(parent));assert.ok(path.basename(fixture).startsWith('download-mcp-'));fs.rmSync(fixture,{recursive:true,force:false});});
 for(const name of ['mcp-snowluma-safe.js','sensitive.js','qq-model-view.js'])fs.copyFileSync(path.join(bridge,'src',name),path.join(dir,'src',name));
 for(const row of [{enabled:false,installed:false,expected:false},{enabled:true,installed:false,expected:false},{enabled:true,installed:true,expected:true},{enabled:true,installed:true,tool:false,expected:false},{enabled:false,installed:true,expected:false}]){
  if(row.installed){fs.mkdirSync(addon,{recursive:true});fs.writeFileSync(path.join(addon,'manifest.json'),'{}');}
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({allow:{private:[],groups:[]},webMedia:{enabled:row.enabled},socialV2:{tools:{webMedia:row.tool}}}));
  const transport=new StdioClientTransport({command:process.execPath,args:[entry],cwd:dir,stderr:'pipe'}),client=new Client({name:'download-mcp-offline',version:'0.1.1'});
  try{await client.connect(transport);const tools=(await client.listTools()).tools,tool=tools.find(x=>x.name==='qq_web_media');assert.equal(!!tool,row.expected);if(tool){assert.ok(tool.inputSchema.required.includes('token'));assert.ok(tool.inputSchema.required.includes('key'));assert.ok(tool.inputSchema.properties.candidateIds);}}
  finally{await client.close();await transport.close();}
 }
});
