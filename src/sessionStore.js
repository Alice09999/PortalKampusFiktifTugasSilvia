'use strict';

/**
 * Session store untuk express-session.
 *
 *   memory -> TIDAK mengirim store sama sekali, sehingga express-session
 *             memakai MemoryStore bawaan (perilaku lama persis, default lokal).
 *   blobs  -> Netlify Blobs (tersedia di paket gratis) — dipakai di Netlify.
 *
 * Mengapa perlu store eksternal: MemoryStore hidup di satu proses. Di Netlify
 * Functions ada banyak instance + cold start, sehingga login akan "hilang"
 * secara acak bila sesi hanya disimpan di memori.
 *
 * Bila Blobs tidak tersedia (token/site id tidak ada, gangguan jaringan),
 * permintaan TIDAK digagalkan: sesi dianggap kosong/ditulis percuma DAN pesan
 * error dicetak ke log — pengguna akan terlihat ter-logout, bukan "tampak
 * berhasil" tanpa penyimpanan.
 */

const { Store } = require('express-session');

const NAMA_TOKO = 'kampuskue-portal';
const PREFIX = 'sess/';

class BlobsSessionStore extends Store {
  constructor() {
    super();
    this.toko = null;
    this.sudahLog = false;
  }

  _log(e) {
    if (this.sudahLog) return;
    this.sudahLog = true;
    console.error(
      '[session] PENYIMPANAN SESSI TIDAK TERSEDIA (Netlify Blobs):',
      e && e.message ? e.message : e
    );
    console.error(
      '[session] Sesi TIDAK akan bertahan antar permintaan/instance. ' +
        'Periksa environment variable NETLIFY_SITE_ID & token Blobs.'
    );
  }

  _store() {
    if (this.toko) return this.toko;
    const { getStore } = require('@netlify/blobs');
    this.toko = getStore({ name: NAMA_TOKO, consistency: 'strong' });
    return this.toko;
  }

  get(sid, cb) {
    let s;
    try {
      s = this._store();
    } catch (e) {
      this._log(e);
      return cb(null, null);
    }
    s.get(PREFIX + sid)
      .then((teks) => {
        if (!teks) return cb(null, null);
        let obj;
        try {
          // Pulihkan expires (JSON mengubah Date menjadi string).
          obj = JSON.parse(teks, (k, v) => (k === 'expires' && v ? new Date(v) : v));
        } catch (_) {
          return cb(null, null);
        }
        const kadaluarsa = obj && obj.cookie && obj.cookie.expires;
        if (kadaluarsa && new Date(kadaluarsa).getTime() < Date.now()) {
          s.delete(PREFIX + sid).catch(() => {});
          return cb(null, null);
        }
        return cb(null, obj);
      })
      .catch((e) => {
        this._log(e);
        return cb(null, null);
      });
  }

  set(sid, sess, cb) {
    let s;
    try {
      s = this._store();
    } catch (e) {
      this._log(e);
      return cb(null);
    }
    s.setJSON(PREFIX + sid, sess)
      .then(() => cb(null))
      .catch((e) => {
        this._log(e);
        return cb(null);
      });
  }

  destroy(sid, cb) {
    let s;
    try {
      s = this._store();
    } catch (e) {
      this._log(e);
      return cb(null);
    }
    s.delete(PREFIX + sid)
      .catch(() => {})
      .then(() => cb(null));
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

/**
 * @param {string} backend 'blobs' -> store Blobs, selain itu -> null
 *   (null membuat express-session memakai MemoryStore, persis perilaku lama).
 */
function createSessionStore(backend) {
  if (backend !== 'blobs') return null;
  try {
    return new BlobsSessionStore();
  } catch (e) {
    console.error('[session] gagal membuat store Blobs:', e.message);
    return null;
  }
}

module.exports = { createSessionStore, BlobsSessionStore };
