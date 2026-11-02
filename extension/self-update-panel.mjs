// Dashboard-only draft. No Chrome APIs, network, storage, timers beyond polling.
export function hasUnsavedProfile(profile,getElementByName,keys){
 if(!profile||typeof getElementByName!=='function')return true;
 for(const key of keys||Object.keys(profile).filter(k=>!['id','version'].includes(k))){
  const input=getElementByName(key),saved=profile[key];if(!input)return true;
  if(typeof saved==='boolean'){if(typeof input.checked!=='boolean'||input.checked!==saved)return true;}
  else if(typeof saved==='number'){const value=String(input.value??'');if(!value.trim()||!Number.isFinite(Number(value))||Number(value)!==saved)return true;}
  else if(typeof saved==='string'){if(String(input.value??'')!==saved)return true;}
  else return true;
 }
 return false;
}
export function isEditableElement(element){
 if(!element||element.disabled||element.readOnly)return false;
 if(element.isContentEditable)return true;
 const tag=String(element.tagName||'').toUpperCase();
 return tag==='TEXTAREA'||tag==='SELECT'||tag==='INPUT'&&!['hidden','button','submit','reset','image'].includes(String(element.type||'text').toLowerCase());
}
export function selfUpdateDeferReason({activeTasks=0,folderBusy=false,profile,getElementByName,profileKeys,activeElement}={}){
 if(activeTasks>0)return 'Обновление подождёт завершения текущей задачи.';
 if(folderBusy)return 'Обновление подождёт завершения обмена с папкой.';
 if(hasUnsavedProfile(profile,getElementByName,profileKeys))return 'Обновление отложено: в профиле есть несохранённые изменения.';
 if(isEditableElement(activeElement))return 'Обновление подождёт, пока вы закончите ввод.';
 return null;
}
export function normalizeSearchView(view){
 if(!view||Array.isArray(view)||typeof view!=='object'||typeof view.searchText!=='string'||view.searchText.length>300||![1,3,7].includes(view.searchDays)||typeof view.searchRemote!=='boolean')throw Error('Неверные параметры поиска');
 return {searchText:view.searchText,searchDays:view.searchDays,searchRemote:view.searchRemote};
}
function searchElements(get){const fields=['searchText','searchDays','searchRemote'].map(get);if(fields.some(x=>!x))throw Error('Поля поиска не найдены');return fields;}
export function readSearchView(getElementById){
 const [text,days,remote]=searchElements(getElementById);
 return normalizeSearchView({searchText:String(text.value??'').slice(0,300),searchDays:Number(days.value),searchRemote:remote.checked});
}
export function restoreSearchView(view,getElementById){
 // Validate every primitive and locate every target BEFORE changing the DOM.
 let clean,fields;try{clean=normalizeSearchView(view);fields=searchElements(getElementById);}catch{return false;}
 const [text,days,remote]=fields;text.value=clean.searchText;days.value=String(clean.searchDays);remote.checked=clean.searchRemote;return true;
}
export function initializeSelfUpdatePanel({call,isIdle=()=>true,getDeferReason,getView=()=>undefined,onPreparing=()=>{},onSettled=()=>{},onPrepared=()=>{},setStatus,notice=()=>{},initialState='running',interval=15000,schedule=setInterval,clear=clearInterval}={}){
 if(typeof call!=='function')throw Error('Нужна функция обращения к программе');
 if(!['running','stopped','blocked','prepared'].includes(initialState))throw Error('Неверное начальное состояние обновления');
 const show=setStatus||notice;let mode=initialState,busy=false,generation=0,timer,lastText;
 function status(text){if(text!==lastText){lastText=text;show(text);}}
 function finish(next,text){mode=next;generation++;if(timer!==undefined){clear(timer);timer=undefined;}status(text);}
 function idleReason(){return getDeferReason?.()||(!isIdle()?'Обновление подождёт завершения текущей работы.':null);}
 async function check(){
  if(mode!=='running')return {status:mode};if(busy)return {status:'busy'};
  const token=generation;busy=true;let preparing=false,prepareSent=false,committed=false,settleKnown=false;
  const alive=()=>mode==='running'&&generation===token;
  try{
   let reason=idleReason();if(reason){status(reason);return {status:'deferred'};}
   const probe=await call({command:'probe_self_update'});
   if(!alive())return {status:'ignored'};
   if(!probe?.ok)throw Error(probe?.error||'Не удалось проверить обновление');
   if(probe.status==='current'){status('Готовые обновления проверяются автоматически, пока панель открыта.');return probe;}
   if(probe.status==='blocked'){finish('blocked',probe.message||'Обновление требует проверки. Автоматический повтор остановлен.');return probe;}
   if(probe.status==='stopped'){finish('stopped','Проверка обновлений остановлена.');return probe;}
   if(probe.status==='deferred'){status(probe.message||'Обновление подождёт завершения текущей работы.');return probe;}
   if(probe.status!=='verified'||! /^[a-f0-9]{64}$/.test(probe.release_hash||''))throw Error('Не подтверждён готовый комплект обновления');
   reason=idleReason();if(reason){status(reason);return {status:'deferred'};}
   const raw=getView(),view=raw===undefined?undefined:normalizeSearchView(raw);
   preparing=true;const hook=onPreparing();if(hook?.then)throw Error('onPreparing должен завершаться синхронно');
   if(!alive()){settleKnown=true;return {status:'ignored'};}
   prepareSent=true;
   const result=await call({command:'prepare_self_update',expected_release_hash:probe.release_hash,...(view?{view}:{})});
   committed=result?.ok===true&&result.status==='prepared';settleKnown=result?.ok===false||result?.ok===true&&['current','deferred','blocked','stopped'].includes(result.status);
   if(!alive())return {status:'ignored'};
   if(!result?.ok)throw Error(result?.error||'Не удалось проверить обновление');
   if(result.status==='prepared'){
    finish('prepared','Устанавливается готовое обновление. Панель откроется снова.');onPrepared();
   }else if(result.status==='blocked')finish('blocked',result.message||'Обновление требует проверки. Автоматический повтор остановлен.');
   else if(result.status==='stopped')finish('stopped','Проверка обновлений остановлена.');
   else if(result.status==='deferred')status(result.message||'Обновление подождёт завершения текущей работы.');
   else if(result.status==='current')status('Готовые обновления проверяются автоматически, пока панель открыта.');
   else throw Error('Неизвестный результат проверки обновления');
   return result;
  }catch(error){
   if(!prepareSent)settleKnown=true;
   if(!alive())return {status:'ignored'};
   if(prepareSent&&!settleKnown){finish('blocked','Результат подготовки обновления не подтверждён. Автоматический повтор остановлен.');return {status:'uncertain'};}
   status('Проверка обновления отложена: '+error.message);return {status:'error'};
  }finally{
   // Cleanup is a separate callback; root must not resume folder work when
   // stopped=true. No status/onPrepared callback is issued by a late response.
   try{if(preparing&&!committed&&settleKnown)onSettled({stopped:mode==='stopped',committed:false});}finally{busy=false;}
  }
 }
 if(mode==='running'){timer=schedule(check,interval);timer?.unref?.();}
 return {check,stop(){if(mode==='stopped')return;finish('stopped','Проверка обновлений остановлена.');},getState:()=>({mode,busy})};
}
