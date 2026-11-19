// Ask Gemini for iOS Safari — Mini Top-Left Button & Chrome-Style Overlay
// Runs inside an isolated Shadow DOM so website CSS never collides.

(function () {
  'use strict';

  if (window.top !== window.self) return;
  const hostName = (location.hostname || '').toLowerCase();
  if (hostName === 'gemini.google.com' || hostName === 'accounts.google.com') return;
  if (document.getElementById('__ask_gemini_safari_host__')) return;

  const ext = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULT_SETTINGS = {
    showMiniButton: true,
    buttonSize: 28,
    idleOpacity: 0.7,
    buttonTopPx: null,
    autoReturnOnSend: false
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let isOpen = false;
  let attachPageContext = true;
  let forceNewChat = false;
  let selectedSnippet = '';
  let activeRequestId = null;
  let isStreaming = false;
  let lastAnswerText = '';
  let plusMenuOpen = false;

  // Storage & messaging helpers
  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        const res = ext.storage.local.get(keys, (items) => resolve(items || {}));
        if (res && typeof res.then === 'function') res.then(resolve).catch(() => resolve({}));
      } catch (_) {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        const res = ext.storage.local.set(obj, () => resolve());
        if (res && typeof res.then === 'function') res.then(resolve).catch(() => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  function sendRuntimeMessage(msg) {
    return new Promise((resolve) => {
      try {
        const res = ext.runtime.sendMessage(msg, (reply) => {
          if (ext.runtime.lastError) resolve(null);
          else resolve(reply || null);
        });
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(() => resolve(null));
        }
      } catch (_) {
        resolve(null);
      }
    });
  }

  // Create Shadow DOM root
  const hostEl = document.createElement('div');
  hostEl.id = '__ask_gemini_safari_host__';
  hostEl.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;border:0;margin:0;padding:0;';
  const shadow = hostEl.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    /* Ultra-compact top-left Ask Gemini mini button */
    .ag-mini-btn {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 10px);
      left: calc(env(safe-area-inset-left, 0px) + 10px);
      width: var(--ag-btn-size, 28px);
      height: var(--ag-btn-size, 28px);
      border-radius: 999px;
      background: rgba(20, 20, 25, 0.78);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      margin: 0;
      cursor: pointer;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      opacity: var(--ag-idle-opacity, 0.7);
      transition: opacity 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
      z-index: 2147483646;
    }

    .ag-mini-btn:hover,
    .ag-mini-btn:active {
      opacity: 1;
      transform: scale(1.06);
      box-shadow: 0 4px 14px rgba(66, 133, 244, 0.42);
    }

    .ag-mini-btn.ag-hidden {
      display: none !important;
    }

    .ag-mini-btn svg {
      width: 56%;
      height: 56%;
      display: block;
      pointer-events: none;
    }

    /* Overlay backdrop */
    .ag-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.24);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 2147483646;
    }

    .ag-backdrop.ag-open {
      opacity: 1;
      pointer-events: auto;
    }

    /* Bottom sheet anchored above iOS keyboard */
    .ag-sheet {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(var(--ag-kb-offset, 0px) + env(safe-area-inset-bottom, 8px) + 8px);
      max-width: 520px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      opacity: 0;
      transform: translateY(18px) scale(0.98);
      transition: opacity 0.2s cubic-bezier(0.2, 0.8, 0.2, 1),
                  transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
                  bottom 0.12s ease-out;
      z-index: 2147483647;
    }

    .ag-sheet.ag-open {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    /* Floating Chrome-style quick prompt pills */
    .ag-pills {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      pointer-events: none;
    }

    .ag-pills.ag-hidden {
      display: none;
    }

    .ag-pill {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      background: rgba(28, 28, 32, 0.96);
      color: #f1f3f4;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 18px;
      padding: 10px 16px;
      font-size: 14.5px;
      font-weight: 500;
      line-height: 1.25;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
      cursor: pointer;
      transition: transform 0.14s ease, background 0.14s ease;
      max-width: 100%;
      text-align: left;
    }

    .ag-pill:active {
      transform: scale(0.97);
      background: rgba(44, 44, 50, 0.98);
    }

    .ag-pill svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      color: #c4c7c5;
    }

    /* Inline Streaming Answer Card */
    .ag-answer-card {
      pointer-events: auto;
      background: rgba(24, 24, 28, 0.97);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 22px;
      padding: 13px 15px;
      color: #e8eaed;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42);
      max-height: min(46vh, 340px);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ag-answer-card.ag-hidden {
      display: none;
    }

    .ag-answer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12.5px;
      color: #9aa0a6;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 7px;
    }

    .ag-answer-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: #e8eaed;
    }

    .ag-answer-status svg {
      width: 14px;
      height: 14px;
    }

    .ag-pulse {
      animation: agSpinPulse 1.4s ease-in-out infinite;
    }

    @keyframes agSpinPulse {
      0%, 100% { transform: scale(0.92); opacity: 0.7; }
      50% { transform: scale(1.12); opacity: 1; }
    }

    .ag-answer-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .ag-mini-action {
      background: rgba(255, 255, 255, 0.08);
      color: #e8eaed;
      border: 0;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
    }

    .ag-mini-action:active {
      background: rgba(255, 255, 255, 0.18);
    }

    .ag-answer-body {
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      font-size: 14.5px;
      line-height: 1.52;
      color: #f1f3f4;
      word-break: break-word;
    }

    .ag-answer-body p {
      margin: 0 0 8px 0;
    }
    .ag-answer-body p:last-child {
      margin-bottom: 0;
    }
    .ag-answer-body ul, .ag-answer-body ol {
      margin: 4px 0 8px 18px;
      padding: 0;
    }
    .ag-answer-body li {
      margin-bottom: 4px;
    }
    .ag-answer-body code {
      background: rgba(255, 255, 255, 0.11);
      padding: 1px 5px;
      border-radius: 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
    }
    .ag-answer-body pre {
      background: rgba(0, 0, 0, 0.45);
      padding: 9px 11px;
      border-radius: 10px;
      overflow-x: auto;
      margin: 6px 0;
    }
    .ag-answer-body pre code {
      background: transparent;
      padding: 0;
    }
    .ag-answer-body h1, .ag-answer-body h2, .ag-answer-body h3 {
      font-size: 15px;
      font-weight: 600;
      margin: 8px 0 4px 0;
      color: #ffffff;
    }

    /* Rainbow Gemini Glow Wrapper matching Chrome iOS Ask Gemini */
    .ag-composer-glow {
      pointer-events: auto;
      position: relative;
      border-radius: 28px;
      padding: 2px;
      background: linear-gradient(
        95deg,
        #ff5f57 0%,
        #fbbc04 26%,
        #34a853 52%,
        #4285f4 78%,
        #a142f4 100%
      );
      box-shadow:
        0 -2px 18px rgba(251, 188, 4, 0.22),
        0 6px 24px rgba(66, 133, 244, 0.34),
        0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .ag-composer-card {
      background: #1b1b1f;
      border-radius: 26px;
      padding: 12px 14px 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Top row inside card: Page Context Chip + Close Overlay X */
    .ag-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .ag-context-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #2b2b30;
      border-radius: 999px;
      padding: 6px 11px 6px 8px;
      max-width: calc(100% - 36px);
      color: #e8eaed;
      font-size: 13.5px;
      font-weight: 500;
    }

    .ag-context-chip.ag-detached {
      opacity: 0.6;
    }

    .ag-favicon {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      flex-shrink: 0;
      object-fit: cover;
      background: #3c4043;
    }

    .ag-chip-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ag-chip-remove {
      background: transparent;
      border: 0;
      color: #c4c7c5;
      font-size: 16px;
      line-height: 1;
      padding: 0 2px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ag-close-sheet {
      background: rgba(255, 255, 255, 0.08);
      border: 0;
      color: #c4c7c5;
      width: 26px;
      height: 26px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      cursor: pointer;
      flex-shrink: 0;
    }

    /* Plus menu */
    .ag-plus-menu {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding-top: 2px;
    }

    .ag-plus-menu.ag-hidden {
      display: none;
    }

    .ag-plus-item {
      background: #2b2b30;
      color: #e8eaed;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 6px 10px;
      font-size: 12.5px;
      cursor: pointer;
    }

    .ag-plus-item.ag-active {
      border-color: #8ab4f8;
      color: #8ab4f8;
    }

    /* Bottom input row */
    .ag-input-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
    }

    .ag-plus-btn {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      border: 0;
      background: transparent;
      color: #e8eaed;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      flex-shrink: 0;
    }

    .ag-plus-btn:active {
      background: rgba(255, 255, 255, 0.1);
    }

    /* 16px prevents iOS Safari automatic input zoom */
    .ag-textarea {
      flex: 1;
      background: transparent;
      border: 0;
      outline: none;
      color: #f1f3f4;
      font-size: 16px;
      font-family: inherit;
      line-height: 1.38;
      resize: none;
      max-height: 104px;
      min-height: 24px;
      padding: 5px 0;
      margin: 0;
    }

    .ag-textarea::placeholder {
      color: #9aa0a6;
    }

    .ag-send-btn {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      border: 0;
      background: #2b2b30;
      color: #9aa0a6;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
    }

    .ag-send-btn.ag-ready {
      background: #8ab4f8;
      color: #131314;
    }

    .ag-send-btn:active {
      transform: scale(0.93);
    }
  `;

  const container = document.createElement('div');
  container.innerHTML = `
    <button class="ag-mini-btn" id="agMiniBtn" title="Ask Gemini" aria-label="Ask Gemini">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="agSparkleGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#669df6"/>
            <stop offset="50%" stop-color="#c58af9"/>
            <stop offset="100%" stop-color="#f28b82"/>
          </linearGradient>
        </defs>
        <path d="M12 2C12.3 7.3 16.7 11.7 22 12C16.7 12.3 12.3 16.7 12 22C11.7 16.7 7.3 12.3 2 12C7.3 11.7 11.7 7.3 12 2Z" fill="url(#agSparkleGrad)"/>
      </svg>
    </button>

    <div class="ag-backdrop" id="agBackdrop"></div>

    <div class="ag-sheet" id="agSheet" role="dialog" aria-label="Ask Gemini">
      <div class="ag-pills" id="agPills">
        <button class="ag-pill ag-hidden" id="agPillSelection" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/>
          </svg>
          <span>Explain selected text</span>
        </button>

        <button class="ag-pill" data-prompt="Summarize this page clearly with the most important points." type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="3"/>
            <path d="M8 9h8M8 13h8M8 17h5"/>
          </svg>
          <span>Summarize page</span>
        </button>

        <button class="ag-pill" data-prompt="Create a concise FAQ about the topic on this page and answer each question." type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>
          </svg>
          <span>Create FAQ about this topic</span>
        </button>

        <button class="ag-pill" data-prompt="What are the key takeaways, facts, and anything I should watch out for on this page?" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 10l-5 5 5 5"/>
            <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
          </svg>
          <span>Key takeaways from this page</span>
        </button>
      </div>

      <div class="ag-answer-card ag-hidden" id="agAnswerCard">
        <div class="ag-answer-header">
          <span class="ag-answer-status" id="agAnswerStatus">
            <svg id="agStatusIcon" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C12.3 7.3 16.7 11.7 22 12C16.7 12.3 12.3 16.7 12 22C11.7 16.7 7.3 12.3 2 12C7.3 11.7 11.7 7.3 12 2Z" fill="#8ab4f8"/>
            </svg>
            <span id="agStatusLabel">Gemini</span>
          </span>
          <div class="ag-answer-actions">
            <button class="ag-mini-action" id="agCopyBtn" type="button">Copy</button>
            <button class="ag-mini-action" id="agOpenGeminiBtn" type="button">Open in Gemini ↗</button>
            <button class="ag-mini-action" id="agClearChatBtn" type="button">Reset</button>
          </div>
        </div>
        <div class="ag-answer-body" id="agAnswerBody"></div>
      </div>

      <div class="ag-composer-glow">
        <div class="ag-composer-card">
          <div class="ag-card-top">
            <div class="ag-context-chip" id="agContextChip">
              <img class="ag-favicon" id="agFavicon" alt="" />
              <span class="ag-chip-title" id="agChipTitle">Current page</span>
              <button class="ag-chip-remove" id="agChipToggle" type="button" title="Toggle page context">×</button>
            </div>
            <button class="ag-close-sheet" id="agCloseSheet" type="button" title="Minimize">✕</button>
          </div>

          <div class="ag-plus-menu ag-hidden" id="agPlusMenu">
            <button class="ag-plus-item" id="agMenuAttachPage" type="button">Attach page context</button>
            <button class="ag-plus-item" id="agMenuNewChat" type="button">New Gemini chat</button>
            <button class="ag-plus-item" id="agMenuOpenWeb" type="button">Open gemini.google.com ↗</button>
          </div>

          <div class="ag-input-row">
            <button class="ag-plus-btn" id="agPlusBtn" type="button" title="Options">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
            <textarea class="ag-textarea" id="agInput" rows="1" placeholder="Ask Gemini"></textarea>
            <button class="ag-send-btn" id="agSendBtn" type="button" title="Send" aria-label="Send to Gemini">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  shadow.appendChild(styleEl);
  shadow.appendChild(container);
  (document.documentElement || document.body).appendChild(hostEl);

  // Elements
  const miniBtn = shadow.getElementById('agMiniBtn');
  const backdrop = shadow.getElementById('agBackdrop');
  const sheet = shadow.getElementById('agSheet');
  const pillsWrap = shadow.getElementById('agPills');
  const pillSelection = shadow.getElementById('agPillSelection');
  const answerCard = shadow.getElementById('agAnswerCard');
  const statusIcon = shadow.getElementById('agStatusIcon');
  const statusLabel = shadow.getElementById('agStatusLabel');
  const answerBody = shadow.getElementById('agAnswerBody');
  const copyBtn = shadow.getElementById('agCopyBtn');
  const openGeminiBtn = shadow.getElementById('agOpenGeminiBtn');
  const clearChatBtn = shadow.getElementById('agClearChatBtn');
  const contextChip = shadow.getElementById('agContextChip');
  const faviconImg = shadow.getElementById('agFavicon');
  const chipTitle = shadow.getElementById('agChipTitle');
  const chipToggle = shadow.getElementById('agChipToggle');
  const closeSheetBtn = shadow.getElementById('agCloseSheet');
  const plusBtn = shadow.getElementById('agPlusBtn');
  const plusMenu = shadow.getElementById('agPlusMenu');
  const menuAttachPage = shadow.getElementById('agMenuAttachPage');
  const menuNewChat = shadow.getElementById('agMenuNewChat');
  const menuOpenWeb = shadow.getElementById('agMenuOpenWeb');
  const inputEl = shadow.getElementById('agInput');
  const sendBtn = shadow.getElementById('agSendBtn');

  function applySettings() {
    miniBtn.classList.toggle('ag-hidden', !settings.showMiniButton || isOpen);
    hostEl.style.setProperty('--ag-btn-size', `${Number(settings.buttonSize) || 28}px`);
    hostEl.style.setProperty('--ag-idle-opacity', String(settings.idleOpacity ?? 0.7));
    if (typeof settings.buttonTopPx === 'number' && settings.buttonTopPx >= 4) {
      miniBtn.style.top = `${Math.min(window.innerHeight - 40, settings.buttonTopPx)}px`;
    } else {
      miniBtn.style.top = 'calc(env(safe-area-inset-top, 0px) + 10px)';
    }
  }

  function getFaviconUrl() {
    const iconLink =
      document.querySelector('link[rel="apple-touch-icon"]') ||
      document.querySelector('link[rel*="icon"]');
    if (iconLink && iconLink.href) return iconLink.href;
    return `${location.origin}/favicon.ico`;
  }

  function refreshContextChip() {
    const title = (document.title || location.hostname || 'Webpage').trim();
    faviconImg.src = getFaviconUrl();
    faviconImg.onerror = () => {
      faviconImg.style.display = 'none';
    };
    faviconImg.onload = () => {
      faviconImg.style.display = 'block';
    };

    if (!attachPageContext) {
      contextChip.classList.add('ag-detached');
      chipTitle.textContent = 'Page not attached (tap + to attach)';
      chipToggle.textContent = '+';
      menuAttachPage.classList.remove('ag-active');
    } else {
      contextChip.classList.remove('ag-detached');
      const shortTitle = title.length > 26 ? `${title.slice(0, 25)}…` : title;
      chipTitle.textContent = selectedSnippet
        ? `${shortTitle} (+ selection)`
        : shortTitle;
      chipToggle.textContent = '×';
      menuAttachPage.classList.add('ag-active');
    }

    menuNewChat.classList.toggle('ag-active', forceNewChat);
  }

  function extractReadablePageText() {
    const root =
      document.querySelector('article, [role="main"], main') || document.body;
    if (!root) return '';

    const clone = root.cloneNode(true);
    const junk = clone.querySelectorAll(
      'script, style, noscript, iframe, svg, canvas, nav, footer, [aria-hidden="true"]'
    );
    junk.forEach((el) => el.remove());

    const raw = (clone.innerText || clone.textContent || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const maxChars = 16000;
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars)}\n\n[...truncated webpage text...]`;
  }

  // Safe lightweight Markdown renderer for streaming Gemini answers
  function renderMarkdownSafe(md) {
    if (!md) return '';
    const escaped = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Extract code blocks first
    const codeBlocks = [];
    let processed = escaped.replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
      return `@@CODEBLOCK_${idx}@@`;
    });

    const lines = processed.split('\n');
    const htmlParts = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^@@CODEBLOCK_\d+@@$/.test(line.trim())) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        htmlParts.push(line.trim());
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        const level = headingMatch[1].length;
        htmlParts.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
        continue;
      }

      const listMatch = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        if (!inList) {
          htmlParts.push('<ul>');
          inList = true;
        }
        htmlParts.push(`<li>${formatInline(listMatch[1])}</li>`);
        continue;
      }

      if (inList && line.trim() === '') {
        htmlParts.push('</ul>');
        inList = false;
        continue;
      }

      if (line.trim() !== '') {
        htmlParts.push(`<p>${formatInline(line)}</p>`);
      }
    }

    if (inList) htmlParts.push('</ul>');

    let finalHtml = htmlParts.join('');
    codeBlocks.forEach((block, idx) => {
      finalHtml = finalHtml.replace(`@@CODEBLOCK_${idx}@@`, block);
    });
    return finalHtml;
  }

  function formatInline(str) {
    return str
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  // Keep bottom sheet directly above iOS Safari keyboard via visualViewport
  function syncViewportOffset() {
    if (!window.visualViewport) return;
    const vv = window.visualViewport;
    const kbHeight = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    hostEl.style.setProperty('--ag-kb-offset', `${Math.round(kbHeight)}px`);
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewportOffset);
    window.visualViewport.addEventListener('scroll', syncViewportOffset);
  }

  function openOverlay() {
    const sel = (window.getSelection ? String(window.getSelection()) : '').trim();
    selectedSnippet = sel.length > 3 ? sel.slice(0, 4000) : '';
    pillSelection.classList.toggle('ag-hidden', !selectedSnippet);

    isOpen = true;
    refreshContextChip();
    syncViewportOffset();
    miniBtn.classList.add('ag-hidden');
    backdrop.classList.add('ag-open');
    sheet.classList.add('ag-open');

    if (!lastAnswerText && !isStreaming) {
      pillsWrap.classList.remove('ag-hidden');
    }

    setTimeout(() => {
      inputEl.focus();
      syncViewportOffset();
    }, 60);
  }

  function closeOverlay() {
    isOpen = false;
    plusMenuOpen = false;
    plusMenu.classList.add('ag-hidden');
    backdrop.classList.remove('ag-open');
    sheet.classList.remove('ag-open');
    inputEl.blur();
    applySettings();
  }

  function autoResizeInput() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(104, inputEl.scrollHeight)}px`;
    sendBtn.classList.toggle('ag-ready', inputEl.value.trim().length > 0);
  }

  async function submitPrompt(rawPrompt) {
    const promptText = (rawPrompt || inputEl.value || '').trim();
    if (!promptText) return;

    inputEl.value = '';
    autoResizeInput();
    plusMenuOpen = false;
    plusMenu.classList.add('ag-hidden');
    pillsWrap.classList.add('ag-hidden');

    const title = (document.title || location.hostname || 'Webpage').trim();
    const url = location.href;
    let fullComposedPrompt = promptText;

    if (attachPageContext) {
      const pageBody = extractReadablePageText();
      const parts = [
        'Use the webpage context below from my Safari tab to answer my request.',
        `Page Title: ${title}`,
        `Page URL: ${url}`
      ];
      if (selectedSnippet) {
        parts.push(`\nHighlighted Selection:\n"""\n${selectedSnippet}\n"""`);
      }
      if (pageBody) {
        parts.push(`\nWebpage Content:\n"""\n${pageBody}\n"""`);
      }
      parts.push(`\nRequest: ${promptText}`);
      fullComposedPrompt = parts.join('\n');
    }

    const requestId = `ag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeRequestId = requestId;
    isStreaming = true;
    lastAnswerText = '';

    answerCard.classList.remove('ag-hidden');
    statusIcon.classList.add('ag-pulse');
    statusLabel.textContent = 'Asking your Gemini subscription…';
    answerBody.innerHTML = `<p style="color:#9aa0a6;">Connecting to your signed-in <code>gemini.google.com</code> session…</p>`;

    const useNewChat = forceNewChat;
    forceNewChat = false;
    refreshContextChip();

    const response = await sendRuntimeMessage({
      type: 'ASK_GEMINI_SUBMIT',
      requestId,
      promptText,
      fullComposedPrompt,
      pageTitle: title,
      pageUrl: url,
      pageFavicon: getFaviconUrl(),
      newChat: useNewChat
    });

    if (!response || !response.ok) {
      isStreaming = false;
      statusIcon.classList.remove('ag-pulse');
      statusLabel.textContent = 'Connection notice';
      answerBody.innerHTML =
        '<p>Could not reach the extension background script. Make sure Ask Gemini is allowed on both this website and <strong>gemini.google.com</strong> in Safari Extensions settings.</p>';
      return;
    }

    if (response.mode !== 'inline') {
      statusLabel.textContent = 'Sent to Gemini tab — streaming back…';
      answerBody.innerHTML =
        '<p style="color:#c4c7c5;">Opened your signed-in <strong>gemini.google.com</strong> tab to run this prompt. Tap <strong>← Back</strong> at the top-left of Gemini anytime — your answer syncs right here too.</p>';
    }
  }

  function handleStreamUpdate(payload) {
    if (!payload || (activeRequestId && payload.requestId !== activeRequestId)) return;

    if (payload.error) {
      isStreaming = false;
      statusIcon.classList.remove('ag-pulse');
      statusLabel.textContent = 'Sign-in or permission needed';
      answerCard.classList.remove('ag-hidden');
      pillsWrap.classList.add('ag-hidden');
      answerBody.innerHTML = `<p>${renderMarkdownSafe(payload.error)}</p>`;
      return;
    }

    if (typeof payload.text === 'string' && payload.text.trim().length > 0) {
      lastAnswerText = payload.text;
      answerCard.classList.remove('ag-hidden');
      pillsWrap.classList.add('ag-hidden');
      answerBody.innerHTML = renderMarkdownSafe(payload.text);
      answerBody.scrollTop = answerBody.scrollHeight;
    }

    if (payload.done) {
      isStreaming = false;
      statusIcon.classList.remove('ag-pulse');
      statusLabel.textContent = 'Gemini';
    } else {
      isStreaming = true;
      statusIcon.classList.add('ag-pulse');
      statusLabel.textContent =
        payload.event === 'sent' ? 'Gemini is thinking…' : 'Gemini is typing…';
    }
  }

  // Mini button vertical drag + tap handler
  let pointerStartY = 0;
  let initialBtnTop = 10;
  let dragged = false;
  let pointerActive = false;

  miniBtn.addEventListener('pointerdown', (e) => {
    pointerActive = true;
    dragged = false;
    pointerStartY = e.clientY;
    initialBtnTop = miniBtn.getBoundingClientRect().top;
    try {
      miniBtn.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  miniBtn.addEventListener('pointermove', (e) => {
    if (!pointerActive) return;
    const dy = e.clientY - pointerStartY;
    if (Math.abs(dy) > 8) {
      dragged = true;
      const nextTop = Math.max(8, Math.min(window.innerHeight - 40, initialBtnTop + dy));
      miniBtn.style.top = `${nextTop}px`;
      settings.buttonTopPx = Math.round(nextTop);
    }
  });

  miniBtn.addEventListener('pointerup', (e) => {
    if (!pointerActive) return;
    pointerActive = false;
    try {
      miniBtn.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (dragged) {
      storageSet({ askGeminiSettings: settings });
    } else {
      openOverlay();
    }
  });

  // UI interactions
  backdrop.addEventListener('click', closeOverlay);
  closeSheetBtn.addEventListener('click', closeOverlay);

  chipToggle.addEventListener('click', () => {
    attachPageContext = !attachPageContext;
    refreshContextChip();
  });

  plusBtn.addEventListener('click', () => {
    plusMenuOpen = !plusMenuOpen;
    plusMenu.classList.toggle('ag-hidden', !plusMenuOpen);
  });

  menuAttachPage.addEventListener('click', () => {
    attachPageContext = !attachPageContext;
    refreshContextChip();
  });

  menuNewChat.addEventListener('click', () => {
    forceNewChat = !forceNewChat;
    refreshContextChip();
  });

  menuOpenWeb.addEventListener('click', () => {
    sendRuntimeMessage({ type: 'OPEN_GEMINI_TAB' });
  });

  inputEl.addEventListener('input', autoResizeInput);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  });

  sendBtn.addEventListener('click', () => submitPrompt());

  pillsWrap.querySelectorAll('.ag-pill[data-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      submitPrompt(btn.getAttribute('data-prompt'));
    });
  });

  pillSelection.addEventListener('click', () => {
    submitPrompt('Explain the highlighted text clearly and concisely in context.');
  });

  copyBtn.addEventListener('click', async () => {
    if (!lastAnswerText) return;
    try {
      await navigator.clipboard.writeText(lastAnswerText);
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1400);
    } catch (_) {}
  });

  openGeminiBtn.addEventListener('click', () => {
    sendRuntimeMessage({ type: 'OPEN_GEMINI_TAB' });
  });

  clearChatBtn.addEventListener('click', () => {
    activeRequestId = null;
    lastAnswerText = '';
    isStreaming = false;
    answerBody.innerHTML = '';
    answerCard.classList.add('ag-hidden');
    pillsWrap.classList.remove('ag-hidden');
    forceNewChat = true;
    refreshContextChip();
  });

  // Listen for runtime messages & storage sync updates (reliable across iOS Safari tab switches)
  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'OPEN_ASK_GEMINI_OVERLAY') {
      openOverlay();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'GEMINI_STREAM_UPDATE') {
      handleStreamUpdate(msg);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.askGeminiSettings && changes.askGeminiSettings.newValue) {
      settings = Object.assign({}, DEFAULT_SETTINGS, changes.askGeminiSettings.newValue);
      applySettings();
    }
    if (changes.askGeminiActiveRequest && changes.askGeminiActiveRequest.newValue) {
      const req = changes.askGeminiActiveRequest.newValue;
      if (activeRequestId && req.requestId === activeRequestId) {
        handleStreamUpdate({
          requestId: req.requestId,
          text: req.text || '',
          done: Boolean(req.done),
          error: req.error || null,
          event: req.status
        });
      }
    }
  });

  // Initialize saved settings & recover any in-flight answer for this page
  storageGet(['askGeminiSettings', 'askGeminiActiveRequest']).then((stored) => {
    if (stored.askGeminiSettings) {
      settings = Object.assign({}, DEFAULT_SETTINGS, stored.askGeminiSettings);
    }
    applySettings();

    const activeReq = stored.askGeminiActiveRequest;
    if (
      activeReq &&
      activeReq.sourceUrl === location.href &&
      Date.now() - (activeReq.updatedAt || 0) < 10 * 60 * 1000 &&
      activeReq.text
    ) {
      activeRequestId = activeReq.requestId;
      lastAnswerText = activeReq.text;
      answerCard.classList.remove('ag-hidden');
      pillsWrap.classList.add('ag-hidden');
      statusLabel.textContent = activeReq.done ? 'Gemini' : 'Gemini is typing…';
      answerBody.innerHTML = renderMarkdownSafe(activeReq.text);
    }
  });
})();
