// Browser-local UI preference only. This is never an instruction to the operator.
const KEY='vilodFolderPreferences';
let pending=Promise.resolve();
export async function loadFolderAuto(){
 const storage=globalThis.chrome?.storage?.local;
 if(!storage)return false;
 const value=(await storage.get(KEY))?.[KEY];
 if(value===undefined)return null;
 return value?.version===1&&value.automatic===true;
}
export function saveFolderAuto(automatic){
 const value={version:1,automatic:automatic===true};
 // Serialize rapid changes so a late enable cannot overwrite Stop.
 const write=pending.catch(()=>{}).then(async()=>{
  const storage=globalThis.chrome?.storage?.local;
  if(!storage)throw Error('Настройку авточтения не удалось сохранить');
  await storage.set({[KEY]:value});
 });
 pending=write;
 return write;
}
