# Rencana implementasi — 4 celah (tanpa menyentuh kode intro)

Disetujui 2026-10-11 · read-only · **tidak ada file implementasi intro yang diubah**

> Permintaan pemilik: **tolak `scrollbar-gutter: stable`**, pertahankan kompensasi
> `--intro-gutter` yang hanya aktif selama `intro-active`. Jangan ubah file
> implementasi intro kecuali ada bukti masalah — **belum ada bukti, jadi tidak ada
> yang diubah.**

---

## Ringkas bukti (dasar keputusan)

| Temuan | Angka |
|---|---|
| Mekanisme blank (proven) | re-injeksi skin lama → `<html>` opacity 0 → pixel `rgb(18,18,18)`, **variance 0** |
| Kunci scroll B (HEAD) bekerja | `scrollY=0` di 32 skenario; F5 dari 4000 → `0` di 7 sampel |
| `scrollbar-gutter: stable` | shell `left 83 → 78` = **−5px permanen** → **ditolak** |
| Durasi entrance | 4950ms (spec 5000±150) |
| Skipping | 105–319ms (spec <500ms) |

---

## Gap 1 — `tools/diagnose-intro-scroll.mjs` (DUA cacat, bukan satu)

### 1a. `void dir` di luar loop
- Baris 32 `for (const dir of [1, 1]) {` memblok-scope `dir`; baris 40 `void dir;` di
  luar loop → `ReferenceError: dir is not defined`. **Keempat run swipe mati**
  (terbukti: output `ERR swipe@t200 (mob): dir is not defined` ×4).

### 1b. `touchscreen.tap` mematikan intro sebelum swipe terjadi
Baris 30 `await p.touchscreen.tap(195, 400).catch(() => {})` mengirim
pointerdown+pointerup → `js/intro.js:494 onPointerUp` → `finish('tapped', true)`.

**Diukur:** setelah tap, dalam **424ms**: `intro-active=false`, `intro-compressed=true`.

Artinya **walaupun 1a diperbaiki, skenario swipe tidak pernah menguji kunci scroll** —
intro sudah selesai sebelum jarinya bergerak. Ini cacat yang lebih dalam dan harus
diperbaiki bersama.

### Edit (3 baris)
| Baris | Dari | Jadi |
|---|---|---|
| 30 | `await p.touchscreen.tap(195, 400).catch(() => {});` | *(hapus)* |
| 32 | `for (const dir of [1, 1]) {` | `for (let s = 0; s < 2; s++) {` |
| 40 | `void dir;` | *(hapus)* |

Meniru `check-intro-scroll.mjs:176-184` yang sudah benar.

### Titik uji
`node tools/diagnose-intro-scroll.mjs` → **32 baris, 0 `ERR`**.
Baris swipe wajib: t=200 & t=1000 → `scrollY` awal `0` + `ovf=hidden` (kunci menahan);
t=2500 & t=4000 → `scrollY` jadi ≠ 0 (intro sudah selesai, swipe正常).
Bukti acuan Already ada dari uji manual: `mobile/swipe@t200 → locked=true, scrollY 0`.

---

## Gap 2 — `tools/check-intro-scroll.mjs` + `package.json`: `--quick` / `--full`

Masalah: matriks `runInputMatrix` = **60 run** (7 input desktop + 8 mobile × 4 waktu),
diukur **~21 detik/run ≈ 22–25 menit**, dan ikut di `npm run check` → gerbang
praktis tidak pernah dijalankan.

### Edit
1. `const FULL = has('full');` (pakai helper `has()` yang sudah ada, baris 43).
2. `runInputMatrix`: bila `!FULL`, batasi ke **desktop**, input
   `{wheel, space, end, dragscroll}`, waktu `{200, 2500}` → **8 run**.
   - `200` dan `2500` adalah dua waktu yang sudah dianggap kritis oleh file itu sendiri
     (baris 333 `const worst = t === 200 || t === 2500`).
   - keempat input tetap merepresentasikan empat jalur berbeda:
     wheel (`preventDefault`), Space (keyboard), End (lompatan besar), dragscroll (tidak bisa dicegah).
3. `--no-inputs` tetap honored. `--full` mengembalikan matriks 60-run.
4. `extras()` **selalu jalan di kedua mode** — di sinilah invarian sebenarnya:
   entrance 5000±150 · skip ×4 · rerefresh ×2 · bfcache · hidden-tab · `?intro=off`/deep-link · motion ×2.

### `package.json`
```diff
-    "check:intro-scroll": "node tools/check-intro-scroll.mjs",
+    "check:intro-scroll": "node tools/check-intro-scroll.mjs",
+    "check:intro-scroll:full": "node tools/check-intro-scroll.mjs --full",
```
`npm run check` **tidak berubah** (tetap memanggil `check:intro-scroll`, yang kini quick).

### Titik uji
| Perintah | Target waktu | Harus hijau |
|---|---|---|
| `npm run check:intro-scroll` | **< 6 menit** | ya |
| `npm run check:intro-scroll:full` | ~22–25 menit | ya |

Catat **kedua angka aktual** di HANDOFF §gates. Bila quick masih >6 menit, pangkas
`{wheel, end, dragscroll}` (Space bisa masuk `--full`).

---

## Gap 3 — `HANDOFF.md` (dokumen saja, satu-satunya yang stale)

`css/intro.css` sudah mendokumentasikan kunci scroll dengan benar; **HANDOFF.md
satu-satunya dokumen yang bertentangan dengan kode.**

### 3a. Ganti §"Three decisions that are not obvious" butir 1 (baris 39–54)
Teks sekarang: *"There is no scroll lock, and adding one back is a regression"* +
*"`scrollbar-gutter: stable` is the obvious repair and it is worse"* — **keduanya
sudah salah** (kode memang memakai `overflow:hidden`; `stable` memang ditolak).

Ganti dengan apa yang benar-benar ada:
- kunci **3 lapis**: `overflow:hidden` + kompensasi `--intro-gutter` (padding, **hanya saat
  `intro-active`**), `preventDefault` non-passive pada wheel/touchmove/keydown, satu
  `scroll` listener yang hanya memanggil `scrollTo(0,0)` bila `scrollY !== 0`;
- `history.scrollRestoration='manual'` + `scrollTo(0,0)` di titik kritis, tanpa loop per frame;
- `scrollbar-gutter: stable` **ditolak karena diukur**: shell `left 83 → 78` = −5px
  permanen untuk semua pengunjung (termasuk `motion-reduced`), karena gutter direserve
  tanpa syarat saat halaman diam.

### 3b. Tabel file (baris 99–108)
Tambah baris: `tools/check-intro-scroll.mjs` + script `check:intro-scroll`; dan
terangkan bahwa `js/reveal.js` kini memiliki sweep serah-terima
(`recover()` / `passVisible()` / `startSelfHeal()`).

### 3c. §"Known state of the gates" (baris 110–124)
Pernyataan "`npm run check` hijau kecuali satu assertion" sudah usang → catat hasil
pengukuran ulang + pemecahan quick/full.

### Titik uji
Baca diff; pastikan **tidak ada lagi** klaim "no scroll lock" dan **tidak ada** rekomendasi
`scrollbar-gutter: stable` di HANDOFF.

---

## Gap 4 — uji cabang bfcache secara sintetis

### Mengapa sintetik (bukti)
Di localhost **bfcache tidak pernah terjadi**: `page.goBack()` menghasilkan
`pageshow.persisted=false` dengan **hanya satu** `pageshow` → itu full reload, bukan
restore. Jadi blok Back/Forward yang sudah ada (`check-intro-scroll.mjs:492-521`)
**tidak pernah memasuki cabang `if (e.persisted)`**. Cabang itu belum pernah diuji.

### Yang ditambahkan — dua sub-kasus di `extras()`

**4a. Setelah intro selesai** (properti pembeda bfcache: posisi scroll **harus dipertahankan**)
```
scroll ke 2500 → dispatch new PageTransitionEvent('pageshow',{persisted:true})
assert: scrollY MASIH 2500  (bukan 0 — inilah yang membedakan bfcache dari reload)
        !intro-active && !intro-exit · overlay hilang · overflow visible · tak ada inert
        scrollRestoration === 'auto' · hiddenInView === 0
```
*Diverifikasi hari ini:* scrollY `2500 → 2500`, semua bersih.

**4b. Saat intro masih berjalan** (t≈400ms, sebelum handover)
```
dispatch pageshow{persisted:true} → waitForFunction(OVER) → settle(page) → wait(1500)
assert: intro-active=false && intro-exit=false · overlay hilang · overflow visible
        scrollRestoration === 'auto' · tak ada inert · hiddenInView === 0 · htmlOpacity ≥ 0.99
```
*Diverifikasi hari ini:* `hidden=0 cover=0 htmlOp=1 ovf=visible restore=auto inert=false` ✅

> `hiddenInView` **wajib** didiagnosis setelah `settle()` + `1500ms`. Tanpa itu
> tercatat `hiddenInView=10` (sistem reveal masih.flush) — bukan bug, hanya belum selesai.

Blok Back/Forward yang sudah ada **tetap dipertahankan** — masih bernilai, hanya
rupanya tidak menguji bfcache.

---

## File yang akan diubah

| File | Perubahan |
|---|---|
| `tools/diagnose-intro-scroll.mjs` | 3 baris (hapus tap, ganti loop, hapus `void dir`) |
| `tools/check-intro-scroll.mjs` | filter matriks quick/full + blok bfcache sintetik |
| `package.json` | tambah `check:intro-scroll:full` |
| `HANDOFF.md` | 3 seksi (kunci scroll B, tabel file, status gerbang) |

## File yang **TIDAK** disentuh

`index.html` · `js/intro.js` · `js/reveal.js` · `css/intro.css` · `css/animations.css` ·
`css/bundle.css` — **tidak ada bukti masalah pada berkas-berkas ini.**

---

## Verifikasi akhir (setelah implementasi)

```
npm run check:intro-scroll            # quick — catat waktunya
npm run check:intro-scroll:full       # catat waktunya
node tools/diagnose-intro-scroll.mjs  # 32 baris, 0 ERR
npm run check:fluid && npm run check:motion && npm run check:hero-edge
npm run check:css && npm run build:css -- --check
```

**Langkah 0 — pemilik, manual, di Chrome desktop:** F5 saat intro, scroll, cek
Developer Tools → `<html>` tidak pernah `opacity: 0`, dan scrollbar benar-benar
hilang saat intro. **Hanya bisa dilakukan di mesin pemilik:** mesin ini memakai
overlay-scrollbar (`scrollbarPx=0` sepanjang waktu, tidak ada Xvfb), sehingga klaim
shift scrollbar klasik **tidak dapat diverifikasi di sini**.

---

## Risiko

| Risiko | Mitigasi |
|---|---|
| Quick mempersempit matriks 60→8 run | quick mempertahankan 4 jalur gesture + 2 waktu batas; sisanya di `--full` |
| Assertion `scrollY===2500` rapuh bila layout berubah | gunakan `>= 2000`, bukan nilai persis |
| `_FULL` tak，默认 quick — ada yang mengira sudah penuh | print mode yang berjalan di header output |
| Dokumen jadi basi lagi | Gate §gates di HANDOFF menyebut perintah + waktunya |