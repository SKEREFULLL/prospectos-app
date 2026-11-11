# WhatsApp CRM: estado de integración de prueba

## Publicado y comprobado

- Worker: https://prospectos-whatsapp-prueba.joacuver.workers.dev/
- D1: prospectos-whatsapp-prueba, ID 91b4f61d-e9a0-4fe4-a420-d51111333b21. Tablas contacts/events/drafts creadas y binding DB conectado.
- Panel autenticado responde: «Modo prueba · Envíos desactivados».
- META_ACCESS_TOKEN generado en Meta y almacenado cifrado en Cloudflare, junto con ADMIN_TOKEN, VERIFY_TOKEN y BRIDGE_TOKEN. Ningún secreto está en Git.
- Publicación manual del bundle dashboard-worker.mjs. worker.mjs + public/index.html son las fuentes; mantener sincronizados los dos formatos.
- El token de Meta se obtuvo desde el panel de pruebas; no se afirma que sea una credencial permanente apta para producción.

## Meta

App Prospectos CRM 2576987516121438; porfolio Joaquin Software 2922559054767759.
Número de prueba +1 (555) 194-0430; Phone Number ID 1475247372330489; WABA 1509958214302961.

META_APP_SECRET guardado cifrado en Cloudflare después de que el propietario ingresó su contraseña. Webhook /webhook verificado y campo messages suscrito. El test genérico del panel usa phone_number_id 123456123 y queda fuera del filtro del emisor de prueba; no se toma como evidencia de importación de mensajes reales.
La página de Meta advierte que mientras la app no esté publicada solo entrega los webhooks de prueba del panel. No publicar la app ni registrar un teléfono comercial sin autorización.

## Google Apps Script

Proyecto vinculado a Prospectos amoblamientos en joacuver@gmail.com, script 1H0tmktk26-vYJhZPvfktH7nBqHHSFrudh7BShhWZsg9IAeZsWgFRPs5w.
Añadido y guardado WhatsAppSync.gs (sync-crm.gs). Código.gs existente conservado; no se desplegó otra versión del doGet.
Propiedades WHATSAPP_URL y WHATSAPP_BRIDGE_TOKEN configuradas. El token solo permite leer /api/bridge; no permite aprobar mensajes.

El propietario completó la autorización de Google. sincronizarWhatsApp se ejecutó manualmente y terminó sin errores. Se creó por UI un trigger de sincronizarWhatsApp, Principal, temporizador por minutos, cada 5 minutos. Se verificó su existencia junto al avisoDiario previo; no se duplicó ni alteró ese aviso. Falta confirmar el primer evento de WhatsApp real en la planilla.

No hay destinatarios de prueba cargados en Meta. Próximo dato requerido: número elegido por el propietario (excluir personal protegido). Añadir destinatario necesita verificación; pedir aprobación antes de cualquier código o mensaje de prueba. No se ha vinculado ni migrado teléfono comercial.

La sincronización conserva Demo/Cliente/No interesa; una respuesta pasa los estados de prospección a Respondió. Si el teléfono no existe o hay duplicados, solo registra el evento para revisar. No crea contactos, no borra demos y no envía mensajes. No clasifica semánticamente respuestas automáticas de empresas: cualquier entrante pausa revisión.

## Restricciones y garantías del servidor

- Solo emisor de prueba fijo y destinatarios expresamente añadidos a TEST_RECIPIENTS. Por defecto lista vacía y SENDS_ENABLED=false.
- Número personal protegido: no registrar, migrar ni usar. Comercial: requiere aprobación previa. Cada envío requiere aprobación exacta.
- GET /webhook challenge; POST firmado HMAC SHA-256 sobre cuerpo original, filtro WABA/emisor, IDs únicos.
- Borradores inmutables; aprobación expira a 30 minutos. Respuesta nueva cancela el borrador incluso si tiene el mismo timestamp que la anterior.
- SQL condicional evita doble envío concurrente. Resultado incierto no se reintenta. Fuera de ventana de 24 h: solo plantilla aprobada.
- Ventana inevitable entre reclamo SQL y envío a Meta: una respuesta que llegue en ese intervalo no puede retirar un envío ya iniciado.
- No hay mensajes reales enviados ni destinatarios de prueba configurados. Falta prueba real de envío/entrega/respuesta con aprobación individual.

## Validación

node --test whatsapp-api/worker.test.mjs whatsapp-api/sync-crm.test.mjs

16 pruebas locales: SQLite real + red simulada; reglas de sincronización en entorno simulado. Panel real autenticado y DB conectada comprobados en Chrome. Todavía no se verificó el recorrido Meta -> Worker -> planilla.
