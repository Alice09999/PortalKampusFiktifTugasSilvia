'use strict';

/**
 * Pembatas percobaan login untuk PORTAL UTAMA.
 *
 * Catatan: mekanisme INI sengaja TIDAK dipakai oleh laboratorium kerentanan
 * "percobaan sandi tanpa pembatasan" (/lab/login) — itulah objek latihannya.
 */

const store = new Map(); // key -> { fails, lockedUntil }

function key(ip, username) {
  return `${ip}|${String(username || '').toLowerCase()}`;
}

function check(ip, username, maxFails, lockSeconds) {
  const k = key(ip, username);
  const rec = store.get(k);
  if (!rec) return { locked: false, fails: 0 };
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    const sisa = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
    return { locked: true, seconds: sisa, fails: rec.fails };
  }
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) {
    store.delete(k);
    return { locked: false, fails: 0 };
  }
  return { locked: false, fails: rec.fails };
}

function registerFailure(ip, username, maxFails, lockSeconds) {
  const k = key(ip, username);
  const rec = store.get(k) || { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= maxFails) {
    rec.lockedUntil = Date.now() + lockSeconds * 1000;
  }
  store.set(k, rec);
  return rec;
}

function reset(ip, username) {
  store.delete(key(ip, username));
}

function resetAll() {
  store.clear();
}

module.exports = { check, registerFailure, reset, resetAll };
