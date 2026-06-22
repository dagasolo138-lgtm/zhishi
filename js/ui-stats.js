import { getAllFacts } from "./storage.js";

function element(selector) {
  return document.querySelector(selector);
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

function categoryName(categoryId, categoryNames = new Map()) {
  return categoryNames.get(categoryId) || categoryId || "未分类";
}

function createTextElement(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  node.textContent = text;
  return node;
}

export async function renderStats({ categories = [], categoryNames = new Map() } = {}) {
  const facts = await getAllFacts();
  const factTotal = facts.length;
  const counts = facts.reduce((categoryCounts, fact) => {
    const categoryId = typeof fact.category === "string" && fact.category.trim() ? fact.category.trim() : "uncategorized";
    categoryCounts.set(categoryId, (categoryCounts.get(categoryId) || 0) + 1);
    return categoryCounts;
  }, new Map());
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
      .map((categoryId) => ({ id: categoryId, name: categoryName(categoryId, categoryNames) }))
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

export function setStatus(message, kind = "idle") {
  const statusText = element("#status-text");

  if (statusText) {
    statusText.textContent = message;
    statusText.dataset.status = kind;
  }
}

export function setLastGenerated(timestamp) {
  const lastGenerated = element("#last-generated");

  if (lastGenerated) {
    lastGenerated.textContent = timestamp ? formatDate(timestamp) : "尚未生成";
  }
}

export function handleGeneratorStatus(event) {
  const detail = event.detail || {};
  const message = detail.message || "生成器状态已更新";

  setStatus(message, detail.status || "idle");

  if (detail.status === "completed" && Number(detail.savedCount) > 0) {
    setLastGenerated(detail.timestamp || Date.now());
  }
}
