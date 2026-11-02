export function inspectVisualForm(){
 const u=new URL(location.href),id=u.pathname.match(/^\/vacancy\/(\d+)\/?$/)?.[1];
 if(u.protocol!=='https:'||!(u.hostname==='hh.ru'||u.hostname.endsWith('.hh.ru'))||!id)throw Error('Откройте форму на полной карточке HH');
 const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(x=>x.getClientRects().length);
 if(dialogs.length!==1)throw Error('Для снимка нужна одна видимая форма');
 const dialog=dialogs[0];
 if(dialog.querySelector('input[type="password"],iframe,[data-qa*="captcha"],[class*="captcha"]'))throw Error('Форма содержит пароль, встроенную страницу или проверку. Снимок не сохраняется');
 if([...dialog.querySelectorAll('input,textarea')].some(c=>!['hidden','checkbox','radio','button','submit','reset'].includes(c.type)&&c.value))throw Error('В форме уже есть введенный текст. Для снимка используйте незаполненную форму');
 const r=dialog.getBoundingClientRect(),x=Math.max(0,r.left),y=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
 if(right-x<50||bottom-y<50)throw Error('Форма вне видимой области');
 return {vacancy_id:id,url:location.href,viewport:{width:innerWidth,height:innerHeight},crop:{x,y,width:right-x,height:bottom-y},partial:r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight||dialog.scrollHeight>dialog.clientHeight,text:dialog.innerText.slice(0,12000)};
}
export async function captureForm(browser){
 const [tab]=await browser.tabs.query({active:true,currentWindow:true});
 const inspect=async()=>{const [{result}]=await browser.scripting.executeScript({target:{tabId:tab.id},func:inspectVisualForm});return result;};
 const before=await inspect();
 if(before.url!==tab.url)throw Error('Страница изменилась');
 const screenshot=await browser.tabs.captureVisibleTab(tab.windowId,{format:'jpeg',quality:80});
 const [current]=await browser.tabs.query({active:true,currentWindow:true});
 if(current?.id!==tab.id||current?.url!==tab.url)throw Error('Активная вкладка изменилась. Снимок не сохранен');
 const after=await inspect();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Форма изменилась во время снимка. Снимок не сохранен');
 const image=new Image();image.src=screenshot;await image.decode();
 const scaleX=image.naturalWidth/before.viewport.width,scaleY=image.naturalHeight/before.viewport.height;
 const canvas=document.createElement('canvas');canvas.width=Math.round(before.crop.width*scaleX);canvas.height=Math.round(before.crop.height*scaleY);
 const context=canvas.getContext('2d');if(!context)throw Error('Не удалось выделить форму');
 context.drawImage(image,Math.round(before.crop.x*scaleX),Math.round(before.crop.y*scaleY),canvas.width,canvas.height,0,0,canvas.width,canvas.height);
 const data_url=canvas.toDataURL('image/jpeg',0.8);if(data_url.length>1000000)throw Error('Снимок больше 1 МБ. Уменьшите видимую форму');
 return {...before,data_url,width:canvas.width,height:canvas.height,captured_at:new Date().toISOString(),interpretation:'requires_visual_analysis'};
}
