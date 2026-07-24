'use strict';

/* =============================================================================
  Musicala Store · roles.js
  ------------------------------------------------
  Rol por correo + capacidades (qué puede ver/hacer cada quien).

  IMPORTANTE (honestidad técnica):
  Esto controla la INTERFAZ. La seguridad real vive en firestore.rules, que
  usa exactamente la misma lista de correos. Si cambias un correo aquí,
  cámbialo también en firestore.rules o quedará desalineado.
============================================================================= */

import { ADMIN_EMAILS, ASESOR_EMAILS } from './config.js';

export const ROLE = Object.freeze({
  ADMIN: 'admin',
  ASESOR: 'asesor',
  NONE: 'none',
});

/* Capacidades por rol.
   - see_costs      : puede LEER costos ya guardados (productCosts)
   - write_costs    : puede ESCRIBIR el costo que le cobra el proveedor
   - see_margin     : ve el % de ganancia y la utilidad por producto
   - see_profit     : ve utilidades/ganancias agregadas (dashboard)
   - see_dashboard  : ve la pestaña Dashboard y los KPIs de ventas
   - see_competitor : ve el precio de competencia
   - override_price : puede escribir un precio de venta distinto al sugerido
   - edit_pricing   : puede cambiar la regla de precios (rangos de ganancia)
   - manage_data    : migraciones y mantenimiento
*/
const CAPS = Object.freeze({
  [ROLE.ADMIN]: new Set([
    'edit_products', 'see_costs', 'write_costs', 'see_margin', 'see_profit',
    'see_dashboard', 'see_competitor', 'override_price', 'edit_pricing',
    'manage_data', 'see_sales', 'delete_sales',
  ]),
  [ROLE.ASESOR]: new Set([
    'edit_products', 'write_costs', 'see_sales',
  ]),
  [ROLE.NONE]: new Set(),
});

const norm_ = (email) => String(email || '').trim().toLowerCase();

export function roleForEmail(email) {
  const e = norm_(email);
  if (!e) return ROLE.NONE;
  if (ADMIN_EMAILS.has(e)) return ROLE.ADMIN;
  if (ASESOR_EMAILS.has(e)) return ROLE.ASESOR;
  return ROLE.NONE;
}

let _email = '';
let _role = ROLE.NONE;

export const Roles = {
  setEmail(email) {
    _email = norm_(email);
    _role = roleForEmail(_email);
    // OJO: NO usar data-role aquí. Ese atributo marca los nodos que se ocultan
    // por rol, y el <body> quedaría dentro del selector (se ocultaría todo).
    try { document.body.dataset.userRole = _role; } catch {}
    return _role;
  },

  clear() {
    _email = '';
    _role = ROLE.NONE;
    try { delete document.body.dataset.userRole; } catch {}
  },

  email() { return _email; },
  role() { return _role; },

  isAdmin() { return _role === ROLE.ADMIN; },
  isAsesor() { return _role === ROLE.ASESOR; },
  isStaff() { return _role === ROLE.ADMIN || _role === ROLE.ASESOR; },

  can(cap) {
    const set = CAPS[_role] || CAPS[ROLE.NONE];
    return set.has(String(cap || ''));
  },

  label() {
    if (_role === ROLE.ADMIN) return 'Admin';
    if (_role === ROLE.ASESOR) return 'Asesora';
    return 'Sin acceso';
  },
};
