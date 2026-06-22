export const API_KEY_STORAGE_KEY = "zhishi_deepseek_api_key";
export const SETTINGS_STORAGE_KEY = "zhishi_settings";
export const ENABLED_CATEGORIES_KEY = "zhishi_enabled_categories";
export const CUSTOM_CATEGORIES_KEY = "zhishi_custom_categories";
export const MAX_ROUNDS_KEY = "zhishi_max_rounds";
export const TARGETED_GENERATION_KEY = "zhishi_targeted_generation";

export const DEFAULT_SETTINGS = Object.freeze({
  generationEnabled: true
});

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};

  return {
    generationEnabled: input.generationEnabled !== false
  };
}

function readJSONSetting(key, fallback) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMaxRounds(value) {
  const parsed = parseInt(value, 10) || 0;
  return Math.max(0, parsed);
}

function normalizeEnabledCategories(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()))] : null;
}

function normalizeCustomCategories(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function normalizeTargetedGeneration(value) {
  const input = value && typeof value === "object" ? value : {};
  const categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : "";
  const subcategories = Array.isArray(input.subcategories)
    ? [...new Set(input.subcategories.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];

  return {
    enabled: input.enabled === true,
    categoryId,
    subcategories
  };
}

/**
 * Load persisted UI settings and the locally stored DeepSeek API key.
 * @returns {{apiKey: string, generationEnabled: boolean, maxRounds: number, enabledCategories: string[]|null, customCategories: object[], targetedGeneration: {enabled: boolean, categoryId: string, subcategories: string[]}}}
 */
export function loadSettings() {
  let storedSettings = {};

  try {
    const rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    storedSettings = rawSettings ? JSON.parse(rawSettings) : {};
  } catch {
    storedSettings = {};
  }

  const settings = normalizeSettings(storedSettings);
  const apiKey = (localStorage.getItem(API_KEY_STORAGE_KEY) || "").trim();
  const maxRounds = normalizeMaxRounds(localStorage.getItem(MAX_ROUNDS_KEY));
  const enabledCategories = normalizeEnabledCategories(readJSONSetting(ENABLED_CATEGORIES_KEY, null));
  const customCategories = normalizeCustomCategories(readJSONSetting(CUSTOM_CATEGORIES_KEY, []));
  const targetedGeneration = normalizeTargetedGeneration(readJSONSetting(TARGETED_GENERATION_KEY, null));

  return { apiKey, ...settings, maxRounds, enabledCategories, customCategories, targetedGeneration };
}

/**
 * Persist settings. API key is stored separately so it is never included in exported settings.
 * @param {{apiKey?: string, generationEnabled?: boolean, maxRounds?: number|string, enabledCategories?: string[]|null, customCategories?: object[], targetedGeneration?: {enabled?: boolean, categoryId?: string, subcategories?: string[]}}} nextSettings
 * @returns {{apiKey: string, generationEnabled: boolean, maxRounds: number, enabledCategories: string[]|null, customCategories: object[], targetedGeneration: {enabled: boolean, categoryId: string, subcategories: string[]}}}
 */
export function saveSettings(nextSettings = {}) {
  const current = loadSettings();
  const apiKey = typeof nextSettings.apiKey === "string" ? nextSettings.apiKey.trim() : current.apiKey;
  const settings = normalizeSettings({
    generationEnabled: Object.prototype.hasOwnProperty.call(nextSettings, "generationEnabled")
      ? nextSettings.generationEnabled
      : current.generationEnabled
  });
  const maxRounds = Object.prototype.hasOwnProperty.call(nextSettings, "maxRounds")
    ? normalizeMaxRounds(nextSettings.maxRounds)
    : current.maxRounds;
  const enabledCategories = Object.prototype.hasOwnProperty.call(nextSettings, "enabledCategories")
    ? normalizeEnabledCategories(nextSettings.enabledCategories)
    : current.enabledCategories;
  const customCategories = Object.prototype.hasOwnProperty.call(nextSettings, "customCategories")
    ? normalizeCustomCategories(nextSettings.customCategories)
    : current.customCategories;
  const targetedGeneration = Object.prototype.hasOwnProperty.call(nextSettings, "targetedGeneration")
    ? normalizeTargetedGeneration(nextSettings.targetedGeneration)
    : current.targetedGeneration;

  if (apiKey) {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }

  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  localStorage.setItem(MAX_ROUNDS_KEY, String(maxRounds));

  if (enabledCategories === null) {
    localStorage.removeItem(ENABLED_CATEGORIES_KEY);
  } else {
    localStorage.setItem(ENABLED_CATEGORIES_KEY, JSON.stringify(enabledCategories));
  }

  localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories));
  localStorage.setItem(TARGETED_GENERATION_KEY, JSON.stringify(targetedGeneration));

  const saved = { apiKey, ...settings, maxRounds, enabledCategories, customCategories, targetedGeneration };
  emit("settings:changed", saved);
  return saved;
}
