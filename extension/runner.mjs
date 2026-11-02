import {local} from './transport.mjs';
import {extractVacancy} from './extract.mjs';
import {checkCardUrl as checkUrl,waitCardReady} from './card-ready.mjs';
import {readCompany} from './company-reader.mjs';
const log = document.getElementById('log');
const start = document.getElementById('start');
let stopped = true;
let generation = 0;
const write = text => { log.textContent += text + '\n'; };
// A Stop in the dashboard must also stop a runner opened in another tab.
chrome.storage?.onChanged?.addListener((changes,area)=>{
 if(area==='local'&&changes.vilodState?.newValue?.paused===true&&!stopped){
  stopped=true;generation++;write('Очередь остановлена из рабочей панели.');
 }
});
async function native(message) {
  const response = await local(message);
  if (!response.ok) throw new Error(response.error || 'Ошибка локального компонента');
  return response;
}
document.getElementById('stop').addEventListener('click',async()=>{
  generation++;
  stopped=true;
  try { await native({command:'pause_read_jobs'}); write('Новые задачи остановлены.'); }
  catch(error) { write('Остановка локальной очереди не подтверждена: '+error.message); }
});
start.addEventListener('click',async()=>{
  if (!stopped) return;
  start.disabled=true;
  const run = ++generation;
  let queueEnabled=false;
  try {
    const granted=await chrome.permissions.request({origins:['https://hh.ru/*','https://*.hh.ru/*']});
    if (!granted) throw new Error('Доступ к HH не предоставлен.');
    if (run !== generation) throw new Error('Запуск отменён.');
    const bridge=await native({command:'ping'});
    if (run !== generation) throw new Error('Запуск отменён.');
    if (!bridge.capabilities?.includes('read_jobs')) throw new Error('Нужно обновить локальный компонент.');
    await native({command:'resume_read_jobs'});
    queueEnabled=true;
    if(run!==generation) throw new Error('Запуск отменён.');
    stopped=false;
    for(let count=0;count<5 && !stopped;count++) {
      const {job,reason}=await native({command:'next_read_job'});
      if (!job) { write(reason==='empty'?'Очередь пуста. На выдаче HH откройте расширение и нажмите «Собрать ссылки в очередь», затем вернитесь сюда.':reason==='paused'?'Очередь остановлена.':'Нет ожидающих задач. Сохраненные карточки уже в базе; ошибки требуют проверки.'); break; }
      let savedCard;
      try {
        if (job.kind!=='read_vacancy' || !/^\d+$/.test(job.vacancy_id)) throw new Error('Неподдерживаемая задача');
        checkUrl(job.url,job.vacancy_id);
        if (stopped) throw new Error('Остановлено пользователем');
        const tab=await chrome.tabs.create({url:job.url,active:false});
        write('Чтение HH '+job.vacancy_id);
        await waitCardReady(tab.id,job.vacancy_id,{isStopped:()=>stopped || run!==generation});
        if (stopped) throw new Error('Остановлено пользователем');
        const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractVacancy,injectImmediately:true});
        if (stopped || run !== generation) throw new Error('Остановлено пользователем');
        checkUrl(result.url,job.vacancy_id);
        result.vacancy_id=job.vacancy_id;
        if (!result.title || !result.company || !result.description) throw new Error('Полная карточка недоступна. Возможно, требуется вход или проверка сайта.');
        await native({command:'finish_read_job',id:job.id,lease_token:job.lease_token,vacancy:result});
        savedCard=result;
        write('Сохранено: '+result.company+' - '+result.title);
      } catch(error) {
        try { await native({command:'finish_read_job',id:job.id,lease_token:job.lease_token,error:String(error.message).slice(0,1900)}); }
        catch(ackError) { write('Результат завершения неизвестен: '+ackError.message); }
        throw error;
      }
      // The vacancy job has already been acknowledged. A company failure must
      // never overwrite its saved status or try to finish the lease twice.
      if(savedCard?.company_url && !stopped && run===generation) {
        write('Чтение компании: '+savedCard.company);
        const material=await readCompany(savedCard.company_url,{isStopped:()=>stopped||run!==generation});
        if(stopped||run!==generation)throw Error('Остановлено пользователем');
        if(material.company){
          await native({command:'save_company',company:material.company});
          write('Описание компании сохранено: '+savedCard.company);
        } else write('Материалы компании не получены: '+material.reason+'. В пакет попадет только описание вакансии.');
      }
    }
  } catch(error) { write('Остановлено: '+error.message); }
  finally {
    stopped=true;
    if(queueEnabled) {
      try {await native({command:'pause_read_jobs'});}
      catch(error) {write('Пауза очереди не подтверждена: '+error.message);}
    }
    start.disabled=false;
  }
});

document.getElementById('api').addEventListener('click',async()=>{
  const button=document.getElementById('api');
  button.disabled=true;
  try {
    const granted=await chrome.permissions.request({origins:['https://api.hh.ru/*']});
    if(!granted) throw new Error('Доступ к API не предоставлен.');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch('https://api.hh.ru/vacancies?text=QA&per_page=1',{
        method:'GET',credentials:'omit',redirect:'error',signal:controller.signal,
        headers:{'HH-User-Agent':'VilodHH/0.13.14'}});
      write('Публичный API из Chrome: HTTP '+response.status);
      if((response.headers.get('content-type')||'').includes('application/json')) {
        const data=await response.json();
        write(JSON.stringify({request_id:data.request_id||null,found:data.found??null,
          errors:Array.isArray(data.errors)?data.errors.map(e=>({type:e.type,value:e.value})):null}));
      }
      write('Этот результат не подтверждает OAuth, отправку или маршрут остальных процессов.');
    } finally {clearTimeout(timeout);}
  } catch(error) {write('API: '+error.message);}
  finally {button.disabled=false;}
});
