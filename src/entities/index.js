// Entidades (tablas). sync() crea las que faltan; los cambios a tablas existentes van en src/migraciones (sin perder datos).
// Multiempresa: todo pertenece a una Empresa (EmpresaId) y los repositorios filtran siempre por la empresa de la API key.
const { DataTypes: T } = require('sequelize');
const sequelize = require('../config/db');
const def = (n, a, o = {}) => sequelize.define(n, a, { tableName: n.toLowerCase(), ...o });
const NA = { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' }; // SQL Server no admite varias rutas de cascada
const str = (n = 255) => ({ type: T.STRING(n), allowNull: false });
const bool = (d) => ({ type: T.BOOLEAN, allowNull: false, defaultValue: d });

const Empresa = def('Empresa', { nombre: str(), activa: bool(true) });
const deEmpresa = (M) => { M.belongsTo(Empresa, { foreignKey: { name: 'EmpresaId', allowNull: false }, ...NA }); return M; };

// API key de una aplicación cliente (gestion-app, facturación…). Solo se guarda el hash.
const ApiKey = deEmpresa(def('ApiKey', {
  nombre: str(100), prefijo: str(20), hash: { ...str(64), unique: true },
  activa: bool(true), ultimoUso: { type: T.DATE },
}));

// Número de WhatsApp (Cloud API). El Access Token se guarda cifrado.
const Numero = deEmpresa(def('Numero', {
  nombre: str(100),
  phoneNumberId: { ...str(40), unique: true }, // "Identificador del número de teléfono" en Meta
  wabaId: str(40), // "Identificador de la cuenta de WhatsApp Business"
  numeroVisible: { type: T.STRING(30) }, // display_phone_number
  nombreVerificado: { type: T.STRING(150) },
  calidad: { type: T.STRING(20) }, // quality_rating (GREEN / YELLOW / RED)
  accessToken: { type: T.TEXT, allowNull: false }, // cifrado (token de usuario del sistema)
  predeterminado: bool(false), activo: bool(true),
}));

// Contacto: cada número de WhatsApp con el que se habló, por número propio
const Contacto = deEmpresa(def('Contacto', {
  waId: str(30), nombre: { type: T.STRING(150) },
  ultimoEntrante: { type: T.DATE }, // abre la ventana de atención de 24 h (mensajes libres sin plantilla)
}, { indexes: [{ unique: true, fields: ['NumeroId', 'waId'] }] }));
Contacto.belongsTo(Numero, { foreignKey: { name: 'NumeroId', allowNull: false }, ...NA });

const Mensaje = deEmpresa(def('Mensaje', {
  direccion: str(10), // SALIENTE | ENTRANTE
  wamid: { type: T.STRING(200) }, // id del mensaje en WhatsApp
  tipo: str(20), // texto, plantilla, imagen, documento, audio, video, sticker, ubicacion, interactivo, reaccion, contactos, boton, otro
  texto: { type: T.TEXT }, // texto legible (cuerpo, pie de foto, botón elegido…) para listados y búsquedas
  contenido: { type: T.TEXT }, // JSON: lo enviado a Meta o lo recibido de Meta
  estado: str(15), // PENDIENTE, ACEPTADO, ENVIADO, ENTREGADO, LEIDO, FALLIDO, RECIBIDO
  error: { type: T.TEXT }, // JSON con el error de Meta
  referencia: { type: T.STRING(100) }, // id propio de la app cliente (por ejemplo "venta:1234")
  respondeA: { type: T.STRING(200) }, // wamid del mensaje citado
  fechaEstado: { type: T.DATE },
}, { indexes: [{ fields: ['wamid'] }, { fields: ['EmpresaId', 'createdAt'] }, { fields: ['EmpresaId', 'referencia'] }] }));
Mensaje.belongsTo(Numero, { foreignKey: { name: 'NumeroId', allowNull: false }, ...NA });
Mensaje.belongsTo(Contacto, { foreignKey: { name: 'ContactoId', allowNull: false }, ...NA });

// Historial de estados de cada mensaje (enviado, entregado, leído, fallido), tal como los informa Meta
const EstadoMensaje = def('EstadoMensaje', { estado: str(15), fecha: { type: T.DATE, allowNull: false }, detalle: { type: T.TEXT } });
EstadoMensaje.belongsTo(Mensaje, { foreignKey: { name: 'MensajeId', allowNull: false }, ...NA });
Mensaje.hasMany(EstadoMensaje, { as: 'estados', foreignKey: 'MensajeId' });

// Suscripción de una app cliente a los eventos (mensaje recibido, cambio de estado). El secreto firma cada envío.
const Suscripcion = deEmpresa(def('Suscripcion', {
  url: str(500), secreto: { type: T.TEXT, allowNull: false }, // cifrado
  eventos: { ...str(200), defaultValue: '*' }, // lista separada por coma o * (todos)
  descripcion: { type: T.STRING(200) }, activa: bool(true),
}));

// Bandeja de salida de los reenvíos a las apps suscriptas (con reintentos)
const Entrega = deEmpresa(def('Entrega', {
  evento: str(50), payload: { type: T.TEXT, allowNull: false },
  estado: str(15), // PENDIENTE | ENTREGADA | FALLIDA
  intentos: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
  proximoIntento: { type: T.DATE }, ultimoError: { type: T.TEXT }, codigoHttp: { type: T.INTEGER },
}, { indexes: [{ fields: ['estado', 'proximoIntento'] }] }));
Entrega.belongsTo(Suscripcion, { foreignKey: { name: 'SuscripcionId', allowNull: false }, ...NA });

// Webhooks crudos recibidos de Meta (para diagnóstico y reproceso). Se borran a los EVENTOS_META_DIAS días.
const EventoMeta = def('EventoMeta', {
  payload: { type: T.TEXT, allowNull: false }, procesado: bool(false), error: { type: T.TEXT },
});

module.exports = { sequelize, Empresa, ApiKey, Numero, Contacto, Mensaje, EstadoMensaje, Suscripcion, Entrega, EventoMeta };
