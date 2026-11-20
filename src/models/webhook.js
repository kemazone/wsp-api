// Webhook de Meta: registra mensajes entrantes y cambios de estado, y los reenvía a las apps suscriptas.
const R = require('../repositories');
const E = require('../entities');
const P = require('./presentar');
const config = require('../config');
const Entregas = require('./entregas');
const { eventos } = require('../meta/webhook');
const { avanza } = require('../meta/mensajes');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const numerosAvisados = new Set();

async function mensajeEntrante(ev) {
  const numero = await R.numeros.porPhoneNumberId(ev.phoneNumberId);
  if (!numero) {
    if (!numerosAvisados.has(ev.phoneNumberId)) { numerosAvisados.add(ev.phoneNumberId); console.warn(`[webhook] Llegan mensajes para el número ${ev.phoneNumberId}, que no está dado de alta en ninguna empresa: se ignoran.`); }
    return;
  }
  if (await R.mensajes.porWamid(ev.wamid, 'ENTRANTE')) return; // Meta reintenta: ya registrado
  const contacto = await R.contactos.obtenerOCrear(numero.EmpresaId, numero.id, ev.waId, ev.nombre);
  if (!contacto.ultimoEntrante || ev.fecha > contacto.ultimoEntrante) await contacto.update({ ultimoEntrante: ev.fecha });
  const m = await R.mensajes.crear({
    EmpresaId: numero.EmpresaId, NumeroId: numero.id, ContactoId: contacto.id, direccion: 'ENTRANTE', wamid: ev.wamid,
    tipo: ev.tipoMensaje, texto: ev.texto, contenido: JSON.stringify(ev.crudo), estado: 'RECIBIDO', respondeA: ev.respondeA, fechaEstado: ev.fecha,
  });
  const datos = {
    ...P.mensaje({ ...m.get({ plain: true }), Contacto: { waId: contacto.waId, nombre: contacto.nombre } }),
    numero: { id: numero.id, phoneNumberId: numero.phoneNumberId, numeroVisible: numero.numeroVisible },
    fechaWhatsapp: ev.fecha, media: ev.media, ubicacion: ev.ubicacion, respuesta: ev.respuesta, reaccion: ev.reaccion,
  };
  delete datos.contenido; datos.crudo = ev.crudo;
  await Entregas.encolar(numero.EmpresaId, 'mensaje.recibido', datos);
}

async function cambioEstado(ev) {
  let m = await R.mensajes.porWamid(ev.wamid, 'SALIENTE');
  if (!m) { await pausa(2000); m = await R.mensajes.porWamid(ev.wamid, 'SALIENTE'); } // el estado puede llegar antes de que se guarde el wamid
  if (!m) return; // mensaje enviado por fuera de esta API (por ejemplo desde el WhatsApp Manager)
  const detalle = ev.errores || ev.conversacion || ev.precio ? { errores: ev.errores, conversacion: ev.conversacion, precio: ev.precio } : null;
  await R.mensajes.agregarEstado(m.id, ev.estado, ev.fecha, detalle);
  if (avanza(m.estado, ev.estado)) {
    await m.update({ estado: ev.estado, fechaEstado: ev.fecha, ...(ev.estado === 'FALLIDO' ? { error: JSON.stringify(ev.errores || null) } : {}) });
  }
  await Entregas.encolar(m.EmpresaId, 'mensaje.estado', { mensajeId: m.id, wamid: m.wamid, referencia: m.referencia, estado: ev.estado, estadoActual: m.estado, fecha: ev.fecha, waId: ev.waId, errores: ev.errores, precio: ev.precio });
}

// Otros avisos de la cuenta (plantilla aprobada/rechazada, cambio de calidad del número…): se reenvían como meta.<campo>
async function otro(ev) {
  const nums = await E.Numero.findAll({ where: { wabaId: String(ev.wabaId) } });
  const empresas = [...new Set(nums.map((n) => n.EmpresaId))];
  if (!empresas.length) console.warn(`[webhook] Aviso de Meta '${ev.campo}' para la cuenta ${ev.wabaId}, sin números dados de alta: se ignora.`);
  for (const id of empresas) await Entregas.encolar(id, `meta.${ev.campo}`, { wabaId: ev.wabaId, valor: ev.valor });
}

async function procesar(body) {
  for (const ev of eventos(body)) {
    if (ev.tipo === 'mensaje') await mensajeEntrante(ev);
    else if (ev.tipo === 'estado') await cambioEstado(ev);
    else await otro(ev);
  }
}

// Guarda el webhook crudo y lo procesa (se llama después de responder 200 a Meta)
async function recibir(cuerpoCrudo, body) {
  const ev = await R.eventosMeta.crear(cuerpoCrudo.toString('utf8'));
  try { await procesar(body); await ev.update({ procesado: true }); }
  catch (e) { console.error('[webhook] Error al procesar un webhook de Meta:', e); await ev.update({ error: String(e.stack || e.message).slice(0, 4000) }); }
}

let ultimaLimpieza = 0;
async function limpiar() {
  if (!config.eventosDias || Date.now() - ultimaLimpieza < 6 * 3600000) return;
  ultimaLimpieza = Date.now();
  try { await R.eventosMeta.limpiar(config.eventosDias); } catch (e) { console.warn('[webhook] No se pudieron borrar los eventos viejos:', e.message); }
}

module.exports = { recibir, procesar, limpiar };
