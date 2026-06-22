import { getFacts, getAllFacts } from "./storage.js";

const FACTS_RENDER_LIMIT = 300;

function requiredElement(selector) {
  const found = document.querySelector(selector);

  if (!found) {
    throw new Error(`页面缺少必需元素：${selector}`);
  }

  return found;
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

function createDetailRow(label, value) {
  const row = document.createElement("div");
  const labelNode = createTextElement("span", "fact-card__detail-label", label);
  const valueNode = createTextElement("span", "fact-card__detail-value", value);

  row.className = "fact-card__detail-row";
  row.append(labelNode, valueNode);
  return row;
}

export function createFactCard(fact, { categoryNames = new Map() } = {}) {
  const card = document.createElement("article");
  const header = document.createElement("header");
  const categoryBadge = createTextElement(
    "span",
    `category-badge category-badge--${fact.category || "uncategorized"}`,
    categoryName(fact.category, categoryNames)
  );
  const subcategory = createTextElement("span", "fact-card__subcategory", fact.subcategory || "未分类");

  if (fact.leaf) {
    subcategory.append(
      document.createTextNode(" › "),
      createTextElement("span", "fact-card__leaf", fact.leaf)
    );
  }
  const body = createTextElement("p", "fact-card__body", fact.fact || "");
  const footer = document.createElement("footer");
  const detail = document.createElement("div");
  const source = createTextElement("span", "fact-card__source", fact.source_hint || "来源提示缺失");
  const scoreValue = Number(fact.quality_score);
  const score = Number.isInteger(scoreValue) && scoreValue >= 5
    ? createTextElement("span", "fact-card__score", `★ ${scoreValue} / 10`)
    : null;
  const time = createTextElement("time", "fact-card__time", formatDate(fact.timestamp));

  if (score) {
    score.dataset.score = scoreValue >= 8 ? "high" : "mid";
  }
  const timestampDate = parseDate(fact.timestamp);
  const fullGeneratedTime = timestampDate ? timestampDate.toISOString() : "时间未知";
  const shortId = fact.id ? String(fact.id).slice(-6) : "未知";

  card.className = "fact-card";
  card.dataset.factId = fact.id || "";
  card.addEventListener("click", () => {
    card.classList.toggle("fact-card--expanded");
  });

  if (timestampDate) {
    time.dateTime = timestampDate.toISOString();
  }

  header.className = "fact-card__header";
  header.append(categoryBadge, subcategory);

  footer.className = "fact-card__footer";
  footer.append(...[source, score, time].filter(Boolean));

  detail.className = "fact-card__detail";
  detail.append(createDetailRow("来源", fact.source_hint || "来源提示缺失"));

  if (fact.leaf) {
    detail.append(createDetailRow("细分类", fact.leaf));
  }

  detail.append(
    createDetailRow("质量评分", Number.isInteger(scoreValue) ? `★ ${scoreValue} / 10` : "未评分"),
    createDetailRow("生成时间", fullGeneratedTime),
    createDetailRow("条目 ID", shortId)
  );

  card.append(header, body, footer, detail);
  return card;
}

export function renderEmptyState(message = "还没有符合条件的事实。") {
  const grid = requiredElement("#facts-grid");
  const empty = createTextElement("p", "facts-empty", message);
  grid.replaceChildren(empty);
}

export function renderFactCards(facts, { categoryNames = new Map() } = {}) {
  const grid = requiredElement("#facts-grid");

  if (!facts.length) {
    renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();
  facts.forEach((fact) => fragment.appendChild(createFactCard(fact, { categoryNames })));

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
