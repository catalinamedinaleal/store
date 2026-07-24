# Musicala Store

Manager interno de catálogo, inventario y ventas. Sitio estático (HTML + JS modules) sobre Firebase Auth + Firestore, publicado con GitHub Pages en https://catalinamedinaleal.github.io/store/

## Roles

| | Admin | Asesora |
|---|---|---|
| Catálogo, inventario, ventas, restock | ✅ | ✅ |
| Registrar el costo que cobra el proveedor | ✅ | ✅ |
| **Ver** costos ya guardados | ✅ | ❌ |
| % de ganancia y utilidad por producto | ✅ | ❌ |
| Dashboard y cifras de venta | ✅ | ❌ |
| Precio de competencia | ✅ | ❌ |
| Editar la regla de precios | ✅ | ❌ |

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

## Dónde viven los datos

| Colección | Contenido | Quién lee |
|---|---|---|
| `products` | nombre, marca, categoría, SKU, descripción, **precio de venta**, activo | todo el equipo |
| `productCosts` | **costo del proveedor**, competencia, margen | solo admin |
| `settings/pricing` | rangos de % de ganancia | todo el equipo (ver nota) |
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
