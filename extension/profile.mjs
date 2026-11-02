export const initialProfile=()=>({"id": "local-profile", "version": 1, "name": "", "city": "", "citizenship": "", "direction": "", "minimum_net_rub": 0, "remote_from_russia": false, "commercial_qa_years": 0, "hours_per_week": 0, "availability": "", "experience": "", "skills": "", "education": "", "english": "", "email": "", "github": "", "resume": "", "exclusions": ""});
export function validateProfile(p){
  const clean={};
  for(const key of Object.keys(initialProfile())){
    if(['id','version'].includes(key))continue;
    const value=p[key];
    if(typeof initialProfile()[key]==='string') {if(typeof value!=='string'||value.length>12000)throw Error('Проверьте поле профиля: '+key);clean[key]=value.trim();}
    else if(typeof initialProfile()[key]==='boolean'){if(typeof value!=='boolean')throw Error('Проверьте формат удаленной работы');clean[key]=value;}
    else {if(!Number.isFinite(value)||value<0||value>10000000)throw Error('Проверьте число: '+key);clean[key]=value;}
  }
  if(!clean.name||!clean.direction||clean.hours_per_week>168)throw Error('Укажите имя, направление и корректное число рабочих часов');
  return clean;
}
