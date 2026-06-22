import { refreshFacts } from "./ui.js";

const CATEGORIES_URL = new URL("../data/categories.json", import.meta.url);
const CUSTOM_CATEGORIES_KEY = "zhishi_custom_categories";

let categories = [];
let currentTab = "all";
let currentSubtab = "";

function element(selector) {
  return document.querySelector(selector);
}

function readCustomCategories() {
  try {
    const rawValue = localStorage.getItem(CUSTOM_CATEGORIES_KEY);
    const customCategories = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(customCategories)
      ? customCategories.filter((category) => category && typeof category === "object")
      : [];
  } catch {
    return [];
  }
}

export async function loadCategories() {
  const response = await fetch(CATEGORIES_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`无法读取分类配置：${response.status}`);
  }

  const builtinCategories = await response.json();

  if (!Array.isArray(builtinCategories)) {
    throw new Error("分类配置格式错误。");
  }

  return builtinCategories.concat(readCustomCategories());
}

function subcategoryValue(subcategory) {
  return typeof subcategory === "string" ? subcategory : subcategory?.name || "";
}

function setPanelVisibility(tabId) {
  const factsGrid = element("#facts-grid");
  const graphContainer = element("#graph-container");
  const subtabBar = element("#subtab-bar");

  if (tabId === "graph") {
    factsGrid?.setAttribute("hidden", "");
    graphContainer?.removeAttribute("hidden");
    subtabBar?.setAttribute("hidden", "");
    return;
  }

  factsGrid?.removeAttribute("hidden");
  graphContainer?.setAttribute("hidden", "");
  subtabBar?.removeAttribute("hidden");
}

function updateActiveTab(tabId) {
  document.querySelectorAll(".tab-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });
}

function updateActiveSubtab(subtabValue) {
  document.querySelectorAll(".subtab-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.subtab === subtabValue);
  });
}

export function initTabs(nextCategories = categories) {
  categories = Array.isArray(nextCategories) ? nextCategories : [];

  const tabBar = element(".tab-bar");
  const graphTab = element('.tab-item[data-tab="graph"]');

  if (!tabBar || !graphTab) {
    return;
  }

  tabBar.querySelectorAll('.tab-item[data-generated="true"]').forEach((tab) => tab.remove());

  const fragment = document.createDocumentFragment();
  categories.forEach((category) => {
    if (!category?.id) {
      return;
    }

    const button = document.createElement("button");
    button.className = "tab-item";
    button.type = "button";
    button.dataset.tab = category.id;
    button.dataset.generated = "true";
    button.textContent = category.name || category.id;
    fragment.appendChild(button);
  });

  tabBar.insertBefore(fragment, graphTab);

  tabBar.querySelectorAll(".tab-item").forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    button.addEventListener("click", () => {
      switchTab(button.dataset.tab || "all");
    });
    button.dataset.bound = "true";
  });
}

export function switchTab(tabId) {
  currentTab = tabId || "all";
  currentSubtab = "";

  updateActiveTab(currentTab);
  setPanelVisibility(currentTab);

  if (currentTab === "graph") {
    return;
  }

  if (currentTab === "all") {
    const subtabBar = element("#subtab-bar");
    subtabBar?.replaceChildren();
    refreshFacts({ category: "" });
    return;
  }

  const category = categories.find((item) => item.id === currentTab);
  renderSubtabs(category);
  refreshFacts({ category: currentTab });
}

export function renderSubtabs(category) {
  const subtabBar = element("#subtab-bar");

  if (!subtabBar) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const allButton = document.createElement("button");
  allButton.className = "subtab-item active";
  allButton.type = "button";
  allButton.dataset.subtab = "";
  allButton.textContent = "全部子类";
  fragment.appendChild(allButton);

  const subcategories = Array.isArray(category?.subcategories) ? category.subcategories : [];
  subcategories.forEach((subcategory) => {
    const value = subcategoryValue(subcategory);

    if (!value) {
      return;
    }

    const button = document.createElement("button");
    button.className = "subtab-item";
    button.type = "button";
    button.dataset.subtab = value;
    button.textContent = value;
    fragment.appendChild(button);
  });

  subtabBar.replaceChildren(fragment);

  subtabBar.querySelectorAll(".subtab-item").forEach((button) => {
    button.addEventListener("click", () => {
      currentSubtab = button.dataset.subtab || "";
      updateActiveSubtab(currentSubtab);
      refreshFacts({ category: currentTab, keyword: currentSubtab });
    });
  });
}

export function getCurrentTabQuery() {
  return {
    category: currentTab === "all" || currentTab === "graph" ? "" : currentTab,
    keyword: currentSubtab
  };
}
