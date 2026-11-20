// Cliente de la WhatsApp Cloud API (Graph API de Meta). Es la única parte del sistema que habla con Meta.
// Cada llamada recibe el número (phoneNumberId, wabaId) y su Access Token ya descifrado.
const config = require('../config');

class ErrorMeta extends Error {
  constructor(status, cuerpo) {
    const e = (cuerpo && cuerpo.error) || {};
    super(e.error_user_msg || e.message || `Meta respondió HTTP ${status}`);
    this.status = status >= 500 ? 502 : status === 401 || status === 403 ? 502 : 422; // para la app cliente: error de Meta, no de autenticación propia
    this.statusMeta = status;
    this.codigo = e.code; this.subcodigo = e.error_subcode; this.fbtrace = e.fbtrace_id;
    this.detalle = (e.error_data && e.error_data.details) || e.error_user_title || undefined;
    this.meta = e;
  }
}

function crear({ fetchImpl = globalThis.fetch, cfg = config.meta } = {}) {
  const url = (ruta) => `${cfg.graphUrl}/${cfg.graphVersion}/${String(ruta).replace(/^\/+/, '')}`;

  async function llamar(token, metodo, ruta, { json, form, query } = {}) {
    let u = url(ruta);
    if (query) u += '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    const headers = { Authorization: `Bearer ${token}` };
    let body;
    if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form) body = form;
    const r = await fetchImpl(u, { method: metodo, headers, body, signal: AbortSignal.timeout(cfg.timeoutMs) });
    const texto = await r.text();
    let datos; try { datos = texto ? JSON.parse(texto) : {}; } catch { datos = { texto }; }
    if (!r.ok) throw new ErrorMeta(r.status, datos);
    return datos;
  }

  return {
    // Envía un mensaje ya armado en formato Meta (ver mensajes.armarPayload). Devuelve { wamid, waId, estado }
    async enviar(numero, token, payload) {
      const r = await llamar(token, 'POST', `${numero.phoneNumberId}/messages`, { json: payload });
      const m = (r.messages && r.messages[0]) || {};
      return { wamid: m.id, waId: r.contacts && r.contacts[0] && r.contacts[0].wa_id, estadoMeta: m.message_status, respuesta: r };
    },
    // Marca un mensaje recibido como leído (tildes azules)
    marcarLeido: (numero, token, wamid) => llamar(token, 'POST', `${numero.phoneNumberId}/messages`, { json: { messaging_product: 'whatsapp', status: 'read', message_id: wamid } }),
    // Sube un archivo y devuelve { id } para usarlo después en un mensaje
    async subirMedia(numero, token, { buffer, tipo, nombre }) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', tipo);
      form.append('file', new Blob([buffer], { type: tipo }), nombre || 'archivo');
      return llamar(token, 'POST', `${numero.phoneNumberId}/media`, { form });
    },
    // Datos de un archivo (url temporal de descarga, tipo, tamaño)
    infoMedia: (token, mediaId) => llamar(token, 'GET', encodeURIComponent(mediaId)),
    // Descarga el archivo desde la url temporal que devolvió infoMedia (necesita el mismo token)
    async descargarMedia(token, urlMedia) {
      const r = await fetchImpl(urlMedia, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(cfg.timeoutMs * 3) });
      if (!r.ok) throw new ErrorMeta(r.status, null);
      return { buffer: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || 'application/octet-stream' };
    },
    // Plantillas aprobadas (o no) de la cuenta de WhatsApp Business
    plantillas: (numero, token, { limite = 100, despues } = {}) => llamar(token, 'GET', `${numero.wabaId}/message_templates`, { query: { fields: 'name,status,language,category,components', limit: limite, after: despues } }),
    // Datos del número (para verificar la configuración)
    infoNumero: (numero, token) => llamar(token, 'GET', numero.phoneNumberId, { query: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,platform_type' } }),
    // Suscribe la app de Meta a los webhooks de la cuenta de WhatsApp Business (paso que suele olvidarse)
    suscribirWaba: (numero, token) => llamar(token, 'POST', `${numero.wabaId}/subscribed_apps`),
    appsSuscriptas: (numero, token) => llamar(token, 'GET', `${numero.wabaId}/subscribed_apps`),
    // Registra el número en la Cloud API con su PIN de verificación en dos pasos (solo números propios, no el de prueba)
    registrarNumero: (numero, token, pin) => llamar(token, 'POST', `${numero.phoneNumberId}/register`, { json: { messaging_product: 'whatsapp', pin: String(pin) } }),
  };
}

module.exports = { crear, ErrorMeta, cliente: crear() };
