export async function local(message){
  const response=await chrome.runtime.sendMessage({...message,target:'vilod-local'});
  if(!response)throw Error('Хранилище расширения не ответило');
  return response;
}
