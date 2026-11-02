export function extractVacancy() {
  const get = selector => document.querySelector(selector)?.innerText?.trim() || null;
  const selectors = {
    salary: '[data-qa="vacancy-salary"]',
    experience: '[data-qa="vacancy-experience"]',
    employment: '[data-qa="vacancy-busy-type"]',
    schedule: '[data-qa="vacancy-work-schedule"]',
    location: '[data-qa="vacancy-view-location"]',
    published: '.vacancy-creation-time'
  };
  const evidence = {};
  for (const [key, selector] of Object.entries(selectors)) {
    const text = get(selector);
    if (text) evidence[key] = {text, selector};
  }
  const labelKeys={'опыт работы':'experience','тип занятости':'employment','оформление':'contract','график':'schedule','рабочие часы':'hours','формат работы':'work_format'};
  for(const dl of document.querySelectorAll('dl')) {
    const label=dl.querySelector('dt')?.innerText?.replace(/:/g,'').trim().toLowerCase();
    const key=labelKeys[label],text=dl.querySelector('dd')?.innerText?.trim();
    if(key && text && !evidence[key])evidence[key]={text,selector:'dl > dt + dd',label};
  }
  const node=document.querySelector('[data-qa="vacancy-company-name"]');
  const anchor=node?.closest?.('a[href]') || node?.querySelector?.('a[href]');
  let companyUrl;
  if(anchor?.href) {
    const u=new URL(anchor.href,location.href);
    if(u.protocol==='https:' && (u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru')) && /^\/employer\/\d+\/?$/.test(u.pathname)) companyUrl=u.origin+u.pathname;
  }
  return {url: location.href, title: get('[data-qa="vacancy-title"]'),
    company: get('[data-qa="vacancy-company-name"]'),
    description: get('[data-qa="vacancy-description"]'), evidence, ...(companyUrl?{company_url:companyUrl}:{})};
}
