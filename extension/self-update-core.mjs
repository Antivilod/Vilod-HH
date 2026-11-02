// Pure release consistency gate. No Chrome APIs, fetch, lifecycle or commands.
// read(relativePath) must read ONLY this extension's bundled resources.
export const LIMITS=Object.freeze({files:100,fileBytes:2*1024*1024,totalBytes:10*1024*1024,markerBytes:64*1024});
export const MANDATORY=Object.freeze(['manifest.json','version.mjs','worker.mjs','dashboard.html','dashboard.mjs','popup.html','popup.js','self-update-core.mjs']);
export class ReleaseError extends Error{constructor(code,message){super(message);this.name='ReleaseError';this.code=code;}}
const fail=(code,message)=>{throw new ReleaseError(code,message);};
export function validPath(path){
 return typeof path==='string'&&path.length>0&&path.length<=240&&!path.includes('..')&&path.split('/').every(part=>part.length<=100&&/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part)&&part!=='.');
}
export function versionParts(value){
 if(typeof value!=='string'||!/^\d+(?:\.\d+){0,3}$/.test(value))fail('version','Invalid numeric Chrome version');
 const parts=value.split('.');if(parts.some(p=>p.length>1&&p[0]==='0')||parts.some(p=>p.length>5||Number(p)>65535)||parts.every(p=>Number(p)===0))fail('version','Invalid numeric Chrome version');
 return Array.from({length:4},(_,i)=>Number(parts[i]||0));
}
export function compareVersions(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<4;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
export const newer=(a,b)=>compareVersions(a,b)>0;
export const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
// Tagged canonical form preserves object-vs-array and primitive distinctions.
const canonical=v=>Array.isArray(v)?['array',v.map(canonical)]:record(v)?['object',Object.keys(v).sort().map(k=>[k,canonical(v[k])])]:[typeof v,v];
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function parseJSON(bytes,label){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('json','Invalid UTF-8 JSON: '+label);}}
function resourcePaths(manifest){
 const result=[];
 const path=(value,label)=>{if(!validPath(value))fail('manifest_resource','Invalid bundled path: '+label);result.push(value);};
 const icons=(value,label)=>{if(typeof value==='string')path(value,label);else if(record(value)){for(const [size,file] of Object.entries(value)){if(!/^\d+$/.test(size))fail('manifest_resource','Invalid icon size: '+label);path(file,label);}}else fail('manifest_resource','Invalid icons: '+label);};
 if(manifest.icons!==undefined)icons(manifest.icons,'icons');
 if(manifest.background!==undefined){if(!record(manifest.background))fail('manifest_resource','Invalid background');const b=manifest.background;if(b.service_worker!==undefined)path(b.service_worker,'background.service_worker');if(b.page!==undefined)path(b.page,'background.page');if(b.scripts!==undefined){if(!Array.isArray(b.scripts))fail('manifest_resource','Invalid background.scripts');for(const p of b.scripts)path(p,'background.scripts');}}
 if(manifest.options_page!==undefined)path(manifest.options_page,'options_page');
 if(manifest.options_ui!==undefined){if(!record(manifest.options_ui))fail('manifest_resource','Invalid options_ui');path(manifest.options_ui.page,'options_ui.page');}
 for(const key of ['action','browser_action','page_action'])if(manifest[key]!==undefined){const a=manifest[key];if(!record(a))fail('manifest_resource','Invalid '+key);if(a.default_popup!==undefined&&a.default_popup!=='')path(a.default_popup,key+'.default_popup');if(a.default_icon!==undefined)icons(a.default_icon,key+'.default_icon');}
 return [...new Set(result)];
}
export async function verifyRelease(runningManifest,read){
 if(typeof read!=='function'||!record(runningManifest)||runningManifest.manifest_version!==3)fail('arguments','Expected running MV3 manifest and own-resource reader');
 // Freeze the running input before awaiting caller code.
 const running=structuredClone(runningManifest);versionParts(running.version);
 async function bytes(path,limit=LIMITS.fileBytes){
  if(!validPath(path))fail('path','Invalid bundled resource path');
  let data;try{data=await read(path);}catch{fail('read','Cannot read own bundled resource: '+path);}
  let value;if(data instanceof ArrayBuffer)value=new Uint8Array(data);else if(ArrayBuffer.isView(data)&&data.BYTES_PER_ELEMENT===1)value=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);else fail('read_type','Reader must return bytes: '+path);
  if(value.byteLength>limit)fail('file_size','Bundled resource exceeds limit: '+path);
  return value.slice(); // caller cannot mutate the bytes after returning
 }
 const manifestBytes=await bytes('manifest.json'),candidate=parseJSON(manifestBytes,'manifest.json');
 if(!record(candidate))fail('manifest','Expected manifest object');
 const comparison=compareVersions(candidate.version,running.version);
 if(comparison<=0)return {status:'current',from:running.version,to:candidate.version,running:running.version,disk:candidate.version,reason:comparison===0?'same_version':'older_version'};
 if(!same({...candidate,version:running.version},running))fail('manifest_change','Only manifest.version may change');
 const markerBytes=await bytes('release-ready.json',LIMITS.markerBytes),marker=parseJSON(markerBytes,'release-ready.json');
 if(!record(marker)||marker.format!=='vilod-hh-release'||marker.schema!==1||marker.version!==candidate.version||!record(marker.files))fail('marker','Invalid or mismatching release marker');
 const inventory=Object.entries(marker.files);
 if(inventory.length<MANDATORY.length||inventory.length>LIMITS.files)fail('inventory_count','Invalid release inventory count');
 const files=new Map(inventory);
 for(const [path,hash] of inventory){if(!validPath(path)||path==='release-ready.json')fail('path','Invalid inventory path: '+path);if(typeof hash!=='string'||! /^[a-f0-9]{64}$/.test(hash))fail('hash_format','Invalid SHA256: '+path);}
 for(const path of [...MANDATORY,...resourcePaths(candidate)])if(!files.has(path))fail('missing','Missing bundled resource in inventory: '+path);
 let total=0,versionSource=null;
 for(const [path,expected] of inventory){
  const data=path==='manifest.json'?manifestBytes:await bytes(path);total+=data.byteLength;
  if(total>LIMITS.totalBytes)fail('total_size','Release bundle exceeds total limit');
  if(await sha256(data)!==expected)fail('hash_mismatch','SHA256 mismatch: '+path);
  if(path==='version.mjs')versionSource=data;
 }
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(versionSource);}catch{fail('version_source','Invalid UTF-8 version.mjs');}
 // Deliberately finite grammar, never execute a release's source to learn VERSION.
 const versionMatch=text.match(/^\s*export\s+const\s+VERSION\s*=\s*(['"])([0-9.]+)\1\s*;\s*$/);
 if(!versionMatch||versionMatch[2]!==candidate.version)fail('version_source','version.mjs must export exactly the candidate VERSION');
 versionParts(versionMatch[2]);
 const manifestHash=await sha256(manifestBytes),markerHash=await sha256(markerBytes);
 if(await sha256(await bytes('manifest.json'))!==manifestHash||await sha256(await bytes('release-ready.json',LIMITS.markerBytes))!==markerHash)fail('overlap','Manifest or marker changed during verification');
 return {status:'verified',from:running.version,to:candidate.version,release_hash:markerHash,files_verified:inventory.length,total_bytes:total,manifest_sha256:manifestHash,marker_sha256:markerHash,inventory:inventory.map(([path])=>path)};
}
