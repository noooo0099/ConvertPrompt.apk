// api/health.js
// AKhir — Health Check Endpoint
// GET /api/health → {"status":"ok","ts":"...","version":"..."}

'use strict';

const { version } = require('../package.json');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Periksa apakah API key ada (tanpa expose nilainya)
  const apiKeySet = Boolean(process.env.GEMINI_API_KEY);

  const payload = {
    status: apiKeySet ? 'ok' : 'degraded',
    version,
    ts: new Date().toISOString(),
    checks: {
      gemini_api_key: apiKeySet ? 'set' : 'MISSING — set GEMINI_API_KEY di Vercel',
    },
  };

  return res.status(apiKeySet ? 200 : 503).json(payload);
};
