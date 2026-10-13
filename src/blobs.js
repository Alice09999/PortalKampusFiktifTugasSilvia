'use strict';

/**
 * Titik tunggal pemakaian Netlify Blobs (sesi, unggahan, mirror database).
 *
 * Dua hal teknis ditangani khusus di sini, karena keduanya PERNAH membuat sesi
 * gagal total di deployment Netlify:
 *
 *  1. Runtime "Lambda compatibility" tidak mengisi konteks Blobs secara
 *     otomatis. Konteks harus dipasang dari event dengan connectLambda(event)
 *     (lihat README @netlify/blobs, bagian "Lambda compatibility mode").
 *     Tanpa konteks, getStore() melempar MissingBlobsEnvironmentError
 *     (siteID, token) sehingga TIDAK ADA data yang bisa disimpan/dibaca.
 *
 *  2. consistency:'strong' hanya bisa dipakai bila konteks memuat properti
 *     'uncachedEdgeURL'. Bila properti itu tidak ada, SETIAP operasi dengan
 *     'strong' melempar BlobsConsistencyError. Akibatnya penyimpanan sesi
 *     selalu dianggap kosong, token CSRF tidak pernah cocok, dan login selalu
 *     403 "Token keamanan (CSRF) tidak valid" — meski cookie sesi sudah benar.
 *     Karena itu tingkat konsistensi dipilih dari ISI konteks:
 *       ada uncachedEdgeURL -> 'strong'  (baca langsung, tanpa cache edge)
 *       selain itu           -> 'eventual'(nilai bawaan paket, selalu sah)
 *
 * Pemilihan konsistensi tidak pernah melempar: bila konteks tidak terbaca,
 * dipakai 'eventual' yang aman di semua mode akses (edge maupun API).
 */

let sudahDicoba = false;

function konteksMentah() {
  try {
    return globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT || '';
  } catch (_) {
    return '';
  }
}

/**
 * Pasang konteks Blobs dari event bila runtime tidak menyediakannya.
 * Aman dipanggil pada setiap permintaan: hanya bekerja sekali dan tidak
 * menimpa konteks yang sudah ada.
 *
 * @param {object} event event fungsi Netlify
 * @returns {boolean} true bila konteks tersedia setelah dipanggil
 */
function hubungkanDariEvent(event) {
  if (sudahDicoba) return konteksMentah() !== '';
  sudahDicoba = true;
  if (konteksMentah()) {
    // Runtime modern: konteks sudah terisi otomatis.
    console.log('[blobs] konteks tersedia dari runtime; konsistensi="' + konsistensi() + '".');
    return true;
  }
  if (!event || typeof event.blobs !== 'string') {
    console.error(
      '[blobs] konteks tidak tersedia: NETLIFY_BLOBS_CONTEXT kosong dan event.blobs tidak ada. ' +
        'Sesi/unggahan/mirror database TIDAK akan bisa disimpan.'
    );
    return false;
  }
  try {
    require('@netlify/blobs').connectLambda(event);
    console.log(
      '[blobs] konteks dipasang lewat connectLambda(event); konsistensi="' + konsistensi() + '".'
    );
    return true;
  } catch (e) {
    console.error('[blobs] connectLambda gagal:', e && e.message ? e.message : e);
    return false;
  }
}

/** Tingkat konsistensi yang didukung konteks saat ini (tidak pernah melempar). */
function konsistensi() {
  const enc = konteksMentah();
  if (!enc) return 'eventual';
  try {
    const ctx = JSON.parse(Buffer.from(enc, 'base64').toString('utf8'));
    return ctx && ctx.uncachedEdgeURL ? 'strong' : 'eventual';
  } catch (_) {
    // Format konteks tidak terbaca -> pakai nilai bawaan yang selalu didukung.
    return 'eventual';
  }
}

/** Buka store dengan nama tertentu memakai konsistensi yang didukung. */
function bukaToko(nama) {
  const { getStore } = require('@netlify/blobs');
  return getStore({ name: nama, consistency: konsistensi() });
}

module.exports = { hubungkanDariEvent, konsistensi, bukaToko };
