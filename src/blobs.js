'use strict';

/**
 * Titik tunggal pemakaian Netlify Blobs (sesi, unggahan, mirror database).
 *
 * Tiga hal teknis ditangani khusus di sini, karena ketiganya PERNAH membuat
 * sesi gagal total di deployment Netlify:
 *
 *  1. Runtime "Lambda compatibility" tidak mengisi konteks Blobs secara
 *     otomatis. Konteks harus dipasang dari event dengan connectLambda(event)
 *     (README @netlify/blobs, bagian "Lambda compatibility mode").
 *     Tanpa konteks, getStore() melempar MissingBlobsEnvironmentError
 *     (siteID, token) sehingga TIDAK ADA data yang bisa disimpan/dibaca.
 *
 *  2. Konteks WAJIB dipasang pada SETIAP permintaan, bukan sekali per
 *     container. Token yang dibawa event.blobs hanya berlaku singkat — bila
 *     konteks lama dipakai ulang, tulisan berikutnya gagal dengan
 *     "Failed to decode token: Token expired" dan sesi dianggap kosong.
 *     Dokumentasi paket: "call this method immediately before calling
 *     getStore". Karena itu cache store juga dibuang begitu konteks berubah.
 *
 *  3. consistency:'strong' hanya bisa dipakai bila konteks memuat properti
 *     'uncachedEdgeURL'. Bila properti itu tidak ada, SETIAP operasi dengan
 *     'strong' melempar BlobsConsistencyError — token CSRF tak pernah cocok
 *     sehingga login selalu 403. Tingkat konsistensi karena itu dipilih dari
 *     ISI konteks:
 *       ada uncachedEdgeURL -> 'strong'  (baca langsung, tanpa cache edge)
 *       selain itu           -> 'eventual'(nilai bawaan paket, selalu sah)
 *
 * Semua fungsi di sini tidak pernah melempar ke pemanggil: bila konteks tidak
 * terbaca dipakai 'eventual', dan kegagalan dicatat ke log sekali per container.
 */

let sudahLog = false;
const tokoTersimpan = new Map(); // nama store -> { konteks, toko }

function konteksMentah() {
  try {
    return globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT || '';
  } catch (_) {
    return '';
  }
}

/**
 * Pasang konteks Blobs dari event. DIPANGGIL PADA SETIAP PERMINTAAN.
 * Bila runtime sudah menyediakan konteks sendiri (tanpa event.blobs),
 * konteks platform itu dipakai apa adanya.
 *
 * @param {object} event event fungsi Netlify
 * @returns {boolean} true bila konteks tersedia setelah dipanggil
 */
function hubungkanDariEvent(event) {
  if (event && typeof event.blobs === 'string') {
    try {
      require('@netlify/blobs').connectLambda(event);
      // Token berubah tiap permintaan -> store lama tidak boleh dipakai lagi.
      tokoTersimpan.clear();
      if (!sudahLog) {
        sudahLog = true;
        console.log(
          '[blobs] konteks dipasang dari event (setiap permintaan); konsistensi="' +
            konsistensi() +
            '".'
        );
      }
      return true;
    } catch (e) {
      if (!sudahLog) {
        sudahLog = true;
        console.error('[blobs] connectLambda gagal:', e && e.message ? e.message : e);
      }
      return konteksMentah() !== '';
    }
  }

  if (konteksMentah()) {
    if (!sudahLog) {
      sudahLog = true;
      console.log('[blobs] konteks dari runtime platform; konsistensi="' + konsistensi() + '".');
    }
    return true;
  }

  if (!sudahLog) {
    sudahLog = true;
    console.error(
      '[blobs] konteks tidak tersedia: NETLIFY_BLOBS_CONTEXT kosong dan event.blobs tidak ada. ' +
        'Sesi/unggahan/mirror database TIDAK akan bisa disimpan.'
    );
  }
  return false;
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

/**
 * Buka store dengan nama tertentum memakai konsistensi yang didukung.
 * Hasil disimpan per nama DAN dibuang bila konteks berubah, karena objek store
 * membawa token konteks saat dibuat.
 */
function bukaToko(nama) {
  const enc = konteksMentah();
  const tersimpan = tokoTersimpan.get(nama);
  if (tersimpan && tersimpan.konteks === enc) return tersimpan.toko;

  const { getStore } = require('@netlify/blobs');
  const toko = getStore({ name: nama, consistency: konsistensi() });
  tokoTersimpan.set(nama, { konteks: enc, toko });
  return toko;
}

module.exports = { hubungkanDariEvent, konsistensi, bukaToko };
