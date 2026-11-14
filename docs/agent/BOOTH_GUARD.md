# Booth Guard

Approval, lockdown, dan remote control untuk setiap instalasi Sebooth. Website (`sebooth-website`) jadi relay + dashboard; **yang memutuskan booth terbuka atau tidak adalah kunci owner yang di-pin di build ini** (`src/shared/guardPins.ts`).

## Aturan

- Siapa pun yang dipercaya boleh **mengunci** (owner, server saat clone terdeteksi, deteksi lokal). Hanya tanda tangan owner (passkey atau recovery key) yang boleh **approve / unlock / ubah config / restart / revoke**.
- Selama `SERVER_PUBLIC_KEY` atau semua owner key kosong, guard **mati** dan app berjalan seperti sebelumnya.
- Saat terkunci: semua IPC selain `guard:*`, `window:*`, `config:get` menjawab `LOCKED`; server LAN :5050 menjawab 503; layar = `LockScreen`.

| State | Masuk karena | Keluar lewat |
|---|---|---|
| `pending` | identitas baru (instal baru / file identitas dari PC lain) | `approve` owner |
| `active` | approve + lease 3 hari | — |
| `stale` | 3 hari tanpa heartbeat sukses, atau jam PC mundur > 1 jam | heartbeat sukses saat server masih `approved` |
| `locked` | `lock` owner, server lapor `locked` (clone), file state diedit (`tamper`) | `unlock` owner yang terbit setelah kunci |
| revoke | `revoke` owner | identitas dihapus → `pending` baru |

## File

- Desktop: `src/main/guard/` (`protocol.ts` format kabel + verifikasi passkey, `identity.ts` kunci Ed25519 DPAPI + MachineGuid, `client.ts` state machine + heartbeat 30 dtk + command, `gate.ts` pembungkus `ipcMain.handle`, `runtime.ts` flag kunci), `src/shared/guardPins.ts`, `src/renderer/components/LockScreen/`, `src/main/lib/adminPin.ts`, `src/main/lib/lanKey.ts`. Cek: `node scripts/check-guard-protocol.mjs`.
- Saat guard aktif, semua layanan cloud booth lewat request bertanda tangan device (hanya booth `approved`): upload + baris sesi (`cloud.ipc.ts`), pembayaran DOKU/Midtrans (`payment.ipc.ts`, server = proxy penanda tangan), email (`email.ipc.ts`), antrean (`QueueService.ts`). Tanpa guard, jalur lama (kunci di booth) tetap dipakai.
- Website: `src/lib/boothGuard.ts` + `boothGuardShared.ts`, `src/app/api/booth/{register,heartbeat,upload-url,rows,payment,email}`, `/api/queue/{webhook,generate-session-token}` (terima secret lama atau tanda tangan booth lewat `kioskAuth`), `src/app/api/admin/{booths,booths/command,owner-keys}`, `src/components/admin/BoothGuardTab.tsx`, `_harness/sql/booth-guard.sql`, `scripts/booth-guard-keygen.mjs`, `scripts/booth-guard-recovery-sign.mjs`.

## Menyalakan (urut)

1. Supabase SQL editor: jalankan `sebooth-website/_harness/sql/booth-guard.sql`.
2. Website: `node scripts/booth-guard-keygen.mjs server` → `BOOTH_SIGNING_KEY` ke env Vercel; simpan `SERVER_PUBLIC_KEY`.
3. Website: `node scripts/booth-guard-keygen.mjs recovery <file-di-USB>` → simpan file itu offline (cetak juga); `RECOVERY_PUBLIC_KEY` ke env Vercel `BOOTH_RECOVERY_PUBKEYS`.
4. Env Vercel lain: `SUPABASE_SERVICE_ROLE_KEY`, `GCS_SERVICE_ACCOUNT_JSON` (base64 isi file service account GCS), opsional `GCS_BUCKET_NAME`; pembayaran `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_SANDBOX` (`true`/kosong) dan/atau `MIDTRANS_SERVER_KEY`, `MIDTRANS_PRODUCTION` (`true` = live, kosong = sandbox seperti sebelumnya); email `GMAIL_USER`, `GMAIL_APP_PASSWORD`. Satu set merchant untuk semua booth. Deploy.
5. Dari HP owner (dan laptop sebagai cadangan): `https://www.sebooth.in/admin` → tab Booth Guard → "Daftarkan passkey device ini" → salin snippet JSON. Tekan "Aktifkan notifikasi".
6. Desktop: isi `src/shared/guardPins.ts` (`SERVER_PUBLIC_KEY`, `OWNER_KEYS` = snippet tiap device, `RECOVERY_PUBLIC_KEYS`). Build + install.
7. Setiap booth muncul `pending` di dashboard → Approve dengan passkey. Set PIN admin (tombol "PIN admin").
8. Setelah semua booth jalan dengan build guard:
   - hapus `.env` dan `gcs-key.json` dari `build.extraResources` (`package.json`) dan `copy-gcs-key.js` dari `prebuild:dist`;
   - kosongkan `dokuSecretKey`, `midtransServerKey`, `queueWebhookSecret` di Admin tiap booth (tidak dipakai lagi);
   - ganti `QUEUE_WEBHOOK_SECRET` di Vercel ke nilai acak baru (default lama `sebooth-queue-webhook-2026` tertanam di semua build lama), rotasi Gmail app password, DOKU secret, Midtrans server key, dan buat service account GCS baru — semua yang lama sudah pernah ikut di installer;
   - cabut izin tulis anon di tabel `sessions`/`media` Supabase.
   Mulai saat itu kloningan tidak bisa upload, menerima pembayaran, kirim email, atau memakai antrean.

## Update jarak jauh

Feed: `https://storage.googleapis.com/sebooth-media-konser/releases/win` (`build.publish` di `package.json` dan `UPDATE_FEED_URL` di `guardPins.ts`, keduanya harus sama). Booth hanya update lewat command `update` bertanda tangan passkey, lalu memverifikasi `<installer>.sig` dengan `RELEASE_PUBLIC_KEY` sebelum memasang. Akses tulis ke bucket saja tidak cukup untuk menyuntik update.

1. Sekali: `node scripts/publish-release.mjs keygen <file-di-USB>` → pin `RELEASE_PUBLIC_KEY` di `guardPins.ts`. Booth dengan build lama (tanpa key ini) harus di-install manual sekali.
2. Tiap rilis: naikkan `version` di `package.json` → `npm run build:win` → `node scripts/publish-release.mjs publish <release-key.pem>` (upload installer, blockmap, `.sig`, lalu `latest.yml`; versi yang sama tidak bisa di-upload dua kali).
3. Admin → Booth Guard → tombol **Update** pada booth → isi versinya → tanda tangani dengan passkey. Progres (`checking/downloading/verifying/installing/failed`) muncul di kartu booth.

Hanya booth `active` yang mau update; downgrade ditolak. Kunci GCS untuk upload rilis ada di PC developer (`GCS_KEY_PATH` / `google-key.json`), bukan di booth.

## HP owner hilang

`node scripts/booth-guard-recovery-sign.mjs <recovery.pem> <deviceId> unlock` → tempel JSON di tab Booth Guard → "Kirim command dari recovery key". Daftarkan passkey baru, pin di build berikutnya, buang yang lama.

## Belum dikerjakan

- Email lewat server hanya mengirim link galeri + strip (dulu melampirkan semua file lokal sesi, tidak mungkin dari server). UI saat ini tidak memanggil email sama sekali.
- `operatorAction` di `QueueService` memanggil `/api/queue/operator/action` yang butuh login admin, jadi dari kiosk selalu 403 (sudah begitu sebelum Booth Guard).
- Update jarak jauh belum dites sampai pasang di booth asli (butuh rilis di bucket); installer belum code-signed, jadi Windows SmartScreen bisa memperingatkan saat instal manual.
- `EnableEmbeddedAsarIntegrityValidation` belum dinyalakan (perlu electron-builder yang menanam hash integritas di Windows).
