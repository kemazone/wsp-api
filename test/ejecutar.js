// Corre todos los tests (*.test.js) de esta carpeta, uno por proceso, y resume el resultado.
const { readdirSync } = require('fs'), { spawnSync } = require('child_process'), path = require('path');
const filtro = process.argv[2], archivos = readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && (!filtro || f.includes(filtro))).sort();
let mal = 0;
for (const f of archivos) {
  const t = Date.now(), r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', env: { ...process.env, LOG_ARCHIVO: '0' } });
  const ok = r.status === 0; if (!ok) mal++;
  console.log(`${ok ? '✓' : '✗'} ${f} (${Date.now() - t} ms)`);
  if (!ok) console.log((r.stdout + r.stderr).split('\n').slice(-15).join('\n'));
}
console.log(mal ? `\n${mal} de ${archivos.length} con errores` : `\nTodos los tests pasaron (${archivos.length})`); process.exit(mal ? 1 : 0);
