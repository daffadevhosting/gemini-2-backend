// src/constants.js
// API_KEY dan CHAT_HISTORY_KV_NAME akan diakses via env.
export const PRODUCTS_JSON_URL = "https://plus62store.github.io/products.json"; // URL ke data produk Anda
export const AI_ASSISTANT_WORKER_URL = "https://gemini-2.sendaljepit.workers.dev/ai-assistant"; // URL worker AI Anda (jika digunakan oleh frontend)

// Konstanta non-sensitif atau yang tidak perlu melalui env
export const MAX_CHAT_HISTORY_LENGTH = 20; // Maksimal jumlah pesan dalam riwayat chat
export const DAILY_RATE_LIMIT = 50; // Batas harian untuk setiap user ID
export const GEMINI_DAILY_KEY_LIMIT = 10000; // Batas pemakaian kustom per API key

