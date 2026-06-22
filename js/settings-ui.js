import { pause, resume } from "./generator.js";
import { clearAll } from "./storage.js";
import { loadSettings, saveSettings } from "./settings-store.js";

const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
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
          class="input"
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
          <input class="input" id="custom-cat-name" type="text" placeholder="分类名称，如：法律" aria-label="自定义分类名称">
          <input class="input" id="custom-cat-subs" type="text" placeholder="子类，逗号分隔，如：民法,刑法" aria-label="自定义分类子类">
          <input class="input" id="custom-cat-keys" type="text" placeholder="关键词，逗号分隔" aria-label="自定义分类关键词">
        </div>
        <button id="add-custom-cat" class="button" type="button">添加分类</button>
      </section>
      <section aria-labelledby="targeted-generation-title">
        <p id="targeted-generation-title" class="settings-section-title">定向生成</p>
        <label class="settings-switch" for="targeted-enabled">
          <span>启用定向生成</span>
          <input id="targeted-enabled" name="targetedEnabled" type="checkbox">
        </label>
        <p class="settings-help">开启后只生成指定大类/小类，关闭则恢复加权随机生成</p>
        <div id="targeted-options" hidden>
          <label class="settings-field" for="targeted-category">
            <span>选择大类</span>
            <select id="targeted-category" name="targetedCategory">
              <option value="">请选择大类</option>
            </select>
          </label>
          <div id="targeted-subcategories-wrapper" hidden>
            <p class="settings-section-title">选择小类（可多选，不选则全部）</p>
            <div id="targeted-subcategories" class="category-toggles-grid"></div>
          </div>
        </div>
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
  const targetedEnabledInput = panel.querySelector("#targeted-enabled");
  const targetedOptions = panel.querySelector("#targeted-options");
  const targetedCategorySelect = panel.querySelector("#targeted-category");
  const targetedSubcategoriesWrapper = panel.querySelector("#targeted-subcategories-wrapper");
  const targetedSubcategories = panel.querySelector("#targeted-subcategories");

  function getSubcategoryName(item) {
    return typeof item === "string" ? item.trim() : item?.name?.trim() || "";
  }

  function getTargetedGenerationFromControls() {
    return {
      enabled: targetedEnabledInput.checked,
      categoryId: targetedCategorySelect.value,
      subcategories: [...targetedSubcategories.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => checkbox.value)
    };
  }

  async function getAllCategories() {
    const builtinCategories = await loadBuiltinCategories();
    return [...builtinCategories, ...customCategories];
  }

  function setTargetedOptionsVisibility() {
    targetedOptions.hidden = !targetedEnabledInput.checked;
  }

  function renderTargetedSubcategories(categoryId, selectedSubcategories = []) {
    const selectedSet = new Set(selectedSubcategories);
    const categories = targetedCategorySelect._categories || [];
    const category = categories.find((item) => item?.id === categoryId);
    const fragment = document.createDocumentFragment();
    const subcategories = Array.isArray(category?.subcategories) ? category.subcategories : [];

    subcategories.forEach((subcategory) => {
      const subcategoryName = getSubcategoryName(subcategory);

      if (!subcategoryName) {
        return;
      }

      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      const name = document.createElement("span");

      label.className = "category-toggle-item";
      checkbox.type = "checkbox";
      checkbox.value = subcategoryName;
      checkbox.checked = selectedSet.has(subcategoryName);
      name.textContent = subcategoryName;
      label.append(checkbox, name);
      fragment.appendChild(label);
    });

    targetedSubcategories.replaceChildren(fragment);
    targetedSubcategoriesWrapper.hidden = !categoryId;
  }

  async function renderTargetedCategoryOptions(selectedCategoryId = settings.targetedGeneration.categoryId, selectedSubcategories = settings.targetedGeneration.subcategories) {
    const categories = await getAllCategories();
    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement("option");

    targetedCategorySelect._categories = categories;
    placeholder.value = "";
    placeholder.textContent = "请选择大类";
    fragment.appendChild(placeholder);

    categories.forEach((category) => {
      const categoryId = typeof category?.id === "string" ? category.id : "";
      const categoryName = typeof category?.name === "string" ? category.name : categoryId;

      if (!categoryId || !categoryName) {
        return;
      }

      const option = document.createElement("option");
      option.value = categoryId;
      option.textContent = categoryName;
      fragment.appendChild(option);
    });

    targetedCategorySelect.replaceChildren(fragment);
    targetedCategorySelect.value = categories.some((category) => category?.id === selectedCategoryId) ? selectedCategoryId : "";
    renderTargetedSubcategories(targetedCategorySelect.value, selectedSubcategories);
  }

  function getEnabledCategoriesFromToggles() {
    const checkboxes = [...categoryToggles.querySelectorAll('input[type="checkbox"]')];

    if (checkboxes.length === 0 || checkboxes.every((checkbox) => checkbox.checked)) {
      return null;
    }

    return checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
  }

  async function renderCategoryToggles() {
    const categories = await getAllCategories();
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
          await renderTargetedCategoryOptions(getTargetedGenerationFromControls().categoryId, getTargetedGenerationFromControls().subcategories);
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
  targetedEnabledInput.checked = settings.targetedGeneration.enabled;
  setTargetedOptionsVisibility();
  host.appendChild(panel);
  renderCustomCategoryList();

  renderCategoryToggles().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(feedback, `分类加载失败：${message}`, "error");
  });

  renderTargetedCategoryOptions().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(feedback, `定向生成分类加载失败：${message}`, "error");
  });

  const toggleButton = document.querySelector("#settings-toggle");
  toggleButton?.addEventListener("click", () => {
    setPanelOpen(panel, panel.hidden);
  });

  closeButton.addEventListener("click", () => setPanelOpen(panel, false));

  categoryToggles.addEventListener("change", () => {
    enabledCategories = getEnabledCategoriesFromToggles();
  });

  targetedEnabledInput.addEventListener("change", () => {
    setTargetedOptionsVisibility();
  });

  targetedCategorySelect.addEventListener("change", () => {
    renderTargetedSubcategories(targetedCategorySelect.value, []);
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
      await renderTargetedCategoryOptions(getTargetedGenerationFromControls().categoryId, getTargetedGenerationFromControls().subcategories);
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
      customCategories,
      targetedGeneration: getTargetedGenerationFromControls()
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
      customCategories,
      targetedGeneration: getTargetedGenerationFromControls()
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
