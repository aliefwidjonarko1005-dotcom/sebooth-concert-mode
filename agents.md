# Sebooth — Agent Guide

Photobooth kiosk app (Electron + React), versi **vertikal + tombol fisik**. Repo: `T44ro/sebooth-vertical-button`.
Website/portal klaim foto ada di repo terpisah: `06 Sebooth Proposal Company Profile\sebooth-website` (Next.js, Vercel). Agent boleh langsung pindah antar kedua folder kalau task butuh full-stack.

## Stack
- **Desktop**: Electron, React 18, Vite (`electron-vite`), TypeScript, Zustand, React Router v6 (**HashRouter**), framer-motion.
- **Media**: `sharp`, `fluent-ffmpeg`, `gifenc`, `pdf-lib`. **Print**: `pdf-to-printer` + `PrintQueueService`.
- **Cloud**: Supabase (metadata/log), Google Cloud Storage (media), Cloudflare CDN. Sharing = QR code ke web portal (bukan LINE bot/webhook).
- **Kamera**: Canon EDSDK via helper C# `CanonHelper.exe` (x64), digiCamControl, WIA, webcam/capture card HDMI, mock.

## Struktur
- `src/main/` — main process: hardware, ffmpeg, print, cloud, Express server (`server.ts`, port 5050, serve dashboard remote).
- `src/main/ipc/` — IPC handler (`camera`, `printer`, `cloud`, `queue`, `payment`, `system`...).
- `src/main/services/` — `PrintQueueService`, `RemotePrintService`, `QueueService`, `UploadQueueService`, `JanitorService`, `ConfigService`.
- `src/preload/` — context bridge. `src/shared/` — tipe & channel IPC. `src/renderer/` — React UI.
- `sebooth-gallery/` — (gitignored) aset landing klaim foto.

## Alur halaman (`src/renderer/pages/`)
`Landing` → (`QueueDisplay` bila Queue Mode) → `Tutorial` (dilewati saat `concertMode`; navigasi lewat `startRoute()`) → `PaymentGateway` → `FrameSelection` → `CaptureSession` → `PhotoReviewPage` → `ReviewSession` (filter) → `OutputPage` → `SharingPage` → `PrintingPage` → kembali ke Landing/Queue. `AdminDashboard` = settings, analytics xlsx, queue, printer, layout.

Orientasi = mode input: **portrait = booth tombol fisik**, **landscape = touchscreen** (`useInputMode()`). Tombol fisik `1` `2` `3` ada di sisi kanan layar (1 atas, 2 tengah, 3 bawah). Handler key ada di tiap page; labelnya tampil di `ButtonRail` lewat `useButtonHints`. Layout harus jalan di landscape (1920×1080) dan portrait (1080×1920, `body.app-portrait`).

## Aturan wajib
1. **IPC aman**: jangan expose `ipcRenderer`/Node ke renderer. Channel + payload didefinisikan di `src/shared/`. Secret (GCP, Supabase service key) hanya di main.
2. **Kerja berat di main** (ffmpeg, sharp, pdf, LUT). Pakai `async` fs, bukan `*Sync`.
3. **Hardware tidak boleh bikin crash**: try/catch, log diam-diam, fallback (mock/webcam).
4. **Dua mode terisolasi**: portrait (tombol fisik) dan landscape (touchscreen) tidak boleh saling memengaruhi. Perubahan untuk satu mode hanya di `:global(body.app-portrait)` / `:global(body.app-landscape)` (atau `body.has-dock`) di `.module.css` halaman, dan di JS lewat cabang `appOrientation`/`useInputMode()`; jangan ubah gaya dasar bersama untuk memperbaiki satu mode. Blok khusus landscape ditandai `LANDSCAPE (touch booth) ONLY`. Ukuran di landscape harus mengikuti tinggi layar (1080p dengan skala Windows 125% = viewport ±1530×893), bukan angka tetap.
5. **Admin dark theme** di-scope ke `.container` di `AdminDashboard.module.css`; jangan bocor ke kiosk.
6. **Perubahan kecil & terarah** (lihat skill `ponytail`). Jangan refactor di luar scope.

## Jebakan yang sudah pernah kena (jangan diulang)
- Cek route pakai `window.location.hash.startsWith('#/capture')` — app pakai HashRouter, `pathname` selalu `/`.
- Canon EDSDK: satu proses `CanonHelper.exe` saja (COM port "in use" kalau dobel). Jangan `listCameras()`/`connect()` ulang saat helper hidup. Jangan stop live view di cleanup kalau capture card aktif (mirror turun → HDMI pelangi).
- Live view HDMI: `LiveViewDevice = 3` (Camera+Host). Polling frame USB (`START_POLLING`) hanya saat countdown, lalu `STOP_POLLING` — polling terus-menerus memutus HDMI.
- Recording live photo mode EDSDK + capture card: pakai `MediaRecorder` dari stream capture card; kirim `videoSource` ke `save-session-locally` agar tidak double rotate/mirror.
- Array turunan di `CaptureSession` harus di-`useMemo` (pernah infinite render loop).
- `CaptureSession`: stream preview hanya dibuka oleh effect "Unified Init" (jangan tambah `initWebcam()` lain — dua init balapan bikin "Initializing camera" muncul di tengah countdown dan live photo rusak). Re-init stream hanya saat `idle`. Shutter ditolak sampai `cameraReady`. Mode DSLR + capture card tidak boleh fallback ke webcam laptop. Handler keyboard memakai closure lama → baca state lewat ref (`cameraReadyRef`, `triggerCaptureRef`).
- `camera:use-canon-edsdk` bisa terpanggil berkali-kali (StrictMode): jangan buat handler Canon baru kalau sudah ada, dan `connect()` wajib dedupe (in-flight promise) — kalau tidak, helper yatim mengunci kamera.
- Canon EDSDK keep-alive: Node kirim `KEEPALIVE` tiap 45 dtk → helper `EdsSendCommand(ExtendShutDownTimer)` agar kamera tidak auto power-off.
- Duplicate slot: operasi foto pakai `sourceSlotId` (resolve `duplicateOfSlotId`), bukan `slotId`.
- Jumlah cetak: `printQuantity` disimpan saat payment; copies = `Math.round(qty / 2)`.
- Setelah ubah `CanonHelper.cs`, compile ulang x64 dengan `csc.exe` Framework64.
- **Tombol fisik**: tombol 3 SELALU maju/OK di setiap halaman; 1/2 aksi sekunder. Daftarkan label lewat `useButtonHints` (rail kanan). Jangan tambah overlay penunjuk di area kamera (pengecualian: stiker pil "Tekan 3" di tepi bawah preview `CaptureSession`). Dialog yang muncul di kiosk wajib bisa dijawab tombol fisik: `ConfirmBackHomeModal` menangani 1 (ya, batalkan) / 3 (lanjutkan) sendiri di capture phase dan memasang label rail lewat `useButtonHintsOverride` — jangan tangani tombol modal lagi di halaman. Tekanan dobel sudah difilter `KeyGuard` (400 ms per tombol + kunci 700 ms tiap ganti halaman) — jangan buat debounce sendiri.
- **Desain kiosk**: tema poster royal blue (`--brand-royal`), judul `kiosk-title` (Bayon), angka pakai `kiosk-num` (Bayon menggambar 1 seperti I). Tanpa emoji, tanpa ungu; gradasi hanya di animasi abstrak `AmbientArt` (Landing, diatur di Admin → Timers → Animasi Beranda). Semua halaman kiosk memakai gaya stiker kartun 2D (`components/CaptureArt`: SVG flat + outline ink, animasi CSS transform-only, hormati reduced-motion). Anti-"AI slop" (audit taste-skill): tanpa eyebrow/kicker di atas judul, judul satu warna (tanpa kata aksen), tanpa label kecil kapital-renggang, tanpa panah/emoji tempelan di tombol, tanpa konfeti generik (motif latar hanya maskot kamera bermata logo); bayangan keras + miring hanya untuk SATU objek utama per layar (aksi tombol 3 / QR / nomor / kode), sisanya cukup outline ink; teks kecil di atas oranye pakai ink (putih cuma 3,5:1). Logo = `SeboothLogo` (sinkron dengan `sebooth-website/src/components/ui/SeboothLoader.tsx`). Font dibundel lokal via `@fontsource` (offline).
- Overlay/modal `position: fixed` selebar layar wajib `right: var(--rail-w)` (bukan `right: 0`/`inset: 0`) supaya tidak tertimpa rail tombol; kalau di portrait dibuat `absolute` di dalam container stage, kembalikan ke `right: 0`.
- Latar kartun bersama (`.kiosk-art` di `App.tsx`, z-index -1) hanya terlihat kalau container halaman `background: transparent`; kartu/tombol pakai token stiker (`--ink-line`, `--sticker-shadow*`, `--brand-sun`).
- Mode sentuh (landscape): rail disembunyikan; hint tanpa `onScreen: true` muncul sebagai dok tombol sentuh yang men-dispatch `keydown` 1/2/3 (jalur aksi tetap satu). Halaman yang sudah punya tombol layar untuk aksi itu wajib menandai hint-nya `onScreen`; teks "Tekan 3" ganti "Ketuk" dan badge angka disembunyikan (`body.app-landscape`).
- Touch (landscape): carousel pakai `lib/useSwipe.ts` (kosong di portrait) dan `onTap` (bukan `onClick`, supaya akhir swipe tidak dianggap ketukan); maskot pemandu `components/GuideTransition` memainkan aksi per route (tirai/flash/cetak) di kedua mode (portrait 1,6 dtk + tombol 1/2/3 ditahan selama aksi; dimatikan saat `concertMode`); blok khusus portrait ditandai `PORTRAIT (button booth) ONLY`, dan maskot hiasan portrait disembunyikan di `PORTRAIT_BUSY_ROUTES` (`App.tsx`) — tambah route baru → tambahkan baris di `SCRIPT` dan langkah di `MascotAssistant.STEPS` (+ reaksi di `react()`); halaman melaporkan aksi pelanggan lewat `emitMascot()` / `useEmitOnChange()` (`lib/mascotEvents.ts`, swipe sudah otomatis dari `useSwipe`) (asisten opsional, `config.mascotAssistant`, default mati; tips hanya boleh menyebut kontrol yang memang ada di halaman itu).
- Vite kadang tidak menangkap perubahan `.module.css` yang ditulis cepat berturut-turut → `touch` file-nya kalau class tidak muncul.
- `server.ts`: `POST /api/print/:sessionId` menangkap semua path `/api/print/<x>` — daftarkan endpoint `/api/print/*` baru **sebelum** route itu.
- Port 5050 (`server.ts`) menyajikan `out/renderer` = **build terakhir**, bukan dev server. Saat `npm run dev`, HP yang buka `http://<ip>:5050/#/loket` melihat UI lama; cek perubahan renderer di `http://localhost:5173/#/loket` atau `npm run build` dulu.
- Jangan pernah `await` upload/Supabase/GCS di alur sesi. Media → `system:finalize-session` (fire-and-forget), upload → `UploadQueue` (persisten, berurutan). Print remote → `sendOrQueue` (disimpan ke disk kalau server mati; server dedupe per `sessionId`).

## Perintah
- Dev: `npm run dev` · Build: `npm run build` · Installer: `npm run build:win`
- Typecheck: `npm run typecheck` · Refresh graph: `npm run graph:update` · Refresh index skill: `npm run skills:index`

## Tooling agent
- **Codemap**: [`docs/agent/CODEMAP.md`](docs/agent/CODEMAP.md) — route, IPC, endpoint, dan "mau ubah X → file mana". Baca ini sebelum eksplorasi.
- **Skills**: index di [`docs/agent/SKILLS_INDEX.md`](docs/agent/SKILLS_INDEX.md) (regenerate: `python scripts/gen-skills-index.py`). Default kerja: `ponytail` (perubahan minimal), `investigate-first`/`systematic-debugging` untuk bug hardware, `verify-and-stop` sebelum selesai.
- **graphify**: peta kode di `graphify-out/` (`GRAPH_REPORT.md`, `graph.json`). Sebelum grep luas, coba `graphify query "<pertanyaan>"`, `graphify explain "<Simbol>"`, `graphify affected "<Simbol>"`. Refresh setelah perubahan besar: `graphify update .` (tanpa biaya LLM).
- **rtk**: bungkus perintah yang outputnya panjang supaya hemat token: `rtk git diff`, `rtk tsc`, `rtk grep`, `rtk err npm run build`, `rtk log <file>`.

## Changelog (wajib)
Setiap perubahan struktural/fitur/arsitektur: tambahkan **1 baris ringkas** di akhir [`docs/agent/CHANGELOG.md`](docs/agent/CHANGELOG.md) dengan format `- **<Bulan Tahun> (<Judul>)**: <apa & file utama>`. Kalau perubahan itu melahirkan jebakan baru, tambahkan juga ke bagian "Jebakan" di atas. Jangan menulis changelog panjang di file ini.
