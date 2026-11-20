# wsp-api

API REST propia para **WhatsApp** sobre la **Cloud API de Meta**. Es el único componente de la plataforma que habla con
Meta: gestion-app, la app de facturación y las que vengan usan esta API con su **API key** y reciben los eventos
(mensajes entrantes, cambios de estado) en la URL que suscriben. La idea es la misma que con ARCA: lo tedioso de la
integración queda encapsulado acá.

```
 gestion-app ─┐  X-API-Key                                    ┌─> Meta Cloud API (graph.facebook.com)
 facturación ─┼──────────> wsp-api (Node + SQL Server) ───────┤
 otras apps  ─┘  <──────── eventos firmados (webhooks)  <─────┘   webhook de Meta (firmado)
```

## Qué hace (v0.1)

- **Multiempresa**: cada empresa tiene sus números de WhatsApp, sus API keys, sus contactos y sus mensajes, aislados.
- **Envío**: texto, plantillas (con atajos para variables, encabezado y botones), imagen, documento, audio, video,
  sticker, ubicación, interactivos (botones, listas, CTA… en formato Meta) y reacciones. Respuesta citando un mensaje.
- **Recepción**: webhook de Meta con validación de firma; registra los mensajes entrantes (sin duplicados) y abre la
  ventana de 24 h del contacto.
- **Estados**: ACEPTADO → ENVIADO → ENTREGADO → LEIDO / FALLIDO, con historial; nunca retrocede aunque Meta los mande
  desordenados.
- **Reenvío a las apps**: suscripciones por empresa a `mensaje.recibido`, `mensaje.estado` y `meta.*`, firmadas con
  HMAC-SHA256 y con reintentos (hasta ~1 día).
- **Media**: subir archivos a Meta y descargar los recibidos.
- **Plantillas**: listado con su estado de aprobación.
- **Administración**: empresas, API keys (solo se guarda el hash), números (token cifrado con AES-256-GCM),
  diagnóstico de la configuración en Meta y suscripción del webhook de la cuenta.
- **Pantalla de administración** en **`/admin`** (pide el `ADMIN_TOKEN`): empresas, números (alta, edición,
  verificación en Meta, suscripción al webhook, registro con PIN, envío de prueba) y API keys.
- Documentación interactiva en **`/api/docs`** (OpenAPI en `src/docs/openapi.yaml`).

## Estructura

Mismas capas que gestion-app:

```
src/
  entities/       Entidades (Sequelize, SQL Server)
  repositories/   Acceso a datos (siempre filtrado por empresa)
  models/         Lógica: mensajes, webhook, entregas (reenvío), administración, recursos
  controllers/    HTTP -> modelo
  routes/         /api/v1 (API key), /api/admin (X-Admin-Token), /api/webhook/meta
  meta/           Cliente de la Cloud API y traducción de formatos (funciones puras)
  middleware/     Autenticación y errores
  migraciones/    Cambios de esquema sin perder datos (mismo mecanismo que gestion-app)
  seguridad/      Cifrado de secretos y API keys
scripts/          Despliegue (deploy.ps1) y servicio de Windows (NSSM)
docs/             Configuración de Meta paso a paso
test/             Tests sin base ni red (npm test)
```

## Puesta en marcha

1. **Meta**: seguir [docs/configuracion-meta.md](docs/configuracion-meta.md) (desde crear la app hasta el primer mensaje).
2. **Local**: `npm install`, copiar `.env.example` a `.env`, completar y `npm run dev`. La base se crea sola.
   Para recibir webhooks en local hace falta una URL pública (por ejemplo un túnel); lo normal es probar en TEST.

## Uso desde una app

```js
// Enviar
await fetch(`${WSP_API}/api/v1/mensajes`, {
  method: 'POST',
  headers: { 'X-API-Key': process.env.WSP_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ para: '5491123456789', plantilla: { nombre: 'pedido_listo', parametros: ['Juan', '1234'] }, referencia: 'venta:1234' }),
});

// Recibir eventos: validar la firma sobre el cuerpo CRUDO
app.post('/api/whatsapp/eventos', express.raw({ type: 'application/json' }), (req, res) => {
  const esperada = 'sha256=' + crypto.createHmac('sha256', process.env.WSP_API_SECRETO).update(req.body).digest('hex');
  const firma = req.get('X-WspApi-Firma') || '';
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return res.sendStatus(401);
  const { id, evento, datos } = JSON.parse(req.body); // id: para descartar duplicados (los reintentos repiten el id)
  res.sendStatus(200); // responder rápido; procesar después
  // evento 'mensaje.recibido' -> datos.texto, datos.contacto.waId, datos.media.id, datos.respuesta.id (botones)…
  // evento 'mensaje.estado'   -> datos.referencia ('venta:1234'), datos.estado (ENTREGADO, LEIDO, FALLIDO)…
});
```

Detalle de cada endpoint y ejemplos en `/api/docs`.

## Despliegue

Mismo circuito que gestion-app y arca-app (runner self-hosted `deploy-servidor` en KEMASRV):

| Ambiente | Carpeta | Servicio | Puerto | URL |
|---|---|---|---|---|
| TEST | `D:\DEPLOY\wsp-api-test` | `wsp-api-test` | 5200 | `https://kema.from-de.com/wsp-api-test` |
| PROD | `D:\DEPLOY\wsp-api` | `wsp-api` | 3200 | `https://kema.from-de.com/wsp-api` |

- Push a `main` con tests OK → se despliega en **TEST** y se marca el tag `v<version>`.
- **Producción, a mano**: Actions → *Deploy a producción* → versión. Solo versiones que pasaron por TEST: si no se
  sube `version` en `package.json`, el cambio llega a TEST pero no puede ir a producción.
- `scripts/deploy/deploy.ps1` hace respaldo de la base, guarda la versión anterior, actualiza, migra y vuelve atrás
  solo si el servicio no responde.
- Primera vez en cada ambiente: crear la carpeta y su `.env`, `scripts/servidor/instalar-servicio.ps1 -Carpeta <carpeta>`
  y la aplicación en IIS (reverse proxy al puerto).

## Cambios de esquema

Las tablas nuevas las crea `sync()` al arrancar. Para modificar una tabla existente, agregar en `src/migraciones` un
archivo `NNN_descripcion.js` idempotente (ver `helpers.js`). `npm run migrar -- --estado` muestra las pendientes.
