export function employerId(value) {
  const u=new URL(value);
  const id=u.pathname.match(/^\/employer\/(\d+)\/?$/)?.[1];
  if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru'))||!id)throw Error('Неожиданный адрес работодателя HH');
  return id;
}

export function companyMaterials(state,url) {
  if(!url)return [];
  let id;try{id=employerId(url);}catch{return [];}
  return Object.values(state.companies).filter(c=>{try{return employerId(c.url)===id;}catch{return false;}});
}

// Serialized by Chrome: uses only the target page's document and location.
export function probeCompany() {
  const visible=node=>Boolean(node?.getClientRects().length);
  const challenge=[...document.querySelectorAll('iframe[src*="captcha"], [data-qa*="captcha"], input[name*="captcha"]')].some(visible);
  const body=(document.body?.innerText||'').slice(0,18000);
  const blocked=challenge||/подтвердите,? что вы (?:не робот|человек)|пройдите проверку безопасности|доступ (?:временно )?ограничен/i.test(body);
  const widgets=[...document.querySelectorAll('[data-qa="employer-view-widget-description"]')].map(n=>n.innerText?.trim()).filter(Boolean);
  const node=document.querySelector('[data-qa="employer-description"]')||document.querySelector('.employer-description');
  return {url:location.href,blocked,missing:/страница не найдена|компания не найдена/i.test(body),content:widgets.length?[...new Set(widgets)].join('\n\n'):node?.innerText?.trim()||null};
}

export async function readCompany(url,{isStopped,api=chrome,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=25000}={}) {
  const id=employerId(url),end=now()+timeoutMs;
  const stop=()=>{if(isStopped())throw Error('Остановлено пользователем');};
  stop();
  const tab=await api.tabs.create({url,active:false});
  while(now()<end) {
    stop();
    const current=await api.tabs.get(tab.id);
    stop();
    for(const address of [current.pendingUrl,current.url])if(address&&address!=='about:blank'&&employerId(address)!==id)throw Error('Страница перенаправлена к другому работодателю');
    if(current.url&&current.url!=='about:blank') {
      let timer,results;
      try {
        results=await Promise.race([
          api.scripting.executeScript({target:{tabId:tab.id},func:probeCompany,injectImmediately:true}),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Не получен ответ страницы компании. Серия остановлена.')),Math.max(1,end-now()));})
        ]);
      }catch(error){
        if(!/frame (?:with ID .* was removed|was removed)|document unloaded/i.test(error.message))throw error;
      }finally{clearTimeout(timer);}
      stop();
      const result=results?.[0]?.result;
      if(result){
        if(employerId(result.url)!==id)throw Error('Прочитана другая компания');
        if(result.blocked)throw Error('HH требует проверки доступа на странице компании. Серия остановлена.');
        if(result.missing)return {company:null,reason:'Страница компании недоступна',tab_id:tab.id};
        if(result.content){
          if(typeof result.content!=='string'||result.content.length>100000)throw Error('Недопустимый размер описания компании');
          const actual=new URL(result.url);
          return {company:{employer_id:id,url:actual.origin+actual.pathname,content:result.content},tab_id:tab.id};
        }
      }
    }
    await sleep(Math.min(500,Math.max(0,end-now())));
  }
  stop();
  return {company:null,reason:'Описание компании не появилось за 25 секунд',tab_id:tab.id};
}
