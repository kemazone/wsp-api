// Lectura de webhooks de Meta: firma y conversión a eventos
const assert = require('assert');
const crypto = require('crypto');
const { src } = require('./util');
const W = src('meta/webhook');

const cuerpo = Buffer.from(JSON.stringify({ hola: 1 }));
const firma = 'sha256=' + crypto.createHmac('sha256', 'secreto').update(cuerpo).digest('hex');
assert(W.firmaValida(cuerpo, firma, 'secreto'));
assert(!W.firmaValida(cuerpo, firma, 'otro'));
assert(!W.firmaValida(cuerpo, 'sha1=abc', 'secreto'));
assert(!W.firmaValida(cuerpo, undefined, 'secreto'));
assert(!W.firmaValida(cuerpo, firma, ''));

const body = {
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA1', changes: [
    { field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '5491100000000', phone_number_id: 'PN1' },
      contacts: [{ profile: { name: 'Ana' }, wa_id: '5492230000000' }],
      messages: [
        { from: '5492230000000', id: 'wamid.T', timestamp: '1763660000', type: 'text', text: { body: 'Hola!' }, context: { from: '5491100000000', id: 'wamid.ORIG' } },
        { from: '5492230000000', id: 'wamid.I', timestamp: '1763660001', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', sha256: 'h', caption: 'foto' } },
        { from: '5492230000000', id: 'wamid.B', timestamp: '1763660002', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'si', title: 'Sí' } } },
        { from: '5492230000000', id: 'wamid.P', timestamp: '1763660003', type: 'button', button: { payload: 'CONFIRMAR', text: 'Confirmar' } },
      ],
    } },
    { field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, statuses: [
      { id: 'wamid.OUT', status: 'delivered', timestamp: '1763660010', recipient_id: '5492230000000', pricing: { billable: true, category: 'utility' } },
      { id: 'wamid.OUT2', status: 'failed', timestamp: '1763660011', recipient_id: '5492230000000', errors: [{ code: 131047, title: 'Re-engagement message' }] },
    ] } },
    { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'aviso' } },
  ] }],
};
const ev = W.eventos(body);
assert.strictEqual(ev.length, 7);
const [t, img, btn, pl, ent, fal, otro] = ev;
assert.deepStrictEqual([t.tipo, t.phoneNumberId, t.waId, t.nombre, t.wamid, t.tipoMensaje, t.texto, t.respondeA], ['mensaje', 'PN1', '5492230000000', 'Ana', 'wamid.T', 'texto', 'Hola!', 'wamid.ORIG']);
assert.strictEqual(t.fecha.getTime(), 1763660000000);
assert.deepStrictEqual(img.media, { id: 'MEDIA1', tipo: 'image/jpeg', nombreArchivo: undefined, sha256: 'h', pie: 'foto' }); assert.strictEqual(img.texto, 'foto');
assert.deepStrictEqual([btn.tipoMensaje, btn.texto, btn.respuesta.id], ['interactivo', 'Sí', 'si']);
assert.deepStrictEqual([pl.tipoMensaje, pl.respuesta.id], ['boton', 'CONFIRMAR']);
assert.deepStrictEqual([ent.tipo, ent.estado, ent.wamid], ['estado', 'ENTREGADO', 'wamid.OUT']); assert.strictEqual(ent.precio.category, 'utility');
assert.deepStrictEqual([fal.estado, fal.errores[0].code], ['FALLIDO', 131047]);
assert.deepStrictEqual([otro.tipo, otro.campo, otro.wabaId], ['otro', 'message_template_status_update', 'WABA1']);
assert.deepStrictEqual(W.eventos({ object: 'page' }), []);
assert.deepStrictEqual(W.eventos(null), []);
console.log('OK');
