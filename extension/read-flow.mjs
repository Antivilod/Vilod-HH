import {extractVacancy} from './extract.mjs';
export async function readCurrentVacancy(browser,send,{exportAnalysis=false}={}){
 const [tab]=await browser.tabs.query({active:true,currentWindow:true});
 if(!tab)throw Error('Нет активной вкладки');
 const u=new URL(tab.url),id=u.pathname.match(/^\/vacancy\/(\d+)\/?$/)?.[1];
 if(u.protocol!=='https:'||!(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru'))||!id)throw Error('Откройте полную карточку вакансии HH');
 const [{result}]=await browser.scripting.executeScript({target:{tabId:tab.id},func:extractVacancy});
 if(result?.url!==tab.url)throw Error('Страница изменилась. Повторите чтение');
 const vacancy={...result,vacancy_id:id};
 const saved=await send({command:'save_vacancy',vacancy});
 if(!saved?.ok)throw Error('Сохранение не подтверждено: '+(saved?.error||'нет ответа'));
 let packet;
 if(exportAnalysis){const exported=await send({command:'export_analysis',vacancy_id:id});if(!exported?.ok)throw Error('Карточка сохранена, но выгрузка не подготовлена: '+(exported?.error||'нет ответа'));packet=exported.packet;if(packet?.hh_vacancy_id!==id||!/^exchange-[a-f0-9-]{36}$/.test(packet?.request_id||''))throw Error('Получен неверный пакет анализа');}
 return {vacancy,saved,packet};
}
