# KampusKu — Portal Akademik Fiktif

Portal akademik berbahasa Indonesia untuk latihan **Audit Laporan M5–M6 KSI**.
Mahasiswa dapat masuk, melihat nilai, mengunggah tugas, dan berdiskusi; dosen memberi
nilai; admin mengelola akun. Terdapat dua laboratorium kerentanan yang dibuat
sengaja untuk pembelajaran.

> ⚠️ **Seluruh akun, nama, mata kuliah, nilai, dan berkas di dalam proyek ini
> bersifat SINTETIS/FIKTIF.** Jangan memasukkan data sungguhan.

---

## 1. Daftar Isi

1. [Deskripsi & Fitur](#1-deskripsi--fitur)
2. [Teknologi yang Digunakan](#2-teknologi-yang-digunakan)
3. [Struktur File](#3-struktur-file)
4. [Persyaratan & Instalasi](#4-persyaratan--instalasi)
5. [Inisialisasi Database](#5-inisialisasi-database)
6. [Menjalankan Aplikasi](#6-menjalankan-aplikasi)
7. [Akun Demo](#7-akun-demo)
8. [Dua Kerentanan Laboratorium](#8-dua-kerentanan-laboratorium)
9. [Langkah Pengujian Lokal](#9-langkah-pengujian-lokal)
10. [Keamanan Portal Utama](#10-keamanan-portal-utama)
11. [Environment Variables](#11-environment-variables)
12. [Mengunggah ke GitHub](#12-mengunggah-ke-github)
13. [Deployment](#13-deployment)
14. [Menutup Laboratorium pada Deployment Publik](#14-menutup-laboratorium-pada-deployment-publik)
15. [Batasan & Catatan Pengujian](#15-batasan--catatan-pengujian)

---

## 1. Deskripsi & Fitur

### Peran dan fitur

| Peran | Fitur |
|---|---|
| **Semua** | Login/logout berbasis sesi, pesan kegagalan, pengalihan ke dashboard sesuai peran |
| **Mahasiswa** | Dashboard akademik, daftar mata kuliah, nilai miliknya sendiri, daftar tugas + status pengumpulan, unggah/pembaruan berkas tugas, membaca & membuat diskusi, membalas diskusi |
| **Dosen** | Dashboard, daftar mata kuliah yang diajar, daftar mahasiswa per kelas, daftar tugas & berkas masuk, memberi/memperbarui **nilai akhir** dan **nilai tugas** (tersimpan ke database), mengunduh berkas mahasiswa kelasnya |
| **Admin** | Dashboard ringkasan (jumlah akun & data akademik), daftar/cari akun, **buat akun**, ubah peran, aktifkan/nonaktifkan, reset kata sandi |
| **Laboratorium** | Halaman SQL Injection (pencarian + bypass login, versi rentan & versi berparameter), halaman login tanpa pembatasan percobaan |

### Halaman yang tersedia

1. `/login` — Login
2. `/mahasiswa` — Dashboard mahasiswa
3. `/mahasiswa/nilai` — Halaman nilai
4. `/mahasiswa/tugas` — Tugas & unggah berkas
5. `/mahasiswa/diskusi` (+ `/mahasiswa/diskusi/:id`) — Diskusi
6. `/dosen` — Dashboard dosen
7. `/dosen/penilaian` (+ `/dosen/mata-kuliah/:id`) — Penilaian
8. `/admin` — Dashboard admin
9. `/admin/akun` — Pengelolaan akun
10. `/lab/sqli` — Laboratorium SQL Injection
11. `/lab/login` — Laboratorium percobaan sandi tanpa pembatasan

Semua tombol dan formulir terhubung ke backend; tidak ada tombol dekoratif.

---

## 2. Teknologi yang Digunakan

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Runtime | **Node.js ≥ 20.11** (diuji pada Node 24) | Sudah tersedia di Windows, tanpa kompilasi native |
| Web framework | **Express 4** | Sederhana, stabil, mudah dideploy |
| Template | **EJS** (server-side rendering) | Formulir & navigasi dirender server, otorisasi mudah diperiksa |
| Basis data | **SQLite** lewat modul bawaan `node:sqlite` | Basis data nyata tanpa instalasi server terpisah |
| Autentikasi | **express-session** (cookie httpOnly) + **bcryptjs** | Sesi di backend, kata sandi ter-hash |
| Unggahan | **multer** | Batas ukuran, whitelist ekstensi/MIME, nama berkas acak |
| Konfigurasi | **dotenv** | Rahasia dipisahkan ke `.env` |

> Catatan: Node menampilkan peringatan `ExperimentalWarning: SQLite`.
> Peringatan tersebut normal dan tidak memengaruhi fungsi aplikasi.

---

## 3. Struktur File

```
D:\WEB PORTAL KAMPUS FIKTIF\
├── server.js                  # Titik masuk server Express + rute utama
├── package.json               # Dependensi & skrip npm
├── .env.example               # Templat variabel lingkungan (aman untuk Git)
├── .env                       # Konfigurasi lokal (TIDAK di-commit)
├── .gitignore
├── README.md
├── scripts/
│   ├── init-db.js             # Inisialisasi + seed data sintetis (--fresh untuk ulang)
│   └── smoke-test.js          # Uji otomatis menyeluruh (65 pemeriksaan)
├── src/
│   ├── config.js              # Pembacaan .env & konfigurasi
│   ├── db.js                  # Koneksi SQLite + skema tabel + helper query
│   ├── queries.js             # Helper bersama (keanggotaan kelas, kepemilikan kelas)
│   ├── loginGuard.js          # Pembatas percobaan login PORTAL UTAMA
│   ├── middleware/
│   │   └── auth.js            # Flash, CSRF, requireLogin, requireRole
│   └── routes/
│       ├── auth.js            # POST /login, POST /logout
│       ├── mahasiswa.js       # Dashboard, nilai, tugas+unggah, diskusi
│       ├── dosen.js           # Dashboard, detail kelas, penilaian
│       ├── admin.js           # Dashboard, pengelolaan akun
│       ├── files.js           # Unduhan berkas dengan otorisasi per peran
│       └── lab.js             # /lab/sqli dan /lab/login (sengaja rentan)
├── views/                     # Template EJS
│   ├── partials/  (head, nav, flash, foot)
│   ├── login.ejs, error.ejs
│   ├── mahasiswa/ (dashboard, nilai, tugas, diskusi, diskusi-detail)
│   ├── dosen/     (dashboard, mata-kuliah, penilaian)
│   ├── admin/     (dashboard, akun)
│   └── lab/       (index, sqli, brute)
├── public/
│   ├── css/style.css          # Gaya seluruh halaman (responsif)
│   └── js/app.js              # Menu mobile, notifikasi, simulasi brute force
├── data/
│   ├── kampuskue.db           # Database portal (di-gitignore)
│   └── lab.db                 # Database terpisah khusus lab (di-gitignore)
└── uploads/                   # Berkas unggahan mahasiswa (di-gitignore)
```

---

## 4. Persyaratan & Instalasi

| Kebutuhan | Versi |
|---|---|
| Node.js | ≥ 20.11 (uji dilakukan dengan **v24.14.0**) |
| npm | ≥ 10 (uji dilakukan dengan **v11.9.0**) |
| OS | Windows / Linux / macOS |

Langkah instalasi (di folder proyek):

```powershell
# 1. Pastikan Node terpasang
node -v
npm -v

# 2. Pasang dependensi
npm install

# 3. Salin templat konfigurasi
Copy-Item .env.example .env      # Linux/macOS: cp .env.example .env

# 4. (Wajib) Ganti SESSION_SECRET di .env dengan string acak
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 5. Inisialisasi Database

```powershell
# Isi data jika database masih kosong
npm run init:db

# Hapus dan bangun ulang seluruh data (reset penuh)
npm run reset:db
```

Perintah tersebut membuat:

- **Database portal** `data/kampuskue.db` dengan tabel
  `users`, `courses`, `enrollments`, `assignments`, `submissions`, `grades`,
  `discussions`, `discussion_replies`.
- **Database laboratorium** `data/lab.db` dengan tabel `lab_users` dan
  `lab_login_attempts` — **terpisah penuh** dari data portal.
- Data sintetis: **17 pengguna** (1 admin, 4 dosen, 12 mahasiswa), **8 mata kuliah**,
  **60 pendaftaran kelas**, **16 tugas**, **75 pengumpulan**, **50 nilai akhir**,
  **6 diskusi + balasan**, 4 akun laboratorium, serta berkas contoh di `uploads/`.

---

## 6. Menjalankan Aplikasi

```powershell
npm start            # http://127.0.0.1:3000
# atau, dengan pemuatan ulang otomatis saat file berubah:
npm run dev
```

Buka **http://127.0.0.1:3000** — akan diarahkan ke halaman login.

---

## 7. Akun Demo

| Peran | Nama pengguna | Kata sandi | URL tujuan |
|---|---|---|---|
| Admin | `admin` | `admin12345` | `/admin` |
| Dosen | `dosen01` … `dosen04` | `dosen12345` | `/dosen` |
| Mahasiswa | `mahasiswa01` … `mahasiswa12` | `mhs12345` | `/mahasiswa` |

Dosen lain: `dosen02`, `dosen03`, `dosen04` (kata sandi sama).
Mahasiswa lain: `mahasiswa02` … `mahasiswa12` (kata sandi sama).

**Akun laboratorium** (hanya untuk `/lab`, tidak dapat masuk ke portal utama):

| Nama pengguna | Kata sandi | Keterangan |
|---|---|---|
| `lab_mhs01` | `kampus2026` | Sasaran simulasi brute force (kata sandi ke-9 pada kamus uji) |
| `lab_adi` | `adi123` | Pembanding SQL Injection |
| `lab_bela` | `bela123` | Pembanding SQL Injection |
| `lab_citra` | `citra123` | Pembanding SQL Injection |

Di halaman login, klik salah satu baris tabel **Akun demo** untuk mengisi formulir otomatis.

---

## 8. Dua Kerentanan Laboratorium

> **Aturan keselamatan:** kedua kerentanan hanya digunakan untuk pembelajaran di
> lingkungan milik sendiri, dengan data sintetis, pada jalur terpisah dari portal
> utama. Jangan digunakan untuk menyerang situs eksternal. Pada deployment publik
> keduanya **wajib dimatikan** (lihat bagian 14).

### 8.1 Kerentanan 1 — SQL Injection

- **Lokasi:** `src/routes/lab.js` → `router.post('/sqli')`, halaman `views/lab/sqli.ejs`
- **Jalur:** `GET/POST /lab/sqli`
- **Basis data:** `data/lab.db` (tabel `lab_users`) — terpisah dari portal utama

**Sifat kerentanan.** Nilai input disusun menjadi string kueri:

```js
// VERSI RENTAN (hanya untuk latihan)
const sql =
  `SELECT id, username, full_name, role, email FROM lab_users ` +
  `WHERE username LIKE '%${q}%' OR full_name LIKE '%${q}%' ORDER BY id`;
const baris = labDb.prepare(sql).all();       // q berasal dari input pengguna
```

**Cara menguji & hasil yang diharapkan** (panduan lengkap juga ada di halaman lab):

| # | Input | Hasil yang diharapkan |
|---|---|---|
| 1 | Pencarian `lab` | Hanya baris yang mengandung “lab” (4 baris) |
| 2 | Pencarian `' OR '1'='1` | **Seluruh** baris `lab_users` keluar — filter ditembus |
| 3 | Pencarian `x' UNION SELECT id,username,full_name,role,email FROM lab_users -- ` | Kueri UNION dieksekusi, seluruh isi tabel tampil |
| 4 | Login: pengguna `' OR 1=1 -- `, sandi bebas | **Login rentan BERHASIL** tanpa mengetahui kata sandi |
| 5 | Payload yang sama pada kolom “versi perbaikan” | **0 baris / login ditolak** — payload diperlakukan sebagai teks |

**Perbaikannya (query berparameter)** — juga ditampilkan di halaman lab:

```js
// VERSI PERBAIKAN
const sql =
  'SELECT id, username, full_name, role, email FROM lab_users ' +
  'WHERE username LIKE ? OR full_name LIKE ? ORDER BY id';
const baris = labDb.prepare(sql).all(`%${q}%`, `%${q}%`);
```

Pada login laboratorium versi aman, kueri memakai placeholder dan verifikasi kata
sandi dilakukan dengan `bcrypt.compare`.

> **Di mana letak perbedaannya?** Halaman lab menampilkan **kedua versi berdampingan**
> (kueri rentan vs kueri berparameter) beserta hasilnya, sehingga kontrasnya dapat
> diamati langsung. Portal utama **hanya** memakai kueri berparameter
> (`src/routes/auth.js`, `src/routes/admin.js`, dst.).

### 8.2 Kerentanan 2 — Percobaan Sandi Tanpa Pembatasan

- **Lokasi:** `src/routes/lab.js` → `router.post('/login')`, halaman `views/lab/brute.ejs`
- **Jalur:** `GET/POST /lab/login`

**Sifat kerentanan.** Rute login laboratorium tidak menerapkan rate limiting, jeda,
CAPTCHA, maupun penguncian akun. Setiap percobaan hanya dicatat ke
`lab_login_attempts`:

```js
// TIDAK ADA pemeriksaan jumlah percobaan — sengaja untuk latihan
const ok = user && bcrypt.compareSync(password, user.password_hash);
labDb.prepare('INSERT INTO lab_login_attempts (username, success, ip) VALUES (?,?,?)')
     .run(username, ok ? 1 : 0, req.ip);
```

**Cara menguji terbatas & hasil yang diharapkan:**

1. Buka `/lab/login`.
2. Tekan **“Jalankan simulasi percobaan beruntun”** — tombol mengirim 10 percobaan
   login beruntun terhadap `lab_mhs01`.
3. **Hasil yang diharapkan:**
   - seluruh percobaan diterima (status 200, tidak ada 429/blokir);
   - percobaan ke-1 sampai ke-8 **gagal**, percobaan **ke-9 berhasil** (`kampus2026`);
   - tabel “Catatan percobaan” menampilkan seluruh percobaan bertambah;
   - tidak pernah muncul pesan “terlalu banyak percobaan”.
4. Sebagai pembanding, login portal utama (`/login`) menampilkan pesan
   **“Terlalu banyak percobaan gagal. Akun ditahan sementara …”** setelah
   `LOGIN_MAX_FAILS` (default 8) kali gagal.

**Risiko:** penyerang dapat mencoba ribuan kombinasi kata sandi tanpa hambatan
(credential stuffing/brute force), akun sah dapat ditebak, dan tidak ada jejak
pembatasan untuk deteksi serangan.

**Cara memperbaikinya** (contoh diterapkan pada login portal utama di
`src/loginGuard.js`):

```js
// Terapkan pada route POST /login
const cek = guard.check(ip, username, MAX_GAGAL, LOCK_DETIK);
if (cek.locked) {
  return res.redirect('/login'); // "Terlalu banyak percobaan, coba lagi nanti"
}
// ... verifikasi kredensial ...
if (!sukses) guard.registerFailure(ip, username, MAX_GAGAL, LOCK_DETIK);
else guard.reset(ip, username);
```

Untuk produksi gunakan pembatas berbasis IP + nama pengguna (mis. `express-rate-limit`),
jeda/sleep progresif, penguncian akun sementara, CAPTCHA, MFA, dan pemantauan log
percobaan gagal.

---

## 9. Langkah Pengujian Lokal

### 9.1 Uji otomatis (dianjurkan)

```powershell
# terminal 1
npm run reset:db     # database bersih agar hasil dapat diulang
npm start

# terminal 2
npm run smoke        # = node scripts/smoke-test.js
```

`scripts/smoke-test.js` menjalankan **80 pemeriksaan** meliputi: ketersediaan server,
CSRF, login 3 peran, pesan kegagalan, logout, pembatasan peran (403), isolasi nilai
mahasiswa (anti-IDOR), unduhan berkas lintas pengguna, unggah tugas (termasuk penolakan
`.exe`), diskusi (buat/balas/akses silang), penyimpanan nilai dosen, pembatasan login
portal utama, seluruh skenario SQL Injection, brute force tanpa pembatasan, cakupan
seluruh halaman wajib (13 rute harus 200 + halaman 404), serta penonaktifan lab
(`LAB_ENABLED=false` → 404).

### 9.2 Uji manual singkat

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| 1 | `npm run init:db && npm start` | Server menyala di `http://127.0.0.1:3000` |
| 2 | Login `mahasiswa01` / `mhs12345` | Membuka dashboard mahasiswa |
| 3 | Buka **Nilai** | Hanya nilai mahasiswa itu sendiri |
| 4 | Buka **Tugas**, unggah `.pdf` | Status berubah “Sudah diunggah”, muncul tautan unduh |
| 5 | Unggah `.exe` | Ditolak dengan pesan kesalahan |
| 6 | Buka **Diskusi**, buat topik lalu balas | Topik & balasan tersimpan dan tampil |
| 7 | Ubah URL ke `/admin` | **403 — Akses Ditolak** |
| 8 | Login `dosen01`, buka **Penilaian**, simpan nilai | Nilai tersimpan (refresh tetap ada) |
| 9 | Coba nilai kelas dosen lain (ganti `?course=`) | Ditolak, data tidak berubah |
| 10 | Login `admin`, buat akun lalu ubah peran & status | Akun muncul, peran/status berubah, akun nonaktif tidak bisa login |
| 11 | Buka `/lab/sqli`, coba payload di atas | Versi rentan tertembus, versi parameter tidak |
| 12 | Buka `/lab/login`, jalankan simulasi | Semua percobaan diterima, tebakan ke-9 berhasil |
| 13 | Salah login 8–9 kali di `/login` utama | Muncul pesan penahanan sementara |

---

## 10. Keamanan Portal Utama

| Aspek | Implementasi | Lokasi |
|---|---|---|
| Hash kata sandi | bcrypt (cost 10) | `scripts/init-db.js`, `src/routes/auth.js`, `src/routes/admin.js` |
| Sesi backend | `express-session`, cookie `httpOnly`, `sameSite=lax`, `secure` di produksi, masa berlaku 8 jam | `server.js` |
| Rotasi sesi | `req.session.regenerate()` saat login (mencegah session fixation) | `src/routes/auth.js` |
| Logout | `session.destroy()` + penghapusan cookie | `src/routes/auth.js` |
| Otorisasi server | `requireRole(...)` pada seluruh rute per peran | `src/middleware/auth.js` |
| Isolasi nilai | Query nilai SELALU memakai `id` dari sesi; tidak ada parameter ID milik orang lain | `src/routes/mahasiswa.js` |
| Kepemilikan berkas | Unduhan memeriksa pemilik/dosen pengampu/admin | `src/routes/files.js` |
| Kepemilikan kelas | Aksi dosen dicek `courses.dosen_id = sesi.user.id` | `src/queries.js` |
| Validasi unggahan | Whitelist ekstensi + MIME, ukuran maksimal 5 MB, nama berkas acak, folder `uploads` tidak disajikan statis | `src/routes/mahasiswa.js` |
| CSRF | Token per sesi pada **semua** POST (termasuk lab) | `src/middleware/auth.js` |
| SQL Injection | Seluruh kueri portal utama memakai placeholder `?` | semua `src/routes/*` |
| Validasi input | Pemotongan panjang, pola username, rentang nilai 0–100, peran whitelist | `src/routes/admin.js`, `src/routes/dosen.js` |
| Pembatas login | 8 kegagalan → tahan 300 detik (hanya portal utama) | `src/loginGuard.js` |
| Penanganan error | Pesan generik ke pengguna, detail dicatat ke log server | `server.js` |
| Environment variables | Rahasia dibaca dari `.env` yang tidak di-commit | `src/config.js`, `.gitignore` |

Laboratorium dirancang **terpisah**: jalur berbeda (`/lab/*`), database berbeda
(`data/lab.db`), tidak memakai sesi portal, dan dapat dimatikan sepenuhnya dengan
`LAB_ENABLED=false` sehingga tidak memengaruhi keamanan portal utama.

---

## 11. Environment Variables

Salin `.env.example` menjadi `.env`:

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `HOST` | `127.0.0.1` | Alamat bind server |
| `SESSION_SECRET` | (wajib diisi) | Rahasia sesi — **ganti dengan string acak panjang** |
| `NODE_ENV` | `development` | `production` saat deployment |
| `LAB_ENABLED` | `true` di dev, `false` bila `NODE_ENV=production` | `true`/`false` — gerbang `/lab/*` |
| `MAX_UPLOAD_BYTES` | `5242880` (5 MB) | Batas ukuran unggahan tugas |
| `LOGIN_MAX_FAILS` | `8` | Kegagalan login sebelum ditahan |
| `LOGIN_LOCK_SECONDS` | `300` | Durasi penahanan login |

`.env` sudah masuk `.gitignore` — **jangan pernah** menyertakannya ke repository.
Berkas yang tidak boleh di-commit: `.env`, `data/*.db`, `uploads/*`, `node_modules/`.

---

## 12. Mengunggah ke GitHub

> Catatan: langkah di bawah adalah **panduan**. Repositori belum dibuat/diunggah
> oleh asisten ini — lakukan sendiri agar Anda memegang kendali akun GitHub.

```powershell
# 1. Dari folder proyek, inisialisasi git
git init
git add .
git status            # PASTIKAN .env, data/*.db, uploads/* TIDAK muncul

# 2. Buat branch utama & commit
git branch -M main
git commit -m "KampusKu - Portal Akademik Fiktif (proyek latihan audit M5-M6 KSI)"

# 3. Buat repository kosong di https://github.com/new (Public, tanpa README)
git remote add origin https://github.com/USERNAME/kampuskue.git
git push -u origin main
```

**Checklist keamanan sebelum push:**

- [ ] `git status` tidak menampilkan `.env`
- [ ] `git status` tidak menampilkan `data/*.db` maupun `uploads/*`
- [ ] `SESSION_SECRET` di `.env.example` tetap berupa placeholder
- [ ] Tidak ada kata sandi asli (semua akun di proyek ini memang sintetis)

Jika `.env` sempat ter-commit, segera: hapus dari tracking (`git rm --cached .env`),
buat commit, **lalu ganti nilai `SESSION_SECRET`**.

---

## 13. Deployment

Aplikasi adalah aplikasi Node biasa sehingga dapat dideploy ke layanan apa pun
(Render, Railway, Fly.io, VPS, dll.). Contoh umum:

**A. VPS / Windows Server (paling sederhana)**

```bash
git clone https://github.com/USERNAME/kampuskue.git
cd kampuskue
npm install --omit=dev
cp .env.example .env            # lalu isi SESSION_SECRET & LAB_ENABLED=false
npm run init:db                 # bangun database di server
NODE_ENV=production npm start   # atau gunakan pm2: pm2 start server.js --name kampuskue
```

**B. Layanan PaaS (mis. Render.com)**

- *Build command:* `npm install`
- *Start command:* `npm run init:db && npm start`
- *Environment variables:* set `NODE_ENV=production`, `SESSION_SECRET` (acak),
  `LAB_ENABLED=false`, `PORT` (sering disediakan platform).
- Karena `data/*.db` bersifat sementara pada PaaS, gunakan *persistent disk* jika
  ingin data bertahan, atau gunakan layanan dengan storage tempel.

**C. Di balik reverse proxy (nginx)**

- Set `TRUST proxy` otomatis aktif saat `NODE_ENV=production` (lihat `server.js`)
  agar cookie `secure` bekerja di balik HTTPS.
- Aktifkan HTTPS (Let’s Encrypt) — cookie ditandai `secure` pada mode produksi.

**Setelah deploy, wajib:** `LAB_ENABLED=false` (atau biarkan kosong — otomatis mati
di produksi) dan ganti `SESSION_SECRET`.

---

## 14. Menutup Laboratorium pada Deployment Publik

Tiga cara (boleh digabung):

1. **Env var** — setel `LAB_ENABLED=false`. Semua rute `/lab/*` akan membalas **404**.
2. **Otomatis di produksi** — jika `LAB_ENABLED` tidak diisi dan
   `NODE_ENV=production`, laboratorium **nonaktif secara bawaan** (lihat `src/config.js`).
3. **Pembungkus tambahan** — bila tetap perlu diakses, lindungi dengan autentikasi
   tingkat proxy (nginx `auth_basic`) dan IP allowlist.

Cara memverikasinya:

```powershell
# Dari luar (atau set LAB_ENABLED=false lalu restart):
curl -i http://HOST_ANDA/lab          # harus 404
curl -i http://HOST_ANDA/lab/sqli     # harus 404
curl -i http://HOST_ANDA/lab/login    # harus 404
curl -i http://HOST_ANDA/login        # harus 200 (portal tetap jalan)
```

Uji otomatis untuk hal ini sudah termasuk dalam `scripts/smoke-test.js`
(bagian **M**).

---

## 15. Batasan & Catatan Pengujian

**Yang sudah diuji dan LULUS** (lihat bagian 9.1): seluruh **80 pemeriksaan** pada
`scripts/smoke-test.js` — ketersediaan server, CSRF, login/logout ketiga peran,
pembatasan peran, isolasi nilai anti-IDOR, unggah & penolakan berkas, diskusi,
penyimpanan nilai dosen (positif & negatif), pengelolaan akun admin, pembatasan
login portal utama, seluruh skenario kedua laboratorium, render semua halaman wajib,
serta penonaktifan lab.

**Yang tidak dikerjakan (di luar cakupan):**

- **Belum** ada repository GitHub yang dibuat dan **belum** ada deployment —
  keduanya memerlukan akun Anda; panduannya ada di bagian 12 dan 13.
- Pengujian beban (*load testing*), audit kode oleh pihak ketiga, dan
  pengujian lintas-peramban otomatis tidak dilakukan.
- Uji visual dilakukan lewat pemeriksaan HTML tanggapan; tidak ada browser
  otomatis (Playwright/Puppeteer) yang dipasang.

**Dua kerentanan yang disengaja** (SQL Injection dan tidak adanya pembatasan
percobaan login) **hanya** ada di `/lab/*`. Jangan menambahkan kerentanan lain
(Stored XSS, IDOR, CSRF, validasi berkas lemah, sesi tidak berakhir, eskalasi
hak akses) pada proyek ini.
