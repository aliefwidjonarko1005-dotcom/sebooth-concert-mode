# 📦 Panduan Instalasi Sebooth

Dokumen ini menjelaskan cara menginstal aplikasi **Sebooth Photobooth** di komputer/laptop baru menggunakan file installer.

---

## Persyaratan Sistem

| Komponen | Minimum |
|----------|---------|
| **OS** | Windows 10 (64-bit) atau lebih baru |
| **RAM** | 4 GB (8 GB direkomendasikan) |
| **Disk** | 500 MB ruang kosong |
| **Layar** | 1920×1080 (Landscape) atau 1080×1920 (Portrait) |
| **Koneksi** | Internet (untuk Supabase & Google Cloud) — opsional untuk mode offline |

### Perangkat Tambahan (Opsional)
- **Kamera DSLR/Mirrorless** — via USB (Canon/Nikon/Sony, kompatibel PTP)
- **Printer Dye-Sublimation** — (contoh: DNP RX1) via USB
- **USB Capture Card** — untuk live preview kamera ke layar

---

## Langkah Instalasi

### 1. Copy File Installer
Salin file **`Sebooth Setup 1.0.0.exe`** (±128 MB) ke komputer tujuan.
File ini bisa dikirim via:
- USB Flash Drive
- Google Drive / OneDrive
- Jaringan lokal (LAN sharing)

### 2. Jalankan Installer
1. **Double-click** `Sebooth Setup 1.0.0.exe`
2. Jika muncul peringatan Windows SmartScreen:
   - Klik **"More info"** → **"Run anyway"**
   - Ini normal karena aplikasi belum memiliki sertifikat code-signing
3. Pilih bahasa instalasi → **OK**

### 3. Pilih Lokasi Instalasi
- Default: `C:\Users\<nama>\AppData\Local\Programs\Sebooth`
- Anda bisa mengubah lokasi jika diperlukan
- Klik **"Install"**

### 4. Selesai
- Centang **"Create Desktop Shortcut"** agar muncul ikon di desktop
- Klik **"Finish"**
- Aplikasi siap dijalankan!

---

## Menjalankan Aplikasi

Setelah terinstall, jalankan Sebooth dengan salah satu cara:
- 🖥️ **Desktop Shortcut** — double-click ikon "Sebooth" di desktop
- 📂 **Start Menu** — cari "Sebooth" di Windows Start Menu
- 📁 **Folder Instalasi** — jalankan `Sebooth.exe` langsung

---

## Setup Perangkat Keras

### Kamera DSLR (Opsional)
1. Hubungkan kamera ke komputer via **kabel USB**
2. Set kamera ke mode **"PC Connect"** atau **"Tethered Shooting"**
3. Install [digiCamControl](http://digicamcontrol.com/download) (untuk Nikon/Canon lama)
4. Buka Sebooth → **Admin Dashboard** → tab **Camera** → pilih kamera

### Webcam / Capture Card
1. Colokkan USB Capture Card ke komputer
2. Hubungkan kabel HDMI dari kamera ke Capture Card
3. Buka Sebooth → kamera akan otomatis terdeteksi

### Printer (Opsional)
1. Hubungkan printer via **USB**
2. Install driver printer dari website produsen (contoh: [DNP Driver](https://www.dnpphoto.com/))
3. Buka Sebooth → **Admin Dashboard** → tab **Printers** → pilih printer

---

## Konfigurasi Admin Dashboard

Setelah aplikasi berjalan, buka **Admin Dashboard** untuk mengatur:

| Menu | Fungsi |
|------|--------|
| **Timers & Layout** | Orientasi layar (Landscape/Portrait), countdown timer |
| **Frames** | Upload template frame, atur posisi foto, QR code |
| **Camera** | Pilih kamera, rotasi, live preview |
| **Printers** | Pilih printer, mode cetak (lokal/remote) |
| **Queue Integration** | Hubungkan ke website antrian sebooth.in |

### Cara Masuk Admin Dashboard
1. Pada halaman utama (Landing), **klik ikon gear (⚙️)** di pojok kanan atas
2. Masukkan password admin
3. Dashboard admin akan terbuka

---

## Struktur File Setelah Install

```
📁 Sebooth/
├── 📄 Sebooth.exe              ← Aplikasi utama
├── 📁 resources/
│   ├── 📁 bin/
│   │   └── ffmpeg.exe          ← Video processor (ter-bundle)
│   ├── 📁 resources/
│   │   └── icon.ico            ← Ikon aplikasi
│   ├── .env                    ← Konfigurasi credentials
│   └── gcs-key.json            ← Google Cloud key
└── 📁 (internal files...)
```

---

## Data Aplikasi

Sebooth menyimpan data di lokasi berikut:

| Data | Lokasi |
|------|--------|
| **Foto Sesi** | `Documents\Sebooth\Sessions\` |
| **Konfigurasi** | `AppData\Roaming\sebooth\config.json` |
| **Print History** | `AppData\Roaming\sebooth\sebooth_print_history.json` |
| **File Temporary** | `AppData\Roaming\sebooth\temp\` |

---

## Troubleshooting

### Aplikasi tidak bisa dibuka
- Pastikan Windows 10 64-bit atau lebih baru
- Coba jalankan sebagai **Administrator** (klik kanan → Run as administrator)

### Kamera tidak terdeteksi
- Pastikan kabel USB terhubung dengan baik
- Coba restart kamera
- Buka Admin Dashboard → tab Camera → klik **🔄 REFRESH**

### Printer tidak mencetak
- Pastikan driver printer sudah terinstall
- Cek apakah printer muncul di Windows Settings → Devices → Printers

### Layar terpotong atau tidak pas
- Buka Admin Dashboard → **Timers & Layout**
- Pilih orientasi yang sesuai: **Landscape** atau **Portrait**
- Tekan **F11** untuk toggle fullscreen

### Error koneksi cloud
- Pastikan komputer terhubung ke internet
- Fitur cloud (upload foto, antrian) membutuhkan koneksi internet
- Mode offline tetap bisa digunakan untuk foto + cetak lokal

---

## Uninstall

Untuk menghapus Sebooth:
1. Buka **Windows Settings** → **Apps** → **Installed Apps**
2. Cari **"Sebooth"** → klik **Uninstall**
3. Atau jalankan `Uninstall Sebooth.exe` dari folder instalasi

---

> **Versi**: 1.0.0  
> **Dibuat oleh**: Sebooth Team  
> **Terakhir diperbarui**: Agustus 2026
