// data-fetcher.js
import { PRODUCTS_JSON_URL } from './constants';

let cachedProducts = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // Cache selama 5 menit

/**
 * Mengambil data produk dari URL yang ditentukan, dengan caching.
 * @returns {Promise<Array>} Array objek produk.
 */
export async function fetchProducts() {
    const now = Date.now();
    if (cachedProducts && (now - lastFetchTime < CACHE_DURATION)) {
        return cachedProducts;
    }

    try {
        const response = await fetch(PRODUCTS_JSON_URL);
        if (!response.ok) {
            throw new Error(`Gagal fetch product: ${response.statusText}`);
        }
        const data = await response.json();
        cachedProducts = data.product; // Asumsi struktur JSON { "produk": [...] }
        lastFetchTime = now;
        return cachedProducts;
    } catch (error) {
        console.error("Error fetching product:", error);
        return [];
    }
}

