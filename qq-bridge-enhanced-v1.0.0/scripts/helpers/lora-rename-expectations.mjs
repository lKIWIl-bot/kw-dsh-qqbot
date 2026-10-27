import {createHash} from 'node:crypto';
// Historical snapshots retain pre-rename names; only the two user-authorized identities migrate.
const names={'真实动漫':'真实动漫ill','动漫截图':'动漫截图ill'};
export function renamedEntry(entry){if(!names[entry.name])return entry;const next={...entry,name:names[entry.name],filename:names[entry.name]+'.safetensors'};if(entry.sha256){delete next.sha256;return {...next,sha256:createHash('sha256').update(JSON.stringify(next)).digest('hex')};}return next;}
export function renamedCatalog(c){const map=obj=>Object.fromEntries(Object.entries(obj).map(([k,v])=>[names[k]??k,v]));return {...c,loras:c.loras.map(renamedEntry),...(c.descriptions?{descriptions:map(c.descriptions)}:{}),...(c.details?{details:map(c.details)}:{})};}
