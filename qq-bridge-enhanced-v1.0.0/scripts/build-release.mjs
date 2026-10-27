import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../scripts/release.mjs',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});process.exitCode=result.status??1;
