// Envío y consulta de mensajes
const R = require('../repositories');
const P = require('./presentar');
const { armarPayload } = require('../meta/mensajes');
const { cliente, ErrorMeta } = require('../meta/cliente');
const { descifrar } = require('../seguridad/secretos');

const token = (numero) => {
  const t = descifrar(numero.accessToken);
  if (!t) throw Object.assign(new Error(`No se puede leer el Access Token del número ${numero.id} (¿cambió CLAVE_CIFRADO?). Volver a cargarlo.`), { status: 500 });
  return t;
};

// Acepta el id interno de un mensaje de esta API o directamente un wamid
async function aWamid(empresaId, ref) {
  if (ref === undefined || ref === null || ref === '') return undefined;
  if (/^\d+$/.test(String(ref))) return (await R.mensajes.obtener(empresaId, ref)).wamid;
  return String(ref);
}

async function enviar(empresaId, body) {
  const b = body || {};
  const numero = await R.numeros.elegir(empresaId, b.numero);
  if (b.tipo === 'reaccion' && b.reaccion && !b.reaccion.wamid) b.reaccion = { ...b.reaccion, wamid: await aWamid(empresaId, b.reaccion.mensajeId) };
  const { payload, tipo, texto, to } = armarPayload(b, { respondeAWamid: await aWamid(empresaId, b.respondeA) });
  const contacto = await R.contactos.obtenerOCrear(empresaId, numero.id, to);
  const m = await R.mensajes.crear({
    EmpresaId: empresaId, NumeroId: numero.id, ContactoId: contacto.id, direccion: 'SALIENTE', tipo, texto,
    contenido: JSON.stringify(payload), estado: 'PENDIENTE', referencia: b.referencia ? String(b.referencia).slice(0, 100) : null,
    respondeA: payload.context && payload.context.message_id,
  });
  try {
    const r = await cliente.enviar(numero, token(numero), payload);
    const ahora = new Date();
    await m.update({ wamid: r.wamid, estado: 'ACEPTADO', fechaEstado: ahora });
    await R.mensajes.agregarEstado(m.id, 'ACEPTADO', ahora, r.estadoMeta ? { message_status: r.estadoMeta } : null);
  } catch (e) {
    const error = e instanceof ErrorMeta ? { mensaje: e.message, codigo: e.codigo, subcodigo: e.subcodigo, detalle: e.detalle, httpMeta: e.statusMeta, fbtrace: e.fbtrace } : { mensaje: e.message };
    await m.update({ estado: 'FALLIDO', error: JSON.stringify(error), fechaEstado: new Date() });
    await R.mensajes.agregarEstado(m.id, 'FALLIDO', new Date(), error);
    if (!(e instanceof ErrorMeta)) throw Object.assign(new Error(`No se pudo enviar a Meta: ${e.message}`), { status: e.status || 502, expose: true, mensajeId: m.id });
    e.mensajeId = m.id;
    throw e;
  }
  return P.mensaje(await R.mensajes.obtener(empresaId, m.id));
}

async function listar(empresaId, q = {}) {
  const pag = P.paginacion(q);
  const f = { ...pag, numeroId: q.numero ? (await R.numeros.elegir(empresaId, q.numero)).id : undefined, waId: q.contacto, direccion: q.direccion && String(q.direccion).toUpperCase(), estado: q.estado && String(q.estado).toUpperCase(), referencia: q.referencia, desde: q.desde ? new Date(q.desde) : undefined, hasta: q.hasta ? new Date(q.hasta) : undefined };
  const { rows, count } = await R.mensajes.listar(empresaId, f);
  return { total: count, pagina: pag.pagina, limite: pag.limite, datos: rows.map((m) => { const o = P.mensaje(m); delete o.contenido; return o; }) };
}

const obtener = async (empresaId, id) => P.mensaje(await R.mensajes.obtener(empresaId, id));

// Marca como leído un mensaje recibido (el cliente ve las tildes azules)
async function marcarLeido(empresaId, id) {
  const m = await R.mensajes.obtener(empresaId, id);
  if (m.direccion !== 'ENTRANTE') throw Object.assign(new Error('Solo se pueden marcar como leídos los mensajes recibidos'), { status: 400 });
  const numero = await R.numeros.obtener(empresaId, m.NumeroId);
  await cliente.marcarLeido(numero, token(numero), m.wamid);
  return { ok: true };
}

module.exports = { enviar, listar, obtener, marcarLeido, token };
