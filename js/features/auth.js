'use strict';

import { ALLOWED_EMAILS } from '../config.js';
import { loginGoogle, logout } from '../firebase.js';

export function isAllowedEmail(email) {
  return ALLOWED_EMAILS.has(String(email || '').trim().toLowerCase());
}

export function initAuthFeature({ onLoginClick, onLogoutClick } = {}) {
  const btnGoogle = document.getElementById('btnGoogle');
  const btnLogout = document.getElementById('btnLogout');
  if (btnGoogle) btnGoogle.addEventListener('click', onLoginClick || (() => loginGoogle()));
  if (btnLogout) btnLogout.addEventListener('click', onLogoutClick || (() => logout()));
}
