import { initBackendStore } from "./backend-store.js";
import { pause, start } from "./generator.js";
import { loadSettings, renderSettingsPanel } from "./settings.js";
import { countFacts, initDB, saveFact } from "./storage.js";
import * as ui from "./ui.js";

const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);
const FACTS_SEED_URL = new URL("../data/facts_seed.json", import.meta.url);
const SEED_INITIALIZED_STORAGE_KEY = "zhishi_seed_initialized";

const SEED_SOURCE_HINTS = Object.freeze({
  geography: "通用地理教材",
  physics: "基础物理教材",
  chemistry: "基础化学教材",
  biology: "基础生物学教材",
  history: "通用历史资料",
  technology: "计算机与工程教材",
  astronomy: "天文学教材",
  mathematics: "数学教材",
  linguistics: "语言学教材"
});

function emitStatus(status, message, detail = {}) {
  window.dispatchEvent(new CustomEvent("generator:status", {
    detail: {
      status,
      message,
      timestamp: Date.now(),
      ...detail
    }
  }));
}

async function loadJSON(url, label) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`无法读取${label}：${response.status}`);
  }

  return response.json();
}

function getSeedFacts(seedData, categories) {
  if (!seedData || typeof seedData !== "object" || Array.isArray(seedData)) {
    throw new Error("种子事实文件格式错误。");
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const seedFacts = [];
  let sequence = 0;
  const baseTimestamp = Date.now() - 10_000;

  Object.entries(seedData).forEach(([categoryId, facts]) => {
    const category = categoryById.get(categoryId);

    if (!category || !Array.isArray(facts)) {
      return;
    }

    const firstSubcategory = category.subcategories?.[0];
    const subcategory = typeof firstSubcategory === "string"
      ? firstSubcategory
      : firstSubcategory?.name || "初始事实";
    const leaf = Array.isArray(firstSubcategory?.leaves) ? firstSubcategory.leaves[0] || "" : "";
    const sourceHint = SEED_SOURCE_HINTS[categoryId] || "项目内置种子事实";

    facts.forEach((factText) => {
      if (typeof factText !== "string" || !factText.trim()) {
        return;
      }

      seedFacts.push({
        category: categoryId,
        subcategory,
        leaf,
        fact: factText.trim(),
        source_hint: sourceHint,
        timestamp: baseTimestamp + sequence
      });
      sequence += 1;
    });
  });

  return seedFacts;
}

async function seedFactsIfNeeded() {
  const existingCount = await countFacts();

  if (existingCount > 0) {
    localStorage.setItem(SEED_INITIALIZED_STORAGE_KEY, "true");
    return 0;
  }

  if (localStorage.getItem(SEED_INITIALIZED_STORAGE_KEY) === "true") {
    return 0;
  }

  const [categories, seedData] = await Promise.all([
    loadJSON(CATEGORIES_URL, "分类配置"),
    loadJSON(FACTS_SEED_URL, "种子事实")
  ]);

  if (!Array.isArray(categories)) {
    throw new Error("分类配置格式错误。");
  }

  const seedFacts = getSeedFacts(seedData, categories);
  let savedCount = 0;

  for (const fact of seedFacts) {
    const savedFact = await saveFact(fact);
    savedCount += 1;
    window.dispatchEvent(new CustomEvent("fact:new", { detail: savedFact }));
  }

  localStorage.setItem(SEED_INITIALIZED_STORAGE_KEY, "true");
  return savedCount;
}

async function bootstrap() {
  await initDB();
  await initBackendStore();

  const settings = loadSettings();
  renderSettingsPanel();
  await ui.init();

  const seededCount = await seedFactsIfNeeded();
  if (seededCount > 0) {
    await ui.renderStats();
    emitStatus("completed", `已写入 ${seededCount} 条初始种子事实`, { savedCount: seededCount });
  }

  if (settings.generationEnabled) {
    start();
  } else {
    pause();
  }
}

function handleBootstrapError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("zhishi initialization failed:", error);

  const statusText = document.querySelector("#status-text");
  if (statusText) {
    statusText.textContent = `初始化失败：${message}`;
    statusText.dataset.status = "error";
  }
}

function runWhenDocumentReady() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bootstrap().catch(handleBootstrapError);
    }, { once: true });
    return;
  }

  bootstrap().catch(handleBootstrapError);
}

runWhenDocumentReady();
