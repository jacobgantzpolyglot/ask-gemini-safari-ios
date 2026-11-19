// Ask Gemini for iOS Safari — Signed-In gemini.google.com Session Bridge
// Runs only on https://gemini.google.com/* using your existing Gemini subscription.

(function () {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__askGeminiBridgeLoaded__) return;
  window.__askGeminiBridgeLoaded__ = true;

  const ext = typeof browser !== 'undefined' ? browser : chrome;
  const handledRequestIds = new Set();
  let activeWatchTimer = null;
  let returnBannerHost = null;
  let bannerStatusEl = null;
  let currentSourceTabId = null;
  let currentSourceTitle = '';

  const EDITOR_SELECTORS = [
    '.ql-editor[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[aria-label*="prompt" i]',
    'textarea'
  ].join(', ');

  const SEND_BTN_SELECTORS = [
    'button.send-button',
    '.send-button-container button',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button[data-test-id*="send" i]'
  ].join(', ');

  const STOP_BTN_SELECTORS = [
    'button[aria-label*="Stop" i]',
    '.stop-icon',
    'button.stop-button'
  ].join(', ');

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

  function sendUpdate(payload) {
    try {
      const res = ext.runtime.sendMessage(
        Object.assign({ type: 'GEMINI_STREAM_UPDATE' }, payload),
        () => {
          void ext.runtime.lastError;
        }
      );
      if (res && typeof res.then === 'function') res.catch(() => {});
    } catch (_) {}
  }

  // Floating top-left "← Back to [Webpage]" pill when Gemini tab is visible
  function ensureReturnPill(sourceTabId, sourceTitle, statusText) {
    currentSourceTabId = sourceTabId;
    currentSourceTitle = sourceTitle || 'Webpage';

    const mountTarget = document.documentElement || document.body;
    if (!mountTarget) return;

    if (!returnBannerHost) {
      returnBannerHost = document.createElement('div');
      returnBannerHost.id = '__ask_gemini_return_pill__';
      returnBannerHost.style.cssText =
        'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
      const shadow = returnBannerHost.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          .pill {
            position: fixed;
            top: calc(env(safe-area-inset-top, 0px) + 8px);
            left: calc(env(safe-area-inset-left, 0px) + 10px);
            pointer-events: auto;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(20, 20, 25, 0.92);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: #e8eaed;
            border: 1px solid rgba(138, 180, 248, 0.45);
            border-radius: 999px;
            padding: 7px 13px;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
            font-size: 13px;
            font-weight: 600;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.38);
            cursor: pointer;
            max-width: calc(100vw - 24px);
          }
          .pill:active {
            transform: scale(0.97);
          }
          .sub {
            font-weight: 400;
            color: #8ab4f8;
            font-size: 12px;
            white-space: nowrap;
          }
          .title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 150px;
          }
        </style>
        <button class="pill" id="backBtn" type="button">
          <span>←</span>
          <span class="title" id="backTitle"></span>
          <span class="sub" id="backStatus"></span>
        </button>
      `;
      mountTarget.appendChild(returnBannerHost);

      const backBtn = shadow.getElementById('backBtn');
      const titleEl = shadow.getElementById('backTitle');
      bannerStatusEl = shadow.getElementById('backStatus');

      backBtn.addEventListener('click', () => {
        try {
          ext.runtime.sendMessage({
            type: 'RETURN_TO_SOURCE_TAB',
            sourceTabId: currentSourceTabId
          });
        } catch (_) {}
      });

      returnBannerHost._titleEl = titleEl;
    }

    const shortName =
      currentSourceTitle.length > 20
        ? `${currentSourceTitle.slice(0, 19)}…`
        : currentSourceTitle;
    returnBannerHost._titleEl.textContent = `Back to ${shortName}`;
    if (bannerStatusEl) bannerStatusEl.textContent = statusText || '';
  }

  function getResponseContainers() {
    const primary = Array.from(
      document.querySelectorAll(
        'model-response message-content .markdown, model-response .model-response-text'
      )
    );
    if (primary.length > 0) return primary;

    const fallback = Array.from(
      document.querySelectorAll('message-content .markdown, model-response')
    );
    return fallback;
  }

  // Convert Gemini's rich HTML response DOM into clean Markdown for the webpage card
  function domToMarkdown(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, button, svg').forEach((n) => n.remove());

    clone.querySelectorAll('pre').forEach((pre) => {
      const codeText = (pre.innerText || pre.textContent || '').trim();
      pre.replaceWith(`\n\`\`\`\n${codeText}\n\`\`\`\n`);
    });

    clone.querySelectorAll('code').forEach((code) => {
      const t = (code.innerText || code.textContent || '').trim();
      if (t) code.replaceWith(`\`${t}\``);
    });

    clone.querySelectorAll('strong, b').forEach((b) => {
      const t = (b.innerText || b.textContent || '').trim();
      if (t) b.replaceWith(`**${t}**`);
    });

    clone.querySelectorAll('h1, h2, h3').forEach((h) => {
      const level = Number(h.tagName.slice(1)) || 2;
      const hashes = '#'.repeat(level);
      const t = (h.innerText || h.textContent || '').trim();
      if (t) h.replaceWith(`\n${hashes} ${t}\n`);
    });

    clone.querySelectorAll('li').forEach((li) => {
      const t = (li.innerText || li.textContent || '').trim();
      if (t) li.replaceWith(`\n- ${t}`);
    });

    return (clone.innerText || clone.textContent || '')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function waitForEditor(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const ed = document.querySelector(EDITOR_SELECTORS);
        if (ed) {
          clearInterval(timer);
          resolve({ editor: ed, signedOut: false });
          return;
        }
        const signInLink = document.querySelector(
          'a[href*="accounts.google.com/ServiceLogin"], a[aria-label*="Sign in" i]'
        );
        if (signInLink && Date.now() - start > 4500) {
          clearInterval(timer);
          resolve({ editor: null, signedOut: true });
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          clearInterval(timer);
          resolve({ editor: null, signedOut: Boolean(signInLink) });
        }
      }, 150);
    });
  }

  function injectPromptIntoEditor(editor, text) {
    editor.focus();

    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      editor.value = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Clear existing draft in contenteditable
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } catch (_) {}

    // Primary: execCommand('insertText') notifies Angular's rich-textarea state
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (_) {
      inserted = false;
    }

    const currentText = (editor.innerText || editor.textContent || '').trim();
    if (!inserted || currentText.length === 0) {
      editor.textContent = text;
      try {
        editor.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text
          })
        );
      } catch (_) {}
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function clickSendOrEnter(editor) {
    return new Promise((resolve) => {
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        const buttons = Array.from(document.querySelectorAll(SEND_BTN_SELECTORS));
        const activeBtn = buttons.find(
          (b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true'
        );
        if (activeBtn) {
          clearInterval(timer);
          activeBtn.click();
          resolve(true);
          return;
        }
        if (tries >= 12) {
          clearInterval(timer);
          editor.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            })
          );
          resolve(true);
        }
      }, 150);
    });
  }

  async function executeRequest(request) {
    if (!request || !request.requestId) return;
    if (handledRequestIds.has(request.requestId)) return;
    handledRequestIds.add(request.requestId);

    if (activeWatchTimer) {
      clearInterval(activeWatchTimer);
      activeWatchTimer = null;
    }

    ensureReturnPill(request.sourceTabId, request.sourceTitle, 'Sending…');

    const { editor, signedOut } = await waitForEditor(15000);
    if (!editor) {
      const errMsg = signedOut
        ? 'Please sign in to your Google / Gemini account at **gemini.google.com** in Safari once. After signing in, Ask Gemini will automatically use your subscription.'
        : 'Timed out waiting for the Gemini chat box on gemini.google.com. Please check the Gemini tab and try again.';
      ensureReturnPill(request.sourceTabId, request.sourceTitle, 'Sign-in needed');
      sendUpdate({
        requestId: request.requestId,
        sourceTabId: request.sourceTabId,
        error: errMsg,
        done: true
      });
      return;
    }

    const baselineNodes = getResponseContainers();
    const baselineCount = baselineNodes.length;
    const baselineLastText =
      baselineCount > 0 ? domToMarkdown(baselineNodes[baselineCount - 1]) : '';

    injectPromptIntoEditor(editor, request.fullComposedPrompt || request.userPrompt || '');
    await clickSendOrEnter(editor);

    ensureReturnPill(request.sourceTabId, request.sourceTitle, 'Generating…');
    sendUpdate({
      requestId: request.requestId,
      sourceTabId: request.sourceTabId,
      text: '',
      done: false,
      event: 'sent'
    });

    // Stream response chunks back to source webpage
    let lastText = '';
    let stableTicks = 0;
    let totalTicks = 0;
    const maxTicks = 420; // ~126s max for Gemini Thinking/Pro models

    activeWatchTimer = setInterval(() => {
      totalTicks++;
      const nodes = getResponseContainers();
      let candidateText = '';

      if (nodes.length > baselineCount) {
        candidateText = domToMarkdown(nodes[nodes.length - 1]);
      } else if (nodes.length > 0 && totalTicks > 6) {
        const newest = domToMarkdown(nodes[nodes.length - 1]);
        if (newest && newest !== baselineLastText) {
          candidateText = newest;
        }
      }

      const stopBtn = document.querySelector(STOP_BTN_SELECTORS);
      const stillGenerating = Boolean(
        stopBtn && stopBtn.offsetParent !== null
      );

      if (candidateText && candidateText !== lastText) {
        lastText = candidateText;
        stableTicks = 0;
        ensureReturnPill(request.sourceTabId, request.sourceTitle, 'Streaming…');
        sendUpdate({
          requestId: request.requestId,
          sourceTabId: request.sourceTabId,
          text: lastText,
          done: false,
          event: 'chunk'
        });
      } else if (lastText.length > 0 && !stillGenerating) {
        stableTicks++;
      }

      // Finish once stop icon disappears and text is stable for ~2.4s
      if ((lastText.length > 0 && !stillGenerating && stableTicks >= 8) || totalTicks >= maxTicks) {
        clearInterval(activeWatchTimer);
        activeWatchTimer = null;
        ensureReturnPill(request.sourceTabId, request.sourceTitle, '✓ Ready');
        sendUpdate({
          requestId: request.requestId,
          sourceTabId: request.sourceTabId,
          text:
            lastText ||
            'Prompt sent in your Gemini tab. Switch to the Gemini tab if it is still thinking.',
          done: true,
          event: 'done'
        });
      }
    }, 300);
  }

  async function checkPendingStorageRequest() {
    const stored = await storageGet(['askGeminiActiveRequest']);
    const req = stored.askGeminiActiveRequest;
    if (!req || !req.requestId) return;
    if (handledRequestIds.has(req.requestId)) return;
    if (req.status !== 'pending') return;
    if (Date.now() - (req.createdAt || 0) > 60000) return;

    await storageSet({
      askGeminiActiveRequest: Object.assign({}, req, {
        status: 'claimed',
        updatedAt: Date.now()
      })
    });
    executeRequest(req);
  }

  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'PING_GEMINI_TAB') {
      sendResponse({ alive: true });
      return false;
    }

    if (msg.type === 'EXECUTE_GEMINI_PROMPT' && msg.request) {
      sendResponse({ accepted: true });
      executeRequest(msg.request);
      return false;
    }

    return false;
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.askGeminiActiveRequest) {
      const next = changes.askGeminiActiveRequest.newValue;
      if (next && next.status === 'pending' && !handledRequestIds.has(next.requestId)) {
        checkPendingStorageRequest();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingStorageRequest, { once: true });
  } else {
    checkPendingStorageRequest();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkPendingStorageRequest();
    }
  });
})();
