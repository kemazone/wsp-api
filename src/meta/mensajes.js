// Traducción entre el formato de esta API (en castellano) y el de la Cloud API de Meta. Funciones puras (sin base ni red).
const err = (msg) => Object.assign(new Error(msg), { status: 400 });

// Número de destino: solo dígitos, con código de país (ej. 5491123456789). Acepta +, espacios, guiones, paréntesis y 00 inicial.
function normalizarNumero(n) {
  let d = String(n || '').replace(/[\s\-().+]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!/^\d{8,15}$/.test(d)) throw err(`Número de destino inválido: '${n}'. Usar el formato internacional, por ejemplo 5491123456789`);
  return d;
}

const TIPOS_MEDIA = { imagen: 'image', documento: 'document', audio: 'audio', video: 'video', sticker: 'sticker' };
const TIPOS = ['texto', 'plantilla', 'ubicacion', 'interactivo', 'reaccion', ...Object.keys(TIPOS_MEDIA)];

// Plantilla: acepta los componentes en formato Meta, o atajos: parametros (cuerpo), encabezado (texto o media) y botones (url dinámicas / payload)
function componentesPlantilla(p) {
  if (Array.isArray(p.componentes)) return p.componentes;
  const c = [];
  if (p.encabezado) {
    const h = p.encabezado;
    let param;
    if (typeof h === 'string') param = { type: 'text', text: h };
    else {
      const t = TIPOS_MEDIA[h.tipo] || h.tipo;
      if (!['image', 'document', 'video'].includes(t)) throw err("plantilla.encabezado.tipo debe ser 'imagen', 'documento' o 'video'");
      param = { type: t, [t]: { ...(h.id ? { id: h.id } : { link: h.url }), ...(t === 'document' && h.nombreArchivo ? { filename: h.nombreArchivo } : {}) } };
    }
    c.push({ type: 'header', parameters: [param] });
  }
  if (Array.isArray(p.parametros) && p.parametros.length) {
    c.push({ type: 'body', parameters: p.parametros.map((v) => (v && typeof v === 'object' ? v : { type: 'text', text: String(v ?? '') })) });
  }
  (p.botones || []).forEach((b, i) => {
    const index = String(b.indice ?? i);
    if (b.url !== undefined) c.push({ type: 'button', sub_type: 'url', index, parameters: [{ type: 'text', text: String(b.url) }] });
    else if (b.payload !== undefined) c.push({ type: 'button', sub_type: 'quick_reply', index, parameters: [{ type: 'payload', payload: String(b.payload) }] });
  });
  return c;
}

// Arma el cuerpo para POST /{phone-number-id}/messages a partir del pedido de la app cliente.
// Devuelve { payload, tipo, texto } (texto: versión legible para guardar).
function armarPayload(m, { respondeAWamid } = {}) {
  if (!m || typeof m !== 'object') throw err('Falta el cuerpo del mensaje');
  const to = normalizarNumero(m.para);
  const tipo = m.tipo || (m.plantilla ? 'plantilla' : m.texto !== undefined ? 'texto' : null);
  if (!TIPOS.includes(tipo)) throw err(`tipo inválido: '${m.tipo}'. Valores: ${TIPOS.join(', ')}`);
  const p = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (respondeAWamid) p.context = { message_id: respondeAWamid };
  let texto = null;

  if (tipo === 'texto') {
    const body = String(m.texto ?? '').trim();
    if (!body) throw err('Falta texto');
    if (body.length > 4096) throw err('El texto supera los 4096 caracteres que permite WhatsApp');
    Object.assign(p, { type: 'text', text: { body, preview_url: !!m.vistaPrevia } });
    texto = body;
  } else if (tipo === 'plantilla') {
    const pl = m.plantilla || {};
    if (!pl.nombre) throw err('Falta plantilla.nombre');
    const components = componentesPlantilla(pl);
    Object.assign(p, { type: 'template', template: { name: pl.nombre, language: { code: pl.idioma || 'es_AR' }, ...(components.length ? { components } : {}) } });
    texto = `[plantilla ${pl.nombre}]${Array.isArray(pl.parametros) && pl.parametros.length ? ' ' + pl.parametros.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(' | ') : ''}`;
  } else if (TIPOS_MEDIA[tipo]) {
    const t = TIPOS_MEDIA[tipo], md = m.media || {};
    if (!md.id && !md.url) throw err('media necesita id (subido con POST /api/v1/media) o url pública');
    const o = md.id ? { id: String(md.id) } : { link: md.url };
    if (md.pie && ['image', 'video', 'document'].includes(t)) o.caption = String(md.pie);
    if (md.nombreArchivo && t === 'document') o.filename = String(md.nombreArchivo);
    Object.assign(p, { type: t, [t]: o });
    texto = md.pie || `[${tipo}]`;
  } else if (tipo === 'ubicacion') {
    const u = m.ubicacion || {};
    if (!Number.isFinite(Number(u.latitud)) || !Number.isFinite(Number(u.longitud))) throw err('ubicacion necesita latitud y longitud');
    Object.assign(p, { type: 'location', location: { latitude: Number(u.latitud), longitude: Number(u.longitud), ...(u.nombre ? { name: u.nombre } : {}), ...(u.direccion ? { address: u.direccion } : {}) } });
    texto = u.nombre || u.direccion || `[ubicación ${u.latitud},${u.longitud}]`;
  } else if (tipo === 'interactivo') {
    // Formato Meta tal cual (botones de respuesta, listas, CTA url, flows…): https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-messages
    if (!m.interactivo || typeof m.interactivo !== 'object' || !m.interactivo.type) throw err('interactivo debe ser el objeto "interactive" de Meta (con type)');
    Object.assign(p, { type: 'interactive', interactive: m.interactivo });
    texto = (m.interactivo.body && m.interactivo.body.text) || `[interactivo ${m.interactivo.type}]`;
  } else if (tipo === 'reaccion') {
    const r = m.reaccion || {};
    if (!r.wamid) throw err('reaccion necesita wamid (o mensajeId) del mensaje al que se reacciona');
    Object.assign(p, { type: 'reaction', reaction: { message_id: r.wamid, emoji: r.emoji || '' } });
    delete p.context;
    texto = r.emoji ? `[reacción ${r.emoji}]` : '[quita reacción]';
  }
  return { payload: p, tipo, texto, to };
}

// Estados: Meta puede informarlos fuera de orden (leído antes que entregado). Solo se avanza; FALLIDO siempre se registra.
const ESTADOS_META = { sent: 'ENVIADO', delivered: 'ENTREGADO', read: 'LEIDO', failed: 'FALLIDO', played: 'LEIDO' };
const ORDEN = { PENDIENTE: 0, ACEPTADO: 1, ENVIADO: 2, ENTREGADO: 3, LEIDO: 4, FALLIDO: 5 };
const avanza = (actual, nuevo) => nuevo === 'FALLIDO' || (ORDEN[nuevo] ?? -1) > (ORDEN[actual] ?? -1);

module.exports = { normalizarNumero, armarPayload, componentesPlantilla, TIPOS, TIPOS_MEDIA, ESTADOS_META, avanza };
