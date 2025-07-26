// src/api-handlers.js
import { MAX_CHAT_HISTORY_LENGTH, DAILY_RATE_LIMIT, PRODUCTS_JSON_URL, GEMINI_DAILY_KEY_LIMIT } from './constants';
import { getGeminiResponse } from './ai-interaction';
import { fetchProducts } from './data-fetcher';

// Cache untuk menyimpan hitungan permintaan per pengguna per hari (pertahankan jika masih digunakan untuk user rate limit)
const requestCountCache = {};

/**
 * Membangun CORS headers berdasarkan environment.
 * @param {object} env - Objek environment dari Cloudflare Worker.
 * @returns {HeadersInit} Objek headers.
 */
function getCorsHeaders(env) {
    const allowedOrigin = env.CORS_ORIGIN_LOCAL || "http://localhost:8800"; // Default untuk lokal
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

/**
 * Fungsi pembantu untuk menghasilkan respons JSON.
 * @param {object} data - Data yang akan dikirim.
 * @param {number} status - Kode status HTTP.
 * @param {object} env - Objek environment untuk CORS headers.
 * @returns {Response} Objek respons.
 */
function jsonResponse(data, status = 200, env) {
    return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(env) },
        status,
    });
}

/**
 * Handle OPTIONS request for CORS preflight.
 * @param {object} env - Objek environment dari Cloudflare Worker.
 * @returns {Response} Respons OPTIONS.
 */
export function handleOptions(env) {
    return new Response(null, {
        headers: getCorsHeaders(env),
        status: 204,
    });
}

/**
 * Fungsi untuk menerapkan batas laju permintaan harian per pengguna.
 * @param {string} userId - ID unik pengguna.
 * @param {KVNamespace} chatHistoryKv - KV Namespace untuk menyimpan riwayat dan hitungan.
 * @returns {Promise<boolean>} True jika pengguna masih dalam batas, false jika tidak.
 */
async function enforceRateLimit(userId, chatHistoryKv) {
    const today = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
    const kvKey = `rate_limit:${userId}:${today}`;

    let currentCount = await chatHistoryKv.get(kvKey);
    currentCount = currentCount ? parseInt(currentCount) : 0;

    if (currentCount >= DAILY_RATE_LIMIT) {
        return false;
    }

    // Tingkatkan hitungan dan simpan kembali ke KV
    // Set expire_at untuk reset otomatis esok hari (24 jam dari sekarang)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Atur ke awal hari besok
    const expirationTtl = Math.max(0, Math.floor((tomorrow.getTime() - Date.now()) / 1000));

    await chatHistoryKv.put(kvKey, (currentCount + 1).toString(), { expirationTtl: expirationTtl });
    return true;
}


// Helper untuk mendapatkan semua API key Gemini dari environment
function getAllGeminiApiKeys(env) {
    const keys = [];
    let i = 1;
    while (true) {
        const key = env[`GEMINI_API_KEY_${i}`];
        if (key) {
            keys.push(key);
            i++;
        } else {
            break;
        }
    }
    // Juga sertakan GEMINI_API_KEY tanpa angka jika ada
    if (env.GEMINI_API_KEY && !keys.includes(env.GEMINI_API_KEY)) {
        keys.unshift(env.GEMINI_API_KEY); // Menambahkan ke awal daftar
    }
    return keys;
}

// Helper untuk mendapatkan tanggal hari ini dalam format YYYY-MM-DD
function getTodayDateString() {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Mencari API key Gemini berikutnya yang tersedia (belum mencapai batas pemakaian harian kustom).
 * Akan mereset penggunaan di KV jika tanggalnya berbeda (hari baru).
 * @param {object} env - Objek environment.
 * @param {Array<string>} allKeys - Array dari semua API key yang tersedia.
 * @param {KVNamespace} apiKeyUsageKv - KV Namespace untuk melacak penggunaan API key.
 * @returns {Promise<string|null>} API key yang tersedia, atau null jika semua sudah habis.
 */
async function findNextAvailableApiKey(env, allKeys, apiKeyUsageKv) {
    const todayDate = getTodayDateString();

    for (const key of allKeys) {
        const kvKey = `gemini_key_usage:${key}`; // Format key di KV
        let usageData = await apiKeyUsageKv.get(kvKey, { type: 'json' });

        if (!usageData || usageData.date !== todayDate) {
            // Jika tidak ada data atau tanggalnya berbeda (hari baru), reset hitungan
            usageData = { count: 0, date: todayDate };
            // Simpan perubahan ke KV. Atur expiration untuk otomatis bersih setelah ~24 jam
            // atau biarkan tanpa expiration untuk direset manual/oleh logic ini
            await apiKeyUsageKv.put(kvKey, JSON.stringify(usageData));
        }

        if (usageData.count < GEMINI_DAILY_KEY_LIMIT) {
            // Key ini masih tersedia
            return key;
        }
    }
    return null; // Tidak ada key yang tersedia
}


/**
 * Handle permintaan AI Assistant.
 * @param {Request} request - Objek permintaan.
 * @param {object} env - Objek environment.
 * @returns {Promise<Response>} Respons AI.
 */
export async function handleAiAssistant(request, env) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405, env);
    }

    const { message, cartItems, userId, aiStructuredInput } = await request.json();

    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400, env);
    }

    const chatHistoryKv = env.CHAT_HISTORY_KV;
    if (!chatHistoryKv) {
        return jsonResponse({ error: 'KV Namespace CHAT_HISTORY_KV not configured.' }, 500, env);
    }

    const apiKeyUsageKv = env.GEMINI_KEY_QUOTA_KV;
    if (!apiKeyUsageKv) {
        return jsonResponse({ error: 'KV Namespace GEMINI_KEY_QUOTA_KV not configured.' }, 500, env);
    }

    const allGeminiApiKeys = getAllGeminiApiKeys(env);
    if (allGeminiApiKeys.length === 0) {
        return jsonResponse({ error: 'Tidak ada GEMINI_API_KEY yang dikonfigurasi di environment variables.' }, 500, env);
    }

    // Terapkan batas laju permintaan harian per pengguna
    const withinLimit = await enforceRateLimit(userId, chatHistoryKv);
    if (!withinLimit) {
        return jsonResponse({ error: `Anda telah mencapai batas chat harian (${DAILY_RATE_LIMIT} pesan). Silakan coba lagi besok.` }, 429, env);
    }

    let history = [];
    try {
        const historyData = await chatHistoryKv.get(userId, { type: 'json' });
        if (historyData && Array.isArray(historyData)) {
            history = historyData;
        }
    } catch (e) {
        console.error("Error fetching chat history from KV:", e);
    }

    // --- LOGIKA ROTASI API KEY PROAKTIF ---
    // Cari API key berikutnya yang masih tersedia
    const currentGeminiApiKey = await findNextAvailableApiKey(env, allGeminiApiKeys, apiKeyUsageKv);

    if (!currentGeminiApiKey) {
        // Jika semua API key sudah mencapai batas penggunaan hari ini
        console.warn("Semua API key Gemini telah mencapai batas penggunaan hari ini. Tidak dapat memproses permintaan.");
        return jsonResponse({ error: 'Maaf, semua kapasitas AI kami sedang penuh. Silakan coba lagi nanti.' }, 503, env);
    }

    let aiReply;
    try {
        const products = await fetchProducts();
        // Panggil getGeminiResponse dengan API key yang sudah dipilih secara proaktif
        aiReply = await getGeminiResponse(currentGeminiApiKey, products, cartItems, history, message, aiStructuredInput);

        // Setelah berhasil, tingkatkan hitungan penggunaan untuk API key yang BARU SAJA DIGUNAKAN
        const kvKey = `gemini_key_usage:${currentGeminiApiKey}`;
        let usageData = await apiKeyUsageKv.get(kvKey, { type: 'json' });
        const todayDate = getTodayDateString();

        // Safety check: Pastikan data penggunaan sudah terbaru atau diinisialisasi
        if (!usageData || usageData.date !== todayDate) {
            usageData = { count: 0, date: todayDate };
        }
        usageData.count++;
        await apiKeyUsageKv.put(kvKey, JSON.stringify(usageData)); // Simpan kembali ke KV

    } catch (error) {
        console.error("Error during AI response generation with current key:", currentGeminiApiKey, error);
        // Error yang terjadi di sini biasanya bukan karena kuota (karena sudah dicegah proaktif)
        // tapi bisa jadi masalah lain dari Gemini API.
        return jsonResponse({ error: error.message || 'Terjadi kesalahan internal saat menghubungi AI.' }, 500, env);
    }

    // Simpan riwayat chat yang baru
    history.push({ role: 'user', text: message });
    history.push({ role: 'ai', text: aiReply });

    if (history.length > MAX_CHAT_HISTORY_LENGTH) {
        history = history.slice(-MAX_CHAT_HISTORY_LENGTH);
    }
    await chatHistoryKv.put(userId, JSON.stringify(history));

    return jsonResponse({ reply: aiReply }, 200, env);
}

/**
 * Handle permintaan riwayat chat.
 * @param {Request} request - Objek permintaan.
 * @param {object} env - Objek environment.
 * @returns {Promise<Response>} Riwayat chat.
 */
export async function handleChatHistory(request, env) {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
        return jsonResponse({ error: 'User ID is required.' }, 400, env);
    }

    const chatHistoryKv = env.CHAT_HISTORY_KV;
    if (!chatHistoryKv) {
        return jsonResponse({ error: 'KV Namespace not configured for chat history.' }, 500, env);
    }

    if (request.method === 'DELETE') {
        try {
            await chatHistoryKv.delete(userId);
            return jsonResponse({ message: 'Chat history deleted successfully.' }, 200, env);
        } catch (error) {
            console.error("Error deleting chat history:", error);
            return jsonResponse({ error: 'Failed to delete chat history.' }, 500, env);
        }
    } else if (request.method === 'GET') {
        try {
            const history = await chatHistoryKv.get(userId, { type: 'json' });
            return jsonResponse({ history: history || [] }, 200, env);
        } catch (error) {
            console.error("Error fetching chat history:", error);
            return jsonResponse({ error: 'Failed to fetch chat history.' }, 500, env);
        }
    } else {
        return jsonResponse({ error: 'Method Not Allowed' }, 405, env);
    }
}
