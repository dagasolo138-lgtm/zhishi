import { exportJSON, exportMarkdown } from "./exporter.js";
import { getFactStats, getFacts } from "./storage.js";

const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);
const CUSTOM_CATEGORIES_KEY = "zhishi_custom_categories";
const SEARCH_DEBOUNCE_MS = 180;
const FACTS_RENDER_LIMIT = 300;

const state = {
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

function parseDate(timestamp) {
  const numericTimestamp = Number(timestamp);

  if (!Number.isFinite(numericTimestamp)) {
    return null;
  }

  const date = new Date(numericTimestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(timestamp) {
  const date = parseDate(timestamp);

  if (!date) {
    return "时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function categoryName(categoryId) {
  return state.categoryNames.get(categoryId) || categoryId || "未分类";
}

function createTextElement(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  node.textContent = text;
  return node;
}

function createFactCard(fact) {
  const card = document.createElement("article");
  const header = document.createElement("header");
  const categoryBadge = createTextElement(
    "span",
    `category-badge category-badge--${fact.category || "uncategorized"}`,
    categoryName(fact.category)
  );
  const subcategory = createTextElement("span", "fact-card__subcategory", fact.subcategory || "未分类");
  const body = createTextElement("p", "fact-card__body", fact.fact || "");
  const footer = document.createElement("footer");
  const source = createTextElement("span", "fact-card__source", fact.source_hint || "来源提示缺失");
  const time = createTextElement("time", "fact-card__time", formatDate(fact.timestamp));
  const timestampDate = parseDate(fact.timestamp);

  card.className = "fact-card";
  card.dataset.factId = fact.id || "";

  if (timestampDate) {
    time.dateTime = timestampDate.toISOString();
  }

  header.className = "fact-card__header";
  header.append(categoryBadge, subcategory);

  footer.className = "fact-card__footer";
  footer.append(source, time);

  card.append(header, body, footer);
  return card;
}

function renderEmptyState(message = "还没有符合条件的事实。") {
  const grid = requiredElement("#facts-grid");
  const empty = createTextElement("p", "facts-empty", message);
  grid.replaceChildren(empty);
}

function renderFactCards(facts) {
  const grid = requiredElement("#facts-grid");

  if (!facts.length) {
    renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();
  facts.forEach((fact) => fragment.appendChild(createFactCard(fact)));

  if (facts.length >= FACTS_RENDER_LIMIT) {
    const limitHint = createTextElement(
      "p",
      "facts-limit-hint",
      "仅显示最新 300 条，导出可获取全量数据"
    );
    limitHint.style.cssText = "break-inside: avoid; margin: 4px 0 16px; color: #737373; font-size: 12px; line-height: 1.6;";
    fragment.appendChild(limitHint);
  }

  grid.replaceChildren(fragment);
}

function currentQuery() {
  const searchInput = element("#search-input");
  const categoryFilter = element("#category-filter");

  return {
    keyword: searchInput?.value.trim() || "",
    category: categoryFilter?.value || ""
  };
}

function setStatus(message, kind = "idle") {
  const statusText = element("#status-text");

  if (statusText) {
    statusText.textContent = message;
    statusText.dataset.status = kind;
  }
}

function setLastGenerated(timestamp) {
  const lastGenerated = element("#last-generated");

  if (lastGenerated) {
    lastGenerated.textContent = timestamp ? formatDate(timestamp) : "尚未生成";
  }
}

async function refreshFacts() {
  const requestId = ++state.refreshSequence;
  const { category, keyword } = currentQuery();

  try {
    const facts = await getFacts({ category, keyword, limit: FACTS_RENDER_LIMIT });

    if (requestId !== state.refreshSequence) {
      return;
    }

    renderFactCards(facts);
  } catch (error) {
    if (requestId !== state.refreshSequence) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    renderEmptyState(`读取知识库失败：${message}`);
    setStatus(`读取失败：${message}`, "error");
  }
}

function scheduleFactRefresh(delay = 0) {
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
  const [{ total: factTotal, counts }, categories] = await Promise.all([getFactStats(), loadCategories()]);
  const total = element("#stats-total");
  const categoryStats = element("#category-stats");

  if (total) {
    total.textContent = `共 ${factTotal} 条事实`;
  }

  if (!categoryStats) {
    return;
  }

  const knownCategoryIds = new Set(categories.map((category) => category.id));
  const displayCategories = [
    ...categories.map((category) => ({ id: category.id, name: category.name })),
    ...[...counts.keys()]
      .filter((categoryId) => !knownCategoryIds.has(categoryId))
      .sort()
      .map((categoryId) => ({ id: categoryId, name: categoryName(categoryId) }))
  ];
  const fragment = document.createDocumentFragment();

  displayCategories.forEach((category) => {
    const item = document.createElement("span");
    item.className = "category-count";
    item.title = `${category.name}：${counts.get(category.id) || 0} 条`;
    item.append(
      createTextElement("span", `category-badge category-badge--${category.id}`, category.name),
      createTextElement("strong", "category-count__value", String(counts.get(category.id) || 0))
    );
    fragment.appendChild(item);
  });

  categoryStats.replaceChildren(fragment);
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

function handleGeneratorStatus(event) {
  const detail = event.detail || {};
  const message = detail.message || "生成器状态已更新";

  setStatus(message, detail.status || "idle");

  if (detail.status === "completed" && Number(detail.savedCount) > 0) {
    setLastGenerated(detail.timestamp || Date.now());
  }
}

function bindRuntimeEvents() {
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
