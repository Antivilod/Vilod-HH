import {initialProfile} from './profile.mjs';
import {historyMatches} from './history.mjs';
import {triage} from './triage.mjs';
import {validateAnswers} from './answers.mjs';
import {companyMaterials} from './company-reader.mjs';
import {preparation,PREPARATION_COMMANDS} from './preparation.mjs';
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export async function hash(v){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function payload(s,id){
 const card=s.cards[id];if(!card)throw Error('Сначала сохраните вакансию');
 return {profile:{...initialProfile(),...s.profile},vacancy:card.value,vacancy_version:card.version,company_materials:companyMaterials(s,card.value.company_url),hh_questionnaire:s.questions[id]||null,visual_form:s.visualForms?.[id]||null,history_matches:historyMatches(s,id),history_check_complete:false,...(s.existingResponses?.[id]?{existing_response_observation:s.existingResponses[id]}:{})};
}
export const currentContextHash=(state,id)=>hash(payload(state,String(id)));
async function archivedReceipt(archive,item){
 const old=archive.replies?.[item.request_id],original=archive.requests?.[item.request_id],response=old?.response;
 if(old?.checksum!==item.checksum||original?.request_id!==item.request_id||original.request_type!=='analyze_vacancy'||!original.payload||!original.expected_response||response?.request_type!=='analysis_result')return false;
 if(await hash(response)!==item.checksum||await hash(original.payload)!==original.context_hash||response.context_hash!==original.context_hash||response.vacancy_hash!==await hash(original.payload.vacancy))return false;
 for(const key of ['protocol_version','request_id','parent_request_id','queue_record_id','hh_vacancy_id','hh_url','data_version','profile_id','profile_version','vacancy_hash','context_hash','request_type','status','next_responsible'])if(response[key]!==original.expected_response[key])return false;
 if(!['suitable','not_suitable','needs_review'].includes(response.decision)||!Array.isArray(response.reasons)||!response.reasons.length||typeof response.letter!=='string'||response.send_authorized===true)return false;
 return true;
}
export async function exchange(s,m,now=Date.now()){
 if(PREPARATION_COMMANDS.has(m.command))return preparation(s,m,{now,hashContext:currentContextHash,hashValue:hash});
 if(m.command==='lookup_analysis_receipts'){
  if(!Array.isArray(m.items)||m.items.length>20||m.items.some(i=>!/^exchange-[a-f0-9-]{36}$/.test(i.request_id)||!/^([a-f0-9]{64})$/.test(i.checksum)))throw Error('Неверный запрос квитанций');
  let accepted=0,archived=0;
  for(const item of m.items){
   if(s.analysisReplies?.[item.request_id]?.checksum===item.checksum){accepted++;continue;}
   let archive=s.restoredExchangeArchive,depth=0;
   while(archive){
    if(++depth>50)throw Error('Слишком глубокий архив обмена');
    if(await archivedReceipt(archive,item)){accepted++;archived++;break;}
    archive=archive.previous;
   }
  }
  // Archived bytes are receipts only. They never recreate an active analysis,
  // remove staleness, authorize preparation, or register a missing request.
  return {ok:true,accepted,archived};
 }
 if(m.command==='record_preparation'){
  if(Object.values(s.restoredPreparationLocks||{}).some(op=>op.vacancy_id===String(m.vacancy_id)&&op.status==='needs_review'))throw Error('После восстановления сначала проверьте незавершенную подготовку в журнале');
  if(s.existingResponses?.[String(m.vacancy_id)])throw Error('На HH уже есть отклик. Повторная подготовка заблокирована.');
  if(historyMatches(s,String(m.vacancy_id)).some(record=>record.hh_ids.includes(String(m.vacancy_id))))throw Error('В истории есть прежний отклик или неизвестный исход по этому HH ID. Сначала проверьте историю.');
  const r=s.analysisReplies?.[m.request_id];
  if(!r||r.response.hh_vacancy_id!==String(m.vacancy_id)||r.response.decision!=='suitable')throw Error('Нет подходящего исходного анализа для записи');
  if(!['letter_inserted','answers_inserted'].includes(m.action)||m.result?.submitted!==false)throw Error('Неверный результат подготовки');
  if(m.action==='letter_inserted'&&(m.result.inserted!==true||m.result.vacancy_id!==String(m.vacancy_id)||m.result.characters!==r.response.letter.length))throw Error('Нет полного подтверждения вставки письма');
  const prepared=(r.questionnaire?.answers||[]).filter(a=>a.status==='prepared');
  if(m.action==='answers_inserted'&&(!Number.isInteger(m.result.filled)||m.result.filled<1||m.result.filled!==prepared.length))throw Error('Количество вставленных ответов не совпадает');
  const stale=await hash(payload(s,String(m.vacancy_id)))!==r.response.context_hash;
  s.events.push({type:m.action,at:new Date(now).toISOString(),vacancy_id:String(m.vacancy_id),request_id:m.request_id,profile_version:r.response.profile_version,vacancy_hash:r.response.vacancy_hash,letter:m.action==='letter_inserted'?r.response.letter:null,answers:m.action==='answers_inserted'?prepared:[],result:'filled_not_submitted',stale_at_recording:stale,send_confirmed:false});
  return {ok:true,stale_at_recording:stale};
 }
 if(m.command==='export_analysis'){
  const id=String(m.vacancy_id),data=payload(s,id),checksum=await hash(data),vacancyHash=await hash(data.vacancy);
  const requestId='exchange-'+checksum.slice(0,8)+'-'+checksum.slice(8,12)+'-'+checksum.slice(12,16)+'-'+checksum.slice(16,20)+'-'+checksum.slice(20,32);
  s.analysisRequests??={};
  if(s.analysisRequests[requestId])return {ok:true,packet:s.analysisRequests[requestId],created:false};
  const packet={protocol_version:'5.0',request_id:requestId,parent_request_id:null,queue_record_id:null,hh_vacancy_id:id,hh_url:data.vacancy.url,data_version:1,created_at:new Date(now).toISOString(),created_by:'Vilod HH',request_type:'analyze_vacancy',status:'awaiting_analysis',next_responsible:'main_assistant',profile_id:data.profile.id,profile_version:data.profile.version,vacancy_hash:vacancyHash,context_hash:checksum,payload:data,expected_response:{protocol_version:'5.0',request_id:requestId,parent_request_id:requestId,queue_record_id:null,hh_vacancy_id:id,hh_url:data.vacancy.url,data_version:1,profile_id:data.profile.id,profile_version:data.profile.version,vacancy_hash:vacancyHash,context_hash:checksum,request_type:'analysis_result',status:'completed',next_responsible:'Vilod HH',decision:'suitable | not_suitable | needs_review',reasons:['Причины с опорой на материалы'],letter:'Персональное письмо или пустая строка'}};
  // Diagnostic count at export time; unrelated history is not decision context.
  packet.metadata={history_records_imported:Object.keys(s.history||{}).length};
  packet.expected_response.answers=[];
  packet.answer_instructions='answers: [{key, status: prepared, value, fact_source}] либо [{key, status: needs_user, reason}]. Только точные ключи и варианты исходной анкеты. Согласия - needs_user. При отсутствии анкеты answers=[].';
  packet.preliminary_assessment=triage(s,id);s.analysisRequests[requestId]=packet;return {ok:true,packet,created:true};
 }
 if(m.command==='import_analysis'){
  const r=m.response;if(!r||typeof r!=='object'||JSON.stringify(r).length>1000000)throw Error('Неверный размер или формат ответа');
  if(['kind','state','next_actor'].some(k=>Object.hasOwn(r,k)))throw Error('Уберите переходные поля kind/state/next_actor: используются request_type/status/next_responsible');
  if(typeof r.request_id!=='string'||!/^exchange-[a-f0-9-]{36}$/.test(r.request_id))throw Error('Неверный request_id');
  const original=s.analysisRequests?.[r.request_id];if(!original)throw Error('Исходное задание не найдено в расширении');
  const expected=original.expected_response;
  for(const key of ['protocol_version','request_id','parent_request_id','queue_record_id','hh_vacancy_id','hh_url','data_version','profile_id','profile_version','vacancy_hash','context_hash','request_type','status','next_responsible'])if(r[key]!==expected[key])throw Error('Не совпадает поле '+key);
  if(await hash(payload(s,r.hh_vacancy_id))!==original.context_hash)throw Error('Данные изменились. Выгрузите новое задание на анализ');
  if(!['suitable','not_suitable','needs_review'].includes(r.decision)||!Array.isArray(r.reasons)||!r.reasons.length||r.reasons.length>100||r.reasons.some(x=>typeof x!=='string'||!x.trim()||x.length>10000)||typeof r.letter!=='string'||r.letter.length>10000)throw Error('Неполное решение или письмо');
  if(/[\u2013\u2014]/.test(r.letter))throw Error('В письме замените длинное тире коротким дефисом');
  if(r.decision==='suitable'&&!r.letter.trim())throw Error('Для подходящей вакансии требуется письмо');
  if(r.send_authorized===true)throw Error('Анализ не дает разрешения на отправку');
  const questionnaire=validateAnswers(original.payload.hh_questionnaire,r.answers);
  s.analysisReplies??={};const checksum=await hash(r),old=s.analysisReplies[r.request_id];
  if(old&&old.checksum!==checksum)throw Error('Конфликт: для задания уже сохранен другой ответ');
  if(!old)s.analysisReplies[r.request_id]={response:structuredClone(r),questionnaire,checksum,received_at:new Date(now).toISOString(),send_allowed:false};
  return {ok:true,duplicate:!!old,decision:r.decision,questionnaire,send_allowed:false};
 }
 if(m.command==='get_analysis'){
  const found=Object.values(s.analysisReplies||{}).filter(x=>x.response.hh_vacancy_id===String(m.vacancy_id)).sort((a,b)=>b.received_at.localeCompare(a.received_at));
  if(!found.length)return {ok:true,analysis:null};
  const currentHash=await currentContextHash(s,m.vacancy_id);
  const item=found.find(x=>x.response.context_hash===currentHash&&s.analysisRequests?.[x.response.request_id])||found[0],original=s.analysisRequests?.[item.response.request_id];return {ok:true,analysis:{...item,source_questionnaire:original?.payload.hh_questionnaire||null,stale:!original||currentHash!==item.response.context_hash,send_allowed:false}};
 }
 throw Error('Неизвестная операция обмена');
}

