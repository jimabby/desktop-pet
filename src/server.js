'use strict';

const http = require('http');

/**
 * Tiny local control server.
 *
 * Any AI assistant, hook, or script tells the pet what to do by POSTing JSON:
 *
 *   POST http://localhost:7337/state
 *   { "mood": "working", "text": "Refactoring auth...", "source": "claude", "ttl": 8000 }
 *
 * Fields:
 *   mood   - idle | thinking | working | happy | sleeping | error  (default: idle)
 *   text   - optional speech-bubble message
 *   source - optional label (claude | chatgpt | gemini | deepseek | ...)
 *   ttl    - optional ms after which the pet returns to idle
 *
 * GET /health  -> { ok: true }  (handy for scripts to check the pet is up)
 */
function startControlServer(port, onState) {
  const VALID_MOODS = new Set([
    'idle',
    'thinking',
    'working',
    'happy',
    'sleeping',
    'error'
  ]);

  const server = http.createServer((req, res) => {
    // Permissive CORS so browser-based AI wrappers can call it too.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'POST' && req.url === '/state') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 1e5) req.destroy(); // guard against huge payloads
      });
      req.on('end', () => {
        let data = {};
        try {
          data = body ? JSON.parse(body) : {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid json' }));
        }

        const state = {
          mood: VALID_MOODS.has(data.mood) ? data.mood : 'idle',
          text: typeof data.text === 'string' ? data.text.slice(0, 280) : '',
          source: typeof data.source === 'string' ? data.source.slice(0, 40) : '',
          ttl: Number.isFinite(data.ttl) ? Math.max(0, Math.min(data.ttl, 120000)) : 0
        };

        onState(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, state }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[pet] port ${port} already in use — is the pet already running?`
      );
    } else {
      console.error('[pet] server error:', err);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[pet] control server on http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startControlServer };
