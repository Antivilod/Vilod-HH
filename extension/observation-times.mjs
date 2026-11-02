const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):-Infinity;
export function isOlderObservation(s,kind,id,stamp,fallback){
 return time(stamp)<Math.max(time(fallback),time(s.observationTimes?.[kind]?.[id]));
}
export function rememberObservation(s,kind,id,stamp){
 s.observationTimes??={};s.observationTimes[kind]??={};
 if(time(stamp)>time(s.observationTimes[kind][id]))s.observationTimes[kind][id]=stamp;
}
export function restoreObservationTimes(s,source){
 if(source===undefined)return;
 if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(k=>!['cards','companies'].includes(k)))throw Error('Повреждены времена наблюдений');
 for(const [kind,items] of Object.entries(source)){
  if(!items||typeof items!=='object'||Array.isArray(items)||Object.keys(items).length>10000)throw Error('Повреждены времена наблюдений');
  for(const [id,stamp] of Object.entries(items)){
   if(!/^\d{1,20}$/.test(id)||typeof stamp!=='string'||!Number.isFinite(Date.parse(stamp)))throw Error('Неверное время наблюдения');
   rememberObservation(s,kind,id,stamp);
  }
 }
}
