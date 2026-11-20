// Aviso de consultas lentas a la base: queda en el log con la duración y el SQL (recortado), para poder ver qué corría cuando algo se pone lento.
// Se activa con benchmark de Sequelize: el logger recibe (sql, milisegundos). DB_LENTA_MS: umbral en ms (por defecto 3000; 0 = desactivado).
function umbral(env = process.env) {
  const n = Number(env.DB_LENTA_MS);
  return env.DB_LENTA_MS === undefined || env.DB_LENTA_MS === '' || !Number.isFinite(n) || n < 0 ? 3000 : n;
}
function recortar(sql, max = 700) {
  const t = String(sql || '').replace(/^Executed \([^)]*\): /, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}… (${t.length} caracteres)` : t;
}
// Devuelve las opciones de Sequelize para registrar las lentas (o {logging:false} si está desactivado)
function opciones(env = process.env, consola = console) {
  const u = umbral(env);
  if (!u) return { logging: false };
  return { benchmark: true, logging: (sql, ms) => { if (typeof ms === 'number' && ms >= u) consola.warn(`[SQL lenta] ${Math.round(ms)} ms: ${recortar(sql)}`); } };
}
module.exports = { umbral, recortar, opciones };
