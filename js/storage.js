const DB_NAME = "zhishi-db";
const DB_VERSION = 3;
const FACTS_STORE = "facts";

let dbPromise = null;

const KEYWORD_STOP_WORDS = new Set([
  "的",
  "了",
  "是",
  "在",
  "和",
  "与",
  "或",
  "等",
  "也",
  "都",
  "这",
  "那",
  "有",
  "为",
  "被",
  "对",
  "从",
  "以",
  "及",
  "其",
  "并",
  "而",
  "中",
  "上",
  "下",
  "于",
  "由",
  "把",
  "将",
  "会",
  "可",
  "能",
  "一个",
  "一种",
  "这些",
  "那些",
  "因此",
  "因为",
  "所以"
]);

const FACT_HASH_STOP_WORDS = [
  "以及",
  "的",
  "了",
  "是",
  "在",
  "和",
  "与",
  "或",
  "等",
  "也",
  "都",
  "这",
  "那",
  "有",
  "为",
  "被",
  "对",
  "从",
  "其"
];

function keywordScore(word) {
  const uniqueChars = new Set([...word]).size;
  return word.length * 2 + uniqueChars;
}

function addFallbackKeywords(keywords, normalizedText) {
  if (keywords.length >= 3) {
    return keywords;
  }

  const compactText = normalizedText.replace(/\s+/g, "");
  const fallbackWords = compactText.match(/[\p{Script=Han}A-Za-z0-9]{2,6}/gu) || [];

  for (const word of fallbackWords) {
    if (keywords.length >= 3) {
      break;
    }

    if (!KEYWORD_STOP_WORDS.has(word) && !keywords.includes(word)) {
      keywords.push(word);
    }
  }

  return keywords;
}

function extractFactKeywords(factText) {
  const normalized = normalizeText(factText)
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const singleCharStopWords = [...KEYWORD_STOP_WORDS].filter((word) => word.length === 1).join("");
  const splitPattern = new RegExp(`[\\s${singleCharStopWords}]+`, "u");
  const candidates = normalized
    .split(splitPattern)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !KEYWORD_STOP_WORDS.has(word));
  const uniqueCandidates = [...new Set(candidates)]
    .sort((left, right) => keywordScore(right) - keywordScore(left) || left.localeCompare(right, "zh-CN"));

  return addFallbackKeywords(uniqueCandidates.slice(0, 5), normalized)
    .slice(0, 5)
    .join(" ");
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFactText(value) {
  const compactText = normalizeText(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");

  return FACT_HASH_STOP_WORDS.reduce(
    (text, stopWord) => text.replaceAll(stopWord, ""),
    compactText
  );
}

async function hashFactText(factText) {
  const normalizedText = normalizeFactText(factText);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizedText);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function normalizeFact(fact) {
  if (!fact || typeof fact !== "object") {
    throw new TypeError("fact must be an object.");
  }

  const normalized = {
    id: normalizeText(fact.id) || createId(),
    category: normalizeText(fact.category),
    subcategory: normalizeText(fact.subcategory),
    leaf: normalizeText(fact.leaf),
    fact: normalizeText(fact.fact),
    fact_hash: normalizeText(fact.fact_hash),
    source_hint: normalizeText(fact.source_hint),
    quality_score: Number.isInteger(Number(fact.quality_score)) && Number(fact.quality_score) >= 1 && Number(fact.quality_score) <= 10
      ? Number(fact.quality_score)
      : 5,
    timestamp: Number.isFinite(Number(fact.timestamp)) ? Number(fact.timestamp) : Date.now()
  };

  if (!normalized.category || !normalized.subcategory || !normalized.fact || !normalized.source_hint) {
    throw new TypeError("fact must include category, subcategory, fact, and source_hint.");
  }

  return normalized;
}

function normalizeLimit(limit) {
  if (limit === Infinity) {
    return Infinity;
  }

  const parsed = Number(limit);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 50;
}

function normalizeOffset(offset) {
  const parsed = Number(offset);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function factMatchesKeyword(fact, keyword) {
  if (!keyword) {
    return true;
  }

  const haystack = [
    fact.fact,
    fact.category,
    fact.subcategory,
    fact.leaf,
    fact.source_hint
  ]
    .join(" ")
    .toLocaleLowerCase();

  return haystack.includes(keyword.toLocaleLowerCase());
}

function createCursorError(error, fallback) {
  return error || new Error(fallback);
}

function keepUpgradeTransactionAlive(store, isDone) {
  const ping = () => {
    if (isDone()) {
      return;
    }

    const request = store.count();
    request.onsuccess = ping;
    request.onerror = ping;
  };

  ping();
}

function backfillMissingFactHashes(store) {
  let migrationDone = false;
  keepUpgradeTransactionAlive(store, () => migrationDone);

  const cursorRequest = store.openCursor();

  cursorRequest.onsuccess = async () => {
    const cursor = cursorRequest.result;

    if (!cursor) {
      migrationDone = true;
      return;
    }

    const fact = cursor.value;

    if (normalizeText(fact.fact_hash)) {
      cursor.continue();
      return;
    }

    const fact_hash = await hashFactText(fact.fact);
    const updateRequest = store.put({
      ...fact,
      fact_hash
    });

    updateRequest.onsuccess = () => cursor.continue();
    updateRequest.onerror = () => {
      migrationDone = true;
    };
  };

  cursorRequest.onerror = () => {
    migrationDone = true;
  };
}

/**
 * Open the local knowledge database and create required indexes when needed.
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support IndexedDB."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      let store;

      if (!database.objectStoreNames.contains(FACTS_STORE)) {
        store = database.createObjectStore(FACTS_STORE, { keyPath: "id" });
      } else {
        store = request.transaction.objectStore(FACTS_STORE);
      }

      if (!store.indexNames.contains("category")) {
        store.createIndex("category", "category", { unique: false });
      }

      if (!store.indexNames.contains("timestamp")) {
        store.createIndex("timestamp", "timestamp", { unique: false });
      }

      if (request.oldVersion < 2 && !store.indexNames.contains("fact_hash")) {
        store.createIndex("fact_hash", "fact_hash", { unique: true });
      }

      if (request.oldVersion < 3) {
        backfillMissingFactHashes(store);
      }
    };

    request.onsuccess = () => {
      const database = request.result;

      database.onversionchange = () => {
        database.close();
        dbPromise = null;
      };

      resolve(database);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("Unable to open IndexedDB."));
    };

    request.onblocked = () => {
      reject(new Error("IndexedDB upgrade is blocked by another open tab."));
    };
  });

  return dbPromise;
}

/**
 * Save one fact and return the normalized record written to IndexedDB.
 * @param {object} fact
 * @returns {Promise<object|null>}
 */
export async function saveFact(fact) {
  const fact_hash = await hashFactText(fact?.fact);
  const normalizedFact = await normalizeFact({
    ...fact,
    fact_hash
  });
  const database = await initDB();
  const transaction = database.transaction(FACTS_STORE, "readwrite");
  const store = transaction.objectStore(FACTS_STORE);

  try {
    store.put(normalizedFact);
    await transactionToPromise(transaction);

    return normalizedFact;
  } catch (error) {
    if (error?.name === "ConstraintError") {
      return null;
    }

    throw error;
  }
}

/**
 * Query facts by category and/or keyword, newest first.
 * Facts are streamed through the timestamp index and stop once the requested page is filled.
 * @param {object} options
 * @param {string} [options.category]
 * @param {string} [options.keyword]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @returns {Promise<object[]>}
 */
export async function getFacts({ category = "", keyword = "", limit = 50, offset = 0 } = {}) {
  const database = await initDB();
  const normalizedCategory = normalizeText(category);
  const normalizedKeyword = normalizeText(keyword);
  const normalizedLimit = normalizeLimit(limit);
  const normalizedOffset = normalizeOffset(offset);

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FACTS_STORE, "readonly");
    const timestampIndex = transaction.objectStore(FACTS_STORE).index("timestamp");
    const facts = [];
    let matchedCount = 0;
    let settled = false;

    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(facts);
      }
    };

    const fail = (error, fallback) => {
      if (!settled) {
        settled = true;
        reject(createCursorError(error, fallback));
      }
    };

    const request = timestampIndex.openCursor(null, "prev");

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        finish();
        return;
      }

      const fact = cursor.value;
      const matchesCategory = !normalizedCategory || fact.category === normalizedCategory;

      if (matchesCategory && factMatchesKeyword(fact, normalizedKeyword)) {
        if (matchedCount >= normalizedOffset) {
          facts.push(fact);
        }

        matchedCount += 1;

        if (normalizedLimit !== Infinity && facts.length >= normalizedLimit) {
          finish();
          return;
        }
      }

      cursor.continue();
    };

    request.onerror = () => fail(request.error, "Unable to read facts.");
    transaction.onerror = () => fail(transaction.error, "Unable to read facts.");
    transaction.onabort = () => fail(transaction.error, "Fact query was aborted.");
  });
}

/**
 * Return every fact without pagination, newest first.
 * @returns {Promise<object[]>}
 */
export function getAllFacts() {
  return getFacts({ limit: Infinity });
}

/**
 * Count all facts and their categories without materializing the whole knowledge base.
 * @returns {Promise<{total: number, counts: Map<string, number>}>}
 */
export async function getFactStats() {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FACTS_STORE, "readonly");
    const store = transaction.objectStore(FACTS_STORE);
    const counts = new Map();
    let total = 0;
    let settled = false;

    const finish = () => {
      if (!settled) {
        settled = true;
        resolve({ total, counts });
      }
    };

    const fail = (error, fallback) => {
      if (!settled) {
        settled = true;
        reject(createCursorError(error, fallback));
      }
    };

    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        finish();
        return;
      }

      const categoryId = normalizeText(cursor.value.category) || "uncategorized";
      total += 1;
      counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
      cursor.continue();
    };

    request.onerror = () => fail(request.error, "Unable to calculate fact statistics.");
    transaction.onerror = () => fail(transaction.error, "Unable to calculate fact statistics.");
    transaction.onabort = () => fail(transaction.error, "Fact statistics transaction was aborted.");
  });
}

/**
 * Return the total number of stored facts.
 * @returns {Promise<number>}
 */
export async function countFacts() {
  const database = await initDB();
  const transaction = database.transaction(FACTS_STORE, "readonly");
  const request = transaction.objectStore(FACTS_STORE).count();
  const count = await requestToPromise(request);
  await transactionToPromise(transaction);

  return count;
}

/**
 * Return the newest n facts for prompt-level duplicate avoidance.
 * When category is provided, restrict the lookup to that category.
 * @param {number} n
 * @param {string} category
 * @returns {Promise<object[]>}
 */
export async function getRecentFacts(n = 20, category = "") {
  const database = await initDB();
  const limit = Math.max(0, Math.floor(Number(n) || 0));
  const normalizedCategory = normalizeText(category);

  if (limit === 0) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FACTS_STORE, "readonly");
    const store = transaction.objectStore(FACTS_STORE);
    const index = normalizedCategory ? store.index("category") : store.index("timestamp");
    const facts = [];
    const request = normalizedCategory
      ? index.openCursor(IDBKeyRange.only(normalizedCategory))
      : index.openCursor(null, "prev");

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor || (!normalizedCategory && facts.length >= limit)) {
        resolve(facts);
        return;
      }

      if (normalizedCategory) {
        const fact = cursor.value;
        const timestamp = Number.isFinite(Number(fact.timestamp)) ? Number(fact.timestamp) : 0;
        const insertAt = facts.findIndex((item) => Number(item.timestamp) < timestamp);

        if (insertAt === -1) {
          if (facts.length < limit) {
            facts.push(fact);
          }
        } else {
          facts.splice(insertAt, 0, fact);
          if (facts.length > limit) {
            facts.pop();
          }
        }

        cursor.continue();
        return;
      }

      facts.push(cursor.value);
      cursor.continue();
    };

    request.onerror = () => reject(request.error || new Error("Unable to read recent facts."));
    transaction.onerror = () => reject(transaction.error || new Error("Unable to read recent facts."));
    transaction.onabort = () => reject(transaction.error || new Error("Recent facts transaction was aborted."));
  });
}

/**
 * Return compact keyword strings extracted from recent facts for prompt-level duplicate avoidance.
 * @param {number} n
 * @param {string} category
 * @returns {Promise<string>}
 */
export async function getRecentKeywords(n = 20, category = "") {
  const recentFacts = await getRecentFacts(n, category);
  return recentFacts
    .map((fact) => extractFactKeywords(fact.fact))
    .filter(Boolean)
    .join("；");
}

/**
 * Permanently remove every locally stored fact.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  const database = await initDB();
  const transaction = database.transaction(FACTS_STORE, "readwrite");

  transaction.objectStore(FACTS_STORE).clear();
  await transactionToPromise(transaction);
}
