# Codemap (roadmap codebase)

Peta navigasi singkat: baca ini dulu, lalu `graphify query/explain` untuk detail, lalu buka file. Jangan baca file besar utuh — pakai offset/grep setelah tahu lokasinya.
Ukuran (baris) dicantumkan supaya tahu file mana yang mahal dibaca. Update file ini kalau ada file/route/IPC baru.

## Alur data satu sesi
```
Renderer page ──window.api.*──> preload/index.ts ──ipcRenderer.invoke('ns:action')──> main/ipc/<ns>.ipc.ts
                                                                                   └─> main/handlers/* (kamera, printer)
                                                                                   └─> main/services/* (queue, print, upload, image)
Browser/iPad (remote admin) ──fetch──> main/server.ts (Express :5050) ── renderer/lib/apiHelper.ts memilih IPC vs fetch
```

## "Mau ubah X → buka di sini"
| Kebutuhan | File utama |
|---|---|
| Urutan/route halaman | `renderer/App.tsx` (HashRouter) |
| State global (config, frame, sesi, kamera, filter, queue) | `renderer/stores/index.ts` (640) — `useAppConfig` L163, `useFrameStore` L228, `useSessionStore` L430, `useCameraStore` L538, `useFilterStore` L561, `useQueueStore` L610 |
| Tipe `AppConfig`, `SessionData`, `CameraHandler`, DTO | `shared/types.ts` (355) |
| Default/persist config di main | `main/services/ConfigService.ts` |
| Tambah IPC baru | `main/ipc/<ns>.ipc.ts` + `preload/index.ts` (366) + tipe di `shared/types.ts` |
| Tombol fisik 1/2/3 (rail kanan + anti-bounce) | `renderer/components/ButtonRail/ButtonRail.tsx` — page memanggil `useButtonHints({1,2,3})`; `KeyGuard` membuang tekanan dobel. Handler key tetap di tiap page |
| Animasi abstrak beranda (gradasi 2D, overlay live cam) | `renderer/components/brand/AmbientArt.tsx` (canvas: aurora/shapes/waves), config `landingArt`, layer `.artLayer` di `Landing.module.css`, kartu "Animasi Beranda" di Admin tab timers |
| Brand: logo animasi, font, tema poster | `renderer/components/brand/SeboothLogo.tsx` (+ `seboothLogoParts.ts`, port dari website), `renderer/styles/brand.css` (`.kiosk-title`, `.kiosk-kicker`, `.kiosk-num`), token `--brand-*` di `global.css` |
| Kamera DSLR Canon | `main/handlers/CanonEDSDKCamera.ts` (1042) ↔ `main/lib/canon/CanonHelper.cs` (629, compile → `CanonHelper.exe`) |
| Kamera lain | `main/handlers/`: `DigiCamHTTPCamera`, `DigiCamControlCamera`, `WIACamera`, `WIAShutterCamera`, `GPhotoCamera`, `MockCamera`; interface `CameraHandler.ts` |
| Pilih handler kamera / capture IPC | `main/ipc/camera.ipc.ts` (279) |
| Live view + countdown + capture UI | `renderer/pages/CaptureSession.tsx` (1521 — terbesar, baca per bagian) |
| Composite strip (canvas), frame GIF, payload simpan | `renderer/lib/composite.ts` (`buildComposite`, `buildGifFrames`, `buildSaveParams`, `getQRUrl`) — dipakai OutputPage & FinalizePage |
| Simpan lokal + GIF + live MP4 + antre upload (background) | `main/ipc/system.ipc.ts` (`system:finalize-session` → `generateHqGif` → `saveSessionLocally` → `enqueueSessionUpload`) |
| Filter/LUT | `main/ipc/image.ipc.ts` (`apply-filter`), `renderer/pages/ReviewSession.tsx` |
| Print lokal / antrean / riwayat | `main/services/PrintQueueService.ts`, `main/handlers/PrinterHandler.ts`, `main/ipc/printer.ipc.ts` |
| Shared printer multi-booth | `main/services/RemotePrintService.ts` (client, `sendOrQueue` → `userData/pending_prints/`, resend tiap 10s di `printer.ipc.ts`), `server.ts` `POST /api/remote-print` (dedupe per sessionId, file di `userData/print_jobs/`) |
| Pembayaran QRIS (DOKU/Midtrans) | `main/ipc/payment.ipc.ts`, `renderer/pages/PaymentGateway.tsx` |
| Antrean website sebooth.in | `main/services/QueueService.ts`, `main/ipc/queue.ipc.ts`, `renderer/pages/QueueDisplay.tsx` |
| Upload cloud (GCS + baris Supabase) + retry offline | `main/ipc/cloud.ipc.ts` (`drainQueue`, `enqueueSessionUpload`), `main/services/UploadQueue.ts` (`userData/upload_queue.json`), `main/ipc/drive.ipc.ts` |
| Concert mode (alur cepat konser) | config `concertMode`… di `shared/types.ts`; deadline di `useSessionStore`; `CaptureSession` → `PhotoReviewPage` → `FinalizePage` → `PrintingPage` (layar kode loket) |
| Email hasil | `main/ipc/email.ipc.ts`, `renderer/components/EmailModal/` |
| Bersih-bersih temp | `main/services/Janitor.ts` |
| Path userData/temp/resources | `main/lib/paths.ts`, env: `main/lib/env.ts` |
| Global crash guard, bootstrap | `main/index.ts` |
| Admin Dashboard | `renderer/pages/AdminDashboard.tsx` (3769 — **jangan baca utuh**; grep `activeTab === '<tab>'`) |
| Portrait / tema | `.module.css` tiap page (`:global(body.app-portrait)`), `renderer/styles/global.css`; lebar stage = `100vw - var(--rail-w)` |

## Halaman (`renderer/pages/`, route → file)
| Route | File | Isi |
|---|---|---|
| `/` | `Landing.tsx` (607) | attract loop, custom bg, live cam bg |
| `/queue` | `QueueDisplay.tsx` (557) | IDLE/CALLED, QR link sesi |
| `/payment` | `PaymentGateway.tsx` (488) | order summary, cetak tambahan, QRIS |
| `/frames` | `FrameSelection.tsx` (260) | carousel frame |
| `/capture` | `CaptureSession.tsx` (1521) | live view, countdown, capture, live photo |
| `/photo-review` | `PhotoReviewPage.tsx` (267) | pratinjau strip + retake (konser → `/finalize`) |
| `/finalize` | `FinalizePage.tsx` | konser: preview strip, key 2 mirror, key 3/auto 15s cetak |
| `/loket` | `PickupCounter.tsx` | dashboard loket (juga dari HP: `http://<ip>:5050/#/loket`): cari kode, filter status/booth, tandai diambil, cetak ulang (satu/semua gagal), status booth via heartbeat. Selalu lewat HTTP `/api/print/*` di `server.ts` |
| `/review` | `ReviewSession.tsx` (340) | carousel filter, mirror |
| `/output` | `OutputPage.tsx` (890) | carousel strip/GIF/live photo, generate output |
| `/sharing` | `SharingPage.tsx` (225) | QR besar, tombol print/home |
| `/printing` | `PrintingPage.tsx` (245) | kirim ke print queue |
| `/gallery` | `GalleryPage.tsx` (304) | galeri lokal |
| `/admin` | `AdminDashboard.tsx` (3769) | tab: timers, frames, filters, printers, payment, sharing, queue, webhook, history, button-indicator |

Komponen: `ConfirmBackHomeModal`, `EmailModal`, `PrintQuantityModal`, `QRCodeModal`, `SessionTimer`.

## IPC (`ns:action`)
- **camera**: connect disconnect list status capture start-/stop-liveview get-liveview-url get-/set-property get-available-values start-/stop-recording-live-photo use-canon-edsdk use-direct-ptp use-mock use-real
- **system**: finalize-session save-session-locally generate-hq-gif read-file-base64 save-data-url copy-file file-exists find-session-strip rename-session-folder read-/write-json open-file-dialog get-temp-path get-user-data-path get-local-ip
- **image**: composite apply-filter generate-gif resize metadata
- **printer**: list default print print-with-options remote-print check-print-server get-queue get-history
- **queue**: start-/stop-polling get-status generate-token send-session-started send-session-completed skip-ticket
- **payment**: doku-create-session doku-check-status · **cloud**: upload-file get-queue · **drive**: upload-session · **email**: send is-configured · **config**: get update · **window**: toggle-fullscreen toggle-kiosk

## Express (`main/server.ts`, :5050)
`GET /api/config` `POST /api/config` · `GET /api/sessions` · `GET /api/camera/liveview` · `GET /api/print/queue` `GET /api/print/history` `POST /api/print/:sessionId` · `POST /api/remote-print` `GET /api/remote-print/status` · `GET /gallery/:sessionId` · `GET /monitor`

## Hub (paling banyak koneksi — ubah dengan hati-hati)
`useAppConfig`, `useSessionStore`, `useFrameStore`, `CanonEDSDKCamera`, `CameraHandler`/`CameraDevice`/`CaptureResult` (shared/types), `ConfirmBackHomeModal`, `App()`.

## Abaikan saat eksplorasi
`out/`, `node_modules/`, `sebooth-gallery/`, `graphify-out/`, `src/renderer/assets/` (binary), `src/main/lib/canon/*.dll|*.exe`, script `test-*.js`/`*-patch.js`/`fix.js` di root (eksperimen lama).
