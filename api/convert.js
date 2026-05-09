// api/convert.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_INSTRUCTION = `Kamu adalah "Prompt Optimizer" yang mengubah prompt mentah pengguna menjadi prompt siap pakai yang EFISIEN dan TERSTRUKTUR untuk menghasilkan rencana BUDGET.
Aturan Mutlak:
1. Output kamu HARUS HANYA berupa prompt hasil olahan. Tidak boleh ada kata pembuka, kata penutup, atau penjelasan apapun. Langsung promptnya saja.
2. Prompt yang kamu hasilkan harus memerintahkan AI untuk menghasilkan output budget dalam format JSON. Ini wajib agar mudah dibaca aplikasi.
3. Kamu harus menambahkan instruksi "Prioritaskan kebutuhan pokok" dan "Buat alokasi dana yang realistis".
4. Jika input pengguna tidak jelas, buatkan prompt umum untuk "rencana budget bulanan mahasiswa".

Contoh Input: "gaji 3 juta utk keluarga"
Contoh Output: Buatkan rencana budget bulanan yang ketat dan realistis untuk sebuah keluarga dengan total pendapatan Rp 3.000.000. Prioritaskan kebutuhan pokok seperti makanan, sewa, dan listrik. Format output WAJIB dalam JSON.

Sekarang, ubah prompt ini:`;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { rawPrompt } = req.body;
  if (!rawPrompt || rawPrompt.trim().length < 2) {
    return res.status(400).json({ error: 'Prompt terlalu pendek atau kosong.' });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // Model gratis yang kuotanya lebih longgar
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const result = await model.generateContent(rawPrompt);
    const response = result.response;
    const optimizedPrompt = response.text();

    res.status(200).json({ optimizedPrompt });
  } catch (error) {
    console.error('Gemini Error:', error.message);
    
    // Jika error karena quota (429), kasih tahu pengguna
    if (error.status === 429) {
      return res.status(429).json({ error: 'Kuota habis. Silakan coba lagi nanti.' });
    }
    
    res.status(500).json({ error: 'Gagal memproses prompt. Coba lagi.' });
  }
};
