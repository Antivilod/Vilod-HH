import {initialProfile,validateProfile} from './profile.mjs';
import {importHistory,historyMatches} from './history.mjs';
import {triage} from './triage.mjs';
import {VERSION} from './version.mjs';
import {companyMaterials,employerId} from './company-reader.mjs';
import {recordExistingResponse} from './response-evidence.mjs';
import {stopPreparations} from './preparation.mjs';
import {isOlderObservation,rememberObservation} from './observation-times.mjs';
export const emptyState=()=>({schema:1,cards:{},companies:{},questions:{},jobs:[],paused:true,profile:initialProfile(),events:[]});
function hh(value,path) {
  const u=new URL(value);
  if(u.protocol!=='https:' || u.username || u.password || !(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru')) || !path.test(u.pathname)) throw Error('Недопустимый адрес HH');
  return u;
}
function card(value) {
  if(!value || typeof value!=='object') throw Error('Нет карточки');
  const u=hh(value.url,/^\/vacancy\/\d+\/?$/),id=u.pathname.match(/\d+/)[0];
  if(String(value.vacancy_id)!==id) throw Error('ID не совпадает с адресом');
  for(const k of ['title','company','description']) if(typeof value[k]!=='string'||!value[k].trim()||value[k].length>150000) throw Error('Неполная карточка: '+k);
  return {...value,url:'https://hh.ru/vacancy/'+id,vacancy_id:id};
}
export function dispatch(s,m,now=Date.now(),uuid=()=>crypto.randomUUID()) {
  const stamp=new Date(now).toISOString();
  for(const job of s.jobs)if(job.status==='reading'&&job.lease_until<=now&&job.attempts>=2){job.status='error';job.error='Срок чтения истек после двух попыток. Требуется проверка перед повтором';}
  const save=v=>{const v2=card(v),id=v2.vacancy_id,old=s.cards[id];const fingerprint=JSON.stringify(v2);const fresh=!old||old.fingerprint!==fingerprint;
    if(old&&isOlderObservation(s,'cards',id,stamp,old.captured_at))return {ok:true,new_snapshot:false,stale_observation:true};
    if(fresh)s.cards[id]={value:v2,fingerprint,captured_at:stamp,version:(old?.version||0)+1};
    rememberObservation(s,'cards',id,stamp);
    return {ok:true,new_snapshot:fresh,analysis:{status:'pending_export',message:'Ожидает выгрузки на анализ'}};
  };
  switch(m.command) {
    case 'record_existing_response':return recordExistingResponse(s,m.evidence);
    case 'get_existing_response':return {ok:true,evidence:s.existingResponses?.[String(m.vacancy_id)]||null};
    case 'save_visual_form':{const v=m.visual;const u=hh(v?.url,/^\/vacancy\/\d+\/?$/),id=u.pathname.match(/\d+/)[0];if(v.vacancy_id!==id||!s.cards[id])throw Error('Сначала сохраните соответствующую карточку');if(typeof v.data_url!=='string'||v.data_url.length>1000000||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(v.data_url)||typeof v.partial!=='boolean'||!Number.isInteger(v.width)||!Number.isInteger(v.height)||v.width<1||v.height<1||v.width>10000||v.height>10000||typeof v.text!=='string'||v.text.length>12000)throw Error('Неверный снимок');const visuals={...(s.visualForms||{}),[id]:{vacancy_id:id,url:v.url,data_url:v.data_url,width:v.width,height:v.height,partial:v.partial,text:v.text,captured_at:stamp,interpretation:'requires_visual_analysis'}};if(JSON.stringify(visuals).length>4000000)throw Error('Слишком много снимков. Сохраните копию и разберите существующие');s.visualForms=visuals;return {ok:true,partial:v.partial};}
    case 'get_visual_form':return {ok:true,visual:s.visualForms?.[String(m.vacancy_id)]||null};
    case 'get_events':return {ok:true,events:s.events.slice(-300).reverse().map(e=>{const report=s.operatorReports?.[e.operation_id]?.report;return report?.action==='submit_application'&&report.submission_authorized===false?{...e,requires_review:true,error:'НЕСОГЛАСОВАННЫЙ ОТКЛИК. Отправка не была разрешена. Не повторять; требуется решение пользователя.',submission_authorized:false}:e;})};
    case 'get_questionnaire':return {ok:true,questionnaire:s.questions[String(m.vacancy_id)]||null};
    case 'triage':return {ok:true,assessment:triage(s,String(m.vacancy_id))};
    case 'import_history':return importHistory(s,m.history);
    case 'history_matches':return {ok:true,matches:historyMatches(s,String(m.vacancy_id)),total:Object.keys(s.history||{}).length};
    case 'get_profile':return {ok:true,profile:{...initialProfile(),...s.profile}};
    case 'save_profile':{if(m.profile?.id!==s.profile.id||m.profile?.version!==s.profile.version)throw Error('Профиль изменён в другом окне. Обновите панель перед сохранением.');const clean=validateProfile(m.profile);if(Object.keys(clean).every(key=>s.profile[key]===clean[key]))return {ok:true,profile:s.profile,unchanged:true};s.profile={...clean,id:s.profile.id,version:s.profile.version+1};s.events.push({type:'profile_changed',profile_version:s.profile.version,at:stamp});return {ok:true,profile:s.profile,unchanged:false};}
    case 'get_card':{const item=s.cards[String(m.vacancy_id)];if(!item)throw Error('Вакансия не найдена');return {ok:true,card:item};}
    case 'export_backup':return {ok:true,backup:{format:'vilod-hh-backup',version:1,producer_version:VERSION,created_at:stamp,state:structuredClone(s)}};
    case 'ping':return {ok:true,version:VERSION,mode:'read_only',storage:'chrome.storage.local',capabilities:['raw_evidence','save_questions','save_company','enqueue_search','read_jobs']};
    case 'save_vacancy':return save(m.vacancy);
    case 'get_company_materials':{const item=s.cards[String(m.vacancy_id)];if(!item)throw Error('Вакансия не найдена');return {ok:true,materials:companyMaterials(s,item.value.company_url),company_url:item.value.company_url||null};}
    case 'save_company':{
      const c=m.company,u=hh(c?.url,/^\/employer\/\d+\/?$/),id=employerId(c.url);
      if(typeof c.content!=='string'||!c.content.trim()||c.content.length>100000)throw Error('Нет описания компании');
      if(c.employer_id!==undefined&&String(c.employer_id)!==id)throw Error('ID компании не совпадает с адресом');
      const existing=companyMaterials(s,c.url),content=c.content.trim();
      if(existing.some(item=>isOlderObservation(s,'companies',id,stamp,item.captured_at)))return {ok:true,new_snapshot:false,stale_observation:true};
      rememberObservation(s,'companies',id,stamp);
      if(existing.length===1&&existing[0].content===content)return {ok:true,new_snapshot:false};
      if(existing.length){s.companyArchive??=[];s.companyArchive.push(...structuredClone(existing));}
      const keys=Object.keys(s.companies).filter(key=>existing.includes(s.companies[key]));
      for(const key of keys)delete s.companies[key];
      s.companies[u.origin+u.pathname]={employer_id:id,url:u.origin+u.pathname,content,captured_at:stamp};
      s.events.push({type:'company_saved',at:stamp,employer_id:id,result:'material_saved_not_independently_verified'});
      return {ok:true,new_snapshot:true};
    }
    case 'save_questions':{const q=m.questionnaire;hh(q.url,/^\/vacancy\/\d+\/?$/);if(!s.cards[q.vacancy_id])throw Error('Сначала сохраните карточку вакансии');if(!Array.isArray(q.questions)||!q.questions.length||q.questions.length>100)throw Error('Нет распознанных вопросов');if(new URL(q.url).pathname.match(/\d+/)[0]!==String(q.vacancy_id))throw Error('ID анкеты не совпадает');const keys=new Set();const clean=q.questions.map(x=>{if(typeof x.key!=='string'||keys.has(x.key)||typeof x.text!=='string'||!x.text||x.text.length>10000||!['text','textarea','select','radio','checkbox','email','tel','number','date','url'].includes(x.type)||typeof x.required!=='boolean'||!Array.isArray(x.options)||x.options.length>200||x.options.some(o=>typeof o!=='string'||o.length>2000))throw Error('Неполные вопросы');keys.add(x.key);return {key:x.key,text:x.text,type:x.type,required:x.required,options:x.options,requires_user_decision:x.type==='checkbox'};});s.questions[q.vacancy_id]={url:q.url,questions:clean,captured_at:stamp};return {ok:true,questions:clean.length,analysis:{status:'pending_export',message:'Ожидает выгрузки'}};}
    case 'enqueue_search':{hh(m.search.source_url,/^\/search\/vacancy$/);if(!Array.isArray(m.search.urls)||m.search.urls.length>100)throw Error('Слишком много ссылок');const urls=m.search.urls.map(v=>hh(v,/^\/vacancy\/\d+\/?$/));let added=0;for(const u of urls){const id=u.pathname.match(/\d+/)[0];if(!s.cards[id]&&!s.jobs.some(j=>j.vacancy_id===id)){s.jobs.push({id:uuid(),kind:'read_vacancy',vacancy_id:id,url:'https://hh.ru/vacancy/'+id,status:'pending',attempts:0,source_url:m.search.source_url});added++;}}return {ok:true,found:urls.length,added};}
    case 'pause_read_jobs':s.paused=true;stopPreparations(s,now);return {ok:true};
    case 'retry_read_job':{if(!s.paused)throw Error('Сначала остановите очередь кнопкой Стоп');const j=s.jobs.find(x=>x.id===m.id);if(!j||j.status!=='error')throw Error('Повтор доступен только для задания с ошибкой');if(s.cards[j.vacancy_id]){j.status='saved';return {ok:true,already_saved:true};}j.status='pending';j.attempts=0;delete j.lease_token;delete j.lease_until;delete j.error;s.events.push({type:'read_job_retried',at:stamp,vacancy_id:j.vacancy_id,result:'pending_read_only'});return {ok:true,already_saved:false};}
    case 'resume_read_jobs':s.paused=false;return {ok:true};
    case 'next_read_job':{if(s.paused)return {ok:true,job:null,reason:'paused'};const j=s.jobs.find(j=>(j.status==='pending'||j.status==='reading'&&j.lease_until<=now)&&j.attempts<2);if(!j)return {ok:true,job:null,reason:s.jobs.length?'no_pending':'empty'};Object.assign(j,{status:'reading',attempts:j.attempts+1,lease_token:uuid(),lease_until:now+120000});return {ok:true,job:{...j}};}
    case 'finish_read_job':{const j=s.jobs.find(j=>j.id===m.id);if(!j||j.status!=='reading'||j.lease_token!==m.lease_token||j.lease_until<=now)throw Error('Задание устарело');if(m.error){j.status='error';j.error=String(m.error).slice(0,1900);}else{if(String(m.vacancy?.vacancy_id)!==j.vacancy_id)throw Error('Чужая карточка');save(m.vacancy);j.status='saved';}return {ok:true};}
    case 'summary':return {ok:true,cards:Object.values(s.cards).map(x=>({id:x.value.vacancy_id,title:x.value.title,company:x.value.company,version:x.version})),jobs:s.jobs.map(j=>({id:j.id,status:j.status,vacancy_id:j.vacancy_id,error:j.error||null,attempts:j.attempts})),profile:s.profile,history_records:Object.keys(s.history||{}).length,legacy_seed_imported:!!s.legacySeed};
    default:throw Error('Неподдерживаемая операция');
  }
}
