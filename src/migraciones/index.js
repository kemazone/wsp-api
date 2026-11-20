// Migraciones de esquema: cambian las tablas YA EXISTENTES sin perder datos.
// - sync() crea las tablas que faltan (entidades nuevas); las migraciones modifican las que ya existían.
// - Cada archivo NNN_nombre.js exporta { descripcion, up({ qi, sequelize, existeColumna, agregarColumna }) }.
// - Deben ser idempotentes y no destructivas: si una falla a mitad de camino, se reintenta completa en el próximo arranque.
// - Las aplicadas quedan registradas en la tabla schema_migraciones.
const fs = require('fs');
const path = require('path');
const { DataTypes } = require('sequelize');
const helpers = require('./helpers');

async function migrar(sequelize, { aplicar = true, log = console.log } = {}) {
  const Control = sequelize.define('SchemaMigracion', { nombre: { type: DataTypes.STRING, primaryKey: true }, aplicadaEn: { type: DataTypes.DATE } }, { tableName: 'schema_migraciones', timestamps: false });
  await Control.sync();
  const hechas = new Set((await Control.findAll({ raw: true })).map((m) => m.nombre));
  const todas = fs.readdirSync(__dirname).filter((f) => /^\d+_.+\.js$/.test(f)).sort();
  const pendientes = todas.filter((f) => !hechas.has(f));
  const aplicadas = [];
  if (aplicar) {
    for (const f of pendientes) {
      const m = require(path.join(__dirname, f));
      log(`Aplicando migración ${f}${m.descripcion ? ': ' + m.descripcion : ''}`);
      await m.up({ sequelize, qi: sequelize.getQueryInterface(), ...helpers });
      await Control.create({ nombre: f, aplicadaEn: new Date() });
      aplicadas.push(f);
    }
  }
  return { todas, hechas: [...hechas], aplicadas, pendientes: aplicar ? [] : pendientes };
}
module.exports = { migrar };
