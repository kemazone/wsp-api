// Uso: npm run migrar              -> crea las tablas nuevas y aplica las migraciones pendientes
//      npm run migrar -- --estado  -> solo muestra cuáles están aplicadas y cuáles pendientes
const { sequelize } = require('./entities');
const { migrar } = require('./migraciones');
(async () => {
  await sequelize.ensureDatabase(); await sequelize.sync();
  const soloEstado = process.argv.includes('--estado');
  const r = await migrar(sequelize, { aplicar: !soloEstado });
  console.log(soloEstado ? `Aplicadas: ${r.hechas.length} | Pendientes: ${r.pendientes.length}${r.pendientes.length ? ' -> ' + r.pendientes.join(', ') : ''}` : `Migraciones aplicadas ahora: ${r.aplicadas.length}${r.aplicadas.length ? ' -> ' + r.aplicadas.join(', ') : ' (la base ya estaba al día)'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
