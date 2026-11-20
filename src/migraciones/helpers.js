// Utilidades para escribir migraciones idempotentes y no destructivas
const existeColumna = async (qi, tabla, col) => { try { return col in (await qi.describeTable(tabla)); } catch { return false; } };

// Agrega la columna solo si falta (y, si se indica, su clave foránea). Devuelve true si la agregó.
async function agregarColumna(qi, tabla, col, def, fk) {
  if (await existeColumna(qi, tabla, col)) return false;
  await qi.addColumn(tabla, col, def);
  if (fk && qi.sequelize.getDialect() !== 'sqlite') {
    await qi.addConstraint(tabla, { fields: [col], type: 'foreign key', name: `FK_${tabla}_${col}`, references: { table: fk.tabla, field: fk.campo || 'id' }, onDelete: 'no action', onUpdate: 'no action' });
  }
  return true;
}
module.exports = { existeColumna, agregarColumna };
