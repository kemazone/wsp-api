// Cifrado de tokens y API keys
const assert = require('assert');
process.env.CLAVE_CIFRADO = 'clave-de-prueba';
const { src } = require('./util');
const S = src('seguridad/secretos');

const c = S.cifrar('EAAG-token');
assert.notStrictEqual(c, 'EAAG-token');
assert.strictEqual(S.descifrar(c), 'EAAG-token');
assert.notStrictEqual(S.cifrar('EAAG-token'), c); // IV aleatorio
assert.strictEqual(S.cifrar(''), null);
process.env.CLAVE_CIFRADO = 'otra-clave';
assert.strictEqual(S.descifrar(c), null); // con otra clave no se lee
assert.strictEqual(S.descifrar('basura'), null);

const k = S.nuevaApiKey();
assert(k.clave.startsWith('wsp_') && k.clave.length > 30);
assert.strictEqual(k.prefijo, k.clave.slice(0, 12));
assert.strictEqual(k.hash, S.hashApiKey(k.clave));
assert.notStrictEqual(S.nuevaApiKey().clave, k.clave);
assert(S.iguales('abc', 'abc')); assert(!S.iguales('abc', 'abd')); assert(!S.iguales('', '')); assert(!S.iguales(undefined, 'a'));
console.log('OK');
