# FunEarnEzz Frontend

Frontend statis HTML/CSS/JavaScript untuk di-deploy ke Cloudflare Pages. Tidak membutuhkan build command.

## File
- `index.html` — struktur halaman
- `style.css` — desain responsif dark premium
- `app.js` — interaksi frontend dan pemanggilan API
- `README.md` — panduan deployment

## Penting sebelum menghubungkan backend
1. Deploy frontend dan catat URL `https://NAMA-PROJECT.pages.dev`.
2. Pastikan backend punya URL API publik HTTPS yang benar-benar aktif. Jangan memakai localhost atau HTTP dari halaman HTTPS.
3. Edit `app.js`, isi `API_BASE` dengan URL HTTPS backend (tanpa `/api` di ujung), lalu commit perubahan.
4. Atur `FRONTEND_ORIGIN` pada `.env` backend ke origin Pages persis, misalnya `https://nama-project.pages.dev` (tanpa slash di akhir), lalu restart backend.
5. Backend harus mengizinkan origin tersebut melalui CORS dan menyediakan endpoint yang dipakai aplikasi.

## Kontrak API yang diharapkan frontend
- `GET /api/health`
- `POST /api/auth/register` — JSON `{ username, email?, password }`
- `POST /api/auth/login` — JSON `{ username, email?, password }`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/tasks`
- `GET /api/submissions/mine`
- `POST /api/tasks/submit` — multipart fields `taskId`, `note`, `proof`
- `GET /api/wallet`
- `POST /api/withdrawals` — JSON `{ method, amount, destination }`

Frontend mengirim token sesi sebagai `Authorization: Bearer ...` jika backend mengembalikan token pada login/register. Format respons endpoint wajib dicocokkan dengan `server.js`. Frontend tidak mengelola saldo/reward secara otoritatif dan tidak menyediakan panel admin karena otorisasi admin wajib dibuat serta diperiksa di backend.

## Deployment Cloudflare Pages dari Android
1. Buat repository GitHub baru, misalnya `funearnezz-frontend`.
2. Upload `index.html`, `style.css`, `app.js`, dan `README.md` ke root repository.
3. Di Cloudflare Dashboard buka **Workers & Pages** → **Create** → **Pages** → **Connect to Git** (label menu bisa sedikit berubah).
4. Pilih repository yang baru dibuat.
5. Framework preset: **None**. Build command: kosong. Build output directory: `/` atau `.` sesuai pilihan yang diterima dashboard untuk file di root. Jika dashboard meminta direktori output, gunakan root repository (`/` jika tersedia; beberapa layar menggunakan `.`). Jangan masukkan `public` karena file berada di root.
6. Klik **Save and Deploy**.
7. Setelah selesai, buka URL `https://<project>.pages.dev` yang ditampilkan di halaman deployment.

## Keamanan
- Jangan unggah `.env`, database SQLite (`*.db`, `*.sqlite`, `*.sqlite3`), file upload bukti, session/token rahasia, backup database, atau password admin.
- Jangan menaruh password admin atau secret di `app.js`.
- Frontend statis bukan tempat menyimpan rahasia.
- Setiap endpoint admin, saldo, reward, review bukti, dan withdrawal harus melakukan autentikasi, otorisasi, dan validasi di backend.
- Jangan aktifkan CORS wildcard (`*`) jika memakai cookie credentials.
- Jangan menganggap backend sehat sebelum `GET /api/health` berhasil mengembalikan respons yang sesuai.
