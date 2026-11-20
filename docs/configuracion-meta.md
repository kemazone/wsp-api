# Configuración de Meta desde cero

Guía para dejar funcionando la Cloud API de WhatsApp con **wsp-api**. Se arranca con el **número de prueba** que da Meta
(gratis, sin verificar el negocio) y al final se explica cómo pasar a un número propio.

> Meta cambia seguido los nombres de los menús. Si algo no aparece igual, buscá la misma idea: los datos que hay que
> obtener siempre son **App Secret**, **Phone Number ID**, **WABA ID** y un **token permanente**.

## Lo que vamos a obtener

| Dato | Dónde se usa |
|---|---|
| App Secret | `.env` → `META_APP_SECRET` (valida la firma de los webhooks) |
| Token de verificación (lo inventamos) | `.env` → `META_VERIFY_TOKEN` y en la configuración del webhook en Meta |
| Phone Number ID | alta del número en wsp-api (`phoneNumberId`) |
| WhatsApp Business Account ID (WABA ID) | alta del número en wsp-api (`wabaId`) |
| Token permanente de usuario del sistema | alta del número en wsp-api (`accessToken`) |

---

## 1. Portfolio comercial (Meta Business)

1. Entrar a <https://business.facebook.com> con tu usuario de Facebook y crear un **portfolio comercial** (Business portfolio)
   con el nombre de la empresa si todavía no tenés uno.
2. La **verificación del negocio** no hace falta para empezar con el número de prueba. Sí hace falta más adelante para
   subir los límites de envío y publicar el nombre visible del número (paso 9).

## 2. App en Meta for Developers

1. Entrar a <https://developers.facebook.com/apps> → **Crear app**.
2. Caso de uso: **Conectarse con clientes a través de WhatsApp** (o tipo de app **Negocios** si te pide elegir tipo).
3. Nombre: por ejemplo `wsp-api TEST`. Vincularla al portfolio comercial del paso 1.
4. Al terminar, en el panel de la app aparece **WhatsApp** → **Configuración de la API** (API Setup / Inicio rápido).
   Meta crea automáticamente una **cuenta de WhatsApp Business de prueba** con un **número de prueba**.

> Meta permite **una sola URL de webhook por app**. Por eso conviene una app para TEST (esta) y, cuando pasemos a
> producción, otra app (`wsp-api PROD`) apuntando a `https://kema.from-de.com/wsp-api/...`.

## 3. Datos de la app

1. **Configuración de la app → Básica**: copiar la **Clave secreta de la app** (App Secret) → `META_APP_SECRET`.
   En la misma pantalla cargar una **URL de la política de privacidad** (la vas a necesitar para publicar la app).
2. **WhatsApp → Configuración de la API**: anotar
   - **Identificador del número de teléfono** (Phone number ID) del número de prueba.
   - **Identificador de la cuenta de WhatsApp Business** (WhatsApp Business Account ID).
3. En la misma pantalla, en **Para** (destinatarios), agregar tu celular y confirmarlo con el código que llega por WhatsApp.
   Con el número de prueba solo se puede escribir a hasta 5 números confirmados así.

> **Números de Argentina**: WhatsApp identifica los celulares como `549` + característica + número (sin el 15).
> Si al enviar aparece el error **131030** ("Recipient phone number not in allowed list"), revisá que el número esté
> cargado en la lista de destinatarios igual que como lo mandás, y probá con y sin el `9`.

## 4. Token permanente (usuario del sistema)

El token que muestra "Configuración de la API" dura 24 horas: sirve para una prueba rápida, no para el servicio.

1. <https://business.facebook.com> → **Configuración** (del portfolio) → **Usuarios → Usuarios del sistema** → **Agregar**.
   Nombre `wsp-api`, rol **Administrador**.
2. Con ese usuario seleccionado → **Asignar activos**:
   - **Apps** → la app del paso 2 → control total.
   - **Cuentas de WhatsApp** → la cuenta de WhatsApp Business → control total.
3. **Generar token** → elegir la app → **Vencimiento: Nunca** → permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Copiar el token (empieza con `EAA…`). **No se vuelve a mostrar**. Va en el alta del número en wsp-api (paso 7), donde
   queda guardado cifrado.

## 5. Servidor: ambiente TEST

En KEMASRV, igual que los otros servicios:

1. Crear la carpeta `D:\DEPLOY\wsp-api-test` y copiar el contenido del repo (la primera vez a mano, después lo hace GitHub Actions).
2. Crear `D:\DEPLOY\wsp-api-test\.env` a partir de `.env.example`:
   - `PORT=5200`, `DB_*` (instancia `KEMASRV\DEV2019`, base `wsp_api_test`)
   - `CLAVE_CIFRADO` y `ADMIN_TOKEN`: valores largos y aleatorios (por ejemplo `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')` en PowerShell)
   - `META_APP_SECRET` (paso 3) y `META_VERIFY_TOKEN` (inventalo: cualquier texto largo)
3. `npm ci --omit=dev` (o `npm install --omit=dev`) y `npm run migrar` en esa carpeta.
4. Registrar el servicio: `.\scripts\servidor\instalar-servicio.ps1 -Carpeta D:\DEPLOY\wsp-api-test`
5. En IIS, dentro del sitio de `kema.from-de.com`, agregar la aplicación **wsp-api-test** con el mismo `web.config` de
   reverse proxy que usan las otras apps, apuntando a `http://localhost:5200`.
6. Probar desde afuera: `https://kema.from-de.com/wsp-api-test/` debe responder `{"servicio":"wsp-api",...}` y
   `https://kema.from-de.com/wsp-api-test/api/docs` muestra la documentación.

## 6. Webhook en Meta

1. En la app → **WhatsApp → Configuración** → **Webhook** → **Editar**:
   - **URL de devolución de llamada**: `https://kema.from-de.com/wsp-api-test/api/webhook/meta`
   - **Token de verificación**: el mismo valor de `META_VERIFY_TOKEN`
   - **Verificar y guardar**. Si falla: revisar que la URL responda desde internet y que el token sea idéntico
     (el log del servicio muestra "Verificación rechazada" si el token no coincide).
2. En **Campos del webhook** → **Administrar**: suscribir **messages** (obligatorio). Opcionales útiles:
   `message_template_status_update` (aprobación de plantillas) y `phone_number_quality_update`.

## 7. Alta en wsp-api

Con el `ADMIN_TOKEN` del `.env` (se puede hacer desde `/api/docs` con el botón **Authorize**, o con curl/Postman):

```bash
BASE=https://kema.from-de.com/wsp-api-test
ADM="X-Admin-Token: <ADMIN_TOKEN>"

# empresa
curl -X POST $BASE/api/admin/empresas -H "$ADM" -H "Content-Type: application/json" -d '{"nombre":"Kema"}'
# -> {"id":1,...}

# número (valida contra Meta y completa número visible, nombre y calidad)
curl -X POST $BASE/api/admin/empresas/1/numeros -H "$ADM" -H "Content-Type: application/json" \
  -d '{"nombre":"Prueba","phoneNumberId":"<PHONE_NUMBER_ID>","wabaId":"<WABA_ID>","accessToken":"<TOKEN_PERMANENTE>","predeterminado":true}'

# ¿la cuenta envía los webhooks a nuestra app?
curl $BASE/api/admin/numeros/1/verificar -H "$ADM"
# si dice webhookSuscripto: false:
curl -X POST $BASE/api/admin/numeros/1/suscribir-webhook -H "$ADM"

# API key para gestion-app (se muestra UNA vez)
curl -X POST $BASE/api/admin/empresas/1/api-keys -H "$ADM" -H "Content-Type: application/json" -d '{"nombre":"gestion-app QA"}'
```

## 8. Primera prueba

```bash
KEY="X-API-Key: <API_KEY>"
# 1) plantilla de ejemplo que trae toda cuenta nueva (se puede enviar aunque el cliente no haya escrito)
curl -X POST $BASE/api/v1/mensajes -H "$KEY" -H "Content-Type: application/json" \
  -d '{"para":"549XXXXXXXXXX","plantilla":{"nombre":"hello_world","idioma":"en_US"}}'
```

2. Respondé desde tu celular. Eso abre la **ventana de 24 h** y el mensaje queda en `GET /api/v1/mensajes?direccion=ENTRANTE`.
3. Ahora sí se puede mandar texto libre:

```bash
curl -X POST $BASE/api/v1/mensajes -H "$KEY" -H "Content-Type: application/json" -d '{"para":"549XXXXXXXXXX","texto":"Hola desde wsp-api"}'
```

4. `GET /api/v1/mensajes/{id}` muestra cómo el mensaje pasa por ACEPTADO → ENVIADO → ENTREGADO → LEIDO.

## 9. Pasar a un número propio (producción)

1. **Verificar el negocio** en el portfolio (Configuración → Centro de seguridad / Verificación del negocio): pide
   documentación de la empresa y un dominio o teléfono verificable.
2. **Número**: tiene que poder recibir un SMS o una llamada. Si hoy está en la app WhatsApp o WhatsApp Business del
   celular, hay que eliminar esa cuenta antes (o usar la modalidad de coexistencia si Meta la ofrece para ese número).
3. **WhatsApp Manager** (business.facebook.com → Cuentas de WhatsApp) → **Números de teléfono → Agregar**: cargar el
   número, el **nombre visible** (Meta lo revisa) y verificar con el código.
4. Definir el **PIN de verificación en dos pasos** del número y registrarlo en la Cloud API:
   `POST /api/admin/numeros/{id}/registrar` con `{"pin":"123456"}` (antes darlo de alta con su Phone Number ID).
5. **Método de pago** en WhatsApp Manager → Configuración de pago. Meta cobra los mensajes de **plantilla** según su
   categoría (marketing, utilidad, autenticación); las respuestas dentro de la ventana de 24 h no se cobran.
   Precios vigentes: <https://developers.facebook.com/docs/whatsapp/pricing>.
6. **Plantillas**: se crean en WhatsApp Manager → **Plantillas de mensajes**, en `Español (ARG)` (`es_AR`).
   Con la suscripción a `meta.*` la app recibe el aviso cuando Meta las aprueba o rechaza.
7. **Publicar la app** (modo Live) y repetir los pasos 4–7 en el ambiente de producción (`D:\DEPLOY\wsp-api`,
   puerto 3200, base `wsp_api`), con su propia app de Meta y su propio webhook.

## Errores frecuentes de Meta

| Código | Qué significa | Qué hacer |
|---|---|---|
| 131047 | Pasaron más de 24 h desde el último mensaje del cliente | Enviar una plantilla |
| 131030 | Destinatario fuera de la lista permitida (número de prueba) | Agregarlo en "Para" (paso 3); revisar el 9 en números de Argentina |
| 132001 | La plantilla no existe en ese idioma | Revisar nombre e `idioma` con `GET /api/v1/plantillas` |
| 132000 | Cantidad de parámetros distinta a la de la plantilla | Ajustar `parametros` |
| 190 | Token vencido o inválido | Generar un token permanente (paso 4) y actualizarlo con `PATCH /api/admin/numeros/{id}` |
| 131056 | Demasiados mensajes al mismo destinatario en poco tiempo | Espaciar los envíos |
