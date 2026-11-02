// Prepared outside the frozen extension bundle. Uses only a user-selected folder.
import {hash} from './exchange.mjs';
export const WORKSPACE_ID='vilod-hh-public-v1';
const SINGLE=/^exchange-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BATCH=/^batch-[a-f0-9]{64}$/;
async function readFile(handle,maxBytes){const file=await handle.getFile();if(file.size>maxBytes)throw Error('Файл обмена превышает допустимый размер');return JSON.parse((await file.text()).replace(/^\uFEFF/,''));}
function comparison(value){const clean=structuredClone(value);if(clean.format==='vilod-hh-analysis-batch')delete clean.created_at;return clean;}
function responseList(value){
 const responses=value?.format==='vilod-hh-analysis-replies'&&value.version===1?value.responses:value?.request_type==='analysis_result'?[value]:null;
 if(!responses)return null;
 if(!Array.isArray(responses)||!responses.length||responses.length>20||responses.some(r=>!SINGLE.test(r?.request_id)))throw Error('Неверный файл ответов');
 if(new Set(responses.map(r=>r.request_id)).size!==responses.length)throw Error('Повтор задания в файле ответов');
 return responses;
}

export async function selectExchangeFolder({call,picker=globalThis.showDirectoryPicker,isStopped}={}){
 if(typeof picker!=='function')throw Error('Выбор папки здесь не поддерживается. Используйте обычный экспорт и импорт JSON.');
 // Must remain the first asynchronous call inside a user click.
 const directory=await picker({id:'vilod-hh-exchange',mode:'readwrite'});
 return connectExchangeFolder(directory,{call,isStopped});
}

export async function connectExchangeFolder(directory,{call,isStopped=()=>false}={}){
 if(directory?.kind!=='directory'||directory.name!=='Обмен HH')throw Error('Выберите именно папку «Обмен HH» проекта');
 if(await directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('Нет доступа к папке. Повторно выберите ее кнопкой подключения.');
 const marker=await readFile(await directory.getFileHandle('vilod-hh-exchange-root.json'),2048);
 if(marker.format!=='vilod-hh-exchange-root'||marker.version!==1||marker.workspace_id!==WORKSPACE_ID)throw Error('Выбрана другая папка обмена');
 const outgoing=await directory.getDirectoryHandle('На анализ'),incoming=await directory.getDirectoryHandle('Результаты');
 await directory.getDirectoryHandle('На HH');
 const ready=async()=>{
  if(isStopped())throw Error('Обмен остановлен');
  if(await directory.queryPermission({mode:'readwrite'})!=='granted')throw Error('Доступ к папке отозван. Автоматическое чтение остановлено.');
 };
 return {
  directory,
  async saveCurrentBackup(backup){
   await ready();
   if(backup?.format!=='vilod-hh-backup'||backup.version!==1||backup.state?.schema!==1||typeof backup.producer_version!=='string')throw Error('Обновите фоновую часть расширения перед передачей текущей копии');
   const payload={...backup,snapshot_owner:'Vilod HH/'+WORKSPACE_ID,state_checksum:await hash(backup.state)};
   const text=JSON.stringify(payload,null,2);if(new TextEncoder().encode(text).length>10000000)throw Error('Текущая копия больше10МБ. Сохраните архив отдельно.');
   const name='Vilod-HH-current.json';let handle;
   try{
    handle=await outgoing.getFileHandle(name);
    const file=await handle.getFile();
    if(file.size){
     const old=await readFile(handle,10000000);
     if(old.snapshot_owner!==payload.snapshot_owner||old.format!=='vilod-hh-backup')throw Error('Файл текущей копии занят другими данными. Перезапись запрещена.');
     if(old.producer_version===payload.producer_version&&old.state_checksum===payload.state_checksum&&await hash(old.state)===payload.state_checksum)return {ok:true,duplicate:true,filename:name};
    }
   }catch(error){if(error.name!=='NotFoundError')throw error;}
   await ready();handle??=await outgoing.getFileHandle(name,{create:true});const writer=await handle.createWritable();
   try{await writer.write(text);await writer.close();}catch(error){try{await writer.abort();}catch{}throw error;}
   const saved=await readFile(handle,10000000);
   if(saved.snapshot_owner!==payload.snapshot_owner||saved.state_checksum!==payload.state_checksum||await hash(saved.state)!==payload.state_checksum||await hash(saved)!==await hash(payload))throw Error('Текущая копия не прошла проверку сохранения');
   return {ok:true,duplicate:false,filename:name};
  },
  async exportPacket(packet){
   await ready();
   let id;
   if(packet?.format==='vilod-hh-analysis-batch'&&packet.version===1&&BATCH.test(packet.batch_id)&&Array.isArray(packet.packets)&&packet.packets.length&&packet.packets.length<=20&&packet.packets.every(p=>SINGLE.test(p.request_id)&&p.request_type==='analyze_vacancy')){
    if(packet.batch_id!=='batch-'+await hash(packet.packets.map(p=>p.request_id)))throw Error('ID пакета не соответствует вложенным заданиям');
    id=packet.batch_id;
   }
   else if(packet?.request_type==='analyze_vacancy'&&SINGLE.test(packet.request_id))id=packet.request_id;
   else throw Error('Неверный исходный пакет для обмена');
   const text=JSON.stringify(packet,null,2);if(new TextEncoder().encode(text).length>10000000)throw Error('Пакет больше 10 МБ');
   const name=id+'.json';let existing;
   try{existing=await outgoing.getFileHandle(name);}catch(error){if(error.name!=='NotFoundError')throw error;}
   if(existing){
    const old=await readFile(existing,10000000);
    if(await hash(comparison(old))!==await hash(comparison(packet)))throw Error('Файл с таким ID уже содержит другие данные. Перезапись запрещена.');
    return {ok:true,duplicate:true,filename:name,location:'На анализ',assistant_started:false};
   }
   await ready();
   const handle=await outgoing.getFileHandle(name,{create:true});
   const writable=await handle.createWritable();
   try{await writable.write(text);await writable.close();}catch(error){try{await writable.abort();}catch{}throw error;}
   if(await hash(comparison(await readFile(handle,10000000)))!==await hash(comparison(packet)))throw Error('Сохранение пакета в папке не подтверждено');
   return {ok:true,duplicate:false,filename:name,location:'На анализ',assistant_started:false};
  },
  async importReplies({afterName='',limit=100}={}){
   await ready();
   if(typeof afterName!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Неверная страница файлов обмена');
   const result={ok:true,imported:0,duplicates:0,operator_imported:0,operator_duplicates:0,ignored:0,errors:[],files_examined:0,send_allowed:false};
   const entries=[];
   for await(const entry of incoming.values()){
    if(entry.kind!=='file'||!entry.name.toLowerCase().endsWith('.json'))continue;
    entries.push(entry);if(entries.length>10000)throw Error('В папке результатов больше 10000 файлов. Требуется разбор архива.');
   }
   entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
   const pending=entries.filter(e=>!afterName||e.name>afterName),selected=pending.slice(0,limit);
   result.more_files=pending.length>selected.length;result.next_cursor=result.more_files?selected.at(-1).name:null;
   for(const entry of selected){
    await ready();
    result.files_examined++;
    try{
     const value=await readFile(entry,1000000);
     if(value.format==='vilod-hh-operator-preparation'){
      await ready();const saved=await call({command:'import_operator_report',report:value,source_file:'Результаты/'+entry.name});
      if(!saved.ok)throw Error(saved.error||'Отчет оператора не сохранен');
      if(saved.analysis_packet)await this.exportPacket(saved.analysis_packet);
      saved.duplicate?result.operator_duplicates++:result.operator_imported++;continue;
     }
     const responses=responseList(value);
     if(!responses){result.ignored++;continue;}
     const expected=await Promise.all(responses.map(async r=>({request_id:r.request_id,checksum:await hash(r)})));
     const known=await call({command:'lookup_analysis_receipts',items:expected});
     if(!known.ok)throw Error(known.error||'Не удалось сверить историю импорта');
     if(known.accepted===responses.length){result.duplicates+=responses.length;continue;}
     await ready();
     const imported=await call({command:'import_analysis_batch',bundle:{format:'vilod-hh-analysis-replies',version:1,responses}});
     if(!imported.ok)throw Error(imported.error||'Импорт ответов не подтвержден');
     result.imported+=imported.imported;result.duplicates+=imported.duplicates;
    }catch(error){result.errors.push({file:entry.name,error:error.message});}
   }
   result.partial=result.errors.length>0;
   return result;
  }
 };
}
