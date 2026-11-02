// Persist the start before asking Chrome to touch a form.
export async function runPreparation({local,execute,vacancy_id,request_id,action}){
 let operation;
 const call=async message=>{const result=await local(message);if(!result?.ok)throw Error(result?.error||'Связь с журналом не подтверждена');return result;};
 try{
  ({operation}=await call({command:'begin_preparation',vacancy_id,request_id,action}));
  await call({command:'check_preparation',operation_id:operation.id});
  const result=await execute(operation);
  const recorded=await call({command:'complete_preparation',operation_id:operation.id,result});
  return {result,recorded};
 }catch(error){
  if(operation){
   try{await call({command:'fail_preparation',operation_id:operation.id,error:error.message});}
   catch{throw Error(error.message+' Журнал результата недоступен; начало операции сохранено. Проверьте форму и журнал перед повтором.');}
  }
  throw error;
 }
}
