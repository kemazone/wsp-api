// Armado de mensajes hacia Meta (formato de esta API -> Cloud API)
const assert = require('assert');
const { src } = require('./util');
const M = src('meta/mensajes');

// Números
assert.strictEqual(M.normalizarNumero('+54 9 11 2345-6789'), '5491123456789');
assert.strictEqual(M.normalizarNumero('0054 (11) 2345 6789'), '541123456789');
assert.throws(() => M.normalizarNumero('abc'), /inválido/);
assert.throws(() => M.normalizarNumero('123'), (e) => e.status === 400);

// Texto (tipo deducido) y respuesta citada
let r = M.armarPayload({ para: '+5491100000000', texto: ' Hola ' }, { respondeAWamid: 'wamid.X' });
assert.deepStrictEqual(r.payload, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5491100000000', context: { message_id: 'wamid.X' }, type: 'text', text: { body: 'Hola', preview_url: false } });
assert.strictEqual(r.tipo, 'texto'); assert.strictEqual(r.texto, 'Hola');
assert.throws(() => M.armarPayload({ para: '5491100000000', tipo: 'texto', texto: '' }), /Falta texto/);
assert.throws(() => M.armarPayload({ para: '5491100000000', texto: 'x'.repeat(4097) }), /4096/);

// Plantilla con atajos
r = M.armarPayload({ para: '5491100000000', plantilla: { nombre: 'aviso_pedido', parametros: ['Juan', 1500], encabezado: { tipo: 'documento', url: 'https://x/f.pdf', nombreArchivo: 'f.pdf' }, botones: [{ url: 'abc123' }] } });
assert.strictEqual(r.tipo, 'plantilla');
assert.deepStrictEqual(r.payload.template, {
  name: 'aviso_pedido', language: { code: 'es_AR' },
  components: [
    { type: 'header', parameters: [{ type: 'document', document: { link: 'https://x/f.pdf', filename: 'f.pdf' } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Juan' }, { type: 'text', text: '1500' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc123' }] },
  ],
});
assert.strictEqual(r.texto, '[plantilla aviso_pedido] Juan | 1500');
// Plantilla sin parámetros y con componentes en formato Meta
r = M.armarPayload({ para: '5491100000000', plantilla: { nombre: 'hello_world', idioma: 'en_US' } });
assert.deepStrictEqual(r.payload.template, { name: 'hello_world', language: { code: 'en_US' } });
const comp = [{ type: 'body', parameters: [{ type: 'currency', currency: { fallback_value: '$10', code: 'ARS', amount_1000: 10000 } }] }];
assert.deepStrictEqual(M.armarPayload({ para: '5491100000000', plantilla: { nombre: 'p', componentes: comp } }).payload.template.components, comp);
assert.throws(() => M.armarPayload({ para: '5491100000000', tipo: 'plantilla', plantilla: {} }), /plantilla.nombre/);

// Media
r = M.armarPayload({ para: '5491100000000', tipo: 'documento', media: { id: '123', pie: 'Factura', nombreArchivo: 'FC-1.pdf' } });
assert.deepStrictEqual(r.payload.document, { id: '123', caption: 'Factura', filename: 'FC-1.pdf' });
r = M.armarPayload({ para: '5491100000000', tipo: 'audio', media: { url: 'https://x/a.ogg', pie: 'no aplica' } });
assert.deepStrictEqual(r.payload.audio, { link: 'https://x/a.ogg' });
assert.throws(() => M.armarPayload({ para: '5491100000000', tipo: 'imagen', media: {} }), /media necesita/);

// Ubicación, interactivo, reacción
r = M.armarPayload({ para: '5491100000000', tipo: 'ubicacion', ubicacion: { latitud: '-38.0', longitud: -57.5, nombre: 'Playa' } });
assert.deepStrictEqual(r.payload.location, { latitude: -38, longitude: -57.5, name: 'Playa' });
const inter = { type: 'button', body: { text: '¿Confirmás?' }, action: { buttons: [{ type: 'reply', reply: { id: 'si', title: 'Sí' } }] } };
r = M.armarPayload({ para: '5491100000000', tipo: 'interactivo', interactivo: inter });
assert.strictEqual(r.payload.interactive, inter); assert.strictEqual(r.texto, '¿Confirmás?');
r = M.armarPayload({ para: '5491100000000', tipo: 'reaccion', reaccion: { wamid: 'wamid.Y', emoji: '👍' } }, { respondeAWamid: 'wamid.Z' });
assert.deepStrictEqual(r.payload.reaction, { message_id: 'wamid.Y', emoji: '👍' }); assert(!r.payload.context);
assert.throws(() => M.armarPayload({ para: '5491100000000', tipo: 'fax' }), /tipo inválido/);

// Estados: solo avanzan; FALLIDO siempre
assert(M.avanza('ACEPTADO', 'ENTREGADO')); assert(!M.avanza('LEIDO', 'ENTREGADO')); assert(M.avanza('LEIDO', 'FALLIDO')); assert(!M.avanza('ENTREGADO', 'DESCONOCIDO'));
console.log('OK');
