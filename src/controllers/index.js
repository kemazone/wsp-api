// Controladores: traducen el pedido HTTP a llamadas del modelo
const config = require('../config');
const Mensajes = require('../models/mensajes');
const Recursos = require('../models/recursos');
const Entregas = require('../models/entregas');
const Admin = require('../models/admin');
const Webhook = require('../models/webhook');
const { firmaValida } = require('../meta/webhook');

const mensajes = {
  enviar: async (req, res) => res.status(201).json(await Mensajes.enviar(req.empresaId, req.body)),
  listar: (req) => Mensajes.listar(req.empresaId, req.query),
  conversacion: (req) => Mensajes.listar(req.empresaId, { ...req.query, contacto: req.params.waId }),
  obtener: (req) => Mensajes.obtener(req.empresaId, req.params.id),
  leido: (req) => Mensajes.marcarLeido(req.empresaId, req.params.id),
};

const recursos = {
  numeros: (req) => Recursos.numeros(req.empresaId),
  contactos: (req) => Recursos.contactos(req.empresaId, req.query),
  plantillas: (req) => Recursos.plantillas(req.empresaId, req.query),
  subirMedia: async (req, res) => res.status(201).json(await Recursos.subirMedia(req.empresaId, { buffer: Buffer.isBuffer(req.body) ? req.body : null, tipo: (req.get('content-type') || '').split(';')[0].trim(), nombre: req.query.nombre, numero: req.query.numero })),
  async descargarMedia(req, res) {
    const a = await Recursos.descargarMedia(req.empresaId, req.params.id, req.query.numero);
    res.set('Content-Type', a.tipo);
    if (a.sha256) res.set('X-Sha256', a.sha256);
    res.send(a.buffer);
  },
};

const suscripciones = {
  listar: (req) => Recursos.listarSuscripciones(req.empresaId),
  crear: async (req, res) => res.status(201).json(await Recursos.crearSuscripcion(req.empresaId, req.body)),
  actualizar: (req) => Recursos.actualizarSuscripcion(req.empresaId, req.params.id, req.body),
  eliminar: (req) => Recursos.eliminarSuscripcion(req.empresaId, req.params.id),
  probar: (req) => Entregas.probar(req.empresaId, req.params.id),
  entregas: (req) => Entregas.listar(req.empresaId, req.query),
  reintentar: (req) => Entregas.reintentar(req.empresaId, req.params.id),
};

const admin = {
  empresas: () => Admin.listarEmpresas(),
  crearEmpresa: async (req, res) => res.status(201).json(await Admin.crearEmpresa(req.body)),
  actualizarEmpresa: (req) => Admin.actualizarEmpresa(req.params.id, req.body),
  apiKeys: (req) => Admin.listarApiKeys(req.params.id),
  crearApiKey: async (req, res) => res.status(201).json(await Admin.crearApiKey(req.params.id, req.body)),
  revocarApiKey: (req) => Admin.revocarApiKey(req.params.id, req.params.keyId),
  numeros: (req) => Admin.listarNumeros(req.params.id),
  crearNumero: async (req, res) => res.status(201).json(await Admin.crearNumero(req.params.id, req.body)),
  actualizarNumero: (req) => Admin.actualizarNumero(req.params.id, req.body),
  verificarNumero: (req) => Admin.verificarNumero(req.params.id),
  suscribirWebhook: (req) => Admin.suscribirWebhook(req.params.id),
  registrarNumero: (req) => Admin.registrarNumero(req.params.id, req.body),
};

const webhook = {
  // Verificación que hace Meta al configurar la URL del webhook
  verificar(req, res) {
    const q = req.query;
    if (q['hub.mode'] === 'subscribe' && config.meta.verifyToken && q['hub.verify_token'] === config.meta.verifyToken) return res.status(200).type('text/plain').send(String(q['hub.challenge'] || ''));
    console.warn('[webhook] Verificación rechazada: hub.verify_token no coincide con META_VERIFY_TOKEN');
    return res.sendStatus(403);
  },
  // Eventos: se valida la firma, se responde 200 enseguida (Meta reintenta si tarda) y se procesa después
  recibir(req, res) {
    if (!config.meta.appSecret) { console.error('[webhook] Falta META_APP_SECRET en el .env: no se puede validar la firma y se rechazan los webhooks.'); return res.sendStatus(500); }
    if (!firmaValida(req.rawBody, req.get('x-hub-signature-256'), config.meta.appSecret)) { console.warn('[webhook] Firma inválida (¿META_APP_SECRET de otra app?): se descarta.'); return res.sendStatus(401); }
    res.sendStatus(200);
    Webhook.recibir(req.rawBody, req.body).then(() => Webhook.limpiar()).catch((e) => console.error('[webhook]', e));
  },
};

module.exports = { mensajes, recursos, suscripciones, admin, webhook };
