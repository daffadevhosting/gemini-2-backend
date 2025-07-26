# Backend Gemini AI Assistant (Cloudflare Worker)

Selamat datang di repository backend untuk AI Assistant toko online **"L Y Я A"**! Project ini adalah sebuah **Cloudflare Worker** siap pakai, yang berfungsi sebagai jembatan antara aplikasi frontend dengan **Google Gemini API**, dilengkapi dengan fitur **manajemen riwayat chat** dan **pembatasan laju (rate limiting)** menggunakan **Cloudflare KV**.

## ✨ Fitur Unggulan

- **Interaksi Gemini AI**  
  Menggunakan Gemini API (`gemini-2.5-flash` secara default) untuk menghasilkan respons cerdas berdasarkan produk, keranjang belanja, dan riwayat percakapan pengguna.

- **Contextual AI**  
  System prompt dinamis memungkinkan AI memahami konteks produk dan keranjang belanja pengguna.

- **Aksi Terstruktur (JSON Output)**  
  AI dapat menghasilkan respons dalam format JSON untuk memicu aksi spesifik di frontend:
  - `addToCart`
  - `viewProductDetails`
  - `checkout`
  (Tambahkan jika ingin otomatisasi website sepenuhnya via chat prompt.)

- **Manajemen Riwayat Chat**  
  Menyimpan dan mengambil riwayat percakapan per pengguna menggunakan Cloudflare KV.

- **Pembatasan Laju (Rate Limiting)**  
  Membatasi jumlah pesan per pengguna per hari untuk mencegah penyalahgunaan dan mengelola kuota API.

- **Rotasi Kunci API (Key Quota Management)**  
  Mendukung banyak kunci API Gemini dan melakukan rotasi otomatis berdasarkan kuota harian.

- **Error Handling Robust**  
  Penanganan error komprehensif untuk berbagai skenario: masalah API, rate limit, konfigurasi hilang, dll.

## 🛠️ Teknologi yang Digunakan

- **Cloudflare Workers** – Lingkungan serverless yang efisien dan skalabel.
- **Cloudflare KV** – Penyimpanan key-value untuk riwayat chat dan data kuota API.
- **Google Gemini API** – Model AI generatif dari Google.
- **JavaScript (ES Modules)** – Bahasa pemrograman utama.

## 📁 Struktur Project

```
├── src/
│   ├── ai-interaction.js         # Logika interaksi dengan Gemini API dan prompt builder
│   ├── api-handlers.js           # Handler untuk endpoint API (ai-assistant, chat-history)
│   ├── constants.js              # Konstanta global (MAX_CHAT_HISTORY_LENGTH, URLs, dll)
│   ├── data-fetcher.js           # Pengambilan data produk dengan caching
│   └── worker.js                 # Entry point utama dan routing
└── wrangler.toml                 # Konfigurasi Cloudflare Worker
```

## 🚀 Setup dan Instalasi

### 1. Kloning Repository

```bash
git clone [gemini-2-backend]
cd [gemini-2-backend]
```

### 2. Instal Wrangler CLI

```bash
npm install -g wrangler
# atau
yarn global add wrangler
```

### 3. Login ke Cloudflare

```bash
wrangler login
```

### 4. Konfigurasi Environment Variables & KV Bindings

#### Environment Variables

- `GEMINI_API_KEY`: Kunci API utama
- `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, ... (Opsional): Untuk rotasi
- `CORS_ORIGIN`: Origin frontend yang diizinkan
- `GEMINI_MODEL` (Opsional): Default `gemini-1.5-flash-latest`
- `GEMINI_DAILY_KEY_LIMIT` (Opsional): Default `10000`

#### KV Bindings

- `CHAT_HISTORY_KV`: Menyimpan riwayat chat
- `GEMINI_KEY_QUOTA_KV`: Melacak kuota kunci API

Contoh konfigurasi di `wrangler.toml`:

```toml
name = "gemini-ai-assistant"
main = "src/worker.js"
compatibility_date = "2024-05-14"

[[kv_namespaces]]
binding = "CHAT_HISTORY_KV"
id = "YOUR_CHAT_HISTORY_KV_ID"

[[kv_namespaces]]
binding = "GEMINI_KEY_QUOTA_KV"
id = "YOUR_GEMINI_KEY_QUOTA_KV_ID"

[vars]
# CORS_ORIGIN = "http://localhost:5500"
# GEMINI_API_KEY = "AIzaSy..."
# GEMINI_API_KEY_1 = "AIzaSy..."
# GEMINI_API_KEY_2 = "AIzaSy..."
# dst...
```

> ⚠️ Ganti `YOUR_CHAT_HISTORY_KV_ID` dan `YOUR_GEMINI_KEY_QUOTA_KV_ID` dengan ID asli dari dashboard Cloudflare.

### 5. Deploy Worker

```bash
wrangler deploy
```

## 💡 Penggunaan API

### 1. `/ai-assistant` (POST)

Endpoint utama untuk interaksi AI.

#### Request

```json
{
  "message": "Halo, saya mau tanya tentang produk.",
  "cartItems": [
    { "name": "Baju Kaos Polos", "price": 100000, "quantity": 1 }
  ],
  "userId": "user_12345",
  "aiStructuredInput": null
}
```

#### Response

```json
{
  "reply": "Tentu, saya siap membantu. Ada yang bisa saya bantu hari ini?"
}
```

#### Error

```json
{
  "error": "Pesan error"
}
```

### 2. `/chat-history` (GET / DELETE)

#### GET

```http
GET /chat-history?userId=user_12345
```

```json
{
  "history": [
    { "role": "user", "text": "Halo" },
    { "role": "ai", "text": "Halo juga!" }
  ]
}
```

#### DELETE

```http
DELETE /chat-history?userId=user_12345
```

```json
{
  "message": "Chat history deleted successfully."
}
```

## 💻 Pengembangan Lokal

Gunakan perintah berikut untuk menjalankan secara lokal:

```bash
wrangler dev
```

Pastikan environment variables dan KV bindings telah diatur di `wrangler.toml`.
