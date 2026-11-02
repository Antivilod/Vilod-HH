// Adapted from kostindata/hh-cover-letter-extension content.js (MIT).
// Copyright (c) 2026 kostindata. See LICENSE-kostindata.txt.
export function insertReviewedLetter({vacancy_id,letter}){
 // The response URL may submit a resume on navigation. Preparation is confined
 // to an already open public vacancy card; it never supports that URL.
 const u=new URL(location.href),id=u.pathname.match(/^\/vacancy\/(\d+)\/?$/)?.[1];
 if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru'))||id!==vacancy_id)throw Error('Подготовка доступна только на полной карточке вакансии HH. Адрес отправки отклика не используется.');
 if(typeof letter!=='string'||!letter.trim()||letter.length>10000||/[\u2013\u2014]/.test(letter))throw Error('Проверьте текст письма');
 const selectors=['textarea[data-qa="vacancy-response-letter-input"]','textarea[data-qa="vacancy-response-popup-form-letter-input"]','textarea[name="letter"]'];
 const fields=[...new Set(selectors.flatMap(s=>[...document.querySelectorAll(s)]))].filter(f=>{const r=f.getBoundingClientRect();return r.width>0&&r.height>0&&!f.disabled&&!f.matches?.(':disabled')&&!f.readOnly;});
 if(fields.length!==1)throw Error('Нужна одна открытая форма с полем сопроводительного. Ничего не заполнено');
 const field=fields[0];
 if(field.value.trim()&&field.value!==letter)throw Error('В поле уже другой текст. Сначала проверьте и очистите его вручную');
 if(field.maxLength>=0&&letter.length>field.maxLength)throw Error('Письмо превышает ограничение поля. Сокращение должно быть проверено, текст не обрезан');
 const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
 if(!setter)throw Error('Поле не поддерживается');
 if(typeof field.cloneNode==='function'){
  const probe=field.cloneNode(true);setter.call(probe,letter);
  if(probe.value!==letter||probe.validity?.valid===false)throw Error('Письмо не соответствует ограничениям поля. Ничего не заполнено');
 }
 setter.call(field,letter);
 field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:letter}));
 field.dispatchEvent(new Event('change',{bubbles:true}));
 field.focus();field.setSelectionRange(letter.length,letter.length);
 if(field.value!==letter||field.isConnected===false||field.disabled||field.matches?.(':disabled')||field.readOnly||field.validity?.valid===false)throw Error('Форма изменила текст или не приняла значение. Часть действий могла выполниться, проверьте поле вручную');
 return {inserted:true,submitted:false,vacancy_id,characters:letter.length};
}
