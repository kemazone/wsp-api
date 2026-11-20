// Utilidades de test: reemplazan módulos (base de datos, Meta) para probar la lógica sin SQL Server ni red.
const Module = require('module');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

// Paquetes que se reemplazan si no están instalados (dotenv) o siempre (sequelize: no hay base en los tests)
const paquetes = { dotenv: { config: () => ({}) }, sequelize: { Op: new Proxy({}, { get: (t, k) => Symbol.for('op.' + String(k)) }), DataTypes: {} } };
const cargar = Module._load;
Module._load = function (pedido, padre, ...resto) {
  if (pedido === 'sequelize' || (pedido === 'dotenv' && !instalado('dotenv'))) return paquetes[pedido];
  return cargar.call(this, pedido, padre, ...resto);
};
function instalado(p) { try { require.resolve(p); return true; } catch { return false; } }

// Reemplaza un módulo de src por un objeto (ruta relativa a src, sin .js)
function stub(rel, exportaciones) {
  const archivo = require.resolve(path.join(SRC, rel));
  require.cache[archivo] = { id: archivo, filename: archivo, loaded: true, exports: exportaciones };
  return exportaciones;
}
const src = (rel) => require(path.join(SRC, rel));

// Registro en memoria con update() como las instancias de Sequelize
let sec = 1;
function fila(datos) {
  const f = { id: sec++, createdAt: new Date(), ...datos };
  f.update = async (c) => Object.assign(f, c);
  f.get = () => { const { get, update, ...o } = f; return o; };
  return f;
}

// fetch falso: devuelve las respuestas en orden y guarda los pedidos
function fakeFetch(respuestas) {
  const pedidos = [];
  const fn = async (url, op = {}) => {
    pedidos.push({ url, ...op });
    const r = respuestas.length > 1 ? respuestas.shift() : respuestas[0];
    if (r instanceof Error) throw r;
    const status = r.status || 200, cuerpo = typeof r.json === 'string' ? r.json : JSON.stringify(r.json ?? {});
    return { ok: status < 300, status, text: async () => cuerpo, headers: { get: () => 'application/json' }, arrayBuffer: async () => Buffer.from(cuerpo) };
  };
  fn.pedidos = pedidos;
  return fn;
}

module.exports = { stub, src, fila, fakeFetch, SRC };
