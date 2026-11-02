const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function validateHistory(data){
 if(!data||data.format!=='vilod-hh-history'||data.version!==1||!Array.isArray(data.records)||data.records.length>10000)throw Error('Неизвестный формат истории');
 const ids=new Set();
 return data.records.map(r=>{
  if(typeof r.record_id!=='string'||!r.record_id||r.record_id.length>200||ids.has(r.record_id))throw Error('Повторный или неверный ID истории');ids.add(r.record_id);
  if(!Array.isArray(r.hh_ids)||r.hh_ids.length>100||r.hh_ids.some(id=>typeof id!=='string'||!/^\d{1,20}$/.test(id)))throw Error('Неверный ID вакансии в истории');
  const out={record_id:r.record_id,hh_ids:[...new Set(r.hh_ids)].sort(),verification:'imported_claim_not_verified'};
  for(const key of ['date','source','company','title','url','status_claim','notes','source_file']){const v=r[key]??'';if(typeof v!=='string'||v.length>15000)throw Error('Неверное поле истории: '+key);out[key]=v;}
  if(r.raw_fields!==undefined){if(!Array.isArray(r.raw_fields)||r.raw_fields.length>100||r.raw_fields.some(v=>typeof v!=='string'||v.length>15000))throw Error('Неверная исходная строка');out.raw_fields=r.raw_fields;}
  return out;
 });
}
export function historyMatches(s,id){
 const card=s.cards[id]?.value;
 return Object.values(s.history||{}).flatMap(r=>{
  const direct=r.hh_ids.includes(id);
  const explicit=card&&norm(r.company)&&norm(r.title)&&norm(r.company)===norm(card.company)&&norm(r.title)===norm(card.title);
  // Legacy records and results arriving before their cards retain their exact
  // original claims. Derive only a possible role link from known linked HH IDs.
  const linked=card&&(!norm(r.company)||!norm(r.title))?r.hh_ids.map(hhId=>({hhId,item:s.cards[hhId]})).filter(({item})=>item&&norm(item.value.company)===norm(card.company)&&norm(item.value.title)===norm(card.title)):[];
  if(!direct&&!explicit&&!linked.length)return [];
  return [{...r,match_basis:direct?'hh_vacancy_id':explicit?'company_and_title_possible_duplicate':'linked_hh_card_possible_duplicate',...(linked.length&&!direct&&!explicit?{linked_role_sources:linked.map(({hhId,item})=>({hh_vacancy_id:hhId,card_version:item.version,captured_at:item.captured_at,company:item.value.company,title:item.value.title,verification:'derived_from_saved_card_not_historical_confirmation'}))}:{}),requires_verification:true}];
 });
}
export function importHistory(s,data){
 const records=validateHistory(data);let added=0;
 // Records contain validated strings and arrays of strings. Chrome storage can
 // reorder object keys; that is not a change to the imported history content.
 const signature=record=>JSON.stringify(Object.keys(record).sort().map(key=>[key,record[key]]));
 for(const r of records){const old=s.history?.[r.record_id];if(old&&signature(old)!==signature(r))throw Error('Конфликт существующей записи '+r.record_id);}
 s.history??={};for(const r of records)if(!s.history[r.record_id]){s.history[r.record_id]=r;added++;}
 return {ok:true,added,total:Object.keys(s.history).length,verified_sends:0};
}
