import { exportJSON, exportMarkdown } from "./exporter.js";
import { getFacts } from "./storage.js";
import {
  renderEmptyState,
  renderFactCards as renderFactCardsCore
} from "./ui-cards.js";
import {
  handleGeneratorStatus,
  renderStats as renderStatsCore,
  setLastGenerated,
  setStatus
} from "./ui-stats.js";

export { createFactCard, renderEmptyState, renderFactCards } from "./ui-cards.js";
export { handleGeneratorStatus, setLastGenerated, setStatus } from "./ui-stats.js";
export { initTabs } from "./ui-tabs.js";

const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);
const CUSTOM_CATEGORIES_KEY = "zhishi_custom_categories";
const SEARCH_DEBOUNCE_MS = 180;
const FACTS_RENDER_LIMIT = 300;

export const state = {
  initialized: false,
  categories: [],
  categoryNames: new Map(),
  searchTimer: null,
  refreshTimer: null,
  statsTimer: null,
  refreshSequence: 0
};

function element(selector) {
  return document.querySelector(selector);
}

function requiredElement(selector) {
  const found = element(selector);

  if (!found) {
    throw new Error(`页面缺少必需元素：${selector}`);
  }

  return found;
}

function loadCustomCategories() {
  try {
    const rawValue = localStorage.getItem(CUSTOM_CATEGORIES_KEY);
    const categories = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(categories) ? categories.filter((category) => category && typeof category === "object") : [];
  } catch {
    return [];
  }
}

async function loadCategories() {
  const response = await fetch(CATEGORIES_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`无法读取分类配置：${response.status}`);
  }

  const builtinCategories = await response.json();

  if (!Array.isArray(builtinCategories)) {
    throw new Error("分类配置格式错误。");
  }

  const categories = builtinCategories.concat(loadCustomCategories());
  state.categories = categories;
  state.categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  return categories;
}

function currentQuery() {
  const searchInput = element("#search-input");
  const categoryFilter = element("#category-filter");

  return {
    keyword: searchInput?.value.trim() || "",
    category: categoryFilter?.value || ""
  };
}

export async function refreshFacts() {
  const requestId = ++state.refreshSequence;
  const { category, keyword } = currentQuery();

  try {
    const facts = await getFacts({ category, keyword, limit: FACTS_RENDER_LIMIT });

    if (requestId !== state.refreshSequence) {
      return;
    }

    renderFactCardsCore(facts, { categoryNames: state.categoryNames });
  } catch (error) {
    if (requestId !== state.refreshSequence) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    renderEmptyState(`读取知识库失败：${message}`);
    setStatus(`读取失败：${message}`, "error");
  }
}

export function scheduleFactRefresh(delay = 0) {
  if (state.refreshTimer !== null) {
    window.clearTimeout(state.refreshTimer);
  }

  state.refreshTimer = window.setTimeout(() => {
    state.refreshTimer = null;
    refreshFacts();
  }, delay);
}

function scheduleStatsRefresh(delay = 0) {
  if (state.statsTimer !== null) {
    window.clearTimeout(state.statsTimer);
  }

  state.statsTimer = window.setTimeout(() => {
    state.statsTimer = null;
    renderStats().catch((error) => {
      setStatus(`统计更新失败：${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, delay);
}

function createCategoryOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

/**
 * Attach live IndexedDB-backed filtering to the search input.
 */
export function renderSearch() {
  const searchInput = requiredElement("#search-input");

  if (searchInput.dataset.bound === "true") {
    return;
  }

  searchInput.addEventListener("input", () => {
    if (state.searchTimer !== null) {
      window.clearTimeout(state.searchTimer);
    }

    state.searchTimer = window.setTimeout(() => {
      state.searchTimer = null;
      refreshFacts();
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput.dataset.bound = "true";
}

/**
 * Populate and attach the category selector.
 */
export async function renderFilter() {
  const filter = requiredElement("#category-filter");
  const categories = await loadCategories();
  const selectedValue = filter.value;
  const fragment = document.createDocumentFragment();

  fragment.appendChild(createCategoryOption("", "全部分类"));
  categories.forEach((category) => {
    fragment.appendChild(createCategoryOption(category.id, category.name));
  });

  filter.replaceChildren(fragment);
  filter.value = [...filter.options].some((option) => option.value === selectedValue)
    ? selectedValue
    : "";
  filter.dataset.populated = "true";

  if (filter.dataset.bound !== "true") {
    filter.addEventListener("change", () => refreshFacts());
    filter.dataset.bound = "true";
  }
}

/**
 * Render total facts and per-category counts.
 */
export async function renderStats() {
  const categories = await loadCategories();
  return renderStatsCore({ categories, categoryNames: state.categoryNames });
}

async function runExport(button, action, successMessage) {
  button.disabled = true;
  setStatus("正在准备导出文件…", "working");

  try {
    await action();
    setStatus(successMessage, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`导出失败：${message}`, "error");
  } finally {
    button.disabled = false;
  }
}

/**
 * Attach JSON and Markdown export buttons.
 */
export function renderExportButtons() {
  const jsonButton = requiredElement("#export-json");
  const markdownButton = requiredElement("#export-markdown");

  if (jsonButton.dataset.bound !== "true") {
    jsonButton.addEventListener("click", () => {
      runExport(jsonButton, exportJSON, "JSON 导出已开始下载。");
    });
    jsonButton.dataset.bound = "true";
  }

  if (markdownButton.dataset.bound !== "true") {
    markdownButton.addEventListener("click", () => {
      runExport(markdownButton, exportMarkdown, "Markdown 导出已开始下载。");
    });
    markdownButton.dataset.bound = "true";
  }
}

export function bindRuntimeEvents() {
  window.addEventListener("fact:new", () => {
    scheduleFactRefresh(80);
    scheduleStatsRefresh(80);
  });

  window.addEventListener("facts:cleared", () => {
    scheduleFactRefresh();
    scheduleStatsRefresh();
  });

  window.addEventListener("settings:changed", () => {
    (async () => {
      try {
        await renderFilter();
        await Promise.all([refreshFacts(), renderStats()]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`设置更新失败：${message}`, "error");
      }
    })();
  });

  window.addEventListener("generator:status", handleGeneratorStatus);
}

/**
 * Initialize the fact list, search, filters, statistics, exports, and live events.
 * @returns {Promise<void>}
 */
export async function init() {
  if (state.initialized) {
    await Promise.all([refreshFacts(), renderStats()]);
    return;
  }

  await loadCategories();
  renderSearch();
  await renderFilter();
  renderExportButtons();
  bindRuntimeEvents();

  await Promise.all([refreshFacts(), renderStats()]);
  setStatus("等待生成任务启动", "idle");
  setLastGenerated(null);
  state.initialized = true;
}
