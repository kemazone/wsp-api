// Reenvío de eventos a las apps suscriptas (webhooks salientes), con firma HMAC y reintentos.
// Cada envío: POST <url> con JSON { id, evento, empresaId, fecha, datos } y headers
//   X-WspApi-Evento, X-WspApi-Entrega (id, sirve para descartar duplicados), X-WspApi-Firma: sha256=<HMAC-SHA256(secreto, cuerpo)>
const R = require('../repositories');
const P = require('./presentar');
const config = require('../config');
const { descifrar, hmacSha256 } = require('../seguridad/secretos');
let version = ''; try { version = require('../../package.json').version; } catch { /* nada */ }

const ESPERAS_MIN = [0.5, 1, 5, 15, 60, 180, 360, 720]; // espera antes de cada reintento
const espera = (intentos) => ESPERAS_MIN[Math.min(intentos - 1, ESPERAS_MIN.length - 1)] * 60000;
const EVENTOS = ['mensaje.recibido', 'mensaje.estado', 'meta.*'];

// ¿La suscripción quiere este evento? Admite *, el nombre exacto y comodines por prefijo (mensaje.*)
function interesa(eventosSuscripcion, evento) {
  return String(eventosSuscripcion || '*').split(',').map((x) => x.trim()).filter(Boolean)
    .some((e) => e === '*' || e === evento || (e.endsWith('.*') && evento.startsWith(e.slice(0, -1))));
}

function firmar(secreto, cuerpo) { return 'sha256=' + hmacSha256(secreto, cuerpo); }

async function post(url, secreto, evento, entregaId, cuerpo, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(url, {
    method: 'POST', body: cuerpo, signal: AbortSignal.timeout(config.entregas.timeoutMs),
    headers: { 'Content-Type': 'application/json', 'User-Agent': `wsp-api/${version}`, 'X-WspApi-Evento': evento, 'X-WspApi-Entrega': String(entregaId), 'X-WspApi-Firma': firmar(secreto, cuerpo) },
  });
  let texto = ''; try { texto = (await r.text()).slice(0, 500); } catch { /* nada */ }
  return { ok: r.ok, status: r.status, texto };
}

let programado = null;
const pronto = () => { if (!programado) programado = setTimeout(() => { programado = null; procesarPendientes().catch((e) => console.error('[entregas]', e.message)); }, 200); };

// Encola el evento para cada suscripción activa de la empresa que lo quiera
async function encolar(empresaId, evento, datos) {
  const subs = (await R.suscripciones.activas(empresaId)).filter((s) => interesa(s.eventos, evento));
  for (const s of subs) {
    const e = await R.entregas.crear({ EmpresaId: empresaId, SuscripcionId: s.id, evento, payload: '{}', estado: 'PENDIENTE', intentos: 0, proximoIntento: new Date() });
    await e.update({ payload: JSON.stringify({ id: e.id, evento, empresaId, fecha: new Date().toISOString(), datos }) });
  }
  if (subs.length) pronto();
  return subs.length;
}

async function entregar(e) {
  const s = await R.suscripciones.porId(e.SuscripcionId);
  if (!s || !s.activa) return e.update({ estado: 'FALLIDA', ultimoError: 'Suscripción inexistente o inactiva' });
  const intentos = e.intentos + 1;
  try {
    const r = await post(s.url, descifrar(s.secreto) || '', e.evento, e.id, e.payload);
    if (r.ok) return e.update({ estado: 'ENTREGADA', intentos, codigoHttp: r.status, ultimoError: null, proximoIntento: null });
    return fallo(e, intentos, `HTTP ${r.status}: ${r.texto}`, r.status);
  } catch (err) { return fallo(e, intentos, err.name === 'TimeoutError' ? 'Sin respuesta (tiempo agotado)' : err.message, null); }
}

function fallo(e, intentos, msg, status) {
  const agotado = intentos >= config.entregas.maxIntentos;
  if (agotado) console.warn(`[entregas] Entrega ${e.id} (${e.evento}) FALLIDA después de ${intentos} intentos: ${msg}`);
  return e.update({ intentos, ultimoError: msg, codigoHttp: status, estado: agotado ? 'FALLIDA' : 'PENDIENTE', proximoIntento: agotado ? null : new Date(Date.now() + espera(intentos)) });
}

let corriendo = false;
async function procesarPendientes() {
  if (corriendo) return; corriendo = true;
  try {
    for (;;) {
      const lote = await R.entregas.pendientes(20);
      if (!lote.length) break;
      await Promise.all(lote.map(entregar));
      if (lote.length < 20) break;
    }
  } finally { corriendo = false; }
}

function iniciar() {
  const s = config.entregas.intervaloS;
  if (!s) return console.log('Reenvío de eventos: reintentos automáticos desactivados (ENTREGAS_INTERVALO_S=0)');
  setInterval(() => procesarPendientes().catch((e) => console.error('[entregas]', e.message)), s * 1000).unref();
  pronto();
}

// API para las apps cliente
const listar = async (empresaId, q = {}) => {
  const pag = P.paginacion(q);
  const { rows, count } = await R.entregas.listar(empresaId, { ...pag, estado: q.estado && String(q.estado).toUpperCase() });
  return { total: count, pagina: pag.pagina, limite: pag.limite, datos: rows.map(P.entrega) };
};
async function reintentar(empresaId, id) {
  const e = await R.entregas.obtener(empresaId, id);
  await e.update({ estado: 'PENDIENTE', intentos: 0, proximoIntento: new Date(), ultimoError: null });
  await entregar(e);
  return P.entrega(e);
}
// Envía un evento "ping" en el momento (sin encolar) para probar la URL y la validación de la firma
async function probar(empresaId, suscripcionId) {
  const s = await R.suscripciones.obtener(empresaId, suscripcionId);
  const cuerpo = JSON.stringify({ id: 0, evento: 'ping', empresaId, fecha: new Date().toISOString(), datos: { mensaje: 'Prueba de wsp-api' } });
  try { return await post(s.url, descifrar(s.secreto) || '', 'ping', 0, cuerpo); } catch (e) { return { ok: false, status: null, texto: e.message }; }
}

module.exports = { encolar, procesarPendientes, iniciar, listar, reintentar, probar, interesa, firmar, espera, EVENTOS };
