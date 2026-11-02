import {readCurrentVacancy} from './read-flow.mjs';

import {captureForm} from './visual-form.mjs';
import {local} from './transport.mjs';

import {extractExistingResponse} from './response-evidence.mjs';


import {extractCompany} from './company.mjs';
import {extractSearchLinks} from './search.mjs';
import {extractQuestions} from './questions.mjs';
const output = document.getElementById('result');
const status = document.getElementById('status');
document.getElementById('checkExisting').addEventListener('click',async()=>{
 const button=document.getElementById('checkExisting');button.disabled=true;
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const id=new URL(tab.url).pathname.match(/^\/vacancy\/(\d+)\/?$/)?.[1];
  if(!id)throw Error('Откройте полную карточку вакансии HH');
  const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractExistingResponse,args:[{vacancy_id:id}],injectImmediately:true});
  if(result.url!==tab.url)throw Error('Страница изменилась. Повторите проверку.');
  if(result.existing_response!==true){inform(result.explanation,'normal');return;}
  const saved=await local({command:'record_existing_response',evidence:result});
  if(!saved.ok)throw Error(saved.error);
  inform('HH подтверждает существующий отклик. Повтор заблокирован. Новая отправка не выполнялась.','success');
 }catch(error){inform(error.message,'error');}finally{button.disabled=false;}
});
document.getElementById('visualForm').addEventListener('click',async()=>{
 const button=document.getElementById('visualForm');button.disabled=true;
 try{const visual=await captureForm(chrome);const saved=await local({command:'save_visual_form',visual});if(!saved.ok)throw Error(saved.error);inform('Снимок формы сохранен'+(saved.partial?' частично: видна не вся форма.':'.')+' Выгрузите новый пакет на анализ. Распознавание не выполнялось.','success');}catch(e){inform(e.message,'error');}finally{button.disabled=false;}
});
function inform(text,state='normal') {status.textContent=text;status.dataset.state=state;}
document.getElementById('questions').addEventListener('click',async()=>{
  const button=document.getElementById('questions');button.disabled=true;
  try {
    const bridge=await local({command:'ping'});
    if(!bridge.ok || !bridge.capabilities?.includes('save_questions')) throw new Error('Обновите расширение для чтения анкет.');
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const url=new URL(tab.url);
    if(url.protocol!=='https:' || !(url.hostname==='hh.ru'||url.hostname.endsWith('.hh.ru')) || !/^\/vacancy\/\d+\/?$/.test(url.pathname)) throw new Error('Откройте анкету на карточке HH.');
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractQuestions});
    if(result.url!==tab.url) throw new Error('Страница изменилась. Повторите чтение.');
    const saved=await local({command:'save_questions',questionnaire:result});
    if(!saved.ok) throw new Error(saved.error||'Сохранение анкеты не подтверждено');
    inform('Сохранено вопросов: '+saved.questions+'. Ничего не заполнено и не отправлено.','success');
    if(saved.analysis?.status==='error') inform('Вопросы сохранены. Передача на анализ: '+(saved.analysis?.message||'не подтверждена'),'error');
    output.textContent=JSON.stringify(saved,null,2);
  } catch(error) {inform(error.message,'error');}
  finally {button.disabled=false;}
});
document.getElementById('search').addEventListener('click',async()=>{
  const button=document.getElementById('search');button.disabled=true;
  try {
    const bridge=await local({command:'ping'});
    if(!bridge.ok || !bridge.capabilities?.includes('enqueue_search')) throw new Error('Обновите расширение для сбора выдачи.');
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const url=new URL(tab.url);
    if(url.protocol!=='https:' || !(url.hostname==='hh.ru'||url.hostname.endsWith('.hh.ru')) || url.pathname!=='/search/vacancy') throw new Error('Откройте поисковую выдачу HH.');
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractSearchLinks});
    if(result.source_url!==tab.url) throw new Error('Выдача изменилась. Повторите сбор.');
    const saved=await local({command:'enqueue_search',search:result});
    if(!saved.ok) throw new Error(saved.error||'Сохранение очереди не подтверждено');
    inform('Найдено ссылок: '+saved.found+'. Новых задач чтения: '+saved.added+'. Пригодность ещё не проверена.','success');
    output.textContent=JSON.stringify(saved,null,2);
  } catch(error) {inform(error.message,'error');}
  finally {button.disabled=false;}
});
document.getElementById('company').addEventListener('click',async()=>{
  const button=document.getElementById('company');button.disabled=true;
  try {
    const bridge=await local({command:'ping'});
    if(!bridge.ok || !bridge.capabilities?.includes('save_company')) throw new Error('Обновите расширение для чтения компании.');
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const u=new URL(tab.url);
    if(u.protocol!=='https:' || !(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru')) || !/^\/employer\/\d+\/?$/.test(u.pathname)) throw new Error('Откройте страницу работодателя HH.');
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractCompany});
    if(result.url!==tab.url) throw new Error('Страница изменилась. Повторите чтение.');
    const saved=await local({command:'save_company',company:result});
    if(!saved.ok) throw new Error(saved.error||'Сохранение не подтверждено');
    inform('Описание компании сохранено с адресом источника.','success');
    output.textContent=JSON.stringify(saved,null,2);
  } catch(error) {inform(error.message,'error');}
  finally {button.disabled=false;}
});
document.getElementById('runner').addEventListener('click',()=>chrome.runtime.openOptionsPage());
document.getElementById('ping').addEventListener('click', async () => {
  try {
    const response = await local( {command: 'ping'});
    output.textContent = JSON.stringify(response, null, 2);
    if(!response.ok) throw new Error(response.error||'Нет подтверждения связи');
    const summary=await local({command:'summary'});
    if(!summary.ok)throw new Error(summary.error);
    inform('Хранилище работает. Карточек: '+summary.cards.length+'. Задач чтения: '+summary.jobs.length+'. Отправка отключена.','success');
  } catch (error) { output.textContent = 'Хранилище недоступно: ' + error.message; inform(error.message,'error'); }
});
async function readAndMaybeExport(exportAnalysis){
  const read=document.getElementById('read'),exportButton=document.getElementById('readExport');
  read.disabled=true;exportButton.disabled=true;inform('Читаем и сохраняем карточку...');
  try{
    const {vacancy,saved,packet}=await readCurrentVacancy(chrome,local,{exportAnalysis});
    output.textContent=JSON.stringify({vacancy_id:vacancy.vacancy_id,new_snapshot:saved.new_snapshot,request_id:packet?.request_id||null},null,2);
    if(packet){
      const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=packet.request_id+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      inform('Карточка сохранена. Пакет подготовлен к загрузке. Передайте файл основному помощнику; Excel автоматически не изменён.','success');
    }else inform((saved.new_snapshot?'Сохранено: ':'Уже в базе: ')+vacancy.company+' - '+vacancy.title,'success');
  }catch(error){inform(error.message,'error');}
  finally{read.disabled=false;exportButton.disabled=false;}
}
document.getElementById('read').addEventListener('click',()=>readAndMaybeExport(false));
document.getElementById('readExport').addEventListener('click',()=>readAndMaybeExport(true));
