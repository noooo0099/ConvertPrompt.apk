// api/convert.js
// AKhir — Prompt Optimizer Backend
// Production-ready | Vercel Serverless Function

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─────────────────────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────────────────────

const CONFIG = {
  // Batas input pengguna (karakter)
  MAX_PROMPT_LENGTH: 2000,
  MIN_PROMPT_LENGTH: 3,

  // Timeout request ke Gemini (ms) — di bawah maxDuration Vercel (25s)
  GEMINI_TIMEOUT_MS: 18000,

  // Model Gemini — fallback ke flash jika pro tidak tersedia
  GEMINI_MODEL: 'gemini-2.0-flash',

  // Rate limiting sederhana berbasis in-memory (per Vercel instance)
  // Untuk production skala besar, ganti dengan Upstash Redis
  RATE_LIMIT_WINDOW_MS: 60_000,   // 1 menit
  RATE_LIMIT_MAX_REQ:   10,        // 10 request per IP per menit
};

// ─────────────────────────────────────────────────────────
// SYSTEM PROMPT — Sesuai visi AKhir: GENERAL Prompt Optimizer
// FIX KRITIS 1: Dihapus semua konteks "budget" yang membatasi
// ─────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `Kamu adalah AKhir — sebuah mesin pengoptimal prompt AI tingkat lanjut.

MISI UTAMA:
Ubah prompt mentah pengguna menjadi prompt yang jauh lebih tajam, terstruktur, dan efektif untuk digunakan di AI manapun (ChatGPT, Claude, Gemini, Llama, dll).

ATURAN OUTPUT (WAJIB DIPATUHI):
1. Output kamu HANYA berisi prompt hasil optimasi — langsung, tanpa kata pembuka, tanpa penjelasan, tanpa tanda kutip pembungkus.
2. Pertahankan NIAT dan TUJUAN asli pengguna. Jangan ubah topik, jangan tambahkan asumsi yang tidak diminta.
3. Perbaiki struktur kalimat, tambahkan konteks yang relevan, dan perjelas instruksi agar AI target dapat merespons lebih akurat.
4. Gunakan bahasa yang sama dengan input pengguna (Indonesia → Indonesia, Inggris → Inggris).
5. Jika input terlalu singkat atau ambigu, buat versi yang paling umum dan berguna dari niat yang tersirat — jangan tolak.
6. Panjang output idealnya 1–4 kalimat untuk prompt sederhana, hingga beberapa paragraf untuk prompt kompleks.
7. JANGAN tambahkan instruksi format output (seperti "jawab dalam JSON") kecuali pengguna secara eksplisit memintanya.

TEKNIK OPTIMASI YANG HARUS DITERAPKAN:
- Tambahkan persona atau konteks peran jika relevan ("Kamu adalah seorang ahli X...")
- Perjelas audiens target jika bisa disimpulkan
- Tambahkan parameter kualitas ("mendalam", "praktis", "berbasis data", dll)
- Pisahkan instruksi kompleks menjadi langkah-langkah yang jelas
- Hapus ambiguitas dan kata-kata yang tidak perlu

Sekarang optimalkan prompt berikut:`;

// ─────────────────────────────────────────────────────────
// RATE LIMITER IN-MEMORY
// FIX KRITIS 2: Mencegah spam dan penyalahgunaan API key
// ─────────────────────────────────────────────────────────

const rateLimitStore = new Map();

function getRateLimitKey(req) {
  // Ambil IP dari berbagai header (Vercel, proxy, langsung)
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  // Bersihkan entry lama
  if (entry && now - entry.windowStart > CONFIG.RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.delete(ip);
  }

  const current = rateLimitStore.get(ip);
  if (!current) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: CONFIG.RATE_LIMIT_MAX_REQ - 1 };
  }

  if (current.count >= CONFIG.RATE_LIMIT_MAX_REQ) {
    const resetInSec = Math.ceil(
      (CONFIG.RATE_LIMIT_WINDOW_MS - (now - current.windowStart)) / 1000
    );
    return { allowed: false, resetInSec };
  }

  current.count++;
  return { allowed: true, remaining: CONFIG.RATE_LIMIT_MAX_REQ - current.count };
}

// ─────────────────────────────────────────────────────────
// SANITASI INPUT
// FIX PENTING 3: Bersihkan input sebelum dikirim ke Gemini
// ─────────────────────────────────────────────────────────

function sanitizeInput(raw) {
  return raw
    .trim()
    // Hapus karakter kontrol berbahaya kecuali newline & tab
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Batasi newline berturut-turut (max 3)
    .replace(/\n{4,}/g, '\n\n\n')
    // Batasi spasi berturut-turut
    .replace(/ {10,}/g, '     ');
}

// ─────────────────────────────────────────────────────────
// STRUCTURED LOGGER
// FIX KUALITAS 2: Log terstruktur agar mudah dicari di Vercel
// ─────────────────────────────────────────────────────────

function log(level, requestId, message, meta = {}) {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({
    ts: new Date().toISOString(),
    level,
    requestId,
    message,
    ...meta,
  }));
}

// ─────────────────────────────────────────────────────────
// INISIALISASI GEMINI
// ─────────────────────────────────────────────────────────

// Inisialisasi di luar handler agar di-cache antar invokasi (warm start)
let genAI;
let geminiModel;

function getModel() {
  if (!geminiModel) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY environment variable tidak diset.');
    genAI = new GoogleGenerativeAI(apiKey);
    geminiModel = genAI.getGenerativeModel({
      model: CONFIG.GEMINI_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.7,       // Sedikit kreatif tapi tetap konsisten
        topP: 0.9,
        maxOutputTokens: 1024,  // Cukup untuk prompt teroptimasi, tidak boros
      },
    });
  }
  return geminiModel;
}

// ─────────────────────────────────────────────────────────
// HELPER: Set CORS headers
// FIX KRITIS 4: CORS lebih terkontrol
// ─────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  // Untuk Android app native, origin tidak dikirim — '*' tetap diperlukan.
  // Jika kamu punya web client, ganti '*' dengan domain spesifik.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-ID');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────

module.exports = async (req, res) => {

  // FIX KUALITAS 1: Request ID untuk tracing
  const requestId = req.headers['x-request-id'] ||
    `akhir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  setCorsHeaders(res);
  res.setHeader('X-Request-ID', requestId);

  // ── Preflight ──
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ── Method check ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method tidak diizinkan. Gunakan POST.' });
  }

  // FIX KUALITAS 3: Validasi Content-Type
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({
      error: 'Content-Type harus application/json.',
    });
  }

  // ── Rate limiting ──
  const ip = getRateLimitKey(req);
  const rateResult = checkRateLimit(ip);

  res.setHeader('X-RateLimit-Limit', CONFIG.RATE_LIMIT_MAX_REQ);
  res.setHeader('X-RateLimit-Remaining', rateResult.remaining ?? 0);

  if (!rateResult.allowed) {
    log('warn', requestId, 'Rate limit tercapai', { ip });
    return res.status(429).json({
      error: `Terlalu banyak permintaan. Coba lagi dalam ${rateResult.resetInSec} detik.`,
      retryAfterSeconds: rateResult.resetInSec,
    });
  }

  // ── Validasi input ──
  const { rawPrompt } = req.body || {};

  if (!rawPrompt || typeof rawPrompt !== 'string') {
    return res.status(400).json({ error: 'Field "rawPrompt" wajib diisi dan harus berupa teks.' });
  }

  // FIX KRITIS 3: Batasi panjang input
  if (rawPrompt.trim().length < CONFIG.MIN_PROMPT_LENGTH) {
    return res.status(400).json({
      error: `Prompt terlalu pendek. Minimal ${CONFIG.MIN_PROMPT_LENGTH} karakter.`,
    });
  }

  if (rawPrompt.length > CONFIG.MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      error: `Prompt terlalu panjang. Maksimal ${CONFIG.MAX_PROMPT_LENGTH} karakter.`,
      maxLength: CONFIG.MAX_PROMPT_LENGTH,
    });
  }

  const cleanPrompt = sanitizeInput(rawPrompt);
  log('info', requestId, 'Request diterima', {
    ip,
    promptLength: cleanPrompt.length,
  });

  // ── Panggil Gemini dengan timeout ──
  // FIX KRITIS 5: Timeout eksplisit agar tidak hang
  try {
    const model = getModel();

    const geminiCall = model.generateContent(cleanPrompt);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('GEMINI_TIMEOUT')), CONFIG.GEMINI_TIMEOUT_MS)
    );

    const result = await Promise.race([geminiCall, timeoutPromise]);
    const optimizedPrompt = result.response.text()?.trim();

    if (!optimizedPrompt) {
      log('warn', requestId, 'Gemini mengembalikan teks kosong');
      return res.status(502).json({ error: 'AI tidak menghasilkan respons. Coba lagi.' });
    }

    log('info', requestId, 'Berhasil', { outputLength: optimizedPrompt.length });

    return res.status(200).json({
      optimizedPrompt,
      meta: {
        requestId,
        inputLength: cleanPrompt.length,
        outputLength: optimizedPrompt.length,
        model: CONFIG.GEMINI_MODEL,
      },
    });

  } catch (error) {

    // FIX KRITIS 6: Sanitasi pesan error — jangan bocorkan detail internal
    const errMsg = error.message || '';

    // Timeout yang kita set sendiri
    if (errMsg === 'GEMINI_TIMEOUT') {
      log('error', requestId, 'Gemini timeout', { ms: CONFIG.GEMINI_TIMEOUT_MS });
      return res.status(504).json({
        error: 'AI tidak merespons dalam batas waktu. Coba lagi.',
      });
    }

    // Quota Gemini habis
    if (error.status === 429 || errMsg.includes('429') || errMsg.toLowerCase().includes('quota')) {
      log('warn', requestId, 'Gemini quota habis');
      return res.status(429).json({
        error: 'Kuota AI sedang penuh. Coba lagi dalam beberapa menit.',
      });
    }

    // API key tidak valid
    if (error.status === 401 || error.status === 403 || errMsg.includes('API key')) {
      log('error', requestId, 'API key tidak valid atau tidak memiliki akses');
      return res.status(503).json({
        error: 'Layanan sementara tidak tersedia. Hubungi administrator.',
      });
    }

    // Error model tidak ditemukan
    if (error.status === 404 || errMsg.includes('not found')) {
      log('error', requestId, 'Model tidak ditemukan', { model: CONFIG.GEMINI_MODEL });
      return res.status(503).json({
        error: 'Model AI tidak tersedia. Hubungi administrator.',
      });
    }

    // Error tidak dikenal — log detail internal, kirim pesan generik
    log('error', requestId, 'Error tidak dikenal', {
      status: error.status,
      // Hanya log 200 karakter pertama agar tidak spam
      message: errMsg.slice(0, 200),
    });

    return res.status(500).json({
      error: 'Terjadi kesalahan internal. Coba lagi.',
      requestId, // Sertakan requestId agar user bisa lapor
    });
  }
};
