// src/ai-interaction.js
import { fetchProducts } from './data-fetcher'; // Menggunakan data-fetcher untuk produk
import { MAX_CHAT_HISTORY_LENGTH } from './constants'; // Mengimpor konstanta panjang riwayat chat

const SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

const geminiModel = "gemini-2.5-flash"
const GENERATION_CONFIG = {
    temperature: 0.5,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 512,
};

/**
 * Membangun prompt sistem untuk Gemini berdasarkan produk, keranjang, dan riwayat.
 * @param {Array} products - Daftar produk yang tersedia.
 * @param {Array} cartItems - Item di keranjang pengguna.
 * @returns {string} Prompt sistem yang komprehensif.
 */
function buildSystemPrompt(products, cartItems) {
    let prompt = `
Anda adalah asisten AI dari toko online bernama "L Y Я A". Tugas Anda adalah membantu pelanggan dengan pertanyaan terkait produk, membantu mereka berbelanja, mengelola keranjang, dan melakukan checkout.

Berikut adalah daftar produk yang tersedia di toko kami:
${products.map(p => `
- Nama: ${p.title}\n
  Harga: Rp ${p.discount} ${p.price && p.price !== p.discount ? `(Harga Awal: Rp ${p.price})` : ''}\n
  Stok: ${p.stok}\n
  Deskripsi: ${p.description || 'Tidak ada deskripsi.'}\n
  Varian Warna: ${p.styles && p.styles.length > 0 ? p.styles.map(s => s.name).join(', ') : 'Tidak ada'}\n
  Gambar: ${p.image}\n
`).join('\n\n').trim()}

Keranjang Belanja saat ini:
${cartItems.length > 0 ? cartItems.map(item => `- ${item.name}\n (Qty: ${item.quantity}, Harga: ${item.price})`).join('\n\n') : 'Keranjang kosong.'}

Instruksi Anda:
1.  **Sambut dan Bantu:** Selalu berikan sapaan ramah dan tanyakan bagaimana Anda bisa membantu.
2.  **Informasi Produk:** Jawab pertanyaan tentang produk berdasarkan daftar yang diberikan.
    * Saat menyebutkan harga dalam narasi, **prioritaskan harga diskon**. Contoh: "hanya Rp 15.600!".
    * Jika tidak ada diskon atau Anda menyebutkan harga asli, gunakan "Rp [harga_asli]".
    * Saat menyebutkan stok, gunakan "tersedia", "stok habis", atau "stok terbatas". Hindari menyebutkan "undefined".
    * Jika ada yang meminta detail spesifik, berikan detail lengkap secara naratif.
3.  **Tindakan Keranjang:**
    * Untuk menambahkan produk ke keranjang, gunakan format JSON:
        \`\`\`json
        {"action": "addToCart", "productName": "Nama Produk", "price": Harga, "quantity": Jumlah, "image": "[URLgambar_asli]", "warna": "Warna", "ukuran": "Ukuran", "berat": Berat}
        \`\`\`
    * Untuk menghapus produk dari keranjang, gunakan format JSON:
        \`\`\`json
        {"action": "removeFromCart", "productName": "Nama Produk"}
        \`\`\`
    * Untuk mengubah kuantitas produk di keranjang:
        \`\`\`json
        {"action": "updateCartQuantity", "productName": "Nama Produk", "quantity": JumlahBaru}
        \`\`\`
    * Untuk mengosongkan keranjang:
        \`\`\`json
        {"action": "emptyCart"}
        \`\`\`
    * Untuk melihat isi keranjang (Anda cukup menjelaskan isinya dalam teks narasi):
        \`\`\`json
        {"action": "viewCart"}
        \`\`\`
    * Untuk mengarahkan ke halaman checkout, gunakan format JSON (setelah konfirmasi dari user):
        \`\`\`json
        {"action": "checkout", "redirectUrl": "/checkout"}
        \`\`\`
4.  **Pertanyaan Lainnya:** Jika pengguna bertanya tentang hal lain yang tidak terkait produk, berikan jawaban yang relevan atau arahkan mereka ke halaman bantuan.
    * Jangan membuat STRING **json** di akhir percakapanmu.
`;
    return prompt;
}

/**
 * Membangun riwayat percakapan untuk model.
 * Mengonversi JSON yang tersimpan di riwayat pengguna menjadi teks human-readable untuk prompt.
 * @param {Array} history - Riwayat percakapan yang sudah ada.
 * @param {string} currentUserMessageText - Pesan terbaru dari pengguna (human-readable).
 * @param {Object|null} aiStructuredInput - Payload JSON terstruktur untuk AI dari pesan terbaru pengguna.
 * @returns {Array} Array objek pesan untuk API Gemini.
 */
function buildConversationHistory(history, currentUserMessageText, aiStructuredInput) {
    const conversation = history.map(entry => {
        let textContent = entry.text;
        // Jika entri ini adalah pesan user dan isinya adalah JSON dari permintaan detail produk
        if (entry.role === 'user') {
            try {
                const parsed = JSON.parse(textContent);
                if (parsed.type === "product_detail" && parsed.data && parsed.data.title) {
                    // Ubah JSON menjadi teks human-readable untuk prompt AI
                    textContent = `User meminta detail produk: ${parsed.data.title}`;
                }
            } catch (e) {
                // Not a JSON message, use original textContent
            }
        }
        return {
            role: entry.role === 'user' ? 'user' : 'model',
            parts: [{ text: textContent }]
        };
    });

    // Tambahkan pesan terbaru dari pengguna
    if (aiStructuredInput) {
        // Jika ada input terstruktur, itu yang AI harus proses
        conversation.push({
            role: 'user',
            parts: [{ text: JSON.stringify(aiStructuredInput) }] // AI akan memproses JSON ini
        });
    } else {
        // Jika tidak ada input terstruktur, gunakan pesan teks biasa
        conversation.push({
            role: 'user',
            parts: [{ text: currentUserMessageText }]
        });
    }

    return conversation;
}

/**
 * Mengirim permintaan ke Gemini API.
 * @param {string} geminiApiKey - Kunci API Gemini.
 * @param {Array} products - Daftar produk.
 * @param {Array} cartItems - Item di keranjang.
 * @param {Array} history - Riwayat chat.
 * @param {string} userMessageText - Pesan pengguna (human-readable) untuk prompt history.
 * @param {Object|null} aiStructuredInput - Payload JSON terstruktur untuk AI dari pesan terbaru.
 * @returns {Promise<string>} Respons dari Gemini.
 */
export async function getGeminiResponse(geminiApiKey, products, cartItems, history, userMessageText, aiStructuredInput) {
    const systemPrompt = buildSystemPrompt(products, cartItems);
    // [MODIFIED] Meneruskan aiStructuredInput ke buildConversationHistory
    const conversation = buildConversationHistory(history, userMessageText, aiStructuredInput);

    const fullConversation = [{
        role: "user",
        parts: [{ text: systemPrompt }]
    }, {
        role: "model",
        parts: [{ text: "Baik, saya siap membantu. Ada yang bisa saya bantu hari ini?" }]
    }, ...conversation];

    try { // gemini-2.0-flash
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: fullConversation,
                safetySettings: SAFETY_SETTINGS,
                generationConfig: GENERATION_CONFIG,
            }),
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error("Gemini API Error:", data);
            let errorMessage = "Terjadi kesalahan saat menghubungi AI.";
            if (data.error && data.error.message) {
                errorMessage = `Gemini API Error: ${data.error.message}`;
            }
            throw new Error(errorMessage);
        }

        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
            return data.candidates[0].content.parts[0].text;
        } else {
            console.warn("Unexpected Gemini response structure:", data);
            return "Maaf, saya tidak dapat memproses permintaan Anda saat ini.";
        }

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw error;
    }
}
