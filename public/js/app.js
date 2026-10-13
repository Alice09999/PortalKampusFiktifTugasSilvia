/* KampusKu — perilaku umum antarmuka (tanpa pustaka eksternal) */
(function () {
  'use strict';

  // --- Buka/tutup menu navigasi pada layar kecil --------------------
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // --- Tutup notifikasi kilat --------------------------------------
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.alert .close');
    if (btn) {
      var alert = btn.closest('.alert');
      if (alert) alert.remove();
    }
  });

  // --- Konfirmasi aksi merusak (data-confirm) -----------------------
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.dataset && form.dataset.confirm) {
      if (!window.confirm(form.dataset.confirm)) {
        e.preventDefault();
      }
    }
  });

  // --- Isi formulir otomatis dari baris tabel (data-fill) -----------
  document.addEventListener('click', function (e) {
    var row = e.target.closest('[data-fill]');
    if (!row) return;
    var sel = row.getAttribute('data-fill');
    var pairs;
    try {
      pairs = JSON.parse(sel);
    } catch (err) {
      return;
    }
    Object.keys(pairs).forEach(function (target) {
      var el = document.querySelector(target);
      if (el) el.value = pairs[target];
    });
    var focusTarget = document.querySelector(row.getAttribute('data-focus') || 'input');
    if (focusTarget && focusTarget.focus) focusTarget.focus();
  });

  // --- Laboratorium: jalankan beberapa percobaan login otomatis -----
  var autoBtn = document.getElementById('autoRun');
  if (autoBtn) {
    var tbody = document.querySelector('#autoResults tbody');
    var counter = document.getElementById('autoCount');
    autoBtn.addEventListener('click', function () {
      var words;
      try {
        words = JSON.parse(autoBtn.getAttribute('data-words'));
      } catch (err) {
        return;
      }
      var username = autoBtn.getAttribute('data-username');
      var csrf = autoBtn.getAttribute('data-csrf');
      autoBtn.disabled = true;
      autoBtn.textContent = 'Menjalankan...';

      var i = 0;
      function next() {
        if (i >= words.length) {
          autoBtn.disabled = false;
          autoBtn.textContent = 'Jalankan simulasi percobaan beruntun';
          return;
        }
        var word = words[i++];
        fetch('/lab/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ username: username, password: word, _csrf: csrf, format: 'json' })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var tr = document.createElement('tr');
            tr.innerHTML =
              '<td>' + i + '</td>' +
              '<td><code>' + word.replace(/[<>&]/g, '') + '</code></td>' +
              '<td>' + (data.ok
                ? '<span class="badge ok">BERHASIL</span>'
                : '<span class="badge err">gagal</span>') + '</td>' +
              '<td class="num">' + data.totalPercobaanAkun + '</td>' +
              '<td>' + data.message.replace(/[<>&]/g, '') + '</td>';
            if (tbody) tbody.insertBefore(tr, tbody.firstChild);
            if (counter) counter.textContent = data.totalPercobaanAkun;
            if (data.ok) {
              autoBtn.disabled = true;
              autoBtn.textContent = 'Berhasil ditebak — hentikan simulasi';
              return;
            }
            setTimeout(next, 90);
          })
          .catch(function () {
            autoBtn.disabled = false;
            autoBtn.textContent = 'Jalankan simulasi percobaan beruntun';
          });
      }
      next();
    });
  }

  // --- Laboratorium SQLi: sembunyikan tabel hasil kosong ------------
  document.querySelectorAll('[data-hide-empty]').forEach(function (el) {
    if (el.querySelectorAll('tbody tr').length === 0) el.style.display = 'none';
  });
})();
