// Registro (log) a archivo: copia a un archivo diario todo lo que la aplicación escribe en la consola (console.log / info / warn / error / debug),
// con fecha, hora y nivel; opcionalmente registra cada pedido HTTP a la API. La consola sigue funcionando igual.
// Todo se configura con variables de entorno (archivo .env):
//   LOG_ARCHIVO       1 | 0     escribir el log en archivo (por defecto 1)
//   LOG_DIR           carpeta   donde se guardan los archivos (por defecto ./logs, relativa a donde se inicia el servidor)
//   LOG_NIVEL         debug | info | warn | error   nivel mínimo que se guarda en el archivo (por defecto info)
//   LOG_DIAS          días que se conservan los archivos; 0 = no borrar nunca (por defecto 30)
//   LOG_TAMANO_MB     tamaño máximo de un archivo; al superarlo se sigue en uno nuevo del mismo día (.1, .2…); 0 = sin límite (por defecto 20)
//   LOG_PEDIDOS       0 | 1 | errores   registrar los pedidos a la API: ninguno, todos, o solo los que terminan con error HTTP 400 o más (por defecto 0)
//   LOG_CONSOLA       1 | 0     seguir mostrando los mensajes en la consola (por defecto 1)
//   LOG_CONSOLA_FECHA 1 | 0     anteponer fecha, hora y nivel a cada mensaje de la consola, que es lo que captura el servicio (servicio.log) (por defecto 1)
// Nunca se guardan cuerpos de pedidos, contraseñas ni la parte de la URL posterior al «?».
const fs = require('fs');
const path = require('path');
const util = require('util');

const leer = (env) => {
  const e = env || process.env, num = (v, d) => { const n = Number(v); return v === undefined || v === '' || !Number.isFinite(n) || n < 0 ? d : n; };
  const nivel = String(e.LOG_NIVEL || 'info').toLowerCase();
  const pedidos = String(e.LOG_PEDIDOS || '0').toLowerCase();
  return {
    archivo: !['0', 'false', 'no'].includes(String(e.LOG_ARCHIVO ?? '1').toLowerCase()),
    dir: path.resolve(e.LOG_DIR || 'logs'),
    nivel: ['debug', 'info', 'warn', 'error'].includes(nivel) ? nivel : 'info',
    dias: num(e.LOG_DIAS, 30),
    bytes: num(e.LOG_TAMANO_MB, 20) * 1024 * 1024,
    pedidos: ['1', 'true', 'si', 'sí', 'todos'].includes(pedidos) ? 'todos' : pedidos === 'errores' ? 'errores' : 'no',
    consola: !['0', 'false', 'no'].includes(String(e.LOG_CONSOLA ?? '1').toLowerCase()),
    consolaFecha: !['0', 'false', 'no'].includes(String(e.LOG_CONSOLA_FECHA ?? '1').toLowerCase()),
  };
};
const ORDEN = { debug: 0, info: 1, warn: 2, error: 3 };
const p2 = (n) => String(n).padStart(2, '0');
const dia = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const marca = (d) => `${dia(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;

function crear(env, { ahora = () => new Date(), consola = console } = {}) {
  const cfg = leer(env);
  let activo = cfg.archivo, avisado = false, fd = null, fdDia = null, fdNombre = null, bytes = 0, parte = 0;
  const falla = (e) => { activo = false; if (!avisado) { avisado = true; try { process.stderr.write(`[log] No se pudo escribir el archivo de log en ${cfg.dir}: ${e.message}. Se sigue solo con la consola.\n`); } catch { /* nada */ } } };
  const nombre = (d, n) => path.join(cfg.dir, `app-${d}${n ? `.${n}` : ''}.log`);
  const cerrar = () => { if (fd !== null) { try { fs.closeSync(fd); } catch { /* ya cerrado */ } fd = null; } };
  const abrir = (hoy) => {
    cerrar(); fs.mkdirSync(cfg.dir, { recursive: true });
    if (fdDia !== hoy) { fdDia = hoy; parte = 0; }
    // sigue en el último archivo del día mientras no supere el tamaño máximo
    for (;;) {
      const f = nombre(hoy, parte), tam = fs.existsSync(f) ? fs.statSync(f).size : 0;
      if (cfg.bytes && tam >= cfg.bytes) { parte++; continue; }
      fd = fs.openSync(f, 'a'); fdNombre = f; bytes = tam; return;
    }
  };
  const escribir = (nivel, texto) => {
    if (!activo || ORDEN[nivel] < ORDEN[cfg.nivel]) return;
    try {
      const d = ahora(), hoy = dia(d), lineas = String(texto).split('\n');
      const linea = `${marca(d)} [${nivel.toUpperCase().padEnd(5)}] ${lineas[0]}${lineas.length > 1 ? '\n' + lineas.slice(1).map((l) => '    ' + l).join('\n') : ''}\n`;
      if (fd === null || fdDia !== hoy || (cfg.bytes && bytes >= cfg.bytes)) { if (fdDia === hoy && fd !== null) parte++; abrir(hoy); }
      fs.writeSync(fd, linea); bytes += Buffer.byteLength(linea);
    } catch (e) { falla(e); }
  };
  // Borra los archivos de log más viejos que LOG_DIAS (por la fecha del nombre)
  const limpiar = () => {
    if (!activo || !cfg.dias) return 0;
    let n = 0;
    try {
      const corte = ahora(); corte.setHours(0, 0, 0, 0); corte.setDate(corte.getDate() - cfg.dias);
      for (const f of fs.readdirSync(cfg.dir)) {
        const m = /^app-(\d{4})-(\d{2})-(\d{2})(\.\d+)?\.log$/.exec(f);
        if (m && new Date(+m[1], +m[2] - 1, +m[3]) < corte) { fs.unlinkSync(path.join(cfg.dir, f)); n++; }
      }
    } catch (e) { if (e.code !== 'ENOENT') falla(e); }
    return n;
  };
  // Reemplaza los métodos de console: escriben en la consola como siempre (si LOG_CONSOLA no es 0) y además en el archivo
  const originales = {};
  const instalar = () => {
    for (const [metodo, nivel] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error'], ['debug', 'debug']]) {
      originales[metodo] = consola[metodo].bind(consola);
      consola[metodo] = (...a) => {
        if (cfg.consola) { // la consola (y el log del servicio que la captura) también lleva fecha, hora y nivel; las líneas siguientes de un mensaje se sangran
          if (!cfg.consolaFecha) originales[metodo](...a);
          else originales[metodo](`${marca(ahora())} [${nivel.toUpperCase().padEnd(5)}] ${util.format(...a).split('\n').map((l, i) => (i ? '    ' + l : l)).join('\n')}`);
        }
        escribir(nivel, util.format(...a));
      };
    }
    // Si quien captura la salida (servicio, consola cerrada, pipe) se cierra, escribir en la consola da EPIPE de forma asíncrona y eso, sin un manejador, tumba el proceso:
    // se deja de escribir en la consola (el archivo de log sigue) y el servidor continúa
    const sinConsola = (e) => { if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED' || e.code === 'EIO')) { if (cfg.consola) { cfg.consola = false; escribir('warn', `La consola dejó de estar disponible (${e.code}): se sigue registrando solo en el archivo de log`); } } };
    if (consola === console) for (const st of [process.stdout, process.stderr]) if (st && typeof st.on === 'function') st.on('error', sinConsola);
    if (activo) { limpiar(); const t = setInterval(limpiar, 6 * 3600 * 1000); if (t.unref) t.unref(); }
  };
  // Middleware de Express: una línea por pedido a la API, al terminar la respuesta
  const pedidos = (req, res, next) => {
    if (cfg.pedidos === 'no' || !activo) return next();
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (cfg.pedidos === 'errores' && res.statusCode < 400) return;
      const ms = Number(process.hrtime.bigint() - t0) / 1e6, ruta = String(req.originalUrl || req.url || '').split('?')[0];
      escribir(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', `${req.method} ${ruta} ${res.statusCode} ${ms.toFixed(0)} ms${req.ip ? ` ${req.ip}` : ''}${req.user && req.user.id ? ` usuario=${req.user.id}` : ''}`);
    });
    next();
  };
  const descripcion = () => (cfg.archivo ? `Log en archivo: ${cfg.dir} (nivel ${cfg.nivel}, ${cfg.dias ? `se conservan ${cfg.dias} días` : 'sin borrado automático'}, ${cfg.bytes ? `máx. ${Math.round(cfg.bytes / 1048576)} MB por archivo` : 'sin límite de tamaño'}, pedidos: ${cfg.pedidos})` : 'Log en archivo: desactivado (LOG_ARCHIVO=0)');
  return { cfg, instalar, escribir, limpiar, pedidos, descripcion, cerrar, archivoActual: () => fdNombre, activo: () => activo };
}
module.exports = { crear, leer };
