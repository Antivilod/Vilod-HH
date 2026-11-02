import {requiresUserDecision} from './user-decision.mjs';
export function validateAnswers(questionnaire,answers=[]){
 if(!Array.isArray(answers)||answers.length>100)throw Error('Неверный список ответов анкеты');
 const questions=questionnaire?.questions||[],byKey=new Map(questions.map(q=>[q.key,q])),seen=new Set(),validated=[];
 for(const a of answers){
  const q=byKey.get(a?.key);
  if(!q||seen.has(a.key))throw Error('Неизвестный или повторный вопрос анкеты');seen.add(a.key);
  if(!['prepared','needs_user'].includes(a.status))throw Error('Неизвестный статус ответа');
  if(a.status==='needs_user'){
   if(typeof a.reason!=='string'||!a.reason.trim()||a.reason.length>2000||a.value!==undefined)throw Error('Укажите причину уточнения без выдуманного ответа');
   validated.push({key:a.key,status:'needs_user',reason:a.reason});continue;
  }
  if(requiresUserDecision(q))throw Error('Согласие или принятие условий требует решения пользователя');
  if(typeof a.value!=='string'||a.value.length>10000||q.required&&!a.value.trim())throw Error('Неверный текст ответа');
  if(/[\u2013\u2014]/.test(a.value))throw Error('В ответе замените длинное тире коротким дефисом');
  if(['radio','select'].includes(q.type)&&(!q.options.includes(a.value)||q.options.filter(x=>x===a.value).length!==1))throw Error('Ответ не совпадает с единственным вариантом анкеты');
  if(q.type==='number'&&!/^-?\d+(?:[.,]\d+)?$/.test(a.value))throw Error('Ожидается число');
  if(typeof a.fact_source!=='string'||!a.fact_source.trim()||a.fact_source.length>3000)throw Error('Укажите источник факта для ответа');
  validated.push({key:a.key,status:'prepared',value:a.value,fact_source:a.fact_source});
 }
 const pending=questions.filter(q=>q.required&&!validated.some(a=>a.key===q.key&&a.status==='prepared')).map(q=>q.key);
 return {answers:validated,pending_required:pending,ready_for_review:pending.length===0,send_allowed:false};
}
