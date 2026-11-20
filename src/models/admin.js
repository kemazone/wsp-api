// Administración de la plataforma (X-Admin-Token): empresas, API keys y números de WhatsApp
const R = require('../repositories');
const P = require('./presentar');
const { cliente } = require('../meta/cliente');
const { cifrar, nuevaApiKey } = require('../seguridad/secretos');
const { token } = require('./mensajes');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const empresaJson = (e) => ({ id: e.id, nombre: e.nombre, activa: e.activa, fecha: e.createdAt });

// ---- empresas
const listarEmpresas = async () => (await R.empresas.listar()).map(empresaJson);
async function crearEmpresa(b = {}) {
  if (!String(b.nombre || '').trim()) throw err('Falta nombre');
  return empresaJson(await R.empresas.crear({ nombre: String(b.nombre).trim(), activa: b.activa !== false }));
}
async function actualizarEmpresa(id, b = {}) {
  const e = await R.empresas.obtener(id);
  await e.update({ ...(b.nombre ? { nombre: String(b.nombre).trim() } : {}), ...(typeof b.activa === 'boolean' ? { activa: b.activa } : {}) });
  return empresaJson(e);
}

// ---- API keys (la clave se muestra una sola vez)
async function crearApiKey(empresaId, b = {}) {
  await R.empresas.obtener(empresaId);
  const k = nuevaApiKey();
  const r = await R.apiKeys.crear({ EmpresaId: Number(empresaId), nombre: String(b.nombre || 'API key').slice(0, 100), prefijo: k.prefijo, hash: k.hash });
  return { id: r.id, nombre: r.nombre, prefijo: r.prefijo, apiKey: k.clave, aviso: 'Guardá la API key ahora: no se vuelve a mostrar.' };
}
const listarApiKeys = async (empresaId) => (await R.apiKeys.listar(Number(empresaId))).map((k) => ({ id: k.id, nombre: k.nombre, prefijo: k.prefijo, activa: k.activa, ultimoUso: k.ultimoUso, fecha: k.createdAt }));
async function revocarApiKey(empresaId, id) { const k = await R.apiKeys.obtener(Number(empresaId), id); await k.update({ activa: false }); return { ok: true }; }

// ---- números
// Completa los datos visibles del número consultando a Meta (también valida que el token y el id sean correctos)
async function completarDesdeMeta(n) {
  const info = await cliente.infoNumero(n, token(n));
  await n.update({ numeroVisible: info.display_phone_number, nombreVerificado: info.verified_name, calidad: info.quality_rating });
  return info;
}

async function crearNumero(empresaId, b = {}) {
  await R.empresas.obtener(empresaId);
  for (const c of ['phoneNumberId', 'wabaId', 'accessToken']) if (!String(b[c] || '').trim()) throw err(`Falta ${c}`);
  if (await R.numeros.porPhoneNumberId(b.phoneNumberId)) throw err('Ese phoneNumberId ya está dado de alta', 409);
  const n = await R.numeros.crear({
    EmpresaId: Number(empresaId), nombre: String(b.nombre || b.phoneNumberId).slice(0, 100), phoneNumberId: String(b.phoneNumberId).trim(),
    wabaId: String(b.wabaId).trim(), accessToken: cifrar(String(b.accessToken).trim()), predeterminado: !!b.predeterminado,
  });
  if (n.predeterminado) await R.numeros.quitarPredeterminado(n.EmpresaId, n.id);
  let aviso;
  if (b.verificar !== false) { try { await completarDesdeMeta(n); } catch (e) { aviso = `Se guardó, pero Meta no confirmó el número: ${e.message}`; } }
  return { ...P.numero(n), ...(aviso ? { aviso } : {}) };
}

async function actualizarNumero(id, b = {}) {
  const n = await R.numeros.porId(id);
  const cambios = {};
  if (b.nombre) cambios.nombre = String(b.nombre).slice(0, 100);
  if (b.wabaId) cambios.wabaId = String(b.wabaId).trim();
  if (b.accessToken) cambios.accessToken = cifrar(String(b.accessToken).trim());
  if (typeof b.activo === 'boolean') cambios.activo = b.activo;
  if (typeof b.predeterminado === 'boolean') cambios.predeterminado = b.predeterminado;
  await n.update(cambios);
  if (cambios.predeterminado) await R.numeros.quitarPredeterminado(n.EmpresaId, n.id);
  return P.numero(n);
}

const listarNumeros = async (empresaId) => (await R.numeros.listar(Number(empresaId))).map(P.numero);

// Revisa la configuración en Meta: datos del número y si la app recibe los webhooks de la cuenta
async function verificarNumero(id) {
  const n = await R.numeros.porId(id);
  const out = { numero: P.numero(n) };
  try { out.meta = await completarDesdeMeta(n); out.numero = P.numero(n); } catch (e) { out.errorNumero = e.message; }
  try { const s = await cliente.appsSuscriptas(n, token(n)); out.appsSuscriptas = (s.data || []).map((a) => (a.whatsapp_business_api_data || a)); out.webhookSuscripto = out.appsSuscriptas.length > 0; } catch (e) { out.errorSuscripcion = e.message; }
  if (out.webhookSuscripto === false) out.aviso = 'La cuenta de WhatsApp Business no tiene apps suscriptas: no van a llegar mensajes. Usar POST /api/admin/numeros/{id}/suscribir-webhook';
  return out;
}
async function suscribirWebhook(id) { const n = await R.numeros.porId(id); return cliente.suscribirWaba(n, token(n)); }
async function registrarNumero(id, b = {}) {
  if (!/^\d{6}$/.test(String(b.pin || ''))) throw err('pin debe tener 6 dígitos (verificación en dos pasos del número)');
  const n = await R.numeros.porId(id); return cliente.registrarNumero(n, token(n), b.pin);
}

module.exports = { listarEmpresas, crearEmpresa, actualizarEmpresa, crearApiKey, listarApiKeys, revocarApiKey, crearNumero, actualizarNumero, listarNumeros, verificarNumero, suscribirWebhook, registrarNumero };
