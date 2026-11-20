// Rutas bajo /api
const express = require('express');
const C = require('../controllers');
const { apiKey, admin, h } = require('../middleware');

const r = express.Router();
const crudo = (limite) => express.raw({ type: () => true, limit: limite });

// Webhook de Meta (sin API key: se valida con la firma). URL a cargar en Meta: https://<host>/<prefijo>/api/webhook/meta
r.get('/webhook/meta', C.webhook.verificar);
r.post('/webhook/meta', C.webhook.recibir);

// API para las apps cliente (X-API-Key)
const v1 = express.Router();
v1.use(apiKey);
v1.get('/numeros', h(C.recursos.numeros));
v1.post('/mensajes', h(C.mensajes.enviar));
v1.get('/mensajes', h(C.mensajes.listar));
v1.get('/mensajes/:id', h(C.mensajes.obtener));
v1.post('/mensajes/:id/leido', h(C.mensajes.leido));
v1.get('/contactos', h(C.recursos.contactos));
v1.get('/contactos/:waId/mensajes', h(C.mensajes.conversacion));
v1.get('/plantillas', h(C.recursos.plantillas));
v1.post('/media', crudo('100mb'), h(C.recursos.subirMedia));
v1.get('/media/:id', h(C.recursos.descargarMedia));
v1.get('/suscripciones', h(C.suscripciones.listar));
v1.post('/suscripciones', h(C.suscripciones.crear));
v1.patch('/suscripciones/:id', h(C.suscripciones.actualizar));
v1.delete('/suscripciones/:id', h(C.suscripciones.eliminar));
v1.post('/suscripciones/:id/probar', h(C.suscripciones.probar));
v1.get('/entregas', h(C.suscripciones.entregas));
v1.post('/entregas/:id/reintentar', h(C.suscripciones.reintentar));
r.use('/v1', v1);

// Administración de la plataforma (X-Admin-Token)
const a = express.Router();
a.use(admin);
a.get('/empresas', h(C.admin.empresas));
a.post('/empresas', h(C.admin.crearEmpresa));
a.patch('/empresas/:id', h(C.admin.actualizarEmpresa));
a.get('/empresas/:id/api-keys', h(C.admin.apiKeys));
a.post('/empresas/:id/api-keys', h(C.admin.crearApiKey));
a.delete('/empresas/:id/api-keys/:keyId', h(C.admin.revocarApiKey));
a.get('/empresas/:id/numeros', h(C.admin.numeros));
a.post('/empresas/:id/numeros', h(C.admin.crearNumero));
a.patch('/numeros/:id', h(C.admin.actualizarNumero));
a.get('/numeros/:id/verificar', h(C.admin.verificarNumero));
a.post('/numeros/:id/suscribir-webhook', h(C.admin.suscribirWebhook));
a.post('/numeros/:id/registrar', h(C.admin.registrarNumero));
a.post('/numeros/:id/probar', h(C.admin.probarNumero));
r.use('/admin', a);

r.use((req, res) => res.status(404).json({ error: `No existe ${req.method} ${req.baseUrl}${req.path}` }));
module.exports = r;
