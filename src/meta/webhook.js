// Lectura de los webhooks de WhatsApp (Meta). Funciones puras: validan la firma y convierten el payload en eventos simples.
const { hmacSha256, iguales } = require('../seguridad/secretos');
const { ESTADOS_META } = require('./mensajes');

// Meta firma el cuerpo CRUDO con el App Secret: header X-Hub-Signature-256: sha256=<hex>
function firmaValida(cuerpoCrudo, header, appSecret) {
  if (!appSecret || !header || !cuerpoCrudo) return false;
  const [algo, firma] = String(header).split('=');
  return algo === 'sha256' && iguales(firma, hmacSha256(appSecret, cuerpoCrudo));
}

const TIPOS_ENTRANTES = { text: 'texto', image: 'imagen', document: 'documento', audio: 'audio', video: 'video', sticker: 'sticker', location: 'ubicacion', contacts: 'contactos', interactive: 'interactivo', button: 'boton', reaction: 'reaccion', order: 'pedido', system: 'sistema' };

// Texto legible y datos útiles de un mensaje entrante
function resumen(m) {
  const t = m.type, o = m[t] || {};
  switch (t) {
    case 'text': return { texto: o.body };
    case 'image': case 'video': case 'document': case 'audio': case 'sticker':
      return { texto: o.caption || `[${TIPOS_ENTRANTES[t]}]`, media: { id: o.id, tipo: o.mime_type, nombreArchivo: o.filename, sha256: o.sha256, pie: o.caption } };
    case 'location': return { texto: o.name || o.address || `[ubicación ${o.latitude},${o.longitude}]`, ubicacion: { latitud: o.latitude, longitud: o.longitude, nombre: o.name, direccion: o.address } };
    case 'interactive': {
      const r = o.button_reply || o.list_reply || o.nfm_reply || {};
      return { texto: r.title || r.body || '[interactivo]', respuesta: { tipo: o.type, id: r.id, titulo: r.title, descripcion: r.description, datos: r.response_json } };
    }
    case 'button': return { texto: o.text, respuesta: { tipo: 'boton_plantilla', id: o.payload, titulo: o.text } };
    case 'reaction': return { texto: o.emoji ? `[reacción ${o.emoji}]` : '[quita reacción]', reaccion: { wamid: o.message_id, emoji: o.emoji } };
    case 'contacts': return { texto: `[${(m.contacts || []).length} contacto(s)]` };
    default: return { texto: `[${t}]` };
  }
}

// Convierte el payload de Meta en una lista de eventos:
//   { tipo: 'mensaje', phoneNumberId, waId, nombre, wamid, fecha, tipoMensaje, texto, respondeA, crudo, ... }
//   { tipo: 'estado', phoneNumberId, wamid, estado, fecha, waId, errores, conversacion, precio }
//   { tipo: 'otro', campo, valor }   (cambios de calidad, plantillas aprobadas/rechazadas, etc.)
function eventos(body) {
  const out = [];
  if (!body || body.object !== 'whatsapp_business_account') return out;
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (ch.field !== 'messages') { out.push({ tipo: 'otro', wabaId: entry.id, campo: ch.field, valor: v }); continue; }
      const phoneNumberId = v.metadata && v.metadata.phone_number_id;
      const nombres = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
      for (const m of v.messages || []) {
        out.push({
          tipo: 'mensaje', phoneNumberId, wabaId: entry.id, waId: m.from, nombre: nombres[m.from], wamid: m.id,
          fecha: new Date(Number(m.timestamp) * 1000), tipoMensaje: TIPOS_ENTRANTES[m.type] || 'otro',
          respondeA: m.context && m.context.id, ...resumen(m), crudo: m,
        });
      }
      for (const s of v.statuses || []) {
        out.push({
          tipo: 'estado', phoneNumberId, wabaId: entry.id, wamid: s.id, estado: ESTADOS_META[s.status] || String(s.status || '').toUpperCase(),
          fecha: new Date(Number(s.timestamp) * 1000), waId: s.recipient_id,
          errores: s.errors, conversacion: s.conversation, precio: s.pricing,
        });
      }
      if (v.errors) out.push({ tipo: 'otro', wabaId: entry.id, campo: 'errors', valor: v.errors });
    }
  }
  return out;
}

module.exports = { firmaValida, eventos, resumen };
