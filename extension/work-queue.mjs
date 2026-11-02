import {exchange,currentContextHash} from './exchange.mjs';
import {triage} from './triage.mjs';
import {historyMatches} from './history.mjs';
export const workLabels={already_applied:'Уже есть отклик HH',needs_analysis:'Нужен анализ',awaiting_analysis:'Ожидает ответа помощника',needs_reanalysis:'Нужен новый анализ',needs_clarification:'Нужно уточнение',needs_user_input:'Нужен ваш ответ в анкете',ready_for_review:'Подходит к проверке',prepared_not_sent:'Заполнено, не отправлено',rejected:'Не подходит',ruled_out:'Исключено правилом'};
export async function workQueue(state,{offset=0,limit=100}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Неверная страница очереди');
 const ids=Object.keys(state.cards).sort((a,b)=>(state.cards[b].captured_at||'').localeCompare(state.cards[a].captured_at||'')||b.localeCompare(a));
 const items=[],counts={};
 for(const id of ids.slice(offset,offset+limit)){
  const card=state.cards[id],{analysis}=await exchange(state,{command:'get_analysis',vacancy_id:id});
  let status='needs_analysis',reason='',requestId=null;
  if(state.existingResponses?.[id]){status='already_applied';reason='На HH наблюдалось подтверждение существующего отклика. Повтор заблокирован.';}
  else if(historyMatches(state,id).some(record=>record.hh_ids.includes(id))){status='needs_clarification';reason='В истории есть прежний отклик или неизвестный исход по этому HH ID. Сначала проверить историю; повторная подготовка заблокирована.';}
  else if([...Object.values(state.preparationOperations||{}),...Object.values(state.restoredPreparationLocks||{})].some(op=>op.vacancy_id===id&&['in_progress','needs_review'].includes(op.status))){status='needs_clarification';reason='Есть незавершенная подготовка или неизвестный результат. Сначала проверить поля и журнал; повторная подготовка заблокирована.';}
  else if(analysis){
   requestId=analysis.response.request_id;reason=analysis.response.reasons[0];
   if(analysis.stale)status='needs_reanalysis';
   else if(analysis.response.decision==='not_suitable')status='rejected';
   else if(analysis.response.decision==='needs_review')status='needs_clarification';
   else if(analysis.questionnaire?.pending_required?.length)status='needs_user_input';
   else if(state.events.some(e=>e.request_id===requestId&&e.result==='filled_not_submitted'&&e.stale_at_recording===false))status='prepared_not_sent';
   else status='ready_for_review';
  }else{
   const assessment=triage(state,id);
   if(assessment.decision==='not_suitable'){status='ruled_out';reason=assessment.exclusions.map(e=>e.text).join(' ');}
   else{
    const context=await currentContextHash(state,id);
    const request=Object.values(state.analysisRequests||{}).find(p=>p.hh_vacancy_id===id&&p.context_hash===context);
    if(request){status='awaiting_analysis';requestId=request.request_id;}
    else if(Object.values(state.analysisRequests||{}).some(p=>p.hh_vacancy_id===id))status='needs_reanalysis';
   }
  }
  items.push({id,title:card.value.title,company:card.value.company,version:card.version,status,label:workLabels[status],reason,request_id:requestId,send_allowed:false});
  counts[status]=(counts[status]||0)+1;
 }
 return {ok:true,items,counts,total_cards:ids.length,offset,limit,has_more:offset+items.length<ids.length,counts_scope:'current_page',send_allowed:false};
}
