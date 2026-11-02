export function extractSearchLinks() {
  const page=new URL(location.href);
  if(page.protocol!=='https:' || !(page.hostname==='hh.ru'||page.hostname.endsWith('.hh.ru')) || page.pathname!=='/search/vacancy') throw new Error('Откройте поисковую выдачу HH.');
  const found=new Map();
  for(const anchor of document.querySelectorAll('a[href]')) {
    let url;
    try {url=new URL(anchor.href,location.href);} catch {continue;}
    const match=url.pathname.match(/^\/vacancy\/(\d+)\/?$/);
    if(url.protocol!=='https:' || !(url.hostname==='hh.ru'||url.hostname.endsWith('.hh.ru')) || url.username || url.password || !match) continue;
    found.set(match[1],url.origin+'/vacancy/'+match[1]);
    if(found.size>=100) break;
  }
  return {source_url:location.href,urls:[...found.values()]};
}
