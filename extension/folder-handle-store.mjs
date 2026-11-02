// IndexedDB stores only the browser-granted directory handle, never HH credentials.
const databaseName='vilod-hh-folder-connection';
async function openDatabase(){
 if(!globalThis.indexedDB)throw Error('Браузер не поддерживает сохранение выбранной папки');
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(databaseName,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('handles');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('Хранилище подключения занято другой панелью'));
 });
}
export async function loadFolderHandle(){
 const database=await openDatabase();
 try{return await new Promise((resolve,reject)=>{
  const request=database.transaction('handles','readonly').objectStore('handles').get('exchange');
  request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
 });}finally{database.close();}
}
export async function storeFolderHandle(handle){
 const database=await openDatabase();
 try{await new Promise((resolve,reject)=>{
  const transaction=database.transaction('handles','readwrite');
  const store=transaction.objectStore('handles');if(handle)store.put(handle,'exchange');else store.delete('exchange');
  transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('Подключение не сохранено'));
 });}finally{database.close();}
}
