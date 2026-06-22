import { getAllFacts } from "./storage.js";

const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);
const CUSTOM_CATEGORIES_KEY = "zhishi_custom_categories";

function loadCustomCategories() {
  try {
    const rawValue = localStorage.getItem(CUSTOM_CATEGORIES_KEY);
    const categories = rawValue ? JSON.parse(rawValue) : [];

    return Array.isArray(categories)
      ? categories.filter((category) => (
        category
        && typeof category === "object"
        && typeof category.id === "string"
        && category.id.trim()
        && typeof category.name === "string"
        && category.name.trim()
      ))
      : [];
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
  const normalizedBuiltinCategories = Array.isArray(builtinCategories) ? builtinCategories : [];
  const builtinIds = new Set(normalizedBuiltinCategories.map((category) => category?.id));
  const customCategories = loadCustomCategories().filter((category) => !builtinIds.has(category.id));

  return normalizedBuiltinCategories.concat(customCategories);
}

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sortOldestFirst(left, right) {
  return Number(left.timestamp) - Number(right.timestamp);
}

function escapeMarkdown(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]\(\)])/g, "\\$1")
    .replace(/\r?\n/g, " ")
    .trim();
}

function groupFactsByCategory(facts) {
  return facts.reduce((groups, fact) => {
    const categoryId = String(fact.category || "uncategorized");

    if (!groups.has(categoryId)) {
      groups.set(categoryId, []);
    }

    groups.get(categoryId).push(fact);
    return groups;
  }, new Map());
}

/**
 * Download every local fact as zhishi_export.json.
 * @returns {Promise<object[]>}
 */
export async function exportJSON() {
  const facts = await getAllFacts();
  const content = JSON.stringify(facts.sort(sortOldestFirst), null, 2);

  downloadText("zhishi_export.json", content, "application/json");
  return facts;
}

/**
 * Download local facts grouped by category as zhishi_export.md.
 * @returns {Promise<string>}
 */
export async function exportMarkdown() {
  const [facts, categories] = await Promise.all([getAllFacts(), loadCategories()]);
  const factsByCategory = groupFactsByCategory(facts);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const orderedCategoryIds = [
    ...categories.map((category) => category.id),
    ...[...factsByCategory.keys()].filter((id) => !categoryNames.has(id)).sort()
  ];
  const sections = [];

  for (const categoryId of orderedCategoryIds) {
    const categoryFacts = factsByCategory.get(categoryId);

    if (!categoryFacts || categoryFacts.length === 0) {
      continue;
    }

    const categoryName = categoryNames.get(categoryId) || categoryId;
    const lines = categoryFacts
      .sort(sortOldestFirst)
      .map((fact) => {
        const factText = escapeMarkdown(fact.fact);
        const sourceHint = escapeMarkdown(fact.source_hint);
        return `- ${factText}${sourceHint ? `（${sourceHint}）` : ""}`;
      });

    sections.push(`## ${escapeMarkdown(categoryName)}\n${lines.join("\n")}`);
  }

  const content = sections.length > 0
    ? `${sections.join("\n\n")}\n`
    : "# zhishi 导出\n\n当前没有可导出的事实。\n";

  downloadText("zhishi_export.md", content, "text/markdown");
  return content;
}
