(function () {
  'use strict';

  const ext = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULT_SETTINGS = {
    showMiniButton: true,
    buttonSize: 28,
    idleOpacity: 0.7,
    buttonTopPx: null,
    autoReturnOnSend: false
  };

  const summonBtn = document.getElementById('summonBtn');
  const showMiniBtn = document.getElementById('showMiniBtn');
  const btnSize = document.getElementById('btnSize');
  const idleOpacity = document.getElementById('idleOpacity');
  const autoReturn = document.getElementById('autoReturn');
  const resetPosBtn = document.getElementById('resetPosBtn');
  const openGeminiWebBtn = document.getElementById('openGeminiWebBtn');

  let currentSettings = Object.assign({}, DEFAULT_SETTINGS);

  function loadSettings() {
    ext.storage.local.get(['askGeminiSettings'], (items) => {
      if (items && items.askGeminiSettings) {
        currentSettings = Object.assign({}, DEFAULT_SETTINGS, items.askGeminiSettings);
      }
      showMiniBtn.checked = Boolean(currentSettings.showMiniButton);
      btnSize.value = String(currentSettings.buttonSize || 28);
      idleOpacity.value = String(currentSettings.idleOpacity ?? 0.7);
      autoReturn.checked = Boolean(currentSettings.autoReturnOnSend);
    });
  }

  function saveSettings(patch) {
    currentSettings = Object.assign({}, currentSettings, patch);
    ext.storage.local.set({ askGeminiSettings: currentSettings });
  }

  summonBtn.addEventListener('click', () => {
    ext.runtime.sendMessage({ type: 'SUMMON_ASK_GEMINI' }, () => {
      window.close();
    });
  });

  showMiniBtn.addEventListener('change', () => {
    saveSettings({ showMiniButton: showMiniBtn.checked });
  });

  btnSize.addEventListener('change', () => {
    saveSettings({ buttonSize: Number(btnSize.value) || 28 });
  });

  idleOpacity.addEventListener('change', () => {
    saveSettings({ idleOpacity: Number(idleOpacity.value) || 0.7 });
  });

  autoReturn.addEventListener('change', () => {
    saveSettings({ autoReturnOnSend: autoReturn.checked });
  });

  resetPosBtn.addEventListener('click', () => {
    saveSettings({ buttonTopPx: null, showMiniButton: true });
    showMiniBtn.checked = true;
    resetPosBtn.textContent = 'Reset ✓';
    setTimeout(() => {
      resetPosBtn.textContent = 'Reset Button to Top-Left';
    }, 1200);
  });

  openGeminiWebBtn.addEventListener('click', () => {
    ext.runtime.sendMessage({ type: 'OPEN_GEMINI_TAB' }, () => {
      window.close();
    });
  });

  loadSettings();
})();
