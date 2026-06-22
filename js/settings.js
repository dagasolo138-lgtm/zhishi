import { pause, resume } from "./generator.js";
import { clearAll } from "./storage.js";

const API_KEY_STORAGE_KEY = "zhishi_deepseek_api_key";
const SETTINGS_STORAGE_KEY = "zhishi_settings";
const DEFAULT_SETTINGS = Object.freeze({
  generationEnabled: true
});

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};

  return {
    generationEnabled: input.generationEnabled !== false
  };
}

function setPanelOpen(panel, isOpen) {
  panel.hidden = !isOpen;
  panel.setAttribute("aria-hidden", String(!isOpen));

  const toggleButton = document.querySelector("#settings-toggle");
  if (toggleButton) {
    toggleButton.setAttribute("aria-expanded", String(isOpen));
  }
}

function setFeedback(element, message, kind = "") {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.dataset.kind = kind;
}

/**
 * Load persisted UI settings and the locally stored DeepSeek API key.
 * @returns {{apiKey: string, generationEnabled: boolean}}
 */
export function loadSettings() {
  let storedSettings = {};

  try {
    const rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    storedSettings = rawSettings ? JSON.parse(rawSettings) : {};
  } catch {
    storedSettings = {};
  }

  const settings = normalizeSettings(storedSettings);
  const apiKey = (localStorage.getItem(API_KEY_STORAGE_KEY) || "").trim();

  return { apiKey, ...settings };
}

/**
 * Persist settings. API key is stored separately so it is never included in exported settings.
 * @param {{apiKey?: string, generationEnabled?: boolean}} nextSettings
 * @returns {{apiKey: string, generationEnabled: boolean}}
 */
export function saveSettings(nextSettings = {}) {
  const current = loadSettings();
  const apiKey = typeof nextSettings.apiKey === "string" ? nextSettings.apiKey.trim() : current.apiKey;
  const settings = normalizeSettings({
    generationEnabled: Object.prototype.hasOwnProperty.call(nextSettings, "generationEnabled")
      ? nextSettings.generationEnabled
      : current.generationEnabled
  });

  if (apiKey) {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }

  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

  const saved = { apiKey, ...settings };
  emit("settings:changed", saved);
  return saved;
}

/**
 * Insert and wire the settings panel.
 * @returns {HTMLElement}
 */
export function renderSettingsPanel() {
  const existingPanel = document.querySelector("#settings-panel");
  if (existingPanel) {
    return existingPanel;
  }

  const settings = loadSettings();
  const host = document.querySelector("#settings-panel-host") || document.body;
  const panel = document.createElement("aside");

  panel.id = "settings-panel";
  panel.className = "settings-panel";
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-labelledby", "settings-title");
  panel.innerHTML = `
    <div class="settings-panel__header">
      <h2 id="settings-title">设置</h2>
      <button class="icon-button" id="settings-close" type="button" aria-label="关闭设置">×</button>
    </div>
    <form id="settings-form" novalidate>
      <label class="settings-field" for="api-key-input">
        <span>DeepSeek API Key</span>
        <input
          id="api-key-input"
          name="apiKey"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="请输入 DeepSeek API Key"
        >
      </label>
      <p class="settings-help">密钥仅保存在当前浏览器的 localStorage 中。</p>
      <label class="settings-switch" for="generation-toggle">
        <span>自动生成</span>
        <input id="generation-toggle" name="generationEnabled" type="checkbox">
      </label>
      <div class="settings-actions">
        <button class="button button--primary" type="submit">保存设置</button>
        <button class="button button--danger" id="clear-facts-button" type="button">清空知识库</button>
      </div>
      <p id="settings-feedback" class="settings-feedback" role="status" aria-live="polite"></p>
    </form>
  `;

  const apiKeyInput = panel.querySelector("#api-key-input");
  const generationToggle = panel.querySelector("#generation-toggle");
  const form = panel.querySelector("#settings-form");
  const closeButton = panel.querySelector("#settings-close");
  const clearButton = panel.querySelector("#clear-facts-button");
  const feedback = panel.querySelector("#settings-feedback");

  apiKeyInput.value = settings.apiKey;
  generationToggle.checked = settings.generationEnabled;
  host.appendChild(panel);

  const toggleButton = document.querySelector("#settings-toggle");
  toggleButton?.addEventListener("click", () => {
    setPanelOpen(panel, panel.hidden);
  });

  closeButton.addEventListener("click", () => setPanelOpen(panel, false));

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const saved = saveSettings({
      apiKey: apiKeyInput.value,
      generationEnabled: generationToggle.checked
    });

    if (saved.generationEnabled) {
      resume();
    } else {
      pause();
    }

    setFeedback(feedback, "设置已保存。", "success");
  });

  generationToggle.addEventListener("change", () => {
    const saved = saveSettings({ generationEnabled: generationToggle.checked });

    if (saved.generationEnabled) {
      resume();
      setFeedback(feedback, "自动生成已开启。", "success");
    } else {
      pause();
      setFeedback(feedback, "自动生成已暂停。", "success");
    }
  });

  clearButton.addEventListener("click", async () => {
    const confirmed = window.confirm("这会永久删除当前浏览器中的全部知识事实，确定继续吗？");

    if (!confirmed) {
      return;
    }

    clearButton.disabled = true;
    setFeedback(feedback, "正在清空知识库…");

    try {
      await clearAll();
      emit("facts:cleared", { timestamp: Date.now() });
      setFeedback(feedback, "知识库已清空。", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(feedback, `清库失败：${message}`, "error");
    } finally {
      clearButton.disabled = false;
    }
  });

  return panel;
}

export { DEFAULT_SETTINGS };
