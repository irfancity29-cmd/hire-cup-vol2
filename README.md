# HIRE CUP Vol 2 — Website Turnamen Mobile Legends

Express + MongoDB. Pembayaran QRIS lewat WaroengPay, data tim disalin ke Google Sheets.

## Halaman
- `/` — website publik: info turnamen, tim lunas, prize pool, bracket resmi, form pendaftaran
- `/?order=KODE` — status pendaftaran / E-Ticket (link ini otomatis dibuka setelah bayar)
- `/admin` — panel panitia (password = `ADMIN_PASSWORD`)

## Alur pendaftaran
1. Tim mengisi form → server memvalidasi & membuat tagihan WaroengPay (nominal ditentukan server).
2. Tim membayar di halaman WaroengPay → kembali ke `/?order=KODE`.
3. Server menandai LUNAS hanya jika WaroengPay mengonfirmasi (webhook bertanda tangan, atau cek status ke API WaroengPay).
4. Setelah lunas: E-Ticket + link grup WhatsApp muncul, data disalin ke Google Sheets.

## Menjalankan di komputer
```
npm.cmd install
copy .env.example .env   (lalu isi nilainya)
npm.cmd start
```

## Deploy di Railway
Isi semua variabel di `.env.example` pada Railway → service → **Variables** SEBELUM push.
Kalau ada yang belum beres (variabel kosong / database tidak tersambung), buka `https://DOMAIN-KAMU/api/health`.

Di dashboard WaroengPay, set URL webhook ke `https://DOMAIN-KAMU/api/webhook/waroengpay`
dan salin webhook secret ke `WAROENGPAY_WEBHOOK_SECRET`.

## Panel admin
- Lihat semua pendaftaran (lunas / menunggu / kedaluwarsa), cari, unduh CSV
- Ganti nama tim, sembunyikan nama yang tidak pantas, hapus pendaftaran
- Cek status bayar ke WaroengPay, tandai lunas manual (bayar di luar sistem)
- Tambah tim manual, impor tim lama dari Google Sheets, kirim ulang ke Sheets
- Bracket: undi otomatis dari tim lunas (BYE otomatis), isi skor/pemenang, tampilkan/sembunyikan di website
