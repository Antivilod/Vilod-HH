export function extractQuestions() {
  const page=new URL(location.href);
  const match=page.pathname.match(/^\/vacancy\/(\d+)\/?$/);
  if(page.protocol!=='https:' || !(page.hostname==='hh.ru'||page.hostname.endsWith('.hh.ru')) || !match) throw new Error('Откройте анкету на полной карточке HH.');
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(x=>x.getClientRects().length);
  if(dialogs.length!==1) throw new Error('Нужна одна открытая анкета. Форма не распознана однозначно.');
  const questions=[];const grouped=new Map();let unsupported=0;
  for(const control of dialogs[0].querySelectorAll('input,textarea,select')) {
    if(!control.getClientRects().length || control.disabled) continue;
    const type=control.tagName==='TEXTAREA'?'textarea':control.tagName==='SELECT'?'select':control.type;
    if(['hidden','submit','button','reset'].includes(type)) continue;
    if(!['text','textarea','select','radio','checkbox','email','tel','number','date','url'].includes(type)||control.multiple) {unsupported++;continue;}
    const label=[...(control.labels||[])].map(x=>x.innerText.trim()).filter(Boolean).join(' ');
    const fieldset=control.closest('fieldset');
    const legend=fieldset?.querySelector('legend')?.innerText?.trim();
    if(type==='radio') {
      if(!control.name || !legend || !fieldset) {unsupported++;continue;}
      if(grouped.has(control.name)){if(grouped.get(control.name)!==fieldset)unsupported++;continue;}
      grouped.set(control.name,fieldset);
      const choices=[...fieldset.querySelectorAll('input[type="radio"]')].filter(x=>x.name===control.name);
      const options=choices.map(x=>[...(x.labels||[])].map(y=>y.innerText.trim()).join(' '));
      if(options.some(x=>!x)||new Set(options).size!==options.length) {unsupported++;continue;}
      questions.push({key:'radio:'+control.name,text:legend,type,required:choices.some(x=>x.required),options});
    } else {
      if(!label) {unsupported++;continue;}
      const key=control.id || control.name;
      if(!key) {unsupported++;continue;}
      const options=type==='select'?[...control.options].map(x=>x.textContent.trim()):type==='checkbox'?[label]:[];
      questions.push({key:type+':'+key,text:label,type,required:!!control.required,options});
    }
  }
  if(unsupported || !questions.length) throw new Error('Анкета распознана не полностью. Нужна проверка полей; данные не сохранены.');
  return {vacancy_id:match[1],url:location.href,questions};
}
