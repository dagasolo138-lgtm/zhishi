import { hasConfiguredApiKey, streamGenerate } from "./api.js";
import { buildPrompt } from "./prompt.js";
import { getRecentFacts, saveFact } from "./storage.js";
import { validate } from "./validator.js";

const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);
const SUCCESS_DELAY_MS = 3000;
const FAILURE_DELAY_MS = 10000;
const USER_ACTION_STATUS_CODES = new Set([401, 402, 403]);

let categoriesPromise = null;
let loopActive = false;
let paused = false;
let delayTimer = null;
let delayResolver = null;

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function emitStatus(status, detail = {}) {
  emit("generator:status", {
    status,
    timestamp: Date.now(),
    ...detail
  });
}

function normalizeFactText(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
    : "";
}

function needsUserAction(error) {
  return USER_ACTION_STATUS_CODES.has(Number(error?.status));
}

function chooseWeightedCategory(categories) {
  const validCategories = categories.filter((category) => Number(category.weight) > 0);
  const totalWeight = validCategories.reduce((sum, category) => sum + Number(category.weight), 0);

  if (totalWeight <= 0) {
    throw new Error("分类权重无效，无法选择生成分类。");
  }

  let cursor = Math.random() * totalWeight;

  for (const category of validCategories) {
    cursor -= Number(category.weight);
    if (cursor < 0) {
      return category;
    }
  }

  return validCategories[validCategories.length - 1];
}

async function loadCategories() {
  if (!categoriesPromise) {
    categoriesPromise = fetch(CATEGORIES_URL, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`无法读取分类配置：${response.status}`);
        }

        return response.json();
      })
      .then((categories) => {
        if (!Array.isArray(categories) || categories.length === 0) {
          throw new Error("分类配置必须是非空数组。");
        }

        return categories;
      })
      .catch((error) => {
        categoriesPromise = null;
        throw error;
      });
  }

  return categoriesPromise;
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    delayResolver = resolve;
    delayTimer = window.setTimeout(() => {
      delayTimer = null;
      delayResolver = null;
      resolve();
    }, milliseconds);
  });
}

function cancelWait() {
  if (delayTimer !== null) {
    window.clearTimeout(delayTimer);
    delayTimer = null;
  }

  if (delayResolver) {
    const resolve = delayResolver;
    delayResolver = null;
    resolve();
  }
}

function getUsableFacts(validFacts, category, recentFacts) {
  const knownFacts = new Set(
    recentFacts.map((item) => normalizeFactText(item.fact)).filter(Boolean)
  );

  return validFacts.filter((fact) => {
    const normalizedFact = normalizeFactText(fact.fact);

    if (!normalizedFact || fact.category !== category.id || knownFacts.has(normalizedFact)) {
      return false;
    }

    knownFacts.add(normalizedFact);
    return true;
  });
}

function makeStoredFact(fact, categoryId) {
  return {
    category: categoryId,
    subcategory: fact.subcategory,
    fact: fact.fact,
    source_hint: fact.source_hint
  };
}

async function runRound() {
  const categories = await loadCategories();
  const category = chooseWeightedCategory(categories);
  const recentFacts = await getRecentFacts(20);
  const { systemPrompt, userPrompt } = buildPrompt(category, recentFacts);
  let receivedLength = 0;

  emitStatus("generating", {
    category: category.id,
    categoryName: category.name,
    message: `正在生成：${category.name}`
  });

  const rawText = await streamGenerate({
    systemPrompt,
    userPrompt,
    onChunk(chunk) {
      receivedLength += chunk.length;
      emitStatus("streaming", {
        category: category.id,
        categoryName: category.name,
        receivedLength,
        message: `正在接收：${category.name}`
      });
    }
  });

  const { valid, invalid } = validate(rawText);
  const usableFacts = getUsableFacts(valid, category, recentFacts);
  let savedCount = 0;

  for (const fact of usableFacts) {
    if (paused) {
      break;
    }

    const savedFact = await saveFact(makeStoredFact(fact, category.id));
    savedCount += 1;
    emit("fact:new", savedFact);
  }

  emitStatus("completed", {
    category: category.id,
    categoryName: category.name,
    savedCount,
    invalidCount: invalid.length,
    filteredCount: valid.length - usableFacts.length,
    message: savedCount > 0
      ? `已写入 ${savedCount} 条${category.name}事实`
      : `本轮没有可写入的${category.name}事实`
  });

  return savedCount > 0;
}

async function runLoop() {
  let awaitingUserAction = false;

  emitStatus("running", { message: "自动生成已启动" });

  while (!paused) {
    let successful = false;

    try {
      successful = await runRound();
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));

      if (needsUserAction(normalizedError)) {
        awaitingUserAction = true;
        paused = true;
        emitStatus("needs_api_key", {
          error: normalizedError.message,
          message: `生成已暂停：${normalizedError.message}`
        });
        break;
      }

      emitStatus("error", {
        error: normalizedError.message,
        message: `生成失败：${normalizedError.message}`
      });
    }

    if (paused) {
      break;
    }

    const delay = successful ? SUCCESS_DELAY_MS : FAILURE_DELAY_MS;
    emitStatus("waiting", {
      retryIn: delay,
      message: successful ? "等待下一轮生成" : "等待后重试"
    });
    await wait(delay);
  }

  if (!awaitingUserAction) {
    emitStatus("paused", { message: "自动生成已暂停" });
  }
}

/**
 * Start the weighted automatic generation loop.
 */
export function start() {
  if (loopActive) {
    return;
  }

  if (!hasConfiguredApiKey()) {
    paused = true;
    emitStatus("needs_api_key", {
      message: "请先在设置中保存 DeepSeek API Key。"
    });
    return;
  }

  paused = false;
  loopActive = true;

  runLoop()
    .catch((error) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      emitStatus("error", {
        error: normalizedError.message,
        message: `生成器已停止：${normalizedError.message}`
      });
    })
    .finally(() => {
      loopActive = false;
      cancelWait();
    });
}

/**
 * Stop future generation rounds. A request already in flight is allowed to finish.
 */
export function pause() {
  paused = true;
  cancelWait();

  if (!loopActive) {
    emitStatus("paused", { message: "自动生成已暂停" });
  }
}

/**
 * Resume automatic generation after a pause.
 */
export function resume() {
  paused = false;

  if (!loopActive) {
    start();
  } else {
    emitStatus("running", { message: "自动生成已恢复" });
  }
}
