import {verifyRelease,newer} from './self-update-core.mjs';
import {hash} from './exchange.mjs';
export const PENDING_UPDATE='vilodPendingSelfUpdate',UPDATE_STATUS='vilodSelfUpdateStatus';
export const UPDATE_READ_COMMANDS=new Set(['ping','export_backup','get_self_update_status','pause_read_jobs']);
export async function readOwnResource(runtime,file,fetchOwn=fetch){
 if(typeof file!=='string'||file.startsWith('/')||file.split('/').some(p=>!p||p==='.'||p==='..')||!/^[A-Za-z0-9_.\/-]+$/.test(file))throw Error('Неверный файл обновления');
 const response=await fetchOwn(runtime.getURL(file),{cache:'no-store',credentials:'omit'});
 if(!response.ok)throw Error('Файл обновления недоступен: '+file);
 const length=Number(response.headers?.get?.('content-length')||0);if(length>2_000_000)throw Error('Файл обновления слишком большой');
 const bytes=await response.arrayBuffer();if(bytes.byteLength>2_000_000)throw Error('Файл обновления слишком большой');return bytes;
}
export async function probeSelfUpdate({runtime,pending,read}={}){
 if(pending)return {ok:true,status:'blocked',message:'Предыдущий перезапуск требует проверки. Повторное обновление не запускается.'};
 return {ok:true,...await verifyRelease(runtime.getManifest(),read||((file)=>readOwnResource(runtime,file)))};
}
export async function planSelfUpdate(state,{runtime,pending,view,expectedReleaseHash,read,now=Date.now(),uuid=()=>crypto.randomUUID()}={}){
 if(view!==undefined&&(typeof view?.searchText!=='string'||view.searchText.length>300||![1,3,7].includes(view.searchDays)||typeof view.searchRemote!=='boolean'||Object.keys(view).some(k=>!['searchText','searchDays','searchRemote'].includes(k))))throw Error('Неверные параметры сохранения поиска');
 if(pending)return {result:{ok:true,status:'blocked',message:'Предыдущий перезапуск требует проверки. Повторное обновление не запускается.'}};
 if(Object.values(state.preparationOperations||{}).some(op=>op.status==='in_progress')||state.jobs.some(job=>job.status==='reading'))return {result:{ok:true,status:'deferred',message:'Обновление подождет завершения текущей операции.'}};
 const verified=await verifyRelease(runtime.getManifest(),read||((file)=>readOwnResource(runtime,file)));
 if(verified.status!=='verified')return {result:{ok:true,...verified}};
 if(expectedReleaseHash!==undefined&&verified.release_hash!==expectedReleaseHash)throw Error('Комплект обновления изменился после предварительной проверки');
 const next=structuredClone(state);next.paused=true;
 next.events.push({type:'extension_update_prepared',at:new Date(now).toISOString(),from:verified.from,to:verified.to,release_hash:verified.release_hash,send_confirmed:false});
 const intent={schema:1,nonce:uuid(),from:verified.from,to:verified.to,release_hash:verified.release_hash,state_checksum:await hash(next),prepared_at:new Date(now).toISOString(),...(view?{view:structuredClone(view)}:{})};
 return {state:next,pending:intent,result:{ok:true,status:'prepared',from:verified.from,to:verified.to,files_verified:verified.files_verified,reload:true,send_allowed:false}};
}
export async function finishSelfUpdate(details,{runtime,storage,tabs,now=Date.now()}={}){
 const data=await storage.get(['vilodState',PENDING_UPDATE,UPDATE_STATUS]),pending=data[PENDING_UPDATE],version=runtime.getManifest().version;
 const last=data[UPDATE_STATUS];
 if(!pending&&last?.status==='applied'&&details.reason==='update'&&last.to===version&&last.from===details.previousVersion)return last;
 let status={status:'manual_update',version,at:new Date(now).toISOString(),previous_version:details.previousVersion||null};
 if(pending){
  const age=now-Date.parse(pending.prepared_at),matched=pending.schema===1&&details.reason==='update'&&pending.to===version&&pending.from===details.previousVersion&&newer(pending.to,pending.from)&&age>=0&&age<300_000;
  const unchanged=matched&&data.vilodState&&await hash(data.vilodState)===pending.state_checksum;
  status={status:unchanged?'applied':'needs_review',version,at:new Date(now).toISOString(),from:pending.from,to:pending.to,nonce:pending.nonce,release_hash:pending.release_hash,state_preserved:!!unchanged,...(pending.view?{view:pending.view}:{}),message:unchanged?'Программа обновлена. Данные сохранены; очереди не возобновлялись.':'Перезапуск требует проверки. Данные не заменялись; автоматический повтор не выполняется.'};
  if(!unchanged){await storage.set({[UPDATE_STATUS]:status});return status;}
  // Durable acknowledgement precedes consuming the attempt and reopening UI.
  await storage.set({[UPDATE_STATUS]:status});await storage.remove(PENDING_UPDATE);
 }else await storage.set({[UPDATE_STATUS]:status});
 if(['install','update'].includes(details.reason))await tabs.create({url:runtime.getURL('dashboard.html')});
 return status;
}
