import {local} from './transport.mjs';
import {searchUrl} from './search-plan.mjs';
import {readCompany} from './company-reader.mjs';
import {initializeFolderPanel,deliverToFolder,stopFolderExchange,saveCurrentStateSnapshot,folderExchangeBusy,suspendFolderExchange,resumeFolderExchangeAfterUpdateCheck,refreshFolderControls} from './folder-panel.mjs';
import {initializeSelfUpdatePanel,selfUpdateDeferReason,isEditableElement,readSearchView,restoreSearchView} from './self-update-panel.mjs';
import {VERSION} from './version.mjs';
const $=id=>document.getElementById(id);
$('buildVersion').textContent='Версия '+VERSION+' · Поиск работы с помощником';
const labels={name:'Имя',city:'Город',citizenship:'Гражданство',direction:'Направления поиска',minimum_net_rub:'Минимум на руки, рублей',remote_from_russia:'Только удалённая работа из России',commercial_qa_years:'Коммерческий QA-стаж, лет',hours_per_week:'Часов в неделю',availability:'Готовность выйти',experience:'Подтверждённый опыт',skills:'Подтверждённые навыки',education:'Образование',english:'Английский',email:'Email',github:'GitHub',resume:'Резюме',exclusions:'Исключения'};
let profile,selectedId,companyReadGeneration=0,queueOffset=0,workPage=[],refreshGeneration=0,activeTasks=0;
let selfUpdater;
let stoppedByUser=false,updateLockedControls=[];
let lastEditingAt=0,fileDialogOpen=false;
for(const event of ['input','keydown','pointerdown','focusin'])document.addEventListener?.(event,()=>{lastEditingAt=Date.now();},true);
for(const input of document.querySelectorAll('input[type="file"]')){
 input.addEventListener('click',()=>{fileDialogOpen=true;});
 for(const event of ['change','cancel'])input.addEventListener(event,()=>{fileDialogOpen=false;lastEditingAt=Date.now();});
}
let searchTouched=$('searchText').value!==($('searchText').defaultValue??'Junior QA')||$('searchDays').value!==([...($('searchDays').options||[])].find(option=>option.defaultSelected)?.value||'7')||$('searchRemote').checked!==($('searchRemote').defaultChecked??true);
for(const id of ['searchText','searchDays','searchRemote'])for(const event of ['input','change'])$(id).addEventListener(event,()=>{searchTouched=true;});
function syncSearchProfile({preserveSearch=false}={}){
 if(!preserveSearch){$('searchRemote').checked=profile.remote_from_russia;$('searchText').value=profile.direction.split(';')[0].trim().slice(0,300);}
 $('profileSummary').textContent=profile.name+' · '+profile.direction+' · версия '+profile.version;
}
async function showAnalysis(){
 const id=selectedId;
 const [{assessment},{analysis},{questionnaire},{materials,company_url}]=await Promise.all([call({command:'triage',vacancy_id:id}),call({command:'get_analysis',vacancy_id:id}),call({command:'get_questionnaire',vacancy_id:id}),call({command:'get_company_materials',vacancy_id:id})]);
 if(id!==selectedId)return;
 $('readCompany').hidden=!company_url;
 $('triage').textContent=(assessment.decision==='not_suitable'?'Явное несоответствие. ':'Нужен анализ. ')+[...assessment.reasons.map(x=>x.text),...assessment.exclusions.map(x=>x.text),...assessment.questions].join(' · ');
 $('analysisStatus').textContent=!analysis?'Решение пока не импортировано.':(analysis.stale?'Устаревший ответ. Нужен повторный анализ. ':'')+({suitable:'Подходит',not_suitable:'Не подходит',needs_review:'Нужно уточнение'}[analysis.response.decision])+'. Отправка отключена. '+analysis.response.reasons.join(' ');
 $('letter').textContent=analysis?.response.letter||'';
 $('companyMaterials').replaceChildren();
 if(!materials.length){
  const hint=document.createElement('p');hint.textContent=company_url?'Описание работодателя еще не сохранено. В пакет попадет только текст вакансии.':'В карточке не распознана ссылка на работодателя. Отдельных материалов компании нет.';$('companyMaterials').append(hint);
 } else for(const material of materials){
  const source=document.createElement('a');source.href=material.url;source.target='_blank';source.rel='noopener noreferrer';source.textContent='Страница работодателя HH';
  const stamp=document.createElement('p');stamp.textContent='Сохранено '+new Date(material.captured_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК. Это текст работодателя; достоверность отдельно не подтверждена.';
  const content=document.createElement('pre');content.textContent=material.content;$('companyMaterials').append(source,stamp,content);
 }
 $('answers').replaceChildren();
 const {visual}=await call({command:'get_visual_form',vacancy_id:id});if(id!==selectedId)return;
 $('visualPreview').replaceChildren();
 if(visual){const caption=document.createElement('p');caption.textContent='Снимок формы для анализа'+(visual.partial?' (видна только часть формы)':'')+'. Распознавание еще не подтверждено.';const image=document.createElement('img');image.src=visual.data_url;image.alt='Сохраненная видимая область анкеты';image.style.maxWidth='100%';$('visualPreview').append(caption,image);}
 if(!questionnaire){$('answers').textContent='Анкета пока не сохранена. Отсутствие анкеты в базе не означает, что у вакансии ее нет.';return;}
 const returned=analysis?.questionnaire?.answers||[];
 for(const q of questionnaire.questions){
  const row=document.createElement('section');row.className='card';
  const title=document.createElement('h3');title.textContent=q.text+(q.required?' (обязательный вопрос)':'');row.append(title);
  const a=returned.find(x=>x.key===q.key),text=document.createElement('p');
  text.textContent=analysis?.stale?'Прежний ответ устарел. Нужен повторный анализ.':!a?'Ответ еще не подготовлен':a.status==='needs_user'?'Нужно ваше решение: '+a.reason:a.value;
  row.append(text);
  if(a?.fact_source){const source=document.createElement('p');source.textContent='Источник: '+a.fact_source;row.append(source);}
  $('answers').append(row);
 }
}
function notice(text){$('notice').textContent=text;}
async function call(message){const r=await local(message);if(!r.ok)throw Error(r.error);return r;}
function guard(fn){return async()=>{activeTasks++;try{await fn();}catch(e){notice('Ошибка: '+e.message);}finally{activeTasks--;}};}
async function openCard(id){
 selectedId=id;const {card}=await call({command:'get_card',vacancy_id:id});if(selectedId!==id)return;
 $('detail').hidden=false;$('cardTitle').textContent=card.value.title;$('cardCompany').textContent=card.value.company+' · версия '+card.version;$('cardLink').href=card.value.url;$('description').textContent=card.value.description;
 await showAnalysis();if(selectedId===id)$('detail').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderWorkItems(){
 $('cards').replaceChildren();
 const filter=$('workFilter').value||'all';
 const shown=workPage.filter(c=>filter==='all'||filter===c.status||filter==='excluded'&&['rejected','ruled_out'].includes(c.status));
 if(!shown.length)$('cards').textContent=workPage.length?'На этой странице нет вакансий с выбранным статусом.':'Пока нет карточек. Сохраните полную вакансию кнопкой расширения.';
 for(const c of shown){
  const row=document.createElement('article');row.className='work-item';
  const badge=document.createElement('span');badge.className='work-status work-status-'+c.status;badge.textContent=c.label;
  const button=document.createElement('button');button.textContent=c.company+' - '+c.title+' (HH '+c.id+')';button.addEventListener('click',guard(()=>openCard(c.id)));
  row.append(badge,button);$('cards').append(row);
 }
}
async function refresh(){
 const run=++refreshGeneration;
 const [data,work]=await Promise.all([call({command:'summary'}),call({command:'get_work_queue',offset:queueOffset,limit:100})]);
 if(run!==refreshGeneration)return;
 workPage=work.items;renderWorkItems();
 const actions=(work.counts.needs_analysis||0)+(work.counts.needs_reanalysis||0);
 $('workSummary').textContent='На странице: '+work.items.length+' из '+work.total_cards+'. Нужен анализ: '+actions+'. Уточнить: '+(work.counts.needs_clarification||0)+'. Подходят к проверке: '+(work.counts.ready_for_review||0)+'. Отказы: '+((work.counts.rejected||0)+(work.counts.ruled_out||0))+'. Отправка отключена.';
 $('workPrevious').disabled=queueOffset===0;$('workNext').disabled=!work.has_more;
 $('historyInfo').textContent='Записей истории: '+data.history_records+(data.legacy_seed_imported?'. Прежние журналы подключены автоматически.':'.')+' Исторические заявления требуют сверки с HH; подтвержденные отклики из них не создавались.';
 const counts={};for(const j of data.jobs)counts[j.status]=(counts[j.status]||0)+1;
 $('jobs').textContent='Ожидает: '+(counts.pending||0)+'. Читается: '+(counts.reading||0)+'. Сохранено: '+(counts.saved||0)+'. Ошибок: '+(counts.error||0)+'.';
 $('jobErrors').replaceChildren();
 for(const j of data.jobs.filter(j=>j.status==='error').slice(0,50)){const row=document.createElement('section');row.className='card';const description=document.createElement('p');description.textContent='HH '+j.vacancy_id+': '+j.error;const retry=document.createElement('button');retry.textContent='Вернуть в очередь';retry.addEventListener('click',guard(async()=>{const result=await call({command:'retry_read_job',id:j.id});await refresh();notice(result.already_saved?'Карточка уже сохранена, повторное чтение не требуется.':'Задание возвращено. Для чтения отдельно нажмите запуск очереди.');}));row.append(description,retry);$('jobErrors').append(row);}
 const {operations}=await call({command:'get_preparation_operations'});if(run!==refreshGeneration)return;
 const {events}=await call({command:'get_events'});if(run!==refreshGeneration)return;$('events').replaceChildren();
 for(const op of operations.filter(op=>op.status==='needs_review'||op.status==='in_progress')){
  const row=document.createElement('section');row.className='card';const text=document.createElement('p');
  text.textContent='HH '+op.vacancy_id+': '+(op.status==='in_progress'?'Подготовка начата, результат еще не записан.':op.error||'Результат подготовки требует проверки.')+' Отклик этой операцией не отправлялся.';row.append(text);
  if(op.status==='needs_review'){
   const reviewed=document.createElement('button');reviewed.textContent='Проверил поля - разрешить повтор подготовки';
   reviewed.addEventListener('click',guard(async()=>{await call({command:'review_preparation',operation_id:op.id,fields_reviewed:true});await refresh();notice('Проверка отмечена. Повтор подготовки доступен отдельно, отправка отключена.');}));row.append(reviewed);
  }
  $('events').append(row);
 }
 if(!events.length)$('events').textContent='Событий пока нет.';
 for(const e of events){const line=document.createElement('details'),heading=document.createElement('summary');const names={letter_inserted:'Письмо вставлено, не отправлено',answers_inserted:'Ответы вставлены, не отправлены',profile_changed:'Профиль изменен',backup_restored:'Восстановлена копия',preparation_started:'Начата подготовка формы',preparation_failed:'Ошибка подготовки, проверьте поля',preparation_unresolved:'Подготовка требует проверки',preparation_reviewed:'Поля проверены пользователем',company_saved:'Сохранены материалы компании',existing_response_observed:'Найден существующий отклик HH',operator_vacancy_read:'Оператор: карточка и материалы сохранены',operator_letter_prepared:'Оператор: письмо заполнено, отчет импортирован',operator_answers_prepared:'Оператор: ответы заполнены, отчет импортирован',operator_questionnaire_needs_user:'Оператор: анкета требует решения пользователя',operator_submission_observation:'Оператор: сообщение о результате отклика',operator_chat_messages:'Оператор: переписка HH, отчет импортирован'};heading.textContent=new Date(e.at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК · '+(names[e.type]||e.type)+(e.vacancy_id?' · HH '+e.vacancy_id:'')+(e.requires_review?' · нужна проверка':'');line.append(heading);const text=document.createElement('pre');text.textContent=[e.error,e.details,e.letter||e.answers?.map(a=>a.key+': '+(a.value||a.reason)).join('\n')||'Версия профиля: '+(e.profile_version||'см. копию')].filter(Boolean).join('\n\n');line.append(text);$('events').append(line);}
}
$('workFilter').addEventListener('change',renderWorkItems);
$('workPrevious').addEventListener('click',guard(async()=>{queueOffset=Math.max(0,queueOffset-100);await refresh();}));
$('workNext').addEventListener('click',guard(async()=>{queueOffset+=100;await refresh();}));
async function loadProfile(){const beforeView=JSON.stringify(readSearchView($));({profile}=await call({command:'get_profile'}));if(beforeView!==JSON.stringify(readSearchView($)))searchTouched=true;syncSearchProfile({preserveSearch:searchTouched||isEditableElement(document.activeElement)});for(const [key,label] of Object.entries(labels)){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement(['experience','skills','education','exclusions','direction'].includes(key)?'textarea':'input');input.name=key;if(typeof profile[key]==='boolean'){input.type='checkbox';input.checked=profile[key];}else{if(typeof profile[key]==='number'){input.type='number';input.min='0';input.step='any';}input.value=profile[key]??'';}wrap.append(input);$('profile').append(wrap);}}
$('save').addEventListener('click',guard(async()=>{const p={...profile};for(const key of Object.keys(labels)){const input=$('profile').elements.namedItem(key);p[key]=typeof profile[key]==='boolean'?input.checked:typeof profile[key]==='number'?Number(input.value):input.value;}({profile}=await call({command:'save_profile',profile:p}));syncSearchProfile();await refresh();if(selectedId)await showAnalysis();let sharing='';try{const snapshot=await saveCurrentStateSnapshot({resume:true});sharing=snapshot?' Текущая копия передана помощнику.':' Для передачи подключите общую папку.';}catch(error){sharing=' Профиль сохранен, но текущая копия не передана: '+error.message;}notice('Профиль сохранён. Версия '+profile.version+'.'+sharing);}));
$('refresh').addEventListener('click',guard(async()=>{await refresh();if(selectedId)await showAnalysis();}));
$('searchForm').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{const url=searchUrl($('searchText').value,{days:Number($('searchDays').value),remote:$('searchRemote').checked});await chrome.tabs.create({url});notice('Открыт поиск по дате с выбранными периодом и форматом. Проверьте фильтры HH, затем соберите ссылки кнопкой расширения. Работа из РФ и оплата проверяются в полной карточке.');})();});
$('stop').addEventListener('click',guard(async()=>{stoppedByUser=true;selfUpdater?.stop();companyReadGeneration++;const stopped=stopFolderExchange();for(const [control] of updateLockedControls)control.disabled=true;await call({command:'pause_read_jobs'});await stopped;notice('Остановлены очередь, чтение компании и обмен с папкой. Уже сохраненные данные остаются.');}));
$('readCompany').addEventListener('click',guard(async()=>{
 const id=selectedId;if(!id)throw Error('Выберите вакансию');
 if($('readCompany').disabled)return;
 const run=++companyReadGeneration;$('readCompany').disabled=true;
 try{
  const granted=await chrome.permissions.request({origins:['https://hh.ru/*','https://*.hh.ru/*']});
  if(!granted)throw Error('Доступ к HH не предоставлен');
  if(run!==companyReadGeneration)throw Error('Остановлено пользователем');
  const {company_url}=await call({command:'get_company_materials',vacancy_id:id});
  if(!company_url)throw Error('В карточке нет ссылки на работодателя');
  notice('Читаю описание работодателя на HH. Отклики не отправляются.');
  const material=await readCompany(company_url,{isStopped:()=>run!==companyReadGeneration});
  if(run!==companyReadGeneration)throw Error('Остановлено пользователем');
  if(!material.company)throw Error(material.reason);
  const result=await call({command:'save_company',company:material.company});
  await refresh();if(selectedId===id)await showAnalysis();
  notice(result.new_snapshot?'Материалы компании сохранены. Для учета новых сведений выгрузите вакансию на повторный анализ.':'Описание не изменилось. Повторный анализ из-за чтения компании не требуется.');
 }finally{$('readCompany').disabled=false;}
}));
$('reader').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('runner.html')}));
$('backup').addEventListener('click',guard(async()=>{const {backup}=await call({command:'export_backup'});const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Vilod-HH-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notice('Резервная копия подготовлена к сохранению. Проверьте загрузки Chrome.');}));
async function downloadPacket(packet){const folder=await deliverToFolder(packet);if(folder)return {folder:true,...folder};const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=(packet.request_id||packet.batch_id)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('exportAnalysis').addEventListener('click',guard(async()=>{if(!selectedId)throw Error('Выберите вакансию');const {packet}=await call({command:'export_analysis',vacancy_id:selectedId});const delivery=await downloadPacket(packet);notice(delivery?.folder?'Пакет сохранен в папке «На анализ». Помощник запускается отдельно.':'Пакет подготовлен к загрузке. Передайте его основному помощнику. Проверка общей истории еще требуется.');}));
$('importAnalysis').addEventListener('change',guard(async()=>{const file=$('importAnalysis').files[0];if(!file)return;if(file.size>1000000)throw Error('Файл больше 1 МБ');const response=JSON.parse((await file.text()).replace(/^\uFEFF/,''));if(response.hh_vacancy_id!==selectedId)throw Error('Выберите соответствующую вакансию перед импортом');const result=await call({command:'import_analysis',response});await refresh();await showAnalysis();notice(result.duplicate?'Этот ответ уже сохранён.':'Ответ сохранён. Отклик не отправлен.');$('importAnalysis').value='';}));
$('importHistory').addEventListener('change',guard(async()=>{const file=$('importHistory').files[0];if(!file)return;if(file.size>15000000)throw Error('История больше 15 МБ');const history=JSON.parse((await file.text()).replace(/^\uFEFF/,''));const result=await call({command:'import_history',history});$('historyInfo').textContent='Записей: '+result.total+'. Новых: '+result.added+'. Старые утверждения об откликах требуют сверки.';if(selectedId)await showAnalysis();$('importHistory').value='';notice('История импортирована. Подтверждённые отправки из неё не создавались.');}));
$('restoreBackup').addEventListener('change',guard(async()=>{const file=$('restoreBackup').files[0];if(!file)return;if(file.size>15000000)throw Error('Копия больше 15 МБ');const backup=JSON.parse((await file.text()).replace(/^\uFEFF/,''));const result=await call({command:'restore_backup',backup});$('profile').replaceChildren();selectedId=undefined;queueOffset=0;$('detail').hidden=true;await refresh();await loadProfile();notice('Восстановлено карточек: '+result.cards+', записей истории: '+result.history+'. '+result.message);$('restoreBackup').value='';}));
$('exportBatch').addEventListener('click',guard(async()=>{const result=await call({command:'export_analysis_batch'});if(!result.bundle){notice('Нет карточек без актуального ответа для выгрузки.');return;}const delivery=await downloadPacket(result.bundle);notice('Карточек: '+result.bundle.packets.length+(delivery?.folder?'. Пакет сохранен в «На анализ».':'. Общий файл подготовлен к загрузке. Передайте его помощнику.'));}));
$('importBatch').addEventListener('change',guard(async()=>{const file=$('importBatch').files[0];if(!file)return;if(file.size>1000000)throw Error('Общий ответ больше 1 МБ');const bundle=JSON.parse((await file.text()).replace(/^\uFEFF/,''));const result=await call({command:'import_analysis_batch',bundle});await refresh();if(selectedId)await showAnalysis();notice('Принято ответов: '+result.imported+'. Уже были сохранены: '+result.duplicates+'. Отклики не отправлялись.');$('importBatch').value='';}));
await guard(async()=>{await refresh();await loadProfile();})();
const updateNotice=text=>{if($('selfUpdateStatus'))$('selfUpdateStatus').textContent=text;if(/не подтвержд|требует проверки/.test(text))notice(text);};
let updateBlocked=false;
try{
 const initialView=JSON.stringify(readSearchView($));
 const {status,pending}=await call({command:'get_self_update_status'});
 if(status?.status==='applied'&&status.state_preserved&&status.view&&!searchTouched&&initialView===JSON.stringify(readSearchView($))&&!isEditableElement(document.activeElement))restoreSearchView(status.view,$);
 if(status?.message)updateNotice(status.message);
 if(pending){updateBlocked=true;updateNotice('Предыдущий перезапуск требует проверки. Новые изменения не запускаются; сохраните копию данных.');}
}catch(error){updateBlocked=true;updateNotice('Проверка обновления пока недоступна: '+error.message);}
if(!updateBlocked)await initializeFolderPanel({call,notice,refresh,defaultAutomatic:true,initiallyStopped:()=>stoppedByUser,refreshSelected:async()=>{if(selectedId)await showAnalysis();}});
else {suspendFolderExchange();lockUpdateControls();}
function unlockUpdateControls(){for(const [control,disabled] of updateLockedControls)control.disabled=disabled;updateLockedControls=[];}
function lockUpdateControls(){updateLockedControls=[...document.querySelectorAll('input,textarea,select,button')].filter(control=>!['stop','backup'].includes(control.id)).map(control=>[control,control.disabled]);for(const [control] of updateLockedControls)control.disabled=true;}
selfUpdater=initializeSelfUpdatePanel({call,setStatus:updateNotice,initialState:updateBlocked?'blocked':stoppedByUser?'stopped':'running',getView:()=>readSearchView($),getDeferReason:()=>fileDialogOpen?'Обновление подождет завершения выбора файла.':selfUpdateDeferReason({activeTasks,folderBusy:folderExchangeBusy(),profile,getElementByName:key=>$('profile').elements.namedItem(key),profileKeys:Object.keys(labels),activeElement:Date.now()-lastEditingAt<2000?document.activeElement:null}),onPreparing:()=>{
 suspendFolderExchange();
 lockUpdateControls();
},onSettled:({stopped})=>{
 if(selfUpdater?.getState().mode==='blocked')return;
 unlockUpdateControls();
 refreshFolderControls({releaseUpdateLock:true});
 if(!stopped&&selfUpdater?.getState().mode==='running')resumeFolderExchangeAfterUpdateCheck().catch(error=>updateNotice('Обмен пока не возобновлен: '+error.message));
},onPrepared:()=>{companyReadGeneration++;}});








