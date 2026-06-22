import { exportJSON, exportMarkdown } from "./exporter.js";
import { CUSTOM_CATEGORIES_KEY } from "./settings-store.js";
import { getFacts } from "./storage.js";
import {
  getCurrentTabQuery,
  initTabs as initTabsCore,
  loadCategories,
  switchTab as switchTabCore
} from "./ui-tabs.js";
import {
  renderEmptyState,
  renderFactCards as renderFactCardsCore
} from "./ui-cards.js";
import {
  handleGeneratorStatus,
  renderStats as renderStatsCore,
  setStatus
} from "./ui-stats.js";

export { createFactCard, renderEmptyState, renderFactCards } from "./ui-cards.js";
export { handleGeneratorStatus, setStatus } from "./ui-stats.js";



export function initTabs(categories) {
  initTabsCore(categories);

  const graphTab = element('.tab-item[data-tab="graph"]');

  if (graphTab?.dataset.graphBound === "true") {
    return;
  }

  graphTab?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    switchTab("graph");
  }, { capture: true });
  if (graphTab) {
    graphTab.dataset.graphBound = "true";
  }
}

export function switchTab(tabId) {
  switchTabCore(tabId);

  if (tabId === "graph") {
    import("./ui-graph.js")
      .then(({ initGraph }) => initGraph((categoryId) => switchTab(categoryId)))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        renderEmptyState(`图谱加载失败：${message}`);
        setStatus(`图谱加载失败：${message}`, "error");
      });
  }
}

const SEARCH_DEBOUNCE_MS = 180;
export const FACTS_RENDER_LIMIT = 300;

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

async function refreshCategoryState() {
  const categories = await loadCategories();
  state.categories = categories;
  state.categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  return categories;
}

function currentQuery() {
  const searchInput = element("#search-input");
  const tabQuery = getCurrentTabQuery();
  const searchKeyword = searchInput?.value.trim() || "";
  const tabKeyword = tabQuery.keyword || "";

  return {
    category: tabQuery.category || "",
    keyword: [searchKeyword, tabKeyword].filter(Boolean).join(" ")
  };
}

export async function refreshFacts(query = {}) {
  const requestId = ++state.refreshSequence;
  const current = currentQuery();
  const category = Object.hasOwn(query, "category") ? query.category || "" : current.category;
  const keyword = Object.hasOwn(query, "keyword")
    ? [element("#search-input")?.value.trim() || "", query.keyword || ""].filter(Boolean).join(" ")
    : current.keyword;

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
 * Category filtering is now driven by the tab bar. Kept as a no-op for callers
 * that refresh settings and expect the previous filter setup hook to exist.
 */
export async function renderFilter() {}

/**
 * Render total facts and per-category counts.
 */
export async function renderStats() {
  const categories = await refreshCategoryState();
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
        const categories = await refreshCategoryState();
        initTabs(categories);
        switchTab("all");
        await renderStats();
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

  const categories = await refreshCategoryState();
  renderSearch();
  initTabs(categories);
  renderExportButtons();
  bindRuntimeEvents();

  switchTab("all");
  await renderStats();
  setStatus("等待生成任务启动", "idle");
  state.initialized = true;
}
