require('dotenv').config();
const Log = require('./log').crear(); // registro a archivo (ver src/log.js): se instala antes que nada para capturar todo
Log.instalar();
process.on('uncaughtException', (e) => { if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return; console.error('Excepción no controlada:', e); Log.cerrar(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('Promesa rechazada sin manejar:', e); Log.cerrar(); process.exit(1); });

const config = require('./config');
const { sequelize } = require('./entities');
const { crearApp } = require('./app');
const Entregas = require('./models/entregas');

const avisos = [];
if (!process.env.CLAVE_CIFRADO) avisos.push('Falta CLAVE_CIFRADO: los tokens de Meta se cifran con una clave de desarrollo.');
if (!config.meta.appSecret) avisos.push('Falta META_APP_SECRET: se van a rechazar los webhooks de Meta.');
if (!config.meta.verifyToken) avisos.push('Falta META_VERIFY_TOKEN: Meta no va a poder verificar la URL del webhook.');
if (!config.adminToken) avisos.push('Falta ADMIN_TOKEN: la administración (/api/admin) queda deshabilitada.');

require('./iniciar-base')().then(() => {
  const app = crearApp({ pedidos: Log.pedidos });
  app.listen(config.puerto, () => {
    console.log(`wsp-api v${require('../package.json').version} escuchando en http://localhost:${config.puerto} (Graph API ${config.meta.graphVersion})`);
    console.log(Log.descripcion());
    console.log(`Base: mssql://${sequelize.options.host}/${sequelize.config.database}`);
    avisos.forEach((a) => console.warn('ATENCIÓN: ' + a));
    Entregas.iniciar();
  });
}).catch((e) => { console.error('Error al iniciar:', e); Log.cerrar(); process.exit(1); });
