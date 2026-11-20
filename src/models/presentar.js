// Cómo se devuelven las entidades a las apps cliente (nunca tokens ni secretos)
const json = (t) => { if (!t) return null; try { return JSON.parse(t); } catch { return t; } };
const VENTANA_MS = 24 * 3600 * 1000;

const mensaje = (m) => {
  const o = m.get ? m.get({ plain: true }) : m;
  return {
    id: o.id, numeroId: o.NumeroId, direccion: o.direccion, wamid: o.wamid,
    contacto: o.Contacto ? { waId: o.Contacto.waId, nombre: o.Contacto.nombre } : { id: o.ContactoId },
    tipo: o.tipo, texto: o.texto, estado: o.estado, error: json(o.error), referencia: o.referencia, respondeA: o.respondeA,
    fecha: o.createdAt, fechaEstado: o.fechaEstado,
    ...(o.contenido !== undefined ? { contenido: json(o.contenido) } : {}),
    ...(o.estados ? { estados: o.estados.map((e) => ({ estado: e.estado, fecha: e.fecha, detalle: json(e.detalle) })) } : {}),
  };
};

const contacto = (c, ahora = Date.now()) => ({
  id: c.id, numeroId: c.NumeroId, waId: c.waId, nombre: c.nombre, ultimoEntrante: c.ultimoEntrante,
  // Ventana de atención: dentro de las 24 h del último mensaje del cliente se pueden mandar mensajes libres; fuera, solo plantillas
  ventanaAbierta: !!c.ultimoEntrante && ahora - new Date(c.ultimoEntrante).getTime() < VENTANA_MS,
  ventanaCierra: c.ultimoEntrante ? new Date(new Date(c.ultimoEntrante).getTime() + VENTANA_MS) : null,
});

const numero = (n) => ({
  id: n.id, empresaId: n.EmpresaId, nombre: n.nombre, phoneNumberId: n.phoneNumberId, wabaId: n.wabaId,
  numeroVisible: n.numeroVisible, nombreVerificado: n.nombreVerificado, calidad: n.calidad,
  predeterminado: n.predeterminado, activo: n.activo, tokenCargado: !!n.accessToken,
});

const suscripcion = (s) => ({ id: s.id, url: s.url, eventos: String(s.eventos || '*').split(',').map((x) => x.trim()).filter(Boolean), descripcion: s.descripcion, activa: s.activa, fecha: s.createdAt });

const entrega = (e) => ({ id: e.id, suscripcionId: e.SuscripcionId, evento: e.evento, estado: e.estado, intentos: e.intentos, proximoIntento: e.proximoIntento, ultimoError: e.ultimoError, codigoHttp: e.codigoHttp, fecha: e.createdAt, payload: json(e.payload) });

// Paginación de listados: limite (1..200, por defecto 50) y pagina (desde 1)
const paginacion = (q = {}) => ({ limite: Math.min(Math.max(parseInt(q.limite, 10) || 50, 1), 200), pagina: Math.max(parseInt(q.pagina, 10) || 1, 1) });

module.exports = { mensaje, contacto, numero, suscripcion, entrega, paginacion, json };
