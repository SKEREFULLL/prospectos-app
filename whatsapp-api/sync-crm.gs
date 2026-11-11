// Sincronización por lectura: el CRM consulta eventos firmados ya guardados en el Worker.
// No contiene claves; WHATSAPP_URL y WHATSAPP_BRIDGE_TOKEN viven en Propiedades del script.
// No envía mensajes, no crea prospectos y no toca Calendar.
function waTelefono_(valor) {
  var n=String(valor||'').replace(/\D/g,'');
  // Argentina: WhatsApp puede reportar 549 y la planilla guardar 54.
  if(n.indexOf('549')===0)n='54'+n.slice(3);
  return n;
}
function waDecidirEvento_(evento,filas) {
  if(evento.kind!=='incoming')return {tipo:'estado'};
  var telefono=waTelefono_(evento.phone);
  if(!telefono)return {tipo:'sin_telefono'};
  var encontrados=[];
  filas.forEach(function(r,i){if(waTelefono_(r[5])===telefono)encontrados.push(i+2);});
  if(encontrados.length!==1)return {tipo:encontrados.length?'duplicado':'sin_prospecto'};
  var fila=encontrados[0],estado=filas[fila-2][1];
  // Una respuesta no elimina una demo, un cliente ni una decisión comercial anterior.
  var cambiar=['WhatsApp enviado','DM enviado','No atendió','Volver a contactar','Videos enviados','Landing enviada'].indexOf(estado)!==-1;
  return {tipo:'respuesta',fila:fila,cambiarEstado:cambiar};
}
function sincronizarWhatsApp() {
  var lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try {
    var props=PropertiesService.getScriptProperties();
    var base=props.getProperty('WHATSAPP_URL'),token=props.getProperty('WHATSAPP_BRIDGE_TOKEN');
    if(base!=='https://prospectos-whatsapp-prueba.joacuver.workers.dev'||!token)throw new Error('Falta configurar conexión WhatsApp');
    var cursor=Number(props.getProperty('WHATSAPP_CURSOR')||0);
    var response=UrlFetchApp.fetch(base+'/api/bridge?after='+cursor,{headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});
    if(response.getResponseCode()!==200)throw new Error('No se pudo consultar WhatsApp ('+response.getResponseCode()+')');
    var data=JSON.parse(response.getContentText());
    var libro=SpreadsheetApp.getActiveSpreadsheet(),hoja=libro.getSheetByName('Prospectos');
    if(!hoja)throw new Error('No se encontró Prospectos');
    var registro=libro.getSheetByName('WhatsApp eventos');
    if(!registro){registro=libro.insertSheet('WhatsApp eventos');registro.appendRow(['Secuencia','Evento','Teléfono','Fecha','Mensaje','Resultado','Fila CRM']);}
    var ultimo=registro.getLastRow();
    var procesados=ultimo>1?registro.getRange(2,1,ultimo-1,1).getValues().map(function(r){return String(r[0]);}):[];
    for(var i=0;i<(data.events||[]).length;i++) {
      var e=data.events[i];
      if(procesados.indexOf(String(e.sequence))!==-1){cursor=e.sequence;continue;}
      var filas=hoja.getLastRow()>1?hoja.getRange(2,1,hoja.getLastRow()-1,10).getDisplayValues():[];
      var decision=waDecidirEvento_(e,filas),mensaje='';
      if(decision.tipo==='respuesta'&&decision.cambiarEstado){
        hoja.getRange(decision.fila,2).setValue('Respondió');
        // Conserva H (fecha del último contacto), I (fecha acordada) y la demo de J/K.
      }
      try{var payload=JSON.parse(e.payload);mensaje=payload.text?payload.text.body:'['+(payload.type||e.kind)+']';}catch(err){mensaje='[No se pudo interpretar]';}
      // El prefijo evita fórmulas ejecutables si el mensaje empieza por =, +, - o @.
      registro.appendRow([e.sequence,e.kind,"'"+e.phone,new Date(e.occurred_at*1000),"'"+mensaje,decision.tipo,decision.fila||'']);
      SpreadsheetApp.flush();cursor=e.sequence;procesados.push(String(e.sequence));
      props.setProperty('WHATSAPP_CURSOR',String(cursor));
    }
  } finally {lock.releaseLock();}
}
function activarSincronizacionWhatsApp() {
  // Ejecutar solo después de validar la conexión y aceptar el permiso de acceso externo.
  sincronizarWhatsApp();
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='sincronizarWhatsApp')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('sincronizarWhatsApp').timeBased().everyMinutes(5).create();
}
