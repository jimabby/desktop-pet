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
 *   mood     - idle | thinking | working | happy | sleeping | error  (default: idle)
 *   text     - optional speech-bubble message
 *   source   - optional label (claude | chatgpt | gemini | deepseek | ...)
 *   ttl      - optional ms after which the pet returns to idle
 *   link     - optional URL to open when the bubble is clicked (e.g. a
 *              vscode://file/... link to jump back to the editor for a confirm).
 *              Only safe schemes are accepted (http/https/vscode/cursor/...).
 *   linkText - optional label for that link (default: "Open →")
 *   attention- optional bool; true marks a confirm/permission prompt so the pet
 *              bounces + chimes for your attention even with no link.
 *
 * GET /health  -> { ok: true }  (handy for scripts to check the pet is up)
 *
 * Auth: the /state endpoint requires a matching `X-Pet-Token` header whenever a
 * token is configured — and the app generates one on first run, so this is on by
 * default. Without it the open CORS policy would let any web page you happen to
 * have loaded puppet the pet (including planting a bubble link). The token lives
 * in the app's pet-config.json, which the bundled hook reads automatically; set
 * PET_TOKEN in the environment to override it. /health stays public so scripts
 * can probe for the pet without credentials.
 *
 * If the preferred port is taken the server walks up to the next free one and
 * reports it via opts.onListen, so a stale instance can't leave the pet mute.
 */
// Schemes we're willing to open from a (potentially un-tokened) network call.
// Keeps a random web page from POSTing e.g. a file:// link the pet would open.
// Exported so main.js can reuse the same list for the IPC open-link handler.
const ALLOWED_LINK_SCHEMES = new Set([
  'http:',
  'https:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
  'windsurf:'
]);

function startControlServer(port, onState, opts = {}) {
  // Token may be supplied live (e.g. from the GUI-editable store) so changing it
  // takes effect without a restart; falls back to the PET_TOKEN env var.
  const getToken =
    typeof opts.getToken === 'function'
      ? opts.getToken
      : () => process.env.PET_TOKEN || '';

  function safeLink(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    const s = raw.slice(0, 2048);
    try {
      return ALLOWED_LINK_SCHEMES.has(new URL(s).protocol) ? s : '';
    } catch {
      return '';
    }
  }

  const VALID_MOODS = new Set([
    'idle',
    'thinking',
    'working',
    'happy',
    'stressed',
    'sleeping',
    'error'
  ]);

  const server = http.createServer((req, res) => {
    // Permissive CORS so browser-based AI wrappers can call it too.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pet-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'POST' && req.url === '/state') {
      const TOKEN = getToken();
      if (TOKEN && req.headers['x-pet-token'] !== TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }

      let body = '';
      let tooBig = false;
      req.on('data', (c) => {
        body += c;
        // Guard against huge payloads. Answer before hanging up, so the caller
        // learns why instead of sitting on a dead socket until it times out.
        if (body.length > 1e5 && !tooBig) {
          tooBig = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload too large' }));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooBig) return;
        let data = {};
        try {
          data = body ? JSON.parse(body) : {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid json' }));
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'expected a JSON object' }));
        }

        const state = {
          mood: VALID_MOODS.has(data.mood) ? data.mood : 'idle',
          text: typeof data.text === 'string' ? data.text.slice(0, 280) : '',
          source: typeof data.source === 'string' ? data.source.slice(0, 40) : '',
          ttl: Number.isFinite(data.ttl) ? Math.max(0, Math.min(data.ttl, 120000)) : 0,
          link: safeLink(data.link),
          linkText: typeof data.linkText === 'string' ? data.linkText.slice(0, 60) : '',
          // A confirm/permission prompt that needs the user. Drives the bounce +
          // chime even when no editor link could be built (e.g. plain terminal).
          attention: data.attention === true,
          // Context-window size in tokens (drives the pet's usage ring).
          ctx: Number.isFinite(data.ctx) ? Math.max(0, Math.min(data.ctx, 1e9)) : 0
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

  // If the preferred port is taken (an old instance, or another app), walk a
  // few ports up rather than dying silently. onListen reports where we landed
  // so the caller can persist it for the hook to find; onFatal reports that we
  // never got a socket at all, so the app can tell the user instead of looking
  // healthy while reacting to nothing.
  const onListen = typeof opts.onListen === 'function' ? opts.onListen : () => {};
  const onFatal = typeof opts.onFatal === 'function' ? opts.onFatal : () => {};
  const MAX_PORT_TRIES = 10;
  let attempt = 0;
  let boundPort = 0;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES - 1) {
      attempt++;
      console.warn(`[pet] port ${port + attempt - 1} in use — trying ${port + attempt}`);
      setTimeout(tryListen, 0);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`[pet] no free port in ${port}-${port + MAX_PORT_TRIES - 1}`);
      onFatal(new Error(`ports ${port}-${port + MAX_PORT_TRIES - 1} are all in use`));
    } else {
      console.error('[pet] server error:', err);
      onFatal(err);
    }
  });

  function tryListen() {
    server.listen(port + attempt, '127.0.0.1');
  }

  server.on('listening', () => {
    boundPort = server.address().port;
    console.log(`[pet] control server on http://127.0.0.1:${boundPort}`);
    onListen(boundPort);
  });

  tryListen();

  server.getPort = () => boundPort;
  return server;
}

module.exports = { startControlServer, ALLOWED_LINK_SCHEMES };
