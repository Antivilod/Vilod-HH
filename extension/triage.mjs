import {historyMatches} from './history.mjs';
export function triage(s,id){
 const c=s.cards[id]?.value;if(!c)throw Error('Нет карточки');
 const reasons=[],questions=[],excluded=[];
 const e=c.evidence||{},profile=s.profile;
 const format=e.work_format?.text?.trim().toLowerCase();
 if(profile.remote_from_russia){
  if(format==='удалённо'||format==='удаленно')reasons.push({text:'Указан удаленный формат',source:e.work_format});
  else if(format==='на месте работодателя'||format==='гибрид')excluded.push({text:'Формат работы не соответствует полной удаленке',source:e.work_format});
  else questions.push('Не подтвержден полностью удаленный формат');
  questions.push('Проверить возможность работать из России: удаленка сама по себе этого не доказывает');
 }
 const salary=e.salary?.text;
 if(!salary||/не указан/i.test(salary))questions.push('Зарплата не указана: минимум на руки не подтвержден');
 else {
  // Reject only an explicit monthly RUB net upper bound below the minimum.
  // Other representations, currencies, periods and gross amounts require analysis.
  const normalized=salary.replace(/[\s\u00a0\u202f]+/g,' ').trim();
  const match=normalized.match(/^до ([\d ]+) (?:₽|руб\.?|рублей)(?: за месяц| в месяц)(?:,)? на руки$/i);
  if(match&&Number(match[1].replaceAll(' ',''))<profile.minimum_net_rub)excluded.push({text:'Верхняя граница зарплаты на руки ниже вашего минимума',source:e.salary});
  else questions.push('Сверить зарплату, период, валюту и налоги: '+normalized);
 }
 const history=historyMatches(s,id);if(history.length)questions.push('В истории есть '+history.length+' совпадений. Сначала проверить прошлый отклик');
 if(profile.commercial_qa_years===0 && e.experience?.text && !/без опыта/i.test(e.experience.text))questions.push('Указан опыт: '+e.experience.text+'. Коммерческого QA-стажа в профиле нет; обязательность уточнит анализатор');
 questions.push('Основной помощник проверяет требования, географию, оплату, компанию и соответствие направлению по полному тексту');
 return {decision:excluded.length?'not_suitable':'needs_review',reasons,exclusions:excluded,questions,history_matches:history,send_allowed:false,method:'conservative_rules_v1'};
}

