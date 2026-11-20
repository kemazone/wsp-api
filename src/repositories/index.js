// Acceso a datos. Toda consulta de datos de una empresa recibe empresaId y filtra por él: una API key nunca ve datos de otra empresa.
const { Op } = require('sequelize');
const E = require('../entities');

const noEncontrado = (que) => Object.assign(new Error(`${que} no encontrado`), { status: 404 });
const obtener = async (M, empresaId, id, que) => {
  const r = await M.findOne({ where: { id: Number(id) || 0, EmpresaId: empresaId } });
  if (!r) throw noEncontrado(que);
  return r;
};

const empresas = {
  listar: () => E.Empresa.findAll({ order: [['id', 'ASC']] }),
  obtener: async (id) => { const r = await E.Empresa.findByPk(Number(id) || 0); if (!r) throw noEncontrado('Empresa'); return r; },
  crear: (datos) => E.Empresa.create(datos),
};

const apiKeys = {
  porHash: (hash) => E.ApiKey.findOne({ where: { hash, activa: true }, include: [{ model: E.Empresa, where: { activa: true } }] }),
  listar: (empresaId) => E.ApiKey.findAll({ where: { EmpresaId: empresaId }, attributes: { exclude: ['hash'] }, order: [['id', 'ASC']] }),
  crear: (datos) => E.ApiKey.create(datos),
  obtener: (empresaId, id) => obtener(E.ApiKey, empresaId, id, 'API key'),
  marcarUso: (id) => E.ApiKey.update({ ultimoUso: new Date() }, { where: { id } }),
};

const numeros = {
  listar: (empresaId) => E.Numero.findAll({ where: { EmpresaId: empresaId }, order: [['id', 'ASC']] }),
  obtener: (empresaId, id) => obtener(E.Numero, empresaId, id, 'Número'),
  porId: async (id) => { const r = await E.Numero.findByPk(Number(id) || 0); if (!r) throw noEncontrado('Número'); return r; },
  porPhoneNumberId: (phoneNumberId) => E.Numero.findOne({ where: { phoneNumberId: String(phoneNumberId) } }),
  // El número indicado (id interno o phoneNumberId) o, si no se indica, el predeterminado de la empresa (o el único)
  async elegir(empresaId, ref) {
    const base = { EmpresaId: empresaId, activo: true };
    if (ref !== undefined && ref !== null && ref !== '') {
      const r = await E.Numero.findOne({ where: { ...base, [Op.or]: [{ phoneNumberId: String(ref) }, ...(Number.isInteger(Number(ref)) && Number(ref) < 2147483647 ? [{ id: Number(ref) }] : [])] } });
      if (!r) throw noEncontrado(`Número '${ref}'`);
      return r;
    }
    const todos = await E.Numero.findAll({ where: base, order: [['predeterminado', 'DESC'], ['id', 'ASC']] });
    if (!todos.length) throw Object.assign(new Error('La empresa no tiene números de WhatsApp activos'), { status: 409 });
    return todos[0];
  },
  crear: (datos) => E.Numero.create(datos),
  quitarPredeterminado: (empresaId, exceptoId) => E.Numero.update({ predeterminado: false }, { where: { EmpresaId: empresaId, id: { [Op.ne]: exceptoId } } }),
};

const contactos = {
  async obtenerOCrear(empresaId, numeroId, waId, nombre) {
    const [c] = await E.Contacto.findOrCreate({ where: { NumeroId: numeroId, waId }, defaults: { EmpresaId: empresaId, nombre } });
    if (nombre && c.nombre !== nombre) await c.update({ nombre });
    return c;
  },
  buscar: (empresaId, numeroId, waId) => E.Contacto.findOne({ where: { EmpresaId: empresaId, NumeroId: numeroId, waId } }),
  listar: (empresaId, { numeroId, buscar, limite = 50, pagina = 1 } = {}) => {
    const where = { EmpresaId: empresaId };
    if (numeroId) where.NumeroId = numeroId;
    if (buscar) where[Op.or] = [{ waId: { [Op.like]: `%${buscar}%` } }, { nombre: { [Op.like]: `%${buscar}%` } }];
    return E.Contacto.findAndCountAll({ where, order: [['updatedAt', 'DESC']], limit: limite, offset: (pagina - 1) * limite });
  },
};

const mensajes = {
  crear: (datos) => E.Mensaje.create(datos),
  obtener: async (empresaId, id) => {
    const r = await E.Mensaje.findOne({ where: { id: Number(id) || 0, EmpresaId: empresaId }, include: [{ model: E.Contacto, attributes: ['waId', 'nombre'] }, { model: E.EstadoMensaje, as: 'estados' }], order: [[{ model: E.EstadoMensaje, as: 'estados' }, 'fecha', 'ASC']] });
    if (!r) throw noEncontrado('Mensaje');
    return r;
  },
  porWamid: (wamid, direccion) => E.Mensaje.findOne({ where: { wamid, ...(direccion ? { direccion } : {}) } }),
  listar: (empresaId, f = {}) => {
    const where = { EmpresaId: empresaId }, include = [{ model: E.Contacto, attributes: ['waId', 'nombre'], ...(f.waId ? { where: { waId: f.waId } } : {}) }];
    if (f.numeroId) where.NumeroId = f.numeroId;
    if (f.direccion) where.direccion = f.direccion;
    if (f.estado) where.estado = f.estado;
    if (f.referencia) where.referencia = f.referencia;
    if (f.desde || f.hasta) where.createdAt = { ...(f.desde ? { [Op.gte]: f.desde } : {}), ...(f.hasta ? { [Op.lte]: f.hasta } : {}) };
    return E.Mensaje.findAndCountAll({ where, include, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: f.limite, offset: (f.pagina - 1) * f.limite });
  },
  agregarEstado: (mensajeId, estado, fecha, detalle) => E.EstadoMensaje.create({ MensajeId: mensajeId, estado, fecha, detalle: detalle ? JSON.stringify(detalle) : null }),
};

const suscripciones = {
  listar: (empresaId) => E.Suscripcion.findAll({ where: { EmpresaId: empresaId }, attributes: { exclude: ['secreto'] }, order: [['id', 'ASC']] }),
  activas: (empresaId) => E.Suscripcion.findAll({ where: { EmpresaId: empresaId, activa: true } }),
  obtener: (empresaId, id) => obtener(E.Suscripcion, empresaId, id, 'Suscripción'),
  porId: (id) => E.Suscripcion.findByPk(id),
  crear: (datos) => E.Suscripcion.create(datos),
};

const entregas = {
  crear: (datos) => E.Entrega.create(datos),
  pendientes: (limite = 20) => E.Entrega.findAll({ where: { estado: 'PENDIENTE', proximoIntento: { [Op.lte]: new Date() } }, order: [['proximoIntento', 'ASC']], limit: limite }),
  listar: (empresaId, { estado, limite = 50, pagina = 1 } = {}) => E.Entrega.findAndCountAll({ where: { EmpresaId: empresaId, ...(estado ? { estado } : {}) }, order: [['id', 'DESC']], limit: limite, offset: (pagina - 1) * limite }),
  obtener: (empresaId, id) => obtener(E.Entrega, empresaId, id, 'Entrega'),
};

const eventosMeta = {
  crear: (payload) => E.EventoMeta.create({ payload }),
  limpiar: (dias) => E.EventoMeta.destroy({ where: { createdAt: { [Op.lt]: new Date(Date.now() - dias * 86400000) } } }),
};

module.exports = { empresas, apiKeys, numeros, contactos, mensajes, suscripciones, entregas, eventosMeta, noEncontrado };
