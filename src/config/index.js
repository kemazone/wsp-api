// Configuración general leída del .env (sin credenciales de base, que están en config/db.js)
require('dotenv').config();
const e = process.env;
const num = (v, d) => { const n = Number(v); return v === undefined || v === '' || !Number.isFinite(n) ? d : n; };

module.exports = {
  puerto: num(e.PORT, 3200),
  // Token del administrador de la plataforma (header X-Admin-Token): alta de empresas, API keys y números
  adminToken: e.ADMIN_TOKEN || '',
  meta: {
    graphVersion: e.META_GRAPH_VERSION || 'v26.0',
    graphUrl: (e.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
    appSecret: e.META_APP_SECRET || '', // valida la firma X-Hub-Signature-256 de los webhooks
    verifyToken: e.META_VERIFY_TOKEN || '', // el mismo que se carga en la configuración del webhook en Meta
    timeoutMs: num(e.META_TIMEOUT_MS, 20000),
  },
  entregas: {
    intervaloS: num(e.ENTREGAS_INTERVALO_S, 15), // cada cuánto se reintentan los reenvíos pendientes a las apps suscriptas (0 = desactivado)
    maxIntentos: num(e.ENTREGAS_MAX_INTENTOS, 8),
    timeoutMs: num(e.ENTREGAS_TIMEOUT_MS, 10000),
  },
  // Días que se conservan los webhooks crudos recibidos de Meta (0 = no borrar)
  eventosDias: num(e.EVENTOS_META_DIAS, 30),
};
