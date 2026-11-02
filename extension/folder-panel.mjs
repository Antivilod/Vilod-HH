import {selectExchangeFolder,connectExchangeFolder} from './folder-exchange.mjs';
import {loadFolderHandle,storeFolderHandle} from './folder-handle-store.mjs';
import {loadFolderAuto,saveFolderAuto} from './folder-preferences.mjs';
const $=id=>document.getElementById(id);
let connection=null,handle=null,epoch=0,timer=null,busy=false,cursor='',dependencies,preferenceRevision=0,connectionsPending=0,preferenceWrites=0,updateUiLocked=false;
export function folderExchangeBusy(){return busy||connectionsPending>0||preferenceWrites>0;}
export function suspendFolderExchange(){updateUiLocked=true;epoch++;connection=null;stopTimer();}
export async function resumeFolderExchangeAfterUpdateCheck(){if(handle){await ensureConnection();updateTimer();}}
export function refreshFolderControls({releaseUpdateLock=false}={}){if(releaseUpdateLock)updateUiLocked=false;paint($('folderStatus').textContent);}
function rememberAutomatic(){
 preferenceRevision++;
 preferenceWrites++;
 return saveFolderAuto($('folderAuto').checked).catch(error=>dependencies?.notice(error.message)).finally(()=>{preferenceWrites--;});
}
function disableAutomatic(){
 stopTimer();$('folderAuto').checked=false;return rememberAutomatic();
}
function paint(text){
 $('folderStatus').textContent=text;
 $('folderRead').disabled=updateUiLocked||!handle;$('folderDisconnect').disabled=updateUiLocked||!handle;$('folderAuto').disabled=updateUiLocked;
 $('folderConnect').disabled=updateUiLocked||Boolean(connection);$('folderConnect').textContent=connection?'Папка «Обмен HH» подключена':handle?'Возобновить обмен с папкой':'Выбрать папку обмена';
}
function stopTimer(){if(timer)clearInterval(timer);timer=null;}
function updateTimer(){
 stopTimer();
 if(connection&&handle&&!updateUiLocked&&$('folderAuto').checked)timer=setInterval(()=>readReplies(true),12000);
}
async function activate(selected,run){
 connectionsPending++;
 try{
 const next=await connectExchangeFolder(selected,{call:dependencies.call,isStopped:()=>run!==epoch});
 if(run!==epoch)throw Error('Подключение отменено');
 connection=next;handle=selected;paint('Подключена папка «Обмен HH». Файлы не удаляются.');return next;
 }finally{connectionsPending--;}
}
async function ensureConnection(){
 if(updateUiLocked)throw Error('Обмен временно остановлен для обновления программы');
 if(connection)return connection;
 if(!handle)return null;
 return activate(handle,++epoch);
}
export async function deliverToFolder(packet){
 if(!dependencies||!handle)return null;
 const transport=await ensureConnection();
 return transport.exportPacket(packet);
}
export async function saveCurrentStateSnapshot({resume=false}={}){
 const transport=connection||(resume&&handle?await ensureConnection():null);if(!transport)return null;
 const result=await dependencies.call({command:'export_backup'});
 if(!result.ok)throw Error(result.error||'Текущая копия не получена');
 return transport.saveCurrentBackup(result.backup);
}
export function stopFolderExchange(){
 epoch++;connection=null;stopTimer();
 const saved=disableAutomatic();
 if(dependencies)paint(handle?'Обмен с папкой остановлен. Уже сохраненные файлы остаются.':'Папка обмена не подключена.');
 return saved;
}
async function readReplies(quiet=false){
 if(busy||!handle||updateUiLocked)return;
 busy=true;$('folderRead').disabled=true;
 let run=epoch;
 try{
  let transport=connection;
  if(!transport){run=++epoch;transport=await activate(handle,run);}
  const result=await transport.importReplies({afterName:cursor,limit:100});
  if(run!==epoch)return;
  cursor=result.next_cursor||'';
  if(result.imported||result.operator_imported){await dependencies.refresh();await dependencies.refreshSelected();}
  if(run!==epoch)return;
  try{await saveCurrentStateSnapshot();}catch(error){result.errors.push({file:'Vilod-HH-current.json',error:error.message});await disableAutomatic();}
  if(run!==epoch)return;
  const text='Новых ответов: '+result.imported+'. Уже сохранены: '+result.duplicates+'. Ошибок: '+result.errors.length+'.'+(result.operator_imported||result.operator_duplicates?' Записей оператора: '+result.operator_imported+'. Уже в журнале: '+result.operator_duplicates+'.':'');
  paint(text+(result.errors.length?' '+result.errors[0].file+': '+result.errors[0].error:''));
  if(!quiet||result.imported||result.operator_imported||result.errors.length)dependencies.notice(text+' Импорт файлов не отправляет отклики.');
 }catch(error){
  if(run===epoch){await disableAutomatic();paint('Обмен остановлен: '+error.message);dependencies.notice('Проверка папки: '+error.message);}
  await dependencies.refresh();
 }finally{busy=false;$('folderRead').disabled=!handle;}
}
export async function initializeFolderPanel(options){
 dependencies=options;
 $('folderConnect').addEventListener('click',async()=>{
  if(updateUiLocked)return;
  connectionsPending++;
  $('folderConnect').disabled=true;const run=++epoch;
  try{
   if(handle){
    const permission=await handle.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw Error('Доступ к выбранной папке не предоставлен');
    await activate(handle,run);
   }
   else{
    const selected=await selectExchangeFolder({call:options.call,isStopped:()=>run!==epoch});
    await storeFolderHandle(selected.directory);
    if(run!==epoch)throw Error('Подключение отменено');
    connection=selected;handle=selected.directory;paint('Папка подключена. Можно сохранять пакеты и читать готовые ответы.');
   }
   try{await saveCurrentStateSnapshot();}catch(error){options.notice('Папка подключена, но текущая копия не передана: '+error.message);}
   updateTimer();
  }catch(error){connection=null;paint('Папка не подключена: '+error.message);options.notice('Подключение папки: '+error.message);}finally{connectionsPending--;}
 });
 $('folderRead').addEventListener('click',()=>readReplies(false));
 $('folderAuto').addEventListener('change',()=>{if(updateUiLocked)return;updateTimer();return rememberAutomatic();});
 $('folderDisconnect').addEventListener('click',async()=>{
  if(updateUiLocked)return;
  connectionsPending++;
  stopFolderExchange();handle=null;cursor='';
  try{await storeFolderHandle(null);paint('Папка отключена. Файлы сохранены.');}
  catch(error){paint('Обмен остановлен, но запомненное подключение не удалено: '+error.message);}
  finally{connectionsPending--;}
 });
 try{
  const loadingEpoch=epoch,loadingPreference=preferenceRevision;
  const [saved,automatic]=await Promise.all([loadFolderHandle(),loadFolderAuto().catch(error=>{options.notice('Настройка авточтения не прочитана: '+error.message);return false;})]);
  if(epoch!==loadingEpoch)return;
  // This product opts in for its already selected folder, as requested by the
  // user. A persisted false (including Stop) always takes precedence.
  if(preferenceRevision===loadingPreference)$('folderAuto').checked=automatic===null?Boolean(saved&&options.defaultAutomatic===true):automatic;
  if(saved){
   handle=saved;
   if(options.initiallyStopped?.()){paint('Папка запомнена. Обмен остановлен; файлы сохранены.');return;}
   const permission=await saved.queryPermission({mode:'readwrite'});
   if(epoch!==loadingEpoch||options.initiallyStopped?.())return;
   if(permission==='granted')await activate(saved,++epoch);else paint('Папка запомнена, но доступ требует подтверждения кнопкой возобновления.');
  }
  else paint('Папка не подключена. Обычный экспорт и импорт JSON работают.');
  if(connection&&automatic===null&&preferenceRevision===loadingPreference)await rememberAutomatic();
 }catch(error){paint('Папка не подключена. Обычный обмен файлами доступен.');}
 if(connection&&!options.initiallyStopped?.()){try{await saveCurrentStateSnapshot();}catch(error){await disableAutomatic();options.notice('Не удалось передать текущую копию: '+error.message);}}
 updateTimer();
}
