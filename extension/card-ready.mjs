// Self-contained function serialized by Chrome into the HH document.
export function probeCard() {
  const visible = node => Boolean(node?.getClientRects().length);
  const text = selector => document.querySelector(selector)?.innerText?.trim() || '';
  const body = (document.body?.innerText || '').slice(0,18000);
  const challenge = [...document.querySelectorAll('iframe[src*="captcha"], [data-qa*="captcha"], input[name*="captcha"]')].some(visible);
  let blocker = null;
  if(challenge || /подтвердите,? что вы (?:не робот|человек)|пройдите проверку безопасности|доступ (?:временно )?ограничен/i.test(body)) blocker='HH требует проверки доступа. Выполните её вручную в открытой вкладке.';
  if(!blocker && /вакансия (?:не найдена|удалена)|страница не найдена/i.test(body)) blocker='HH сообщает, что вакансия или страница недоступна.';
  return {url:location.href,blocker,ready:Boolean(text('[data-qa="vacancy-title"]') && text('[data-qa="vacancy-company-name"]') && text('[data-qa="vacancy-description"]'))};
}

export function checkCardUrl(value,id) {
  const u=new URL(value);
  if(u.protocol!=='https:' || !(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru')) || u.username || u.password || !new RegExp('^/vacancy/'+id+'/?$').test(u.pathname)) throw new Error('Неожиданный адрес карточки. Чтение остановлено.');
}

export async function waitCardReady(tabId,id,{isStopped,api=chrome,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=60000}={}) {
  const end=now()+timeoutMs;
  const remaining=()=>Math.max(0,end-now());
  const checkStop=()=>{if(isStopped()) throw new Error('Остановлено пользователем');};
  while(remaining()>0) {
    checkStop();
    const tab=await api.tabs.get(tabId);
    checkStop();
    if(tab.pendingUrl) checkCardUrl(tab.pendingUrl,id);
    if(tab.url && tab.url!=='about:blank') {
      checkCardUrl(tab.url,id);
      let timer;
      let results;
      try {
        results=await Promise.race([
          api.scripting.executeScript({target:{tabId},func:probeCard,injectImmediately:true}),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Превышено время ожидания ответа вкладки HH.')),remaining());})
        ]);
      } catch(error) {
        // A document can disappear during HH's regional redirect. Do not mask permission failures.
        if(!/frame (?:with ID .* was removed|was removed)|document unloaded/i.test(error.message)) throw error;
      } finally {clearTimeout(timer);}
      checkStop();
      const state=results?.[0]?.result;
      if(state) {
        checkCardUrl(state.url,id);
        if(state.blocker) throw new Error(state.blocker);
        if(state.ready) return;
      }
    }
    await sleep(Math.min(500,remaining()));
  }
  checkStop();
  throw new Error('За 60 секунд не появилось полное описание вакансии. Проверьте открытую вкладку HH; задача сохранена с ошибкой.');
}
