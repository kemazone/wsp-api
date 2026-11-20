// Prepara la base: la crea si falta, crea las tablas nuevas y aplica las migraciones pendientes
const { sequelize } = require('./entities');
const { migrar } = require('./migraciones');
module.exports = async () => {
  await sequelize.ensureDatabase();
  await sequelize.authenticate();
  await sequelize.sync();
  const r = await migrar(sequelize);
  if (r.aplicadas.length) console.log(`Migraciones aplicadas: ${r.aplicadas.join(', ')}`);
};
