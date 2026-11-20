// Autenticación y manejo de errores
const R = require('../repositories');
const config = require('../config');
const { hashApiKey, iguales } = require('../seguridad/secretos');

const no = (res, status, error) => res.status(status).json({ error });

// Apps cliente: header X-API-Key (o Authorization: Bearer <api key>). Deja req.empresaId
async function apiKey(req, res, next) {
  try {
    const auth = req.get('authorization') || '';
    const clave = req.get('x-api-key') || (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '');
    if (!clave) return no(res, 401, 'Falta la API key (header X-API-Key)');
    const k = await R.apiKeys.porHash(hashApiKey(clave));
    if (!k) return no(res, 401, 'API key inválida, revocada o de una empresa inactiva');
    req.empresaId = k.EmpresaId; req.apiKeyId = k.id;
    if (!k.ultimoUso || Date.now() - new Date(k.ultimoUso).getTime() > 60000) R.apiKeys.marcarUso(k.id).catch(() => {});
    next();
  } catch (e) { next(e); }
}

// Administración de la plataforma: header X-Admin-Token igual a ADMIN_TOKEN del .env
function admin(req, res, next) {
  if (!config.adminToken || config.adminToken.length < 24) return no(res, 503, 'Administración deshabilitada: definir ADMIN_TOKEN (24 caracteres o más) en el .env');
  if (!iguales(req.get('x-admin-token'), config.adminToken)) return no(res, 401, 'X-Admin-Token inválido');
  next();
}

// Envuelve un controlador async para que los errores lleguen a errores()
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => { if (r !== undefined && !res.headersSent) res.json(r); }).catch(next);

// eslint-disable-next-line no-unused-vars
function errores(e, req, res, next) {
  if (e.type === 'entity.parse.failed') return no(res, 400, 'JSON inválido');
  if (e.type === 'entity.too.large') return no(res, 413, 'El cuerpo del pedido es demasiado grande');
  const status = e.status || 500;
  if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl.split('?')[0]}:`, e);
  const out = { error: status >= 500 && !e.codigo && !e.expose && !e.statusMeta ? 'Error interno' : e.message };
  if (e.statusMeta) Object.assign(out, { origen: 'meta', codigoMeta: e.codigo, subcodigoMeta: e.subcodigo, detalle: e.detalle, fbtrace: e.fbtrace });
  if (e.mensajeId) out.mensajeId = e.mensajeId;
  res.status(status).json(out);
}

module.exports = { apiKey, admin, h, errores };
