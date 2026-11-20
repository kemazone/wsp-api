// Media (archivos), plantillas, contactos, números y suscripciones, vistos por una app cliente (API key)
const crypto = require('crypto');
const R = require('../repositories');
const P = require('./presentar');
const { cliente } = require('../meta/cliente');
const { cifrar } = require('../seguridad/secretos');
const { token } = require('./mensajes');
const { EVENTOS } = require('./entregas');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---- media
const LIMITES_MB = { image: 5, audio: 16, video: 16, application: 100, text: 100 };
async function subirMedia(empresaId, { buffer, tipo, nombre, numero }) {
  if (!buffer || !buffer.length) throw err('Falta el archivo (enviarlo como cuerpo del pedido, con su Content-Type)');
  if (!tipo || tipo === 'application/octet-stream') throw err('Indicar el Content-Type real del archivo (image/jpeg, application/pdf, audio/ogg…)');
  const max = LIMITES_MB[tipo.split('/')[0]] || 100;
  if (buffer.length > max * 1048576) throw err(`El archivo supera los ${max} MB que admite WhatsApp para ${tipo}`, 413);
  const n = await R.numeros.elegir(empresaId, numero);
  const r = await cliente.subirMedia(n, token(n), { buffer, tipo, nombre });
  return { id: r.id, numeroId: n.id, tipo, bytes: buffer.length };
}
async function descargarMedia(empresaId, mediaId, numero) {
  const n = await R.numeros.elegir(empresaId, numero);
  const t = token(n);
  const info = await cliente.infoMedia(t, mediaId);
  const archivo = await cliente.descargarMedia(t, info.url);
  return { buffer: archivo.buffer, tipo: info.mime_type || archivo.tipo, bytes: info.file_size, sha256: info.sha256 };
}

// ---- plantillas
async function plantillas(empresaId, q = {}) {
  const n = await R.numeros.elegir(empresaId, q.numero);
  const r = await cliente.plantillas(n, token(n), { limite: Math.min(Number(q.limite) || 100, 250), despues: q.despues });
  return {
    datos: (r.data || []).map((p) => ({ id: p.id, nombre: p.name, idioma: p.language, estado: p.status, categoria: p.category, componentes: p.components })),
    siguiente: r.paging && r.paging.next && r.paging.cursors ? r.paging.cursors.after : null,
  };
}

// ---- números y contactos
const numeros = async (empresaId) => (await R.numeros.listar(empresaId)).filter((n) => n.activo).map((n) => { const o = P.numero(n); delete o.tokenCargado; return o; });
async function contactos(empresaId, q = {}) {
  const pag = P.paginacion(q);
  const numeroId = q.numero ? (await R.numeros.elegir(empresaId, q.numero)).id : undefined;
  const { rows, count } = await R.contactos.listar(empresaId, { ...pag, numeroId, buscar: q.buscar });
  return { total: count, pagina: pag.pagina, limite: pag.limite, datos: rows.map((c) => P.contacto(c)) };
}

// ---- suscripciones (webhooks hacia la app cliente)
function validarUrl(u) {
  let x; try { x = new URL(String(u)); } catch { throw err('url inválida'); }
  if (!['http:', 'https:'].includes(x.protocol)) throw err('La url debe ser http o https');
  return x.toString();
}
function validarEventos(ev) {
  const lista = Array.isArray(ev) ? ev : String(ev || '*').split(',');
  const limpios = lista.map((x) => String(x).trim()).filter(Boolean);
  for (const e of limpios) if (e !== '*' && !EVENTOS.includes(e) && !/^mensaje\.\*$/.test(e) && !/^meta\.[\w.*]+$/.test(e)) throw err(`Evento desconocido: '${e}'. Disponibles: *, ${EVENTOS.join(', ')}`);
  return (limpios.length ? limpios : ['*']).join(',');
}
const listarSuscripciones = async (empresaId) => (await R.suscripciones.listar(empresaId)).map(P.suscripcion);
async function crearSuscripcion(empresaId, b = {}) {
  const secreto = b.secreto ? String(b.secreto) : crypto.randomBytes(24).toString('base64url');
  const s = await R.suscripciones.crear({ EmpresaId: empresaId, url: validarUrl(b.url), eventos: validarEventos(b.eventos), descripcion: b.descripcion ? String(b.descripcion).slice(0, 200) : null, secreto: cifrar(secreto) });
  return { ...P.suscripcion(s), secreto, aviso: 'Guardá el secreto: con él se valida la firma X-WspApi-Firma de cada evento. No se vuelve a mostrar.' };
}
async function actualizarSuscripcion(empresaId, id, b = {}) {
  const s = await R.suscripciones.obtener(empresaId, id);
  const c = {};
  if (b.url) c.url = validarUrl(b.url);
  if (b.eventos) c.eventos = validarEventos(b.eventos);
  if (b.descripcion !== undefined) c.descripcion = b.descripcion ? String(b.descripcion).slice(0, 200) : null;
  if (typeof b.activa === 'boolean') c.activa = b.activa;
  await s.update(c);
  return P.suscripcion(s);
}
// Se desactiva (no se borra: conserva el historial de entregas)
async function eliminarSuscripcion(empresaId, id) { const s = await R.suscripciones.obtener(empresaId, id); await s.update({ activa: false }); return { ok: true }; }

module.exports = { subirMedia, descargarMedia, plantillas, numeros, contactos, listarSuscripciones, crearSuscripcion, actualizarSuscripcion, eliminarSuscripcion, validarEventos, validarUrl };
