// Cifrado de secretos guardados en la base (Access Token de Meta, secreto de las suscripciones) con AES-256-GCM.
// Clave: CLAVE_CIFRADO. Si se cambia, los secretos guardados no se pueden leer y hay que volver a cargarlos.
const crypto = require('crypto');
const clave = () => {
  const c = process.env.CLAVE_CIFRADO;
  if (!c && process.env.NODE_ENV === 'production') throw new Error('Falta CLAVE_CIFRADO en el .env');
  return crypto.createHash('sha256').update(c || 'dev-secret').digest();
};
const cifrar = (texto) => {
  if (!texto) return null;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};
const descifrar = (valor) => {
  if (!valor) return null;
  try {
    const [iv, tag, enc] = valor.split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', clave(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
};

// API keys: se muestran una sola vez al crearlas; en la base queda solo el hash SHA-256 y un prefijo para reconocerlas
const PREFIJO = 'wsp_';
const nuevaApiKey = () => {
  const clave = PREFIJO + crypto.randomBytes(24).toString('base64url');
  return { clave, prefijo: clave.slice(0, 12), hash: hashApiKey(clave) };
};
const hashApiKey = (clave) => crypto.createHash('sha256').update(String(clave || '')).digest('hex');

// Comparación en tiempo constante (tokens de administración, firmas)
const iguales = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const hmacSha256 = (secreto, cuerpo) => crypto.createHmac('sha256', String(secreto)).update(cuerpo).digest('hex');

module.exports = { cifrar, descifrar, nuevaApiKey, hashApiKey, iguales, hmacSha256 };
