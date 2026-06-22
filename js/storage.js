const DB_NAME = "zhishi-db";
const DB_VERSION = 1;
const FACTS_STORE = "facts";

let dbPromise = null;

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

function normalizeFact(fact) {
  if (!fact || typeof fact !== "object") {
    throw new TypeError("fact must be an object.");
  }

  const normalized = {
    id: normalizeText(fact.id) || createId(),
    category: normalizeText(fact.category),
    subcategory: normalizeText(fact.subcategory),
    fact: normalizeText(fact.fact),
    source_hint: normalizeText(fact.source_hint),
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
    fact.source_hint
  ]
    .join(" ")
    .toLocaleLowerCase();

  return haystack.includes(keyword.toLocaleLowerCase());
}

function createCursorError(error, fallback) {
  return error || new Error(fallback);
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
 * @returns {Promise<object>}
 */
export async function saveFact(fact) {
  const normalizedFact = normalizeFact(fact);
  const database = await initDB();
  const transaction = database.transaction(FACTS_STORE, "readwrite");
  const store = transaction.objectStore(FACTS_STORE);

  store.put(normalizedFact);
  await transactionToPromise(transaction);

  return normalizedFact;
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
 * @param {number} n
 * @returns {Promise<object[]>}
 */
export async function getRecentFacts(n = 20) {
  const database = await initDB();
  const limit = Math.max(0, Math.floor(Number(n) || 0));

  if (limit === 0) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FACTS_STORE, "readonly");
    const index = transaction.objectStore(FACTS_STORE).index("timestamp");
    const facts = [];
    const request = index.openCursor(null, "prev");

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor || facts.length >= limit) {
        resolve(facts);
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
 * Permanently remove every locally stored fact.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  const database = await initDB();
  const transaction = database.transaction(FACTS_STORE, "readwrite");

  transaction.objectStore(FACTS_STORE).clear();
  await transactionToPromise(transaction);
}
