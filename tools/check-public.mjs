import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {initialProfile,validateProfile} from '../extension/profile.mjs';
import {emptyState,dispatch} from '../extension/local-store.mjs';
import {WORKSPACE_ID} from '../extension/folder-exchange.mjs';
const root=new URL('../extension/',import.meta.url),p=initialProfile(),s=emptyState();
for(const [k,v] of Object.entries(p)){if(!['id','version'].includes(k))assert.equal(v,typeof v==='string'?'':typeof v==='boolean'?false:0,k);}
assert.equal(p.id,'local-profile');assert.equal(Object.keys(s.cards).length,0);assert.equal(s.jobs.length,0);assert.equal(Object.keys(s.history||{}).length,0);
assert.throws(()=>validateProfile(p));validateProfile({...p,name:'Example',direction:'Example role'});
assert.equal(dispatch(s,{command:'get_profile'}).profile.name,'');
const marker=JSON.parse(await readFile(new URL('../exchange-template/Обмен HH/vilod-hh-exchange-root.json',import.meta.url),'utf8'));assert.equal(marker.workspace_id,WORKSPACE_ID);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')),release=JSON.parse(await readFile(new URL('release-ready.json',root),'utf8'));
assert.equal(manifest.name,'Vilod HH');assert.equal(release.version,manifest.version);
const paths=[];
async function walk(dir,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){const path=prefix+e.name;if(e.isDirectory())await walk(new URL(e.name+'/',dir),path+'/');else paths.push(path);}}
await walk(root);assert(!paths.includes('legacy-history-seed.json'));assert(!paths.includes('seed.mjs'));
for(const path of paths){const data=await readFile(new URL(path,root));if(path!=='release-ready.json')assert.equal(createHash('sha256').update(data).digest('hex'),release.files[path],path);if(/\.(mjs|js)$/.test(path)){const text=data.toString();for(const m of text.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))await readFile(new URL(m[1],new URL(path,root)));}}
assert.deepEqual(Object.keys(release.files).sort(),paths.filter(p=>p!=='release-ready.json').sort());
for(const path of [manifest.options_page,manifest.background.service_worker,manifest.action.default_popup,...Object.values(manifest.icons)])await readFile(new URL(path,root));
console.log('PASS: blank profile/state, no bundled history, folder marker, imports, manifest resources and release hashes ('+paths.length+' extension files)');
