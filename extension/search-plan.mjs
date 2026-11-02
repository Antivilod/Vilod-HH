export function searchUrl(text,{days=7,remote=true}={}){
 if(typeof text!=='string'||!text.trim()||text.length>300)throw Error('Введите поисковый запрос до 300 символов');
 if(![1,3,7,30].includes(days)||typeof remote!=='boolean')throw Error('Проверьте период и формат поиска');
 const url=new URL('https://hh.ru/search/vacancy');url.searchParams.set('text',text.trim());url.searchParams.set('order_by','publication_time');url.searchParams.set('search_period',String(days));if(remote)url.searchParams.set('work_format','REMOTE');return url.href;
}
