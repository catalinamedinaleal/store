# Musicala Store

Manager interno de catálogo, inventario y ventas. Sitio estático (HTML + JS modules) sobre Firebase Auth + Firestore, publicado con GitHub Pages en https://catalinamedinaleal.github.io/store/

## Trabajo diario

El inicio muestra accesos a contactos para hoy o atrasados, pedidos pendientes,
ventas a cuotas, stock bajo y productos sin foto. Cada acceso abre la sección
con su filtro aplicado. Si una lectura falla, se advierte que los datos pueden
estar desactualizados; la hora de actualización corresponde a la última carga completa.

El catálogo abre en tarjetas con foto y también ofrece una tabla de gestión.
Se puede buscar por varias palabras, con o sin tildes, incluyendo descripción,
marca, categoría y SKU; los filtros combinan categoría, existencias, estado y
orden por nombre, precio o actualización. El stock se lee de `inventory`, no del
documento del producto. Un registro sin inventario aparece como stock por confirmar.

Desde **Ver ficha** se puede agregar a la venta actual, registrar a un interesado,
editar el producto o preparar información para el cliente. La ficha comercial
copia nombre, marca, categoría, precio y descripción, con un enlace de foto;
nunca incluye costo, margen ni ubicación interna. **Copiar foto** prepara una
imagen PNG para pegar; **Descargar foto** permite adjuntarla. Compartir con archivo
depende del soporte del navegador y del destino elegido; la ficha de texto y la
descarga quedan disponibles cuando ese soporte no existe.

Las fotos JPG, PNG y WEBP (máximo 10 MB) se cargan a Firebase Storage al guardar
el producto. La vista previa funciona con archivos locales; quitar la foto
elimina la referencia del producto, conservando el archivo anterior en Storage.

Ventas incluye búsqueda por cliente, WhatsApp, producto, asesor, notas e ID;
filtros de pendientes, cuotas, pagadas y canceladas, y el saldo de cuotas visible.
El teléfono del cliente se puede guardar y editar. Interesados permite filtrar
por estado, abrir el producto relacionado, preparar contacto por WhatsApp y
registrar seguimientos. Los enlaces de WhatsApp abren la conversación; el equipo
decide cuándo enviar el mensaje.

## Comprobantes comerciales

La pestaña **Comprobantes** lista las últimas 500 ventas confirmadas y los
documentos emitidos, con búsqueda y filtros. También se abre desde **Ventas →
Comprobante**. No es un módulo de facturación electrónica, no se conecta con la
DIAN y no decide la condición tributaria de la vendedora. La condición de persona
natural por sí sola no acredita una excepción a la obligación de facturar.

- La vendedora se configura en `settings/receipts`, solo legible por el equipo y
  editable por admin según las reglas actuales. No se incluyen sus datos
  personales en el código público. Musicala Store figura como referencia comercial,
  no como coemisor ni alianza jurídica certificada. No se infieren NIT, IVA o RUT.
- Solo admin emite y anula desde la interfaz. El consecutivo interno `CV-000001`
  se incrementa en una transacción junto con la copia en `sales/{id}.receipt`.
  Escribir el consecutivo exige permiso de admin en `settings`; los asesores
  pueden consultar, copiar y descargar documentos ya emitidos.
- Se verifica en servidor la venta antes de abrir, copiar o descargar; la emisión
  rechaza cambios desde la revisión. Emitir no agrega pagos ni descuenta stock.
  Reintentar recupera la copia existente sin consumir otro número.
- La copia contiene emisor, cliente, identificación opcional del cliente,
  productos, total, pagos/saldo al emitir, observación comercial y aviso no fiscal.
  No copia costos, márgenes ni notas internas. Pagos posteriores no actualizan
  esta copia; no constituye un recibo de esos pagos posteriores.
- Cancelar la venta anula su comprobante. Anular únicamente el comprobante no
  cancela la venta ni devuelve dinero o stock. Una venta con comprobante no se
  elimina desde la app, para conservar historial; un número anulado no se reutiliza.
  No se implementó reexpedición ni emisión de recibos individuales por abono.
- Estas protecciones son del flujo de la app; las reglas preexistentes de
  `sales` siguen permitiendo escritura al equipo. No son un archivo fiscal
  inalterable ni se modificaron permisos de Firebase en esta implementación.

Fuentes de orientación: [obligación de facturar (DIAN)](https://www.dian.gov.co/impuestos/sociedades/Paginas/obligadosfacturar.aspx)
y [documento soporte a cargo del comprador cuando corresponda (DIAN)](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documento-soporte-adquisiciones-no-obligados/).
La confirmación tributaria específica debe venir del responsable y su contador.

El PDF usa el jsPDF que ya carga el sitio. Para probar su descarga real y generar
ejemplos largos en la prueba local, se puede definir `STORE_TEST_JSPDF` con la ruta
de `jspdf.umd.min.js` versión 2.5.1. Esa dependencia no contiene datos del negocio.

## Inventario y pagos

- Un pedido **pendiente** no descuenta ni reserva stock. Al reabrirlo y guardarlo
  se actualiza el mismo ID, en lugar de crear otra venta.
- **Pagada** o **a cuotas** descuenta stock una sola vez. El primer abono de un
  pedido pendiente confirma la venta y comprueba las existencias en la misma transacción.
- Editar o quitar un abono ajusta el saldo sin devolver productos. Cancelar una
  venta o eliminar una venta confirmada devuelve las unidades una sola vez.
- Los productos repetidos en varias líneas suman sus cantidades para el stock,
  conservando los precios y líneas comerciales originales.
- Un interesado se marca como **compró** al confirmar la venta, no al guardar
  una propuesta pendiente. La venta conserva `lead_id` para completar el seguimiento.

Los indicadores “ventas pagadas hoy” y “utilidad hoy” corresponden a ventas completamente
pagadas, según `paid_at` (o `created_at` para registros históricos), en hora de
Bogotá. No representan el recaudo diario de todos los abonos. Los costos privados
se mantienen fuera del caché local, incluso al restaurar cachés antiguos.

## Validación local

```bash
node tests/firebase-store-transactions.test.mjs
node tests/state-cache.test.mjs
node tests/store-ui.smoke.cjs
```

Las pruebas de transacciones usan el acceso a datos real con un SDK simulado.
La prueba de interfaz usa Playwright con autenticación y datos locales de ejemplo,
en escritorio y móvil; bloquea peticiones externas y no escribe en producción.
Playwright y Chromium deben estar instalados; se pueden indicar sus rutas con
`STORE_TEST_NODE_MODULES` y `STORE_TEST_BROWSER`. Las capturas se guardan fuera del
repositorio, en una carpeta temporal (o `STORE_TEST_OUTPUT`).

## Roles

| | Admin | Asesora |
|---|---|---|
| Catálogo, fotos, fichas de cliente, inventario, ventas, reposición | ✅ | ✅ |
| Registrar el costo que cobra el proveedor | ✅ | ✅ |
| **Ver** costos ya guardados | ✅ | ❌ |
| % de ganancia y utilidad por producto | ✅ | ❌ |
| Dashboard y cifras de venta | ✅ | ❌ |
| Precio de competencia | ✅ | ❌ |
| Editar la regla de precios | ✅ | ❌ |
| Cotizador: combinar carritos y calcular descuento seguro | ✅ | ❌ |

Los correos de cada rol están en [`js/config.js`](js/config.js) y **deben coincidir** con
[`firestore.rules`](firestore.rules). La interfaz obedece a `config.js`; quien aplica la
seguridad de verdad es Firestore.

## Precio de venta automático

La asesora escribe lo que le cobra el proveedor y el precio al público sale solo, según un
% de ganancia por rango de costo. No necesita esperar a que un admin calcule nada.

**Los porcentajes no están en este repositorio a propósito** (es público). La regla vive en
Firestore, en `settings/pricing`, que solo el admin puede escribir. Mientras no exista esa
regla la app no sugiere precios: avisa que falta configurarla, en vez de inventar un valor.

Para definirla: entrar como admin → **⚙️ Precios** → agregar rangos → Guardar.
Cambiar la regla no modifica los precios ya guardados; aplica a lo que se cree o edite después.

## Interesados

Gente que preguntó por algo y todavía no compra. Se registra con su WhatsApp, qué
busca (un producto del catálogo o texto libre si aún no existe) y una fecha de
próximo contacto. La pestaña muestra un contador con cuántos toca contactar hoy o
están atrasados, y ordena la lista poniendo primero lo vencido.

*Convertir en venta* abre el carrito con la persona y el producto ya cargados;
al confirmar una venta pagada o a cuotas, el interesado queda marcado como
"compró" y enlazado a ella. Una propuesta pendiente mantiene el seguimiento activo.

## Cotizador admin

Los pedidos pendientes se guardan en Firestore con el correo de quien los creó. El
admin puede abrir **✨ Cotizador**, seleccionar varios carritos y consolidar sus
productos sin alterar los pedidos originales.

El descuento máximo se calcula con el producto de menor margen para que ninguna
línea quede por debajo del costo. Si falta el costo de algún producto, el descuento
se bloquea hasta completar ese dato. La salida para IA incluye solamente información
comercial; nunca copia costos ni márgenes internos.

## Dónde viven los datos

| Colección | Contenido | Quién lee |
|---|---|---|
| `products` | nombre, marca, categoría, SKU, descripción, **precio de venta**, activo | todo el equipo |
| `productCosts` | **costo del proveedor**, competencia, margen | solo admin |
| `settings/pricing` | rangos de % de ganancia | todo el equipo (ver nota) |
| `leads` | interesados y su historial de seguimiento | todo el equipo |
| `inventory`, `inventoryMoves`, `sales` | stock, movimientos, ventas | todo el equipo |

Separar `productCosts` es lo que hace que el rol sea real: aunque una asesora abra la consola
del navegador, Firestore no le entrega los costos. Sí puede escribirlos (para registrar lo que
le cotizan), pero no leerlos.

> Nota: `settings/pricing` es legible por todo el equipo porque el navegador necesita los
> rangos para calcular el precio. No aparece en ninguna pantalla de la asesora, pero es
> técnicamente visible desde la consola. Ocultarlo del todo exigiría calcular el precio en un
> servidor (Cloud Function).

## Despliegue

El orden importa:

1. **Sitio** — push a `main`; GitHub Pages publica solo. El `__BUILD__` de `index.html` rompe el caché del JS.
2. **Reglas de Firestore**:
   ```bash
   firebase deploy --only firestore:rules
   ```
   Las reglas de fotos se publican con `firebase deploy --only storage --project store2026-77c54`.
   Para un cambio de interfaz sin cambios de permisos solo se publica el sitio.
3. **Migración de costos** (una sola vez) — entrar como admin → ⚙️ Precios → *Migrar costos antiguos*.
   Mueve los costos que estaban dentro de cada producto a `productCosts` y los borra de `products`.
   Hasta correrla, los costos viejos siguen siendo legibles para todo el equipo.

Si publicas las reglas antes que el sitio, a las asesoras les fallarán los guardados hasta que
se les actualice el navegador.

## Estructura

```
index.html              vistas, modales y marcado (data-role="admin" oculta por rol)
styles.css
js/config.js            correos por rol, config de Firebase, versión de build
js/roles.js             rol por correo + capacidades
js/pricing.js           regla de precio por rangos de costo
js/firebase.js          init de Firebase (Auth + Firestore)
js/firebase-store.js    acceso a datos (productos, costos, inventario, ventas, utilidades)
js/state.js             estado central + caché local
js/main.js              arranque, render y eventos
firestore.rules         permisos reales por rol
```
