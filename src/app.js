// Aplicación Express (separada de server.js para poder probarla sin levantar el puerto)
const express = require('express');
const path = require('path');
const fs = require('fs');
const { errores } = require('./middleware');

function crearApp({ pedidos = (req, res, next) => next() } = {}) {
  const app = express();
  app.set('trust proxy', true); // detrás de IIS (reverse proxy)
  app.disable('x-powered-by');
  // Se guarda el cuerpo crudo: la firma de los webhooks de Meta se calcula sobre los bytes exactos recibidos
  app.use(express.json({ limit: '5mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  // Estado del servicio (lo usa el despliegue para saber que arrancó)
  const version = require('../package.json').version;
  app.get('/', (req, res) => res.json({ servicio: 'wsp-api', version, docs: 'api/docs' }));

  // Documentación OpenAPI
  const spec = path.join(__dirname, 'docs', 'openapi.yaml');
  app.get('/api/openapi.yaml', (req, res) => res.type('text/yaml').send(fs.readFileSync(spec, 'utf8').replace(/^(\s*version:\s*).*$/m, `$1${version}`)));
  try {
    const swaggerUi = require('swagger-ui-express');
    const YAML = require('yaml');
    const doc = YAML.parse(fs.readFileSync(spec, 'utf8')); doc.info.version = version;
    // Redirección relativa: detrás de IIS la app vive en /<carpeta>/ y una redirección absoluta perdería el prefijo
    app.get('/api/docs', (req, res, next) => (req.originalUrl.split('?')[0].endsWith('/') ? next() : res.redirect(301, 'docs/')));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(doc, { customSiteTitle: 'wsp-api', swaggerOptions: { persistAuthorization: true } }));
  } catch (e) { console.warn('Documentación /api/docs no disponible:', e.message); }

  // Pantalla de administración (empresas, números, API keys). Pide el ADMIN_TOKEN; sin él no muestra datos.
  const admin = path.join(__dirname, 'public', 'admin.html');
  app.get(['/admin', '/admin/'], (req, res) => res.set('Cache-Control', 'no-store').sendFile(admin));

  // Política de privacidad pública (Meta la exige para pasar la app a Live). Datos del titular: PRIVACIDAD_* en el .env
  app.get(['/privacidad', '/eliminacion-datos'], (req, res) => {
    const e = process.env, esc = (v) => String(v || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const titular = esc(e.PRIVACIDAD_TITULAR || 'Kema'), email = esc(e.PRIVACIDAD_EMAIL);
    const html = fs.readFileSync(path.join(__dirname, 'public', 'privacidad.html'), 'utf8')
      .replace(/{{TITULAR}}/g, titular)
      .replace(/{{FECHA}}/g, esc(e.PRIVACIDAD_FECHA || '20/11/2026'))
      .replace('{{CONTACTO_LISTA}}', email ? `; o</li><li>escribinos a <a href="mailto:${email}">${email}</a> indicando el número de WhatsApp.` : '.')
      .replace('{{CONTACTO_TEXTO}}', email ? ` · <a href="mailto:${email}">${email}</a>` : ' · por WhatsApp, en el mismo número con el que nos comunicamos.');
    res.type('html').send(html);
  });

  app.use('/api', pedidos, require('./routes'));
  app.use(errores);
  return app;
}

module.exports = { crearApp };
