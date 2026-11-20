// Uso: npm run backup -- "D:\RESPALDOS\wsp-api.bak"   (lo usa el despliegue antes de actualizar)
// La ruta es del equipo donde corre SQL Server y su servicio debe tener permiso de escritura ahí.
const { sequelize } = require('./entities');
const archivo = process.argv[2];
if (!archivo) { console.log('Uso: npm run backup -- "C:\\ruta\\en\\el\\servidor\\wsp-api.bak"'); process.exit(1); }
(async () => {
  const db = sequelize.config.database.replace(/]/g, ']]');
  await sequelize.query(`BACKUP DATABASE [${db}] TO DISK = N'${archivo.replace(/'/g, "''")}' WITH INIT`);
  console.log('Copia de seguridad creada en el servidor SQL:', archivo);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
