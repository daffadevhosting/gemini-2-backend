// src/worker.js
import { handleAiAssistant, handleChatHistory, handleOptions } from './api-handlers';
import { PRODUCTS_JSON_URL } from './constants';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Handle CORS preflight requests
        if (request.method === 'OPTIONS') {
            return handleOptions(env);
        }

        // Pastikan variabel environment dan KV binding yang diperlukan tersedia
        if (!env.CHAT_HISTORY_KV) {
            return new Response('Internal Server Error: CHAT_HISTORY_KV binding tidak terkonfigurasi.', { status: 500, headers: getCorsHeaders(env) });
        }

        // Hapus pengecekan GEMINI_KEY_QUOTA_KV karena tidak diperlukan lagi

        // Route requests
        if (url.pathname === '/ai-assistant') {
            return handleAiAssistant(request, env);
        } else if (url.pathname === '/chat-history') {
            return handleChatHistory(request, env);
        } else if (url.pathname === '/produk.json') {
            const productRes = await fetch(PRODUCTS_JSON_URL);
            if (!productRes.ok) {
                return new Response("Gagal fetch ke product", { status: productRes.status, headers: getCorsHeaders(env) });
            }
            return new Response(productRes.body, { headers: { 'Content-Type': 'application/json', ...getCorsHeaders(env) } });
        } else {
            return new Response('Not Found', { status: 404, headers: getCorsHeaders(env) });
        }
    },
};

/**
 * Membangun CORS headers berdasarkan environment.
 * Didefinisikan di sini agar bisa diakses oleh main worker dan handler lainnya.
 * @param {object} env - Objek environment dari Cloudflare Worker.
 * @returns {HeadersInit} Objek headers.
 */
function getCorsHeaders(env) {
    const allowedOrigin = env.CORS_ORIGIN || "http://localhost:5500"; // Default untuk lokal
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}