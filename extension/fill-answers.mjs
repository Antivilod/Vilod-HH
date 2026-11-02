// Native select handling adapted from singhkritesh/job_app_autofill content/filler.js.
// Copyright (c) 2026 Kritesh Singh, MIT. See LICENSE-singhkritesh.txt.
export function fillPreparedAnswers({vacancy_id,questions,answers}){
 const page=new URL(location.href);
 if(page.protocol!=='https:'||!(page.hostname==='hh.ru'||page.hostname.endsWith('.hh.ru'))||page.pathname.replace(/\/$/,'')!=='/vacancy/'+vacancy_id)throw Error('Открыта другая карточка');
 const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(x=>x.getClientRects().length);
 if(dialogs.length!==1)throw Error('Форма не распознана однозначно');
 const controls=[...dialogs[0].querySelectorAll('input,textarea,select')].filter(x=>x.getClientRects().length&&!x.disabled&&!['hidden','submit','button','reset'].includes(x.type));
 const snapshot=[],byKey=new Map(),radioGroups=new Set();
 for(const c of controls){
  const type=c.tagName==='TEXTAREA'?'textarea':c.tagName==='SELECT'?'select':c.type;
  if(!['text','textarea','email','tel','url','number','date','checkbox','select','radio'].includes(type)||c.multiple)throw Error('Поле не поддерживается: нужна проверка');
  if(type==='radio'){
   const fieldset=c.closest('fieldset'),legend=fieldset?.querySelector('legend')?.innerText?.trim();
   if(!c.name||!fieldset||!legend)throw Error('Группа переключателей не распознана');
   if(radioGroups.has(c.name)){
    if(byKey.get('radio:'+c.name).fieldset!==fieldset)throw Error('Повторяющееся имя группы переключателей');
    continue;
   }
   const choices=[...fieldset.querySelectorAll('input[type="radio"]')].filter(x=>x.name===c.name);
   // Native radio selection can deselect another input with the same name/form.
   // Refuse a group extending outside this fieldset rather than altering it.
   if([...document.querySelectorAll('input[type="radio"]')].some(x=>x.name===c.name&&x.form===c.form&&!choices.includes(x)))throw Error('Группа переключателей выходит за пределы вопроса');
   const options=choices.map(x=>[...(x.labels||[])].map(y=>y.innerText.trim()).filter(Boolean).join(' '));
   if(!choices.length||options.some(x=>!x)||new Set(options).size!==options.length)throw Error('Варианты переключателей неоднозначны');
   const key='radio:'+c.name;
   snapshot.push({key,text:legend,type,required:choices.some(x=>x.required),options});
   byKey.set(key,{fieldset,choices});radioGroups.add(c.name);continue;
  }
  const text=[...(c.labels||[])].map(x=>x.innerText.trim()).filter(Boolean).join(' '),key=type+':'+(c.id||c.name);
  if(!text||!(c.id||c.name)||byKey.has(key))throw Error('Неоднозначная подпись поля');
  const q={key,text,type,required:!!c.required,options:type==='checkbox'?[text]:type==='select'?[...c.options].map(o=>o.textContent.trim()):[]};
  snapshot.push(q);byKey.set(key,c);
 }
 const signature=items=>JSON.stringify(items.map(({key,text,type,required,options})=>({key,text,type,required,options})));
 if(signature(snapshot)!==signature(questions))throw Error('Вопросы или варианты изменились. Нужен новый анализ');
 const plan=[],seen=new Set();
 for(const a of answers){
  if(a.status==='needs_user')continue;
  let c=byKey.get(a.key);const q=questions.find(q=>q.key===a.key);
  if(a.status!=='prepared'||!c||seen.has(a.key)||q.type==='checkbox'||c.readOnly||c.matches?.(':disabled')||typeof a.value!=='string'||a.value.length>10000||/[\u2013\u2014]/.test(a.value))throw Error('Неподдерживаемый ответ или согласие');
  if(q.requires_user_decision===true||/согласи[еяю]|соглас(?:ен|на|ны)|соглаша|принима(?:ю|ем|ете|ть).*(?:услов|оферт|договор)|подпис(?:ать|ыва|ание)|оферт|обработк.*(?:персональн|данн)|персональн.*данн|\b(?:i agree|i accept|consent|terms of service|privacy policy)\b/i.test(String(q.text||'')))throw Error('Согласие или принятие условий требует решения пользователя');
  seen.add(a.key);
  if(q.type==='radio'){
   if(/согласи|согласен|согласна|принима|оферт|персональн|договор|обработк.*данн/i.test(q.text))throw Error('Вопрос о согласии или договоре требует решения пользователя');
   const group=c,choice=group.choices[q.options.indexOf(a.value)];
   if(!choice||choice.disabled||choice.matches?.(':disabled')||choice.readOnly||!choice.getClientRects().length)throw Error('Нужен один точный доступный вариант ответа');
   if(group.choices.some(x=>x.checked&&x!==choice))throw Error('В анкете уже есть другой ответ. Проверьте его вручную');
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked')?.set;
   if(!setter)throw Error('Переключатель не поддерживается');
   plan.push({c:choice,a,setter,value:true,radioGroup:group.choices,q,fieldset:group.fieldset});continue;
  }
  let value=a.value;
  if(q.type==='select'){
   const matches=[...c.options].filter(o=>o.textContent.trim()===a.value);
   if(matches.length!==1||matches[0].disabled||matches[0].parentElement?.disabled)throw Error('Нужен один точный доступный вариант ответа');
   value=matches[0].value;
   if(q.required&&!value)throw Error('Обязательный список не может остаться на пустом варианте');
   if([...c.options].filter(o=>o.value===value).length!==1)throw Error('Неоднозначные значения вариантов');
  }
  if(c.value&&c.value!==value)throw Error('В анкете уже есть другой ответ. Проверьте его вручную');
  if(c.maxLength>=0&&a.value.length>c.maxLength)throw Error('Ответ превышает ограничение поля');
  const prototype=q.type==='textarea'?HTMLTextAreaElement.prototype:q.type==='select'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;
  if(!setter)throw Error('Поле не поддерживается');
  // Validate a detached native copy before changing any live field. This catches
  // required/min/max/step/pattern/type constraints without submitting the form.
  if(typeof c.cloneNode==='function'){
   const probe=c.cloneNode(true);
   setter.call(probe,value);
   if(probe.value!==value||probe.validity?.valid===false)throw Error('Ответ не соответствует ограничениям поля. Ничего не заполнено: '+q.text);
  }
  plan.push({c,a,setter,value,q});
 }
 if(!plan.length)throw Error('Нет подготовленных текстовых ответов');
 let count=0;
 for(const {c,a,setter,value,radioGroup,q,fieldset} of plan){
  if(!c.isConnected||radioGroup?.some(x=>!x.isConnected))throw Error('Форма изменилась. Часть ответов могла быть вставлена; проверьте вручную');
  if(c.disabled||c.matches?.(':disabled')||c.readOnly||!c.getClientRects().length)throw Error('Доступность поля изменилась. Проверьте анкету вручную');
  if(radioGroup){
   const choices=[...fieldset.querySelectorAll('input[type="radio"]')].filter(x=>x.name===c.name);
   const options=choices.map(x=>[...(x.labels||[])].map(y=>y.innerText.trim()).filter(Boolean).join(' '));
   if(c.closest('fieldset')!==fieldset||fieldset.querySelector('legend')?.innerText?.trim()!==q.text||choices.length!==radioGroup.length||choices.some((x,i)=>x!==radioGroup[i])||JSON.stringify(options)!==JSON.stringify(q.options)||radioGroup.some(x=>x.checked&&x!==c))throw Error('Вопрос или выбранный ответ изменились. Нужен новый анализ');
  }else{
   const currentType=c.tagName==='TEXTAREA'?'textarea':c.tagName==='SELECT'?'select':c.type;
   const text=[...(c.labels||[])].map(x=>x.innerText.trim()).filter(Boolean).join(' ');
   if(currentType!==q.type||currentType+':'+(c.id||c.name)!==q.key||text!==q.text||!!c.required!==q.required||(c.value&&c.value!==value)||c.maxLength>=0&&a.value.length>c.maxLength)throw Error('Поле или прежний ответ изменились. Проверьте анкету вручную');
   if(q.type==='select'&&(c.multiple||JSON.stringify([...c.options].map(o=>o.textContent.trim()))!==JSON.stringify(q.options)||[...c.options].find(o=>o.value===value)?.disabled||[...c.options].find(o=>o.value===value)?.parentElement?.disabled))throw Error('Варианты изменились. Нужен новый анализ');
  }
  setter.call(c,value);c.dispatchEvent(new InputEvent('input',{bubbles:true,...(radioGroup?{}:{inputType:'insertText',data:a.value})}));c.dispatchEvent(new Event('change',{bubbles:true}));
  if(!c.isConnected||c.disabled||c.matches?.(':disabled')||c.readOnly||!c.getClientRects().length)throw Error('Поле удалено или стало недоступно после заполнения. Проверьте анкету вручную');
  if(radioGroup){if(!c.checked||radioGroup.some(x=>x!==c&&x.checked))throw Error('Форма изменила выбранный вариант. Проверьте вручную');count++;continue;}
  if(c.value!==value||(c.tagName==='SELECT'&&[...c.options].find(o=>o.value===c.value)?.textContent.trim()!==a.value))throw Error('Форма изменила ответ. Проверьте заполненное вручную');
  if(c.validity?.valid===false)throw Error('Сайт не принял значение поля. Часть ответов могла быть вставлена; проверьте вручную');
  count++;
 }
 // A later field's event handler can change an earlier answer. Confirm the
 // whole planned form again, rather than trusting per-field acknowledgements.
 const currentControls=[...dialogs[0].querySelectorAll('input,textarea,select')].filter(x=>x.getClientRects().length&&!x.disabled&&!['hidden','submit','button','reset'].includes(x.type));
 if(dialogs[0].isConnected===false||currentControls.length!==controls.length||currentControls.some((c,i)=>c!==controls[i]))throw Error('Состав формы изменился после заполнения. Проверьте все ответы вручную');
 const currentSnapshot=snapshot.map(q=>{
  const field=byKey.get(q.key);
  if(q.type==='radio'){
   const name=field.choices[0]?.name;
   const choices=[...field.fieldset.querySelectorAll('input[type="radio"]')].filter(x=>x.name===name);
   return {key:'radio:'+name,text:field.fieldset.querySelector('legend')?.innerText?.trim(),type:'radio',required:choices.some(x=>x.required),options:choices.map(x=>[...(x.labels||[])].map(y=>y.innerText.trim()).filter(Boolean).join(' '))};
  }
  const type=field.tagName==='TEXTAREA'?'textarea':field.tagName==='SELECT'?'select':field.type;
  const text=[...(field.labels||[])].map(x=>x.innerText.trim()).filter(Boolean).join(' ');
  return {key:type+':'+(field.id||field.name),text,type,required:!!field.required,options:type==='checkbox'?[text]:type==='select'?[...field.options].map(o=>o.textContent.trim()):[]};
 });
 if(signature(currentSnapshot)!==signature(questions))throw Error('Вопросы или варианты изменились после заполнения. Нужен новый анализ');
 for(const {c,value,radioGroup,q,fieldset,a} of plan){
  if(!c.isConnected||c.disabled||c.matches?.(':disabled')||c.readOnly||!c.getClientRects().length||c.validity?.valid===false)throw Error('Итоговое состояние поля не подтверждено. Проверьте анкету вручную');
  if(radioGroup){
   const choices=[...fieldset.querySelectorAll('input[type="radio"]')].filter(x=>x.name===c.name);
   const options=choices.map(x=>[...(x.labels||[])].map(y=>y.innerText.trim()).filter(Boolean).join(' '));
   if(!c.checked||radioGroup.some(x=>x!==c&&x.checked)||c.closest('fieldset')!==fieldset||fieldset.querySelector('legend')?.innerText?.trim()!==q.text||choices.length!==radioGroup.length||choices.some((x,i)=>x!==radioGroup[i])||JSON.stringify(options)!==JSON.stringify(q.options)||choices.some(x=>x.required)!==q.required)throw Error('Итоговый выбор или вопрос изменился. Проверьте анкету вручную');
  }else{
   const type=c.tagName==='TEXTAREA'?'textarea':c.tagName==='SELECT'?'select':c.type;
   const text=[...(c.labels||[])].map(x=>x.innerText.trim()).filter(Boolean).join(' ');
   if(c.value!==value||type!==q.type||type+':'+(c.id||c.name)!==q.key||text!==q.text||!!c.required!==q.required)throw Error('Сайт изменил ранее заполненный ответ. Проверьте все поля вручную');
   if(q.type==='select'){
    const option=[...c.options].find(o=>o.value===value);
    if(c.multiple||JSON.stringify([...c.options].map(o=>o.textContent.trim()))!==JSON.stringify(q.options)||!option||option.disabled||option.parentElement?.disabled||option.textContent.trim()!==a.value)throw Error('Итоговые варианты или доступность списка изменились. Проверьте вручную');
   }
  }
 }
 return {filled:count,submitted:false};
}
