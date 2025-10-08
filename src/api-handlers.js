// src/api-handlers.js
import { MAX_CHAT_HISTORY_LENGTH, DAILY_RATE_LIMIT, PRODUCTS_JSON_URL } from './constants';
import { getAIResponse } from './ai-interaction';
import { fetchProducts } from './data-fetcher';

// Cache untuk menyimpan hitungan permintaan per pengguna per hari
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
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const expirationTtl = Math.max(0, Math.floor((tomorrow.getTime() - Date.now()) / 1000));

    await chatHistoryKv.put(kvKey, (currentCount + 1).toString(), { expirationTtl: expirationTtl });
    return true;
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

    // Periksa apakah AI binding tersedia
    if (!env.AI) {
        return jsonResponse({ error: 'AI binding not configured.' }, 500, env);
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

    let aiReply;
    try {
        const products = await fetchProducts();
        // Panggil getAIResponse dengan AI binding
        aiReply = await getAIResponse(env.AI, products, cartItems, history, message, aiStructuredInput);

    } catch (error) {
        console.error("Error during AI response generation:", error);
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