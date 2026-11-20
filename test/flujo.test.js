// Flujo completo sin base ni red: enviar (OK y error de Meta), recibir un mensaje, recibir estados y reenviarlos firmados a la app suscripta
const assert = require('assert');
const crypto = require('crypto');
process.env.CLAVE_CIFRADO = 'clave-test';
const { stub, src, fila, fakeFetch } = require('./util');
const { cifrar } = src('seguridad/secretos');

// ---- base en memoria
const db = { numeros: [], contactos: [], mensajes: [], estados: [], subs: [], entregas: [] };
const numero = fila({ EmpresaId: 1, nombre: 'Principal', phoneNumberId: 'PN1', wabaId: 'WABA1', numeroVisible: '5491100000000', accessToken: cifrar('TOKEN-META'), activo: true, predeterminado: true });
db.numeros.push(numero);
db.subs.push(fila({ EmpresaId: 1, url: 'https://gestion/api/wsp', secreto: cifrar('s3cr3t'), eventos: 'mensaje.*', activa: true }));
db.subs.push(fila({ EmpresaId: 1, url: 'https://otra/api', secreto: cifrar('x'), eventos: 'meta.*', activa: true }));
db.subs.push(fila({ EmpresaId: 2, url: 'https://ajena/api', secreto: cifrar('x'), eventos: '*', activa: true }));
const noHay = (q) => Object.assign(new Error(q + ' no encontrado'), { status: 404 });
stub('repositories', {
  numeros: {
    elegir: async (emp) => { const n = db.numeros.find((x) => x.EmpresaId === emp); if (!n) throw noHay('Número'); return n; },
    porPhoneNumberId: async (p) => db.numeros.find((x) => x.phoneNumberId === p) || null,
    obtener: async (emp, id) => db.numeros.find((x) => x.EmpresaId === emp && x.id === id),
  },
  contactos: {
    obtenerOCrear: async (emp, numeroId, waId, nombre) => {
      let c = db.contactos.find((x) => x.NumeroId === numeroId && x.waId === waId);
      if (!c) db.contactos.push((c = fila({ EmpresaId: emp, NumeroId: numeroId, waId, nombre })));
      else if (nombre) c.nombre = nombre;
      return c;
    },
  },
  mensajes: {
    crear: async (d) => { const m = fila(d); db.mensajes.push(m); return m; },
    obtener: async (emp, id) => { const m = db.mensajes.find((x) => x.EmpresaId === emp && x.id === Number(id)); if (!m) throw noHay('Mensaje'); const { get, update, ...o } = m; return { ...o, Contacto: db.contactos.find((c) => c.id === m.ContactoId), estados: db.estados.filter((e) => e.MensajeId === m.id) }; },
    porWamid: async (w, dir) => db.mensajes.find((x) => x.wamid === w && (!dir || x.direccion === dir)) || null,
    agregarEstado: async (MensajeId, estado, fecha, detalle) => db.estados.push({ MensajeId, estado, fecha, detalle: detalle ? JSON.stringify(detalle) : null }),
  },
  suscripciones: { activas: async (emp) => db.subs.filter((s) => s.EmpresaId === emp && s.activa), porId: async (id) => db.subs.find((s) => s.id === id) },
  entregas: { crear: async (d) => { const e = fila(d); db.entregas.push(e); return e; }, pendientes: async () => [] },
  eventosMeta: { crear: async (payload) => fila({ payload }), limpiar: async () => 0 },
});
stub('entities', { Numero: { findAll: async ({ where }) => db.numeros.filter((n) => n.wabaId === where.wabaId) } });

(async () => {
  // ---- envío OK
  globalThis.fetch = fakeFetch([{ json: { messaging_product: 'whatsapp', contacts: [{ input: '5492230000000', wa_id: '5492230000000' }], messages: [{ id: 'wamid.OUT1', message_status: 'accepted' }] } }]);
  const Mensajes = src('models/mensajes');
  const env = await Mensajes.enviar(1, { para: '+54 9 223 000-0000', texto: 'Tu pedido está listo', referencia: 'venta:42' });
  const pedido = globalThis.fetch.pedidos[0];
  assert.strictEqual(pedido.url, 'https://graph.facebook.com/v26.0/PN1/messages');
  assert.strictEqual(pedido.headers.Authorization, 'Bearer TOKEN-META');
  assert.strictEqual(JSON.parse(pedido.body).to, '5492230000000');
  assert.deepStrictEqual([env.estado, env.wamid, env.referencia, env.direccion, env.contacto.waId], ['ACEPTADO', 'wamid.OUT1', 'venta:42', 'SALIENTE', '5492230000000']);

  // ---- envío con error de Meta (fuera de la ventana de 24 h): queda FALLIDO y el error lleva el id del mensaje
  globalThis.fetch = fakeFetch([{ status: 400, json: { error: { message: 'Re-engagement message', code: 131047, error_data: { details: 'More than 24 hours' }, fbtrace_id: 'TR' } } }]);
  delete require.cache[require.resolve('../src/meta/cliente')]; delete require.cache[require.resolve('../src/models/mensajes')];
  const Mensajes2 = src('models/mensajes');
  await assert.rejects(Mensajes2.enviar(1, { para: '5492230000000', texto: 'Hola' }), (e) => {
    assert.strictEqual(e.status, 422); assert.strictEqual(e.codigo, 131047); assert.strictEqual(e.detalle, 'More than 24 hours'); assert(e.mensajeId);
    const m = db.mensajes.find((x) => x.id === e.mensajeId); assert.strictEqual(m.estado, 'FALLIDO'); assert.strictEqual(JSON.parse(m.error).codigo, 131047);
    return true;
  });
  await assert.rejects(Mensajes2.enviar(9, { para: '5492230000000', texto: 'x' }), (e) => e.status === 404);

  // ---- webhook: mensaje entrante + estados (fuera de orden) + aviso de plantilla
  const Webhook = src('models/webhook');
  const ts = String(Math.floor(Date.now() / 1000));
  const body = { object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [
    { field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, contacts: [{ profile: { name: 'Ana' }, wa_id: '5492230000000' }], messages: [{ from: '5492230000000', id: 'wamid.IN1', timestamp: ts, type: 'text', text: { body: 'Gracias!' }, context: { id: 'wamid.OUT1' } }] } },
    { field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, statuses: [{ id: 'wamid.OUT1', status: 'read', timestamp: ts, recipient_id: '5492230000000' }, { id: 'wamid.OUT1', status: 'delivered', timestamp: ts, recipient_id: '5492230000000' }] } },
    { field: 'message_template_status_update', value: { event: 'APPROVED' } },
  ] }] };
  await Webhook.procesar(body);
  await Webhook.procesar(body); // Meta reintenta: el mensaje no se duplica
  const entrantes = db.mensajes.filter((m) => m.direccion === 'ENTRANTE');
  assert.strictEqual(entrantes.length, 1);
  assert.deepStrictEqual([entrantes[0].texto, entrantes[0].estado, entrantes[0].respondeA], ['Gracias!', 'RECIBIDO', 'wamid.OUT1']);
  const contacto = db.contactos.find((c) => c.waId === '5492230000000');
  assert.strictEqual(contacto.nombre, 'Ana'); assert(contacto.ultimoEntrante);
  assert.strictEqual(src('models/presentar').contacto(contacto).ventanaAbierta, true);
  const saliente = db.mensajes.find((m) => m.wamid === 'wamid.OUT1');
  assert.strictEqual(saliente.estado, 'LEIDO'); // "entregado" llegó después pero no retrocede
  assert.deepStrictEqual(db.estados.filter((e) => e.MensajeId === saliente.id).map((e) => e.estado), ['ACEPTADO', 'LEIDO', 'ENTREGADO', 'LEIDO', 'ENTREGADO']);

  // Solo la empresa 1 recibe; cada suscripción solo los eventos que pidió
  assert(db.entregas.every((e) => e.EmpresaId === 1));
  const aGestion = db.entregas.filter((e) => e.SuscripcionId === db.subs[0].id).map((e) => e.evento);
  assert.deepStrictEqual(aGestion, ['mensaje.recibido', 'mensaje.estado', 'mensaje.estado', 'mensaje.estado', 'mensaje.estado']); // el entrante duplicado no se reenvía
  assert.deepStrictEqual(db.entregas.filter((e) => e.SuscripcionId === db.subs[1].id).map((e) => e.evento), ['meta.message_template_status_update', 'meta.message_template_status_update']);
  const p = JSON.parse(db.entregas[0].payload);
  assert.deepStrictEqual([p.evento, p.empresaId, p.datos.texto, p.datos.contacto.nombre, p.datos.numero.phoneNumberId], ['mensaje.recibido', 1, 'Gracias!', 'Ana', 'PN1']);
  assert.strictEqual(p.id, db.entregas[0].id);

  // ---- reenvío firmado a la app; si falla queda PENDIENTE con reintento programado
  const Entregas = src('models/entregas');
  stub('repositories', { ...require('../src/repositories'), entregas: { pendientes: async () => [db.entregas[0], db.entregas[1]] } });
  globalThis.fetch = fakeFetch([{ status: 200, json: 'ok' }, { status: 500, json: 'caído' }]);
  // Las respuestas se usan en el orden de los pedidos: el primero OK, el segundo falla
  delete require.cache[require.resolve('../src/models/entregas')];
  const E2 = src('models/entregas');
  await E2.procesarPendientes();
  const [p1] = globalThis.fetch.pedidos;
  assert.strictEqual(p1.url, 'https://gestion/api/wsp');
  assert.strictEqual(p1.headers['X-WspApi-Firma'], 'sha256=' + crypto.createHmac('sha256', 's3cr3t').update(p1.body).digest('hex'));
  assert.strictEqual(p1.headers['X-WspApi-Evento'], 'mensaje.recibido');
  assert.strictEqual(db.entregas[0].estado, 'ENTREGADA');
  assert.deepStrictEqual([db.entregas[1].estado, db.entregas[1].intentos, db.entregas[1].codigoHttp], ['PENDIENTE', 1, 500]);
  assert(db.entregas[1].proximoIntento > new Date());

  // Filtro de eventos y esperas
  assert(Entregas.interesa('*', 'mensaje.estado')); assert(Entregas.interesa('mensaje.*', 'mensaje.recibido')); assert(!Entregas.interesa('mensaje.recibido', 'mensaje.estado')); assert(Entregas.interesa('mensaje.estado, meta.*', 'meta.x'));
  assert.strictEqual(Entregas.espera(1), 30000); assert.strictEqual(Entregas.espera(99), 720 * 60000);
  console.log('OK');
  process.exit(0);
})().catch((e) => { console.error('FALLÓ', e); process.exit(1); });
