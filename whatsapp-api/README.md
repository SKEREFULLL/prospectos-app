# WhatsApp CRM: integración aislada de prueba

Estado 2026-11-10: Worker y D1 publicados y conectados. Salud y panel comprobados en navegador. **Faltan secretos, webhook de Meta y sincronización con planilla; no hubo envíos.**

Servidor: https://prospectos-whatsapp-prueba.joacuver.workers.dev
D1: 91b4f61d-e9a0-4fe4-a420-d51111333b21
Publicación manual desde Cloudflare: dashboard-worker.mjs incluye el panel para funcionar sin assets separados.

Próximo paso: autorización del propietario para generar token de acceso Meta de esta app y almacenar token/secreto de app como secretos del Worker de prueba, junto a VERIFY_TOKEN/ADMIN_TOKEN. No se han generado.

## Estado de las cuentas comprobado en Meta

- Aplicación Prospectos CRM: 2576987516121438.
- Porfolio Joaquin Software: 2922559054767759.
- Número de prueba: +1 (555) 194-0430.
- Phone Number ID: 1475247372330489.
- WABA: 1509958214302961.
- No se generó token durante esta intervención. Webhook vacío.
- Chrome tiene Meta conectado; Cloudflare presenta inicio de sesión.

## Restricciones

El número personal del propietario no se registra, migra ni utiliza. El teléfono comercial necesita aprobación previa antes de vincularlo o migrarlo. Cada envío necesita aprobación explícita. Este servidor solo permite el emisor de prueba indicado arriba y destinatarios incluidos deliberadamente en TEST_RECIPIENTS. No hay cron ni envío automático.

## Qué hace

- GET /webhook verifica el challenge; POST exige firma HMAC SHA-256 y filtra WABA y emisor.
- Guarda mensajes entrantes y eventos de entrega una sola vez en D1.
- Al recibir una respuesta, marca el contacto pausado y cancela borradores anteriores. Usa una versión por evento, incluso para dos respuestas en el mismo segundo.
- API administrativa con Bearer token. Borradores inmutables con destinatario y contenido visibles. Aprobación válida 30 minutos; nueva respuesta obliga a revisarlos. Textos libres requieren último mensaje recibido en 24 horas.
- Reclamo SQL condicional: una aprobación concurrente no puede enviar dos veces. Si Meta no confirma el resultado, queda 'unknown' y no reintenta.
- Panel de prueba en / con revisión individual. No guarda la clave de administración en almacenamiento del navegador.

## Publicación pendiente

1. Iniciar sesión en la cuenta Cloudflare que ya usa el propietario.
2. Crear Worker y D1 **nuevos e independientes** del presupuestador. Usar nombre prospectos-whatsapp-prueba.
3. Aplicar schema.sql; sustituir database_id del wrangler.jsonc por el ID real.
4. Configurar secretos: META_APP_SECRET, META_ACCESS_TOKEN, VERIFY_TOKEN y ADMIN_TOKEN. Nunca guardarlos en Git, páginas públicas ni capturas.
5. Mantener SENDS_ENABLED=false y TEST_RECIPIENTS vacío hasta acordar el destinatario de prueba. No usar el número personal protegido.
6. Publicar. Registrar URL https://<worker>/webhook y el mismo VERIFY_TOKEN en Meta; suscribir campo messages. Validar eventos de prueba antes de publicar la app de Meta o usar producción.
7. Habilitar un destinatario de prueba con permiso del propietario. Preparar borrador; pedir aprobación exacta y enviar una vez. Comprobar entrega y respuesta real.
8. Conectar eventos con Google Apps Script: resolver contacto por teléfono sin duplicarlo, mantener Cliente/No interesa, registrar cada evento y pausar seguimientos. Fuente de Apps Script aún no inspeccionada; no declarar sincronización lista.
9. Solo después, decidir integración del número comercial y publicación Meta. Requiere aprobación del propietario y las verificaciones que Meta muestre.

## Límite de concurrencia

Una respuesta recibida antes del reclamo SQL bloquea el envío. Existe una ventana inevitable entre ese reclamo y la recepción en Meta; una respuesta en ese intervalo no puede retirar una solicitud ya enviada. No se promete orden global entre los dos servicios.

## Verificación

Desde la raíz del repositorio: node --test whatsapp-api/worker.test.mjs
Pruebas con SQLite real y proveedor de red simulado, sin enviar mensajes ni usar credenciales. No sustituyen la validación del Worker/D1 publicado ni las pruebas reales Meta.
