// Prepared for the next extension release; not part of the frozen 0.11.0 bundle.
// This is read-only evidence of an EXISTING response, never a new submission.
export function extractExistingResponse({vacancy_id}){
 const page=new URL(location.href);
 if(page.protocol!=='https:'||page.username||page.password||!(page.hostname==='hh.ru'||page.hostname.endsWith('.hh.ru'))||page.pathname.replace(/\/$/,'')!=='/vacancy/'+vacancy_id)throw Error('Открыта другая вакансия HH');
 const title=document.querySelector('[data-qa="vacancy-title"]')?.innerText?.trim();
 const company=document.querySelector('[data-qa="vacancy-company-name"]')?.innerText?.trim();
 const articles=[...document.querySelectorAll('main article')].filter(n=>n.getClientRects().length);
 if(!title||!company||articles.length!==1)throw Error('Карточка вакансии не распознана однозначно');
 const description=articles[0].querySelector('[data-qa="vacancy-description"]');
 if(!description)throw Error('Полное описание недоступно: подтверждение отклика не проверено');
 const allowed=new Set(['Вы откликнулись','Резюме доставлено']);
 const markers=[];
 for(const node of articles[0].querySelectorAll('div,span,p')){
  if(!node.getClientRects().length||description.contains(node)||node.contains(description)||node.closest('[role="dialog"]'))continue;
  const text=node.innerText?.replace(/\s+/g,' ').trim();
  if(allowed.has(text)&&!markers.includes(text))markers.push(text);
 }
 return {source:'hh_vacancy_ui',vacancy_id:String(vacancy_id),url:page.href,title,company,
  observed_at:new Date().toISOString(),existing_response:markers.length?true:null,marker_texts:markers,
  scope:'one_vacancy_in_current_browser_account',complete_account_history:false,
  sent_by_program:false,new_submission_confirmed:false,application_time:null,letter:null,
  explanation:markers.length?'HH показывает наличие существующего отклика. Повтор заблокирован.':'Явного подтверждения не найдено. Это не доказывает отсутствие прежнего отклика.'};
}

export function validateExistingResponse(value){
 if(!value||value.source!=='hh_vacancy_ui'||value.existing_response!==true||value.sent_by_program!==false||value.new_submission_confirmed!==false)throw Error('Нет подтверждения существующего отклика');
 const u=new URL(value.url);
 if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru'))||!/^\d+$/.test(value.vacancy_id)||u.pathname.replace(/\/$/,'')!=='/vacancy/'+value.vacancy_id)throw Error('ID доказательства не совпадает с адресом HH');
 if(!Array.isArray(value.marker_texts)||!value.marker_texts.length||value.marker_texts.some(x=>!['Вы откликнулись','Резюме доставлено'].includes(x))||!Number.isFinite(Date.parse(value.observed_at))||typeof value.title!=='string'||!value.title.trim()||typeof value.company!=='string'||!value.company.trim())throw Error('Неполное подтверждение HH');
 return structuredClone(value);
}

export function recordExistingResponse(state,value){
 const clean=validateExistingResponse(value);
 state.existingResponses??={};
 const old=state.existingResponses[clean.vacancy_id];
 if(old)return {ok:true,duplicate:true,repeat_blocked:true,new_submission_confirmed:false};
 state.existingResponses[clean.vacancy_id]=clean;
 state.events??=[];state.events.push({type:'existing_response_observed',at:clean.observed_at,vacancy_id:clean.vacancy_id,source_url:clean.url,marker_texts:clean.marker_texts,send_confirmed:false,sent_by_program:false,result:'repeat_blocked'});
 return {ok:true,duplicate:false,repeat_blocked:true,new_submission_confirmed:false};
}

export function responseRepeatGuard(state,vacancyId){
 const known=state.existingResponses?.[String(vacancyId)];
 return known?{blocked:true,reason:'existing_response_observed_on_hh',evidence:known}:{blocked:null,reason:'absence_not_proven_by_this_ledger'};
}
