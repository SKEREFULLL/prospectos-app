// Planifica por fecha civil argentina. No envía mensajes ni escribe en la planilla.
const secuencias = new Map([
  ['dm_sin_respuesta', [1]],
  ['landing_sin_agendar', [1, 3]],
  ['demo_ausente', [0, 1]],
  ['demo_sin_compra', [1, 3]],
  ['prueba_iniciada', [2, 3]],
]);

const fechaLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function simularSeguimientos(evento) {
  if (evento.cancelado || !secuencias.has(evento.etapa)) return [];
  const inicio = new Date(evento.instante);
  if (!evento.id || !Number.isFinite(inicio.getTime())) throw new Error('El evento necesita un identificador y un instante válido.');
  const dia = fechaLocal.format(inicio);
  return secuencias.get(evento.etapa).map((dias) => {
    const fecha = new Date(dia + 'T12:00:00Z');
    fecha.setUTCDate(fecha.getUTCDate() + dias);
    return { id: evento.id + '/' + dias, fecha: fecha.toISOString().slice(0, 10), etapa: evento.etapa, dia: dias };
  });
}
