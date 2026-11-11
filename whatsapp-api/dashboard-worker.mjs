const enc = new TextEncoder();
const json = (data, status=200) => Response.json(data, {status,headers:{'Cache-Control':'no-store'}});
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
export async function signatureOK(secret, raw, signature) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature||'')) return false;
  const key = await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g), h=>parseInt(h,16));
  return crypto.subtle.verify('HMAC',key,bytes,enc.encode(raw));
}
export function draftPayload(body) {
  const to=String(body.to||'').replace(/[+\s()-]/g,'');
  if(!/^\d{8,15}$/.test(to)) throw new Error('Número inválido');
  if(body.type==='text' && typeof body.text==='string' && body.text.trim() && body.text.length<=4096)
    return {messaging_product:'whatsapp',to,type:'text',text:{body:body.text}};
  if(body.type==='template' && /^[a-z0-9_]+$/.test(body.template?.name||'') && /^[a-z]{2}(?:_[A-Z]{2})?$/.test(body.template?.language?.code||'')) {
    const template={name:body.template.name,language:{code:body.template.language.code}};
    if(body.template.components) {
      if(!Array.isArray(body.template.components)||body.template.components.length!==1) throw new Error('Plantilla inválida');
      const c=body.template.components[0];
      if(c.type!=='body'||!Array.isArray(c.parameters)||c.parameters.length>10||c.parameters.some(p=>p.type!=='text'||typeof p.text!=='string'||p.text.length>1024)) throw new Error('Parámetros inválidos');
      template.components=[{type:'body',parameters:c.parameters.map(p=>({type:'text',text:p.text}))}];
    }
    return {messaging_product:'whatsapp',to,type:'template',template};
  }
  throw new Error('Mensaje inválido');
}
function allowed(env,to) {return (env.TEST_RECIPIENTS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(to);}
async function webhook(request,env) {
  const url=new URL(request.url);
  if(request.method==='GET') {
    const valid=env.VERIFY_TOKEN && url.searchParams.get('hub.mode')==='subscribe' && url.searchParams.get('hub.verify_token')===env.VERIFY_TOKEN;
    return new Response(valid?url.searchParams.get('hub.challenge')||'':'Forbidden',{status:valid?200:403});
  }
  if(request.method!=='POST') return json({error:'Método inválido'},405);
  const raw=await request.text();
  if(raw.length>262144) return json({error:'Demasiado grande'},413);
  if(!await signatureOK(env.META_APP_SECRET,raw,request.headers.get('x-hub-signature-256'))) return json({error:'Firma inválida'},401);
  let payload;try{payload=JSON.parse(raw);}catch{return json({error:'JSON inválido'},400);}
  if(payload.object!=='whatsapp_business_account') return json({error:'Objeto inválido'},400);
  const statements=[];
  for(const entry of payload.entry||[]) for(const change of entry.changes||[]) {
    const value=change.value||{};
    if(String(entry.id)!==env.WABA_ID||value.metadata?.phone_number_id!==env.PHONE_NUMBER_ID||change.field!=='messages') continue;
    for(const message of value.messages||[]) {
      if(!message.id||!/^\d{8,15}$/.test(message.from||'')) continue;
      const time=Number(message.timestamp);if(!Number.isFinite(time)||time<=0) continue;
      statements.push(stmt(env.DB,'INSERT OR IGNORE INTO events (event_key,kind,phone,wa_id,payload,occurred_at) VALUES (?,?,?,?,?,?)','in:'+message.id,'incoming',message.from,message.id,JSON.stringify(message),time));
      statements.push(stmt(env.DB,`INSERT INTO contacts (phone,last_inbound,inbound_version,paused) VALUES (?,?,(SELECT MAX(sequence) FROM events WHERE kind='incoming' AND phone=?),1)
        ON CONFLICT(phone) DO UPDATE SET last_inbound=MAX(last_inbound,excluded.last_inbound),inbound_version=MAX(inbound_version,excluded.inbound_version),paused=1`,message.from,time,message.from));
      // Replayed old messages do not invalidate drafts created after that message was already recorded.
      statements.push(stmt(env.DB,"UPDATE drafts SET state='cancelled_reply' WHERE phone=? AND state='pending' AND inbound_version<(SELECT inbound_version FROM contacts WHERE phone=?)",message.from,message.from));
    }
    for(const status of value.statuses||[]) {
      if(!status.id||!['sent','delivered','read','failed'].includes(status.status)) continue;
      const time=Number(status.timestamp);if(!Number.isFinite(time)||time<=0)continue;
      statements.push(stmt(env.DB,'INSERT OR IGNORE INTO events (event_key,kind,phone,wa_id,payload,occurred_at) VALUES (?,?,?,?,?,?)',`status:${status.id}:${status.status}:${time}`,status.status,status.recipient_id||'',status.id,JSON.stringify(status),time));
    }
  }
  if(statements.length) await env.DB.batch(statements);
  return json({ok:true});
}
async function api(request,env,fetchMeta) {
  const target=new URL(request.url);
  if(target.pathname==='/api/bridge' && request.method==='GET') {
    if(!env.BRIDGE_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.BRIDGE_TOKEN}`) return json({error:'No autorizado'},401);
    const raw=target.searchParams.get('after')||'0';
    if(!/^\d{1,15}$/.test(raw))return json({error:'Cursor inválido'},400);
    const rows=await stmt(env.DB,'SELECT * FROM events WHERE sequence>? ORDER BY sequence ASC LIMIT 100',Number(raw)).all();
    return json({events:rows.results,next_cursor:rows.results.at(-1)?.sequence||Number(raw)});
  }

  if(!env.ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.ADMIN_TOKEN}`) return json({error:'No autorizado'},401);
  const url=new URL(request.url), now=Math.floor(Date.now()/1000);
  if(url.pathname==='/api/state'&&request.method==='GET') {
    const [events,drafts,contacts]=await Promise.all([
      stmt(env.DB,'SELECT * FROM events ORDER BY sequence DESC LIMIT 100').all(),
      stmt(env.DB,'SELECT * FROM drafts ORDER BY created_at DESC LIMIT 100').all(),
      stmt(env.DB,'SELECT * FROM contacts ORDER BY last_inbound DESC LIMIT 100').all()]);
    return json({mode:'test',sends_enabled:env.SENDS_ENABLED==='true',phone_number_id:env.PHONE_NUMBER_ID,events:events.results,drafts:drafts.results,contacts:contacts.results});
  }
  if(request.method!=='POST') return json({error:'No encontrado'},404);
  let body;try{body=await request.json();}catch{return json({error:'JSON inválido'},400);}
  if(url.pathname==='/api/drafts') {
    let payload;try{payload=draftPayload(body);}catch(e){return json({error:e.message},400);}
    if(!allowed(env,payload.to)) return json({error:'Destinatario fuera de la lista de pruebas'},403);
    const contact=await stmt(env.DB,'SELECT * FROM contacts WHERE phone=?',payload.to).first();
    if(payload.type==='text'&&(!contact||contact.last_inbound<now-86400)) return json({error:'Fuera de la ventana de 24 horas: usá una plantilla aprobada'},409);
    const id=crypto.randomUUID();
    await stmt(env.DB,'INSERT INTO drafts (id,phone,payload,state,created_at,inbound_version) VALUES (?,?,?,?,?,?)',id,payload.to,JSON.stringify(payload),'pending',now,contact?.inbound_version||0).run();
    return json({id,payload,state:'pending'},201);
  }
  const match=url.pathname.match(/^\/api\/drafts\/([a-f0-9-]+)\/(approve|cancel)$/);
  if(!match) return json({error:'No encontrado'},404);
  const id=match[1];
  if(match[2]==='cancel') {await stmt(env.DB,"UPDATE drafts SET state='cancelled' WHERE id=? AND state='pending'",id).run();return json({ok:true});}
  if(body.confirm!==id) return json({error:'Confirmá el borrador exacto'},400);
  if(env.SENDS_ENABLED!=='true'||env.PHONE_NUMBER_ID!=='1475247372330489') return json({error:'Envíos desactivados o número fuera de pruebas'},403);
  if(!env.META_ACCESS_TOKEN) return json({error:'Falta token de Meta'},503);
  const draft=await stmt(env.DB,'SELECT * FROM drafts WHERE id=?',id).first();
  if(!draft) return json({error:'No encontrado'},404);
  if(!allowed(env,draft.phone)) return json({error:'Destinatario ya no permitido'},403);
  const payload=JSON.parse(draft.payload);
  // Conditional claim prevents double-clicks and approvals of stale drafts. No automatic retry after sending.
  const claimed=await stmt(env.DB,`UPDATE drafts SET state='sending' WHERE id=? AND state='pending' AND created_at>=?
    AND inbound_version=COALESCE((SELECT inbound_version FROM contacts WHERE phone=drafts.phone),0)
    AND (? != 'text' OR COALESCE((SELECT last_inbound FROM contacts WHERE phone=drafts.phone),0)>=?) RETURNING id`,id,now-1800,payload.type,now-86400).first();
  if(!claimed) return json({error:'Borrador vencido, ya procesado o hubo una respuesta: revisá el chat'},409);
  try {
    const result=await fetchMeta(`https://graph.facebook.com/v25.0/${env.PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${env.META_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:draft.payload,signal:AbortSignal.timeout(20000)});
    const data=await result.json();
    if(!result.ok) {
      await stmt(env.DB,"UPDATE drafts SET state='rejected',error=? WHERE id=?",JSON.stringify({code:data.error?.code,subcode:data.error?.error_subcode}),id).run();
      return json({error:'Meta rechazó el envío',code:data.error?.code},502);
    }
    if(!data.messages?.[0]?.id) throw new Error('Respuesta sin identificador');
    await stmt(env.DB,"UPDATE drafts SET state='sent',wa_id=? WHERE id=?",data.messages[0].id,id).run();
    return json({ok:true,wa_id:data.messages[0].id});
  }catch {
    await stmt(env.DB,"UPDATE drafts SET state='unknown',error='Verificar en Meta antes de repetir' WHERE id=? AND state='sending'",id).run();
    return json({error:'Resultado incierto: verificá Meta. No se reintenta automáticamente'},502);
  }
}
export async function handle(request,env,fetchMeta=fetch) {
  try {
    const path=new URL(request.url).pathname;
    if(path==='/health') return json({ok:true,mode:'test'});
    if(path==='/webhook') return await webhook(request,env);
    if(path.startsWith('/api/')) return await api(request,env,fetchMeta);
    if(path==='/'&&env.ASSETS) return env.ASSETS.fetch(request);
    return json({error:'No encontrado'},404);
  }catch{return json({error:'Error interno: no se completó la operación'},500);}
}
const PANEL = "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>WhatsApp · Pruebas CRM</title>\n<style>body{font:16px system-ui;max-width:760px;margin:32px auto;padding:0 16px;background:#101418;color:#eee}input,textarea,button,select{font:inherit;padding:10px;margin:5px 0;max-width:100%;box-sizing:border-box}input,textarea{width:100%}textarea{min-height:110px}article{border:1px solid #566;padding:16px;margin:16px 0;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{cursor:pointer}#status{color:#9ed4ff}</style>\n<h1>WhatsApp · Pruebas CRM</h1><p>Solo número de prueba. Cada envío requiere revisar y aprobar su destinatario y contenido.</p>\n<label>Clave de administración<input id=\"token\" type=\"password\" autocomplete=\"off\"></label><button id=\"load\">Conectar / Actualizar</button><p id=\"status\" role=\"status\"></p>\n<form id=\"draft\"><h2>Preparar mensaje</h2><label>Destinatario internacional<input id=\"to\" placeholder=\"Solo un destinatario autorizado para pruebas\" required></label>\n<label>Tipo<select id=\"type\"><option value=\"text\">Texto (requiere mensaje recibido en las últimas 24 horas)</option><option value=\"template\">Plantilla aprobada</option></select></label>\n<label>Texto o JSON de plantilla<textarea id=\"message\" required></textarea></label><button>Guardar borrador, sin enviar</button></form>\n<h2>Borradores</h2><div id=\"drafts\"></div><h2>Eventos recibidos</h2><div id=\"events\"></div>\n<script type=\"module\">\nconst $=id=>document.getElementById(id);const status=text=>$('status').textContent=text;\nasync function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+$('token').value,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}\nfunction pre(value){const p=document.createElement('pre');p.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);return p;}\nasync function load(){try{const s=await api('/api/state');status('Modo prueba · '+(s.sends_enabled?'Envíos habilitados con aprobación':'Envíos desactivados'));$('drafts').replaceChildren();$('events').replaceChildren();for(const d of s.drafts){const card=document.createElement('article');card.append(pre({destinatario:d.phone,estado:d.state,mensaje:JSON.parse(d.payload),id:d.id}));if(d.state==='pending'){const b=document.createElement('button');b.textContent='Revisar y aprobar este envío';b.onclick=async()=>{if(!confirm('Se enviará por WhatsApp al '+d.phone+' exactamente este contenido:\\n'+d.payload))return;b.disabled=true;try{await api('/api/drafts/'+d.id+'/approve',{confirm:d.id});await load();}catch(e){status(e.message);}};card.append(b);const cancel=document.createElement('button');cancel.textContent='Descartar';cancel.onclick=async()=>{try{await api('/api/drafts/'+d.id+'/cancel',{});await load();}catch(e){status(e.message);}};card.append(cancel);}$('drafts').append(card);}for(const e of s.events){const card=document.createElement('article');card.append(pre({evento:e.kind,telefono:e.phone,datos:JSON.parse(e.payload)}));$('events').append(card);}}catch(e){status(e.message);}}\n$('load').onclick=load;$('draft').onsubmit=async e=>{e.preventDefault();try{const type=$('type').value;const body={to:$('to').value,type,...(type==='text'?{text:$('message').value}:{template:JSON.parse($('message').value)})};await api('/api/drafts',body);await load();}catch(e){status(e.message);}};\n</script></html>\n";
export default {fetch(request,env) {
 if(new URL(request.url).pathname==='/') return new Response(PANEL,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
 return handle(request,{WABA_ID:'1509958214302961',PHONE_NUMBER_ID:'1475247372330489',SENDS_ENABLED:'false',TEST_RECIPIENTS:'',...env});
}};

