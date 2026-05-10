# AKhir — Prompt Optimizer API

Backend serverless untuk aplikasi Android **AKhir**. Ditenagai oleh Google Gemini, di-deploy di Vercel.

---

## Endpoint

| Method | Path | Deskripsi |
|--------|------|-----------|
| `POST` | `/api/convert` | Optimalkan prompt mentah |
| `GET` | `/api/health` | Cek status server & API key |

---

## Deploy ke Vercel

### 1. Clone / upload proyek ini ke Vercel

```bash
# Pasang Vercel CLI (jika belum)
npm i -g vercel

# Login
vercel login

# Deploy production
vercel --prod
```

### 2. Set environment variable

Di dashboard Vercel → **Settings → Environment Variables**, tambahkan:

| Key | Value |
|-----|-------|
| `GEMINI_API_KEY` | API key dari [Google AI Studio](https://aistudio.google.com/app/apikey) |

> ⚠️ **Jangan pernah commit API key ke Git.**

### 3. Verifikasi

Setelah deploy, akses:
```
https://<project>.vercel.app/api/health
```

Respons yang benar:
```json
{
  "status": "ok",
  "version": "2.0.0",
  "ts": "2026-...",
  "checks": {
    "gemini_api_key": "set"
  }
}
```

---

## Cara Pakai Endpoint `/api/convert`

### Request

```http
POST /api/convert
Content-Type: application/json

{
  "rawPrompt": "buatkan rencana belajar python untuk pemula"
}
```

### Response sukses (`200`)

```json
{
  "optimizedPrompt": "Kamu adalah instruktur pemrograman berpengalaman. Buatkan rencana belajar Python yang terstruktur dan komprehensif untuk pemula absolut...",
  "meta": {
    "requestId": "akhir-1234567890-abc12",
    "inputLength": 48,
    "outputLength": 312,
    "model": "gemini-2.0-flash"
  }
}
```

### Response error

| Status | Kondisi |
|--------|---------|
| `400` | Prompt kosong, terlalu pendek (< 3 karakter), atau terlalu panjang (> 2000 karakter) |
| `405` | Method bukan POST |
| `415` | Content-Type bukan `application/json` |
| `429` | Rate limit (10 req/menit/IP) atau kuota Gemini habis |
| `500` | Error internal — sertakan `requestId` saat lapor bug |
| `503` | API key tidak valid atau model tidak tersedia |
| `504` | Gemini tidak merespons dalam 18 detik |

---

## Konfigurasi

Edit konstanta `CONFIG` di `api/convert.js`:

```js
const CONFIG = {
  MAX_PROMPT_LENGTH: 2000,    // Batas karakter input
  MIN_PROMPT_LENGTH: 3,       // Minimum karakter input
  GEMINI_TIMEOUT_MS: 18000,   // Timeout request ke Gemini (ms)
  GEMINI_MODEL: 'gemini-2.0-flash',
  RATE_LIMIT_WINDOW_MS: 60_000,  // Jendela rate limit (ms)
  RATE_LIMIT_MAX_REQ: 10,        // Max request per jendela per IP
};
```

---

## Catatan Produksi

- **Rate limiting** saat ini in-memory per Vercel instance. Untuk skala besar, ganti dengan [Upstash Redis](https://upstash.com/).
- **Logging** menggunakan `console.log` dengan format JSON — langsung terbaca di Vercel Logs dashboard.
- **Model fallback**: jika `gemini-2.0-flash` tidak tersedia di region kamu, ganti ke `gemini-1.5-flash`.

---

## Struktur Proyek

```
/
├── api/
│   ├── convert.js    ← Endpoint utama optimasi prompt
│   └── health.js     ← Health check & monitoring
├── package.json
├── vercel.json       ← Konfigurasi Vercel (runtime, routes, security headers)
└── README.md
```
