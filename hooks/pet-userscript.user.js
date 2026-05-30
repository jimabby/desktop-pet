// ==UserScript==
// @name         Desktop Pet — ChatGPT & Gemini bridge
// @namespace    desktop-pet
// @version      1.0.0
// @description  Make the desktop pet react while ChatGPT or Gemini (web) is generating.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Install: paste this into Tampermonkey / Violentmonkey (any browser).
 * It watches the page for the "stop generating" control — which only exists
 * while the model is streaming — and pings the pet's local control server so
 * the pet shows the right AI's tint + badge while it works, and cheers when
 * it finishes. No universal hook system exists for these web UIs, so we infer
 * the state from the DOM.
 *
 * CORS on the pet server is open, so a plain fetch from the page works.
 * If you launched the pet with PET_TOKEN, set the same value in TOKEN below.
 */
(function () {
  'use strict';

  // ---- config (edit if you changed the pet's port or set a token) ----
  const PORT = 7337;
  const TOKEN = ''; // must match the app's PET_TOKEN if you set one
  const ENDPOINT = `http://127.0.0.1:${PORT}/state`;

  // Which site are we on -> which AI label/tint the pet should use.
  const host = location.hostname;
  const SOURCE = host.includes('gemini') ? 'gemini' : 'chatgpt';
  const NAME = SOURCE === 'gemini' ? 'Gemini' : 'ChatGPT';

  // Keep the "working" state alive while it streams; each ping refreshes this
  // TTL so an interrupted/closed-tab generation self-heals back to idle.
  const ACTIVE_TTL = 30000;

  // Rotating little status lines so the bubble doesn't read as frozen.
  const WORKING_LINES = [
    `${NAME} is thinking…`,
    `${NAME} is typing…`,
    `${NAME} is cooking…`,
    `${NAME} is on it…`
  ];

  function post(state) {
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['X-Pet-Token'] = TOKEN;
    fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: SOURCE, ...state })
    }).catch(() => {
      /* pet not running — ignore so we never spam the console */
    });
  }

  // True while the model is streaming a response. We look for the stop control,
  // which is present only mid-generation, across both sites' markup. Selectors
  // are deliberately broad (aria-label / data-testid) so a UI tweak is less
  // likely to break detection.
  function isGenerating() {
    const stop = document.querySelector(
      [
        '[data-testid="stop-button"]',
        'button[aria-label*="Stop streaming" i]',
        'button[aria-label*="Stop generating" i]',
        'button[aria-label*="Stop response" i]',
        'button[aria-label="Stop"]',
        'mat-icon[data-mat-icon-name="stop"]',
        '[data-test-id="stop-button"]'
      ].join(',')
    );
    return !!(stop && stop.offsetParent !== null);
  }

  let generating = false;
  let refreshTimer = null;
  let lineIdx = 0;

  function startWorking() {
    generating = true;
    pingWorking();
    clearInterval(refreshTimer);
    // Refresh the state every few seconds: keeps the TTL alive and rotates the
    // bubble text so it looks live.
    refreshTimer = setInterval(pingWorking, 6000);
  }

  function pingWorking() {
    post({
      mood: 'working',
      text: WORKING_LINES[lineIdx++ % WORKING_LINES.length],
      ttl: ACTIVE_TTL
    });
  }

  function stopWorking() {
    generating = false;
    clearInterval(refreshTimer);
    refreshTimer = null;
    // Cheer briefly, then the pet auto-clears this source via the TTL.
    post({ mood: 'happy', text: `${NAME} done!`, ttl: 4000 });
  }

  function check() {
    const now = isGenerating();
    if (now && !generating) startWorking();
    else if (!now && generating) stopWorking();
  }

  // React to DOM changes (fast) with a polling fallback (robust against
  // observers that miss subtree swaps in these heavily virtualized UIs).
  const observer = new MutationObserver(() => check());
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(check, 1000);

  // Tidy up if the tab is closed/hidden mid-generation.
  window.addEventListener('pagehide', () => {
    if (generating) post({ mood: 'idle' });
  });

  check();
})();
