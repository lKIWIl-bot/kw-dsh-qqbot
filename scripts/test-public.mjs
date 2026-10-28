import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),bridge=path.join(root,'qq-bridge-enhanced-v1.0.0');
import {EXTENSION_IDS,installedExtension} from './extension-lib.mjs';
// This explicit suite runs offline. Local model audits and live QQ/GPU probes are excluded.
const files=['test-comfy-generation-access.mjs','test-comfy-chat.mjs','test-comfy-batch.mjs','test-comfy-pipeline.mjs','test-comfy-queue-recovery.mjs','test-whitelist-help.mjs','test-group-reply-policy.mjs','test-group-reset.mjs','test-reasoning-policy.mjs'].map(f=>path.join(bridge,'scripts',f));
for(const name of fs.readdirSync(path.join(root,'tests')))if(name.endsWith('.test.mjs'))files.push(path.join(root,'tests',name));
for(const id of EXTENSION_IDS){const extension=installedExtension(id,root);if(extension)for(const name of fs.readdirSync(path.join(extension.directory,'tests')))if(name.endsWith('.mjs'))files.push(path.join(extension.directory,'tests',name));}
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1;
