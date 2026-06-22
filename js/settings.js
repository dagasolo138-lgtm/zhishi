import { pause, resume } from "./generator.js";
import { clearAll } from "./storage.js";

const API_KEY_STORAGE_KEY = "zhishi_deepseek_api_key";
const SETTINGS_STORAGE_KEY = "zhishi_settings";
const ENABLED_CATEGORIES_KEY = "zhishi_enabled_categories";
const CUSTOM_CATEGORIES_KEY = "zhishi_custom_categories";
const MAX_ROUNDS_KEY = "zhishi_max_rounds";
const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);
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

function readJSONSetting(key, fallback) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMaxRounds(value) {
  const parsed = parseInt(value, 10) || 0;
  return Math.max(0, parsed);
}

function normalizeEnabledCategories(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()))] : null;
}

function normalizeCustomCategories(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function splitCommaSeparated(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadBuiltinCategories() {
  const response = await fetch(CATEGORIES_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`无法读取分类配置：${response.status}`);
  }

  const categories = await response.json();

  if (!Array.isArray(categories)) {
    throw new Error("分类配置格式错误。");
  }

  return categories;
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
 * @returns {{apiKey: string, generationEnabled: boolean, maxRounds: number, enabledCategories: string[]|null, customCategories: object[]}}
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
  const maxRounds = normalizeMaxRounds(localStorage.getItem(MAX_ROUNDS_KEY));
  const enabledCategories = normalizeEnabledCategories(readJSONSetting(ENABLED_CATEGORIES_KEY, null));
  const customCategories = normalizeCustomCategories(readJSONSetting(CUSTOM_CATEGORIES_KEY, []));

  return { apiKey, ...settings, maxRounds, enabledCategories, customCategories };
}

/**
 * Persist settings. API key is stored separately so it is never included in exported settings.
 * @param {{apiKey?: string, generationEnabled?: boolean, maxRounds?: number|string, enabledCategories?: string[]|null, customCategories?: object[]}} nextSettings
 * @returns {{apiKey: string, generationEnabled: boolean, maxRounds: number, enabledCategories: string[]|null, customCategories: object[]}}
 */
export function saveSettings(nextSettings = {}) {
  const current = loadSettings();
  const apiKey = typeof nextSettings.apiKey === "string" ? nextSettings.apiKey.trim() : current.apiKey;
  const settings = normalizeSettings({
    generationEnabled: Object.prototype.hasOwnProperty.call(nextSettings, "generationEnabled")
      ? nextSettings.generationEnabled
      : current.generationEnabled
  });
  const maxRounds = Object.prototype.hasOwnProperty.call(nextSettings, "maxRounds")
    ? normalizeMaxRounds(nextSettings.maxRounds)
    : current.maxRounds;
  const enabledCategories = Object.prototype.hasOwnProperty.call(nextSettings, "enabledCategories")
    ? normalizeEnabledCategories(nextSettings.enabledCategories)
    : current.enabledCategories;
  const customCategories = Object.prototype.hasOwnProperty.call(nextSettings, "customCategories")
    ? normalizeCustomCategories(nextSettings.customCategories)
    : current.customCategories;

  if (apiKey) {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }

  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  localStorage.setItem(MAX_ROUNDS_KEY, String(maxRounds));

  if (enabledCategories === null) {
    localStorage.removeItem(ENABLED_CATEGORIES_KEY);
  } else {
    localStorage.setItem(ENABLED_CATEGORIES_KEY, JSON.stringify(enabledCategories));
  }

  localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories));

  const saved = { apiKey, ...settings, maxRounds, enabledCategories, customCategories };
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
  let customCategories = [...settings.customCategories];
  let enabledCategories = settings.enabledCategories;

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
      <label class="settings-field" for="max-rounds-input">
        <span>本轮生成轮数</span>
        <input
          id="max-rounds-input"
          name="maxRounds"
          type="number"
          min="0"
          step="1"
          placeholder="0 表示无限持续生成"
        >
      </label>
      <p class="settings-help rounds-hint">填入正整数后，完成后自动暂停。</p>
      <section aria-labelledby="category-toggles-title">
        <p id="category-toggles-title" class="settings-section-title">参与生成的分类</p>
        <div id="category-toggles" class="category-toggles-grid"></div>
        <div class="select-buttons-row">
          <button id="select-all-cats" class="button" type="button">全选</button>
          <button id="deselect-all-cats" class="button" type="button">全不选</button>
        </div>
      </section>
      <section aria-labelledby="custom-categories-title">
        <p id="custom-categories-title" class="settings-section-title">自定义分类</p>
        <div id="custom-categories-list" class="custom-categories-list"></div>
        <div class="custom-cat-inputs">
          <input id="custom-cat-name" type="text" placeholder="分类名称，如：法律" aria-label="自定义分类名称">
          <input id="custom-cat-subs" type="text" placeholder="子类，逗号分隔，如：民法,刑法" aria-label="自定义分类子类">
          <input id="custom-cat-keys" type="text" placeholder="关键词，逗号分隔" aria-label="自定义分类关键词">
        </div>
        <button id="add-custom-cat" class="button" type="button">添加分类</button>
      </section>
      <div class="settings-actions">
        <button class="button button--primary" type="submit">保存设置</button>
        <button class="button button--danger" id="clear-facts-button" type="button">清空知识库</button>
      </div>
      <p id="settings-feedback" class="settings-feedback" role="status" aria-live="polite"></p>
    </form>
  `;

  const apiKeyInput = panel.querySelector("#api-key-input");
  const generationToggle = panel.querySelector("#generation-toggle");
  const maxRoundsInput = panel.querySelector("#max-rounds-input");
  const form = panel.querySelector("#settings-form");
  const closeButton = panel.querySelector("#settings-close");
  const clearButton = panel.querySelector("#clear-facts-button");
  const feedback = panel.querySelector("#settings-feedback");
  const categoryToggles = panel.querySelector("#category-toggles");
  const selectAllCategoriesButton = panel.querySelector("#select-all-cats");
  const deselectAllCategoriesButton = panel.querySelector("#deselect-all-cats");
  const customCategoriesList = panel.querySelector("#custom-categories-list");
  const customCategoryNameInput = panel.querySelector("#custom-cat-name");
  const customCategorySubcategoriesInput = panel.querySelector("#custom-cat-subs");
  const customCategoryKeywordsInput = panel.querySelector("#custom-cat-keys");
  const addCustomCategoryButton = panel.querySelector("#add-custom-cat");

  function getEnabledCategoriesFromToggles() {
    const checkboxes = [...categoryToggles.querySelectorAll('input[type="checkbox"]')];

    if (checkboxes.length === 0 || checkboxes.every((checkbox) => checkbox.checked)) {
      return null;
    }

    return checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
  }

  async function renderCategoryToggles() {
    const builtinCategories = await loadBuiltinCategories();
    const categories = [...builtinCategories, ...customCategories];
    const enabledSet = enabledCategories === null ? null : new Set(enabledCategories);
    const fragment = document.createDocumentFragment();

    categories.forEach((category) => {
      const categoryId = typeof category?.id === "string" ? category.id : "";
      const categoryName = typeof category?.name === "string" ? category.name : categoryId;

      if (!categoryId || !categoryName) {
        return;
      }

      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      const name = document.createElement("span");

      label.className = "category-toggle-item";
      checkbox.type = "checkbox";
      checkbox.value = categoryId;
      checkbox.checked = enabledSet === null || enabledSet.has(categoryId);
      name.textContent = categoryName;
      label.append(checkbox, name);
      fragment.appendChild(label);
    });

    categoryToggles.replaceChildren(fragment);
  }

  function renderCustomCategoryList() {
    const fragment = document.createDocumentFragment();

    customCategories.forEach((category) => {
      const item = document.createElement("div");
      const name = document.createElement("span");
      const removeButton = document.createElement("button");

      item.className = "custom-category-item";
      name.textContent = category.name || category.id || "未命名分类";
      removeButton.className = "custom-category-item__remove";
      removeButton.type = "button";
      removeButton.title = "删除分类";
      removeButton.setAttribute("aria-label", `删除分类 ${name.textContent}`);
      removeButton.textContent = "×";
      removeButton.addEventListener("click", async () => {
        enabledCategories = getEnabledCategoriesFromToggles();
        customCategories = customCategories.filter((itemToKeep) => itemToKeep.id !== category.id);

        if (enabledCategories !== null) {
          enabledCategories = enabledCategories.filter((categoryId) => categoryId !== category.id);
        }

        saveSettings({ customCategories, enabledCategories });
        renderCustomCategoryList();

        try {
          await renderCategoryToggles();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(feedback, `分类加载失败：${message}`, "error");
        }
      });

      item.append(name, removeButton);
      fragment.appendChild(item);
    });

    customCategoriesList.replaceChildren(fragment);
  }

  apiKeyInput.value = settings.apiKey;
  generationToggle.checked = settings.generationEnabled;
  maxRoundsInput.value = settings.maxRounds > 0 ? String(settings.maxRounds) : "0";
  host.appendChild(panel);
  renderCustomCategoryList();

  renderCategoryToggles().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(feedback, `分类加载失败：${message}`, "error");
  });

  const toggleButton = document.querySelector("#settings-toggle");
  toggleButton?.addEventListener("click", () => {
    setPanelOpen(panel, panel.hidden);
  });

  closeButton.addEventListener("click", () => setPanelOpen(panel, false));

  categoryToggles.addEventListener("change", () => {
    enabledCategories = getEnabledCategoriesFromToggles();
  });

  selectAllCategoriesButton.addEventListener("click", () => {
    categoryToggles.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = true;
    });
    enabledCategories = null;
  });

  deselectAllCategoriesButton.addEventListener("click", () => {
    categoryToggles.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = false;
    });
    enabledCategories = [];
  });

  addCustomCategoryButton.addEventListener("click", async () => {
    const name = customCategoryNameInput.value.trim();
    const subcategories = splitCommaSeparated(customCategorySubcategoriesInput.value);
    const keywords = splitCommaSeparated(customCategoryKeywordsInput.value);

    if (!name || subcategories.length === 0 || keywords.length === 0) {
      setFeedback(feedback, "请填写分类名称、至少一个子类和至少一个关键词。", "error");
      return;
    }

    enabledCategories = getEnabledCategoriesFromToggles();
    customCategories.push({
      id: `custom_${Date.now()}`,
      name,
      weight: 7,
      subcategories,
      keywords
    });

    saveSettings({ customCategories, enabledCategories });
    renderCustomCategoryList();

    try {
      await renderCategoryToggles();
      customCategoryNameInput.value = "";
      customCategorySubcategoriesInput.value = "";
      customCategoryKeywordsInput.value = "";
      setFeedback(feedback, "自定义分类已添加。", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(feedback, `分类加载失败：${message}`, "error");
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    enabledCategories = getEnabledCategoriesFromToggles();

    const saved = saveSettings({
      apiKey: apiKeyInput.value,
      generationEnabled: generationToggle.checked,
      maxRounds: maxRoundsInput.value,
      enabledCategories,
      customCategories
    });

    if (saved.generationEnabled) {
      resume();
    } else {
      pause();
    }

    setFeedback(feedback, "设置已保存。", "success");
  });

  generationToggle.addEventListener("change", () => {
    const saved = saveSettings({
      generationEnabled: generationToggle.checked,
      maxRounds: maxRoundsInput.value,
      enabledCategories: getEnabledCategoriesFromToggles(),
      customCategories
    });

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
      localStorage.removeItem("zhishi_seed_initialized");
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
