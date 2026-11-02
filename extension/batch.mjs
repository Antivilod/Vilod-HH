import {exchange,hash} from './exchange.mjs';
import {triage} from './triage.mjs';
export async function batch(state,message){
 const next=structuredClone(state);
 if(message.command==='export_analysis_batch'){
  const packets=[],excluded=[];let alreadyAnswered=0;
  for(const id of Object.keys(next.cards)){
   if(next.existingResponses?.[id]){excluded.push(id);continue;}
   if(triage(next,id).decision==='not_suitable'){excluded.push(id);continue;}
   const {packet}=await exchange(next,{command:'export_analysis',vacancy_id:id});
   if(next.analysisReplies?.[packet.request_id]){alreadyAnswered++;continue;}
   packets.push(packet);if(packets.length===20)break;
  }
  if(!packets.length)return {ok:true,bundle:null,excluded:excluded.length,already_answered:alreadyAnswered};
  const bundle={format:'vilod-hh-analysis-batch',version:1,batch_id:'batch-'+await hash(packets.map(p=>p.request_id)),created_at:new Date().toISOString(),packets,reply_format:{format:'vilod-hh-analysis-replies',version:1,responses:'Ответы по expected_response каждого вложенного пакета'}};
  if(JSON.stringify(bundle).length>10000000)throw Error('Пакет слишком большой. Выгружайте вакансии отдельно');
  Object.assign(state,next);return {ok:true,bundle,excluded:excluded.length,already_answered:alreadyAnswered};
 }
 if(message.command==='import_analysis_batch'){
  const b=message.bundle;
  if(!b||b.format!=='vilod-hh-analysis-replies'||b.version!==1||!Array.isArray(b.responses)||!b.responses.length||b.responses.length>20||JSON.stringify(b).length>1000000)throw Error('Неверный общий файл ответов');
  const ids=new Set(),results=[];
  for(const response of b.responses){if(ids.has(response.request_id))throw Error('Повторное задание внутри файла');ids.add(response.request_id);results.push({request_id:response.request_id,...await exchange(next,{command:'import_analysis',response})});}
  Object.assign(state,next);return {ok:true,results,imported:results.filter(x=>!x.duplicate).length,duplicates:results.filter(x=>x.duplicate).length,send_allowed:false};
 }
 throw Error('Неизвестная операция серии');
}
