'use strict';

import { FIREBASE_CONFIG } from './config.js';

let sdk = null;
let fbApp = null;
let auth = null;
let googleProvider = null;
let db = null;

export async function initFirebase() {
  if (auth && sdk) return FirebaseAuth;

  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js');
  const firestoreMod = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js');

  fbApp = appMod.initializeApp(FIREBASE_CONFIG);
  auth = authMod.getAuth(fbApp);
  db = firestoreMod.getFirestore(fbApp);
  googleProvider = new authMod.GoogleAuthProvider();
  sdk = authMod;

  globalThis.__FB__ = FirebaseAuth;
  return FirebaseAuth;
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirestoreDb() { return db; }

export function loginGoogle() {
  if (!sdk || !auth) throw new Error('Firebase no inicializado');
  return sdk.signInWithPopup(auth, googleProvider);
}

export function logout() {
  if (!sdk || !auth) throw new Error('Firebase no inicializado');
  return sdk.signOut(auth);
}

export function onAuthChange(callback) {
  if (!sdk || !auth) throw new Error('Firebase no inicializado');
  return sdk.onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser || null;
}

export async function getIdToken(forceRefresh = false) {
  const user = getCurrentUser();
  if (!user) return '';
  return user.getIdToken(!!forceRefresh);
}

export const FirebaseAuth = {
  get auth() { return auth; },
  get googleProvider() { return googleProvider; },
  onAuthStateChanged(...args) { return sdk.onAuthStateChanged(...args); },
  signInWithPopup(...args) { return sdk.signInWithPopup(...args); },
  GoogleAuthProvider: function GoogleAuthProviderProxy(...args) { return new sdk.GoogleAuthProvider(...args); },
  signOut(...args) { return sdk.signOut(...args); },
};
