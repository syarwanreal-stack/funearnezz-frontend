# FunEarnEzz — setup semua fitur Supabase

## File SQL lengkap

Kode SQL untuk tabel, private Storage bucket bukti tugas, RLS, ledger saldo, dan RPC transaksional berada di [`schema.sql`](./schema.sql). Buka file tersebut, salin seluruh isinya, lalu tempel ke **Supabase Dashboard → SQL Editor**.

## PENTING sebelum menjalankan

**Jangan jalankan `schema.sql` pada project yang sudah berisi data penting.** File saat ini berisi perintah `DROP TABLE ... CASCADE` dan menghapus akun Auth dengan domain `users.funearnezz.invalid`. Ini bisa menghapus data FunEarnEzz yang sudah ada. Gunakan project Supabase baru yang khusus untuk pengujian, atau buat migration non-destruktif yang sudah disesuaikan dengan schema live sebelum menjalankannya.

## Setelah SQL

1. Di Cloudflare Workers, atur `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` sebagai variables yang sesuai.
2. Atur `SUPABASE_SERVICE_ROLE_KEY` sebagai **Worker Secret**, bukan variable publik dan jangan commit ke Git.
3. Pastikan Supabase Auth dan bucket Storage berhasil dibuat.
4. Jalankan `npm run check` dan `npm test` di branch ini jika environment tersedia.
5. Uji signup/login, upload bukti gambar, review submission, request penarikan, request Robux, serta refund/approval di project uji sebelum dipakai sungguhan.

## Batas verifikasi

File ini adalah panduan pemasangan. Membuat PR atau menjalankan SQL tidak membuktikan bahwa project Supabase/Cloudflare live sudah terkonfigurasi atau bahwa pembayaran nyata berfungsi. RPC withdrawal/Robux hanya memproses status dan ledger internal; pembayaran ke DANA/e-wallet tetap perlu proses payout admin yang aman.
