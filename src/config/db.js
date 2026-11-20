// Conexión a SQL Server con Sequelize (mismo esquema que gestion-app). Variables DB_* del .env
require('dotenv').config();
const { Sequelize } = require('sequelize');
const e = process.env;
const cfg = { dialect: 'mssql', host: e.DB_HOST || 'localhost', ...require('./consultas-lentas').opciones(e) };
cfg.dialectOptions = { options: {
  encrypt: e.DB_ENCRYPT === '1',
  trustServerCertificate: e.DB_TRUST_CERT !== '0',
  ...(e.DB_INSTANCE ? { instanceName: e.DB_INSTANCE } : {}),
} };
if (!e.DB_INSTANCE) cfg.port = Number(e.DB_PORT) || 1433; // con instancia con nombre no se usa puerto

const sequelize = new Sequelize(e.DB_NAME, e.DB_USER, e.DB_PASS, cfg);
// Crea la base si todavía no existe (necesita permiso CREATE DATABASE)
sequelize.ensureDatabase = async () => {
  if (!/^\w+$/.test(e.DB_NAME || '')) throw new Error('DB_NAME inválido: usar solo letras, números y _');
  const master = new Sequelize('master', e.DB_USER, e.DB_PASS, cfg);
  try { await master.query(`IF DB_ID(N'${e.DB_NAME}') IS NULL CREATE DATABASE [${e.DB_NAME}]`); } finally { await master.close(); }
};
module.exports = sequelize;
