import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../extension/',import.meta.url),files={};
async function walk(dir,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){const path=prefix+e.name;if(e.isDirectory())await walk(new URL(e.name+'/',dir),path+'/');else if(path!=='release-ready.json')files[path]=createHash('sha256').update(await readFile(new URL(e.name,dir))).digest('hex');}}
await walk(root);const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
await writeFile(new URL('release-ready.json',root),JSON.stringify({format:'vilod-hh-release',schema:1,version:manifest.version,files:Object.fromEntries(Object.entries(files).sort())},null,2)+'\n');
console.log('Release inventory updated');
