// Tema terang/gelap. Kunci localStorage sama dengan dasbor (src/lib/theme.tsx) karena satu origin,
// jadi pilihan di dasbor otomatis berlaku di admin, dan sebaliknya. Tanpa pilihan: terang, seperti dasbor.
// Dimuat tanpa defer di <head> supaya warna sudah benar sebelum halaman tergambar.
(function () {
  var KUNCI = "terawang.theme";
  function baca() {
    try { var t = localStorage.getItem(KUNCI); if (t === "light" || t === "dark") return t; } catch (e) { /* tidak tersedia */ }
    return "light";
  }
  function pasang(t) {
    document.documentElement.dataset.theme = t;
    var tombol = document.getElementById("tombol-tema");
    if (tombol) {
      tombol.textContent = t === "dark" ? "Mode terang" : "Mode gelap";
      tombol.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
    }
  }
  pasang(baca());
  window.gantiTema = function () {
    var t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KUNCI, t); } catch (e) { /* abaikan */ }
    pasang(t);
  };
  // Ikut berubah bila tema diganti di tab dasbor/admin lain.
  window.addEventListener("storage", function (e) { if (e.key === KUNCI) pasang(baca()); });
  document.addEventListener("DOMContentLoaded", function () {
    pasang(baca());
    var tombol = document.getElementById("tombol-tema");
    if (tombol) tombol.addEventListener("click", window.gantiTema);
  });
})();
