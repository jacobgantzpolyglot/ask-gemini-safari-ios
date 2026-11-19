// Ask Gemini for iOS Safari — Background Coordinator
// Compatible with Safari Web Extensions (Event Pages) and Manifest V3

(function () {
  'use strict';

  const ext = typeof browser !== 'undefined' ? browser : chrome;

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        const res = ext.storage.local.get(keys, (items) => resolve(items || {}));
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(() => resolve({}));
        }
      } catch (_) {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        const res = ext.storage.local.set(obj, () => resolve());
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(() => resolve());
        }
      } catch (_) {
        resolve();
      }
    });
  }

  function tabsQuery(queryInfo) {
    return new Promise((resolve) => {
      try {
        const res = ext.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(() => resolve([]));
        }
      } catch (_) {
        resolve([]);
      }
    });
  }

  function tabsCreate(createProperties) {
    return new Promise((resolve, reject) => {
      try {
        const res = ext.tabs.create(createProperties, (tab) => {
          if (ext.runtime.lastError) reject(ext.runtime.lastError);
          else resolve(tab);
        });
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function tabsUpdate(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
      try {
        const res = ext.tabs.update(tabId, updateProperties, (tab) => {
          if (ext.runtime.lastError) reject(ext.runtime.lastError);
          else resolve(tab);
        });
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function tabsSendMessageWithTimeout(tabId, message, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, timeoutMs);

      try {
        const res = ext.tabs.sendMessage(tabId, message, (reply) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (ext.runtime.lastError) {
            resolve(null);
          } else {
            resolve(reply || null);
          }
        });
        if (res && typeof res.then === 'function') {
          res
            .then((reply) => {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(reply || null);
              }
            })
            .catch(() => {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(null);
              }
            });
        }
      } catch (_) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }

  async function handleAskGeminiSubmit(msg, sender) {
    const sourceTabId = sender && sender.tab ? sender.tab.id : null;
    const requestRecord = {
      requestId: msg.requestId,
      sourceTabId,
      sourceTitle: msg.pageTitle || 'Webpage',
      sourceUrl: msg.pageUrl || '',
      sourceFavicon: msg.pageFavicon || '',
      userPrompt: msg.promptText || '',
      fullComposedPrompt: msg.fullComposedPrompt || msg.promptText || '',
      newChat: Boolean(msg.newChat),
      status: 'pending',
      text: '',
      done: false,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await storageSet({ askGeminiActiveRequest: requestRecord });

    // Look for an already-open gemini.google.com tab in Safari
    const geminiTabs = await tabsQuery({ url: 'https://gemini.google.com/*' });

    if (geminiTabs.length > 0) {
      // Prefer the most recently accessed / last Gemini tab
      const targetTab = geminiTabs[geminiTabs.length - 1];

      // Try inline execution without leaving the current webpage tab
      const reply = await tabsSendMessageWithTimeout(
        targetTab.id,
        { type: 'EXECUTE_GEMINI_PROMPT', request: requestRecord },
        1300
      );

      if (reply && reply.accepted) {
        await storageSet({
          askGeminiActiveRequest: Object.assign({}, requestRecord, {
            status: 'dispatched_inline',
            geminiTabId: targetTab.id,
            updatedAt: Date.now()
          })
        });
        return {
          ok: true,
          mode: 'inline',
          geminiTabId: targetTab.id
        };
      }

      // iOS Safari froze the background tab; wake it up so Angular + session cookies run
      const updateProps = { active: true };
      if (requestRecord.newChat) {
        updateProps.url = 'https://gemini.google.com/app';
      }
      await tabsUpdate(targetTab.id, updateProps);
      return {
        ok: true,
        mode: 'tab_wake',
        geminiTabId: targetTab.id
      };
    }

    // No Gemini tab open yet — open gemini.google.com/app using signed-in Safari session
    const createdTab = await tabsCreate({
      url: 'https://gemini.google.com/app',
      active: true
    });

    await storageSet({
      askGeminiActiveRequest: Object.assign({}, requestRecord, {
        geminiTabId: createdTab ? createdTab.id : null,
        updatedAt: Date.now()
      })
    });

    return {
      ok: true,
      mode: 'tab_created',
      geminiTabId: createdTab ? createdTab.id : null
    };
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'ASK_GEMINI_SUBMIT') {
      handleAskGeminiSubmit(msg, sender)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    if (msg.type === 'GEMINI_STREAM_UPDATE') {
      (async () => {
        const stored = await storageGet(['askGeminiActiveRequest', 'askGeminiSettings']);
        const activeReq = stored.askGeminiActiveRequest;
        const settings = stored.askGeminiSettings || {};
        const targetTabId =
          msg.sourceTabId || (activeReq && activeReq.sourceTabId) || null;

        if (activeReq && activeReq.requestId === msg.requestId) {
          await storageSet({
            askGeminiActiveRequest: Object.assign({}, activeReq, {
              status: msg.done ? 'done' : msg.error ? 'error' : 'streaming',
              text: typeof msg.text === 'string' ? msg.text : activeReq.text,
              done: Boolean(msg.done),
              error: msg.error || null,
              geminiTabId:
                (sender && sender.tab && sender.tab.id) || activeReq.geminiTabId || null,
              updatedAt: Date.now()
            })
          });
        }

        if (targetTabId) {
          tabsSendMessageWithTimeout(
            targetTabId,
            {
              type: 'GEMINI_STREAM_UPDATE',
              requestId: msg.requestId,
              text: msg.text || '',
              done: Boolean(msg.done),
              error: msg.error || null,
              event: msg.event || 'chunk'
            },
            800
          );

          if (msg.event === 'sent' && settings.autoReturnOnSend) {
            try {
              await tabsUpdate(targetTabId, { active: true });
            } catch (_) {}
          }
        }

        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'RETURN_TO_SOURCE_TAB') {
      (async () => {
        const stored = await storageGet(['askGeminiActiveRequest']);
        const activeReq = stored.askGeminiActiveRequest;
        const targetTabId =
          msg.sourceTabId || (activeReq && activeReq.sourceTabId) || null;
        if (targetTabId) {
          try {
            await tabsUpdate(targetTabId, { active: true });
            sendResponse({ ok: true });
            return;
          } catch (_) {}
        }
        sendResponse({ ok: false });
      })();
      return true;
    }

    if (msg.type === 'OPEN_GEMINI_TAB') {
      (async () => {
        const stored = await storageGet(['askGeminiActiveRequest']);
        const activeReq = stored.askGeminiActiveRequest;
        if (activeReq && activeReq.geminiTabId) {
          try {
            await tabsUpdate(activeReq.geminiTabId, { active: true });
            sendResponse({ ok: true });
            return;
          } catch (_) {}
        }
        const geminiTabs = await tabsQuery({ url: 'https://gemini.google.com/*' });
        if (geminiTabs.length > 0) {
          await tabsUpdate(geminiTabs[geminiTabs.length - 1].id, { active: true });
        } else {
          await tabsCreate({ url: 'https://gemini.google.com/app', active: true });
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'SUMMON_ASK_GEMINI') {
      (async () => {
        const tabs = await tabsQuery({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].id) {
          await tabsSendMessageWithTimeout(
            tabs[0].id,
            { type: 'OPEN_ASK_GEMINI_OVERLAY' },
            1000
          );
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    return false;
  });
})();
