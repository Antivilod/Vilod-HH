import {dispatch,emptyState} from './local-store.mjs';
import {exchange} from './exchange.mjs';
import {restore} from './restore.mjs';
import {batch} from './batch.mjs';
import {workQueue} from './work-queue.mjs';
import {PREPARATION_COMMANDS} from './preparation.mjs';
import {importOperatorReport} from './operator-report.mjs';
import {planSelfUpdate,probeSelfUpdate,finishSelfUpdate,PENDING_UPDATE,UPDATE_STATUS,UPDATE_READ_COMMANDS} from './self-update.mjs';
let chain=Promise.resolve();
chrome.runtime.onInstalled?.addListener(details=>{
  chain=chain.catch(()=>{}).then(()=>finishSelfUpdate(details,{runtime:chrome.runtime,storage:chrome.storage.local,tabs:chrome.tabs})).catch(async error=>{
    await chrome.storage.local.set({[UPDATE_STATUS]:{status:'needs_review',at:new Date().toISOString(),message:'Перезапуск требует проверки: '+error.message}});
  });
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  const ownPages=new Set(['dashboard.html','runner.html','popup.html'].map(name=>'chrome-extension://'+chrome.runtime.id+'/'+name));
  if(sender.id!==chrome.runtime.id || message?.target!=='vilod-local' || sender.tab && !ownPages.has(sender.url))return;
  let answered=false;const answer=value=>{if(!answered){answered=true;reply(value);}};
  chain=chain.catch(()=>{}).then(async()=>{
    try {
      const control=await chrome.storage.local.get([PENDING_UPDATE,UPDATE_STATUS]);
      if(message.command==='get_self_update_status'){answer({ok:true,status:control[UPDATE_STATUS]||null,pending:control[PENDING_UPDATE]||null});return;}
      if(['probe_self_update','prepare_self_update'].includes(message.command)&&control[PENDING_UPDATE]){answer({ok:true,status:'blocked',message:'Предыдущий перезапуск требует проверки. Повторное обновление не запускается.'});return;}
      if(control[PENDING_UPDATE]&&!UPDATE_READ_COMMANDS.has(message.command))throw Error('Программа ожидает завершения обновления. Новые изменения временно остановлены; сохраненные данные доступны в копии.');
      if(message.command==='probe_self_update'){
        if(sender.url!=='chrome-extension://'+chrome.runtime.id+'/dashboard.html')throw Error('Проверка обновления доступна только рабочей панели');
        answer(await probeSelfUpdate({runtime:chrome.runtime,pending:control[PENDING_UPDATE]}));return;
      }
      let state=(await chrome.storage.local.get('vilodState')).vilodState||emptyState();
      if(state.schema!==1)throw Error('Версия данных не поддерживается. Сохраненные данные не изменены.');
      let result;
      if(message.command==='prepare_self_update'){
        if(sender.url!=='chrome-extension://'+chrome.runtime.id+'/dashboard.html')throw Error('Проверка обновления доступна только рабочей панели');
        if(typeof message.expected_release_hash!=='string'||!/^[a-f0-9]{64}$/.test(message.expected_release_hash))throw Error('Сначала требуется предварительная проверка готового комплекта');
        if(typeof chrome.runtime.getContexts!=='function'){answer({ok:true,status:'deferred',message:'Проверка открытых панелей пока недоступна.'});return;}
        const contexts=await chrome.runtime.getContexts({contextTypes:['TAB','POPUP']});
        if(contexts.filter(c=>c.documentUrl===chrome.runtime.getURL('dashboard.html')).length!==1||contexts.some(c=>c.contextType==='POPUP')){answer({ok:true,status:'deferred',message:'Обновление подождет закрытия второй панели или меню расширения.'});return;}
        const planned=await planSelfUpdate(state,{runtime:chrome.runtime,pending:control[PENDING_UPDATE],view:message.view,expectedReleaseHash:message.expected_release_hash});
        if(planned.pending){
          await chrome.storage.local.set({vilodState:planned.state,[PENDING_UPDATE]:planned.pending});
          answer(planned.result);chrome.runtime.reload();return;
        }
        answer(planned.result);return;
      }
      else if(message.command==='restore_backup'){const restored=await restore(state,message.backup);state=restored.state;result=restored.result;}
      else if(message.command==='get_work_queue')result=await workQueue(state,message);
      else if(message.command==='import_operator_report')result=await importOperatorReport(state,message.report,message.source_file);
      else if(['export_analysis_batch','import_analysis_batch'].includes(message.command))result=await batch(state,message);
      else result=PREPARATION_COMMANDS.has(message.command)||['export_analysis','import_analysis','get_analysis','record_preparation','lookup_analysis_receipts'].includes(message.command)?await exchange(state,message):dispatch(state,message);
      await chrome.storage.local.set({vilodState:state});
      if(message.command==='export_backup')result.backup.self_update={status:control[UPDATE_STATUS]||null,pending:control[PENDING_UPDATE]||null};
      answer(result);
    } catch(error){
      let text=error.message;
      if(error.name==='ReleaseError')text=error.code==='manifest_change'?'Обновление меняет настройки расширения. Для него требуется отдельная проверка.':error.code==='version'||error.code==='version_source'?'Номер версии обновления не распознан.':'Комплект обновления неполный или изменился. Текущая версия продолжает работать.';
      if(answered)await chrome.storage.local.set({[UPDATE_STATUS]:{status:'needs_review',at:new Date().toISOString(),message:'Перезапуск не подтвержден: '+text}});
      else answer({ok:false,error:text,...(error.name==='ReleaseError'?{code:error.code}:{})});
    }
  });
  return true;
});
