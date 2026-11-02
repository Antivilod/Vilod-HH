import {hash,exchange} from './exchange.mjs';
import {importHistory} from './history.mjs';
import {dispatch,emptyState} from './local-store.mjs';
import {employerId} from './company-reader.mjs';
// Imported observations are data, never permission to act or independent proof.
function hhUrl(value,id){
 const u=new URL(value),vacancy=u.pathname.match(/^\/vacancy\/(\d+)\/?$/)?.[1]||(u.pathname==='/applicant/vacancy_response'?u.searchParams.get('vacancyId'):null);
 if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru'))||vacancy!==id)throw Error('ID отчета не совпадает с адресом HH');
 return u.href;
}
export async function importOperatorReport(state,report,sourceFile,{restoreOnly=false}={}){
 if(!report||report.format!=='vilod-hh-operator-preparation'||report.version!==1||JSON.stringify(report).length>400000||!/^operator-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(report.operation_id)||typeof report.vacancy_id!=='string'||!/^\d{1,20}$/.test(report.vacancy_id))throw Error('Неверный отчет оператора');
 hhUrl(report.url,report.vacancy_id);
 const observed=report.observed_at||report.verified_at;
 if(![report.started_at,observed].every(t=>typeof t==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(t)&&Number.isFinite(Date.parse(t)))||Date.parse(observed)<Date.parse(report.started_at))throw Error('Неверное время отчета');
 if(typeof sourceFile!=='string'||!sourceFile.trim()||sourceFile.length>240)throw Error('Неверный источник отчета');
 if(report.letter!==undefined&&(typeof report.letter!=='string'||report.letter.length>10000))throw Error('Неверный текст письма');
 let type,answers=[],historyClaim=null,card=null,materials=[],details='Импортированное наблюдение оператора. Сам файл не подтверждает отправку.',error=null;
 if(report.action==='read_vacancy_only'){
  if(report.status!=='vacancy_read'||report.application_sent!==false||report.vacancy?.vacancy_id!==report.vacancy_id)throw Error('Нет полного отчета о чтении вакансии');
  const v=report.vacancy;hhUrl(v.url,report.vacancy_id);
  card={vacancy_id:v.vacancy_id,url:v.url,title:v.title,company:v.company,description:v.description};
  if(v.company_url){employerId(v.company_url);card.company_url=v.company_url;}
  if(v.evidence!==undefined){
   if(!v.evidence||typeof v.evidence!=='object'||Array.isArray(v.evidence)||Object.keys(v.evidence).length>30)throw Error('Неверные поля условий вакансии');
   card.evidence={};
   for(const [key,value] of Object.entries(v.evidence)){
    if(!/^[a-z][a-z0-9_]{0,60}$/.test(key)||['constructor','prototype','__proto__'].includes(key))throw Error('Неверное имя поля условий');
    if(typeof value?.text!=='string'||value.text.length>10000||value.selector!==undefined&&typeof value.selector!=='string'||value.label!==undefined&&typeof value.label!=='string')throw Error('Неверный источник поля '+key);
    card.evidence[key]={text:value.text,source_url:v.url,...(value.selector?{selector:value.selector}:{}),...(value.label?{label:value.label}:{})};
   }
  }
  materials=report.company_materials||[];
  if(!Array.isArray(materials)||materials.length>3)throw Error('Слишком много материалов компании');
  const checked=emptyState();dispatch(checked,{command:'save_vacancy',vacancy:card});
  for(const material of materials){
   if(typeof material?.url!=='string')throw Error('Неверный источник материала компании');
   if(!card.company_url||employerId(material.url)!==employerId(card.company_url))throw Error('Материал относится к другой компании');
   dispatch(checked,{command:'save_company',company:material});
  }
  type='operator_vacancy_read';
 }else if(report.action==='insert_cover_letter_only'){
  if(report.status!=='letter_inserted_not_submitted'||report.application_sent!==false||report.verified_exact_match!==true||!report.letter?.trim()||report.verified_characters!==report.letter.length)throw Error('Нет полного отчета о подготовке письма без отправки');
  type='operator_letter_prepared';
 }else if(report.action==='fill_questionnaire_only'){
  if(report.technical_test_detected===true)throw Error('Технический тест не должен импортироваться как обычное автоматическое заполнение');
  if(report.status!=='answers_inserted_not_submitted'||report.application_sent!==false||report.verified_exact_match!==true||!Array.isArray(report.answers)||!report.answers.length||report.answers.length>100||report.verified_answers_count!==report.answers.length)throw Error('Нет полного отчета о заполнении ответов');
  const ids=new Set();answers=report.answers.map(a=>{
   if(typeof a.question_id!=='string'||!a.question_id||ids.has(a.question_id)||typeof a.question_text!=='string'||!a.question_text.trim()||a.question_text.length>10000||typeof a.value!=='string'||a.value.length>10000||typeof a.fact_source!=='string'||!a.fact_source.trim()||a.fact_source.length>3000)throw Error('Неполные или повторные ответы в отчете');
   ids.add(a.question_id);return {key:a.question_id,text:a.question_text,value:a.value,fact_source:a.fact_source};
  });type='operator_answers_prepared';
 }else if(report.action==='read_questionnaire_only'){
  if(report.status!=='needs_user'||report.application_sent!==false||typeof report.reason!=='string'||!report.reason.trim()||report.reason.length>3000||report.answers!==undefined&&(!Array.isArray(report.answers)||report.answers.length))throw Error('Отчет о неподдержанной анкете не должен содержать готовые ответы');
  type='operator_questionnaire_needs_user';error=report.reason;
 }else if(report.action==='chat_messages_only'){
  const chat=new URL(report.chat_url);
  if(report.application_sent!==false||!['chat_messages_observed','chat_messages_unknown'].includes(report.status)||typeof report.chat_id!=='string'||!/^\d{1,20}$/.test(report.chat_id)||chat.protocol!=='https:'||chat.username||chat.password||!(chat.hostname==='hh.ru'||chat.hostname.endsWith('.hh.ru'))||chat.pathname!=='/chat/'+report.chat_id)throw Error('Неверная привязка переписки HH');
  if(!Array.isArray(report.messages)||!report.messages.length||report.messages.length>20)throw Error('Нужны точные записи сообщений');
  const ids=new Set();
  for(const message of report.messages){
   if(typeof message?.record_id!=='string'||!message.record_id.trim()||message.record_id.length>100||ids.has(message.record_id)||typeof message.text!=='string'||!message.text.trim()||message.text.length>10000||typeof message.question!=='string'||message.question.length>10000)throw Error('Неверный текст или повтор сообщения');
   ids.add(message.record_id);
   if(report.status==='chat_messages_observed'&&message.ui_marker!=='Отправлено')throw Error('Нет наблюдения отправленного сообщения');
   if(report.status==='chat_messages_unknown'&&message.ui_marker)throw Error('Неизвестный исход не должен выдавать подтверждение');
  }
  type='operator_chat_messages';
  details+=' Чат HH '+report.chat_id+'. Это переписка по существующей вакансии, не новый отклик.\n\n'+report.messages.map(m=>'Вопрос: '+m.question+'\nОтвет: '+m.text+'\nНаблюдение: '+(m.ui_marker||'исход неизвестен')).join('\n\n');
  if(report.status==='chat_messages_unknown')error='Исход переписки неизвестен. Не повторять сообщения автоматически; сначала сверить чат HH.';
 }else if(report.action==='submit_application'){
  if(report.submission_authorized!==undefined&&typeof report.submission_authorized!=='boolean')throw Error('Неверная отметка согласования отправки');
  if(typeof report.authorization_reference!=='string'||!report.authorization_reference.trim()||report.authorization_reference.length>2000)throw Error('Нужна ссылка на согласование или ручное действие пользователя, не разрешение из файла');
  if(report.status==='submission_observed'){
   const c=report.confirmation;
   if(report.application_sent!==true||!c||c.basis!=='hh_ui_after_action'||c.vacancy_id!==report.vacancy_id||!['Отклик отправлен','Вы откликнулись','Резюме отправлено','Резюме доставлено'].includes(c.marker_text)||typeof c.observed_at!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(c.observed_at)||!Number.isFinite(Date.parse(c.observed_at))||Date.parse(c.observed_at)<Date.parse(report.started_at)||Date.parse(c.observed_at)>Date.parse(observed))throw Error('Нет связанного наблюдения результата HH');
   hhUrl(c.url,report.vacancy_id);historyClaim='operator_reported_submission_observed';
   details+=' Оператор сообщил после действия: '+c.marker_text+'.';
  }else if(report.status==='submission_unknown'){
   if(report.application_sent!==null||typeof report.error!=='string'||!report.error.trim()||report.error.length>3000||report.confirmation)throw Error('Неизвестный результат не должен выдавать отправку за успех');
   historyClaim='operator_reported_submission_unknown_do_not_retry';error=report.error;
  }else if(report.status==='submission_not_sent'){
   if(report.application_sent!==false||report.confirmation)throw Error('Неверное сообщение об отсутствии отправки');
  }else throw Error('Неизвестный статус результата отправки');
  type='operator_submission_observation';
 }else throw Error('Неподдержанный вид отчета оператора');
 const checksum=await hash(report),old=state.operatorReports?.[report.operation_id];
 if(old){if(old.checksum!==checksum)throw Error('По этому ID уже сохранен другой отчет оператора');return {ok:true,duplicate:true,send_confirmed:false,...(!restoreOnly&&old.analysis_request_id&&state.analysisRequests?.[old.analysis_request_id]?{analysis_packet:structuredClone(state.analysisRequests[old.analysis_request_id])}:{})};}
 if(Object.keys(state.operatorReports||{}).length>=10000)throw Error('Сохраните архив журнала перед новым импортом');
 const next=structuredClone(state);
 let archivedOnly=false;
 if(card&&!restoreOnly){
  const saved=dispatch(next,{command:'save_vacancy',vacancy:card},Date.parse(observed));
  archivedOnly=saved.stale_observation===true;
  if(!archivedOnly)for(const material of materials)dispatch(next,{command:'save_company',company:material},Date.parse(observed));
  else details+=' Запоздавшее наблюдение сохранено только в исходном отчете; более свежая активная карточка и материалы не заменены.';
 }
 if(historyClaim&&!restoreOnly){
  const linked=next.cards[report.vacancy_id];
  const role=linked?{company:linked.value.company,title:linked.value.title}:{};
  const provenance=linked?' Компания и название связаны по сохраненной карточке при импорте: версия '+linked.version+', наблюдение '+linked.captured_at+'. Это возможный повтор роли, а не независимое подтверждение исторических условий.':'';
  importHistory(next,{format:'vilod-hh-history',version:1,records:[{record_id:'operator:'+report.operation_id,hh_ids:[report.vacancy_id],...role,date:observed,source:sourceFile,url:report.url,status_claim:historyClaim,notes:'Требует сверки в HH. Импорт не является независимым подтверждением; не повторять автоматически.'+provenance}]});
 }
 const analysisPacket=card&&!restoreOnly&&!archivedOnly?(await exchange(next,{command:'export_analysis',vacancy_id:report.vacancy_id},Date.parse(observed))).packet:null;
 next.operatorReports??={};next.operatorReports[report.operation_id]={report:structuredClone(report),checksum,source_file:sourceFile,verification:'imported_operator_observation'};
 if(archivedOnly)next.operatorReports[report.operation_id].archived_only=true;
 if(analysisPacket)next.operatorReports[report.operation_id].analysis_request_id=analysisPacket.request_id;
 next.events.push({type,at:observed,vacancy_id:report.vacancy_id,operation_id:report.operation_id,letter:['insert_cover_letter_only','submit_application'].includes(report.action)?report.letter||null:null,answers,result:report.status,details,error,source_file:sourceFile,verification:'imported_operator_observation',send_confirmed:false});
 Object.assign(state,next);
 return {ok:true,duplicate:false,send_confirmed:false,...(analysisPacket?{analysis_packet:structuredClone(analysisPacket)}:{})};
}
