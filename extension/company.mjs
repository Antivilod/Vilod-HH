export function extractCompany() {
  const url=new URL(location.href);
  const match=url.pathname.match(/^\/employer\/(\d+)\/?$/);
  if(url.protocol!=='https:' || !(url.hostname==='hh.ru'||url.hostname.endsWith('.hh.ru')) || !match) throw new Error('Откройте страницу работодателя HH.');
  const widgets=[...document.querySelectorAll('[data-qa="employer-view-widget-description"]')].map(n=>n.innerText?.trim()).filter(Boolean);
  const node=document.querySelector('[data-qa="employer-description"]') || document.querySelector('.employer-description');
  const content=widgets.length?[...new Set(widgets)].join('\n\n'):node?.innerText?.trim();
  if(!content || content.length>100000) throw new Error('Описание компании не распознано. Сохранение отменено.');
  return {employer_id:match[1],url:location.href,content};
}
