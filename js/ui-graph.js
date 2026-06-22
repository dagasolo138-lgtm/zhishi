import { getAllFacts } from "./storage.js";

const CUSTOM_CATEGORIES_KEY = "zhishi_custom_categories";
const GRAPH_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#c084fc"
];
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
  "其"
]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readCustomCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function mergeCategories(baseCategories, customCategories) {
  const categoryMap = new Map();

  for (const category of [...baseCategories, ...customCategories]) {
    const id = normalizeText(category?.id);

    if (!id) {
      continue;
    }

    categoryMap.set(id, {
      ...categoryMap.get(id),
      ...category,
      id,
      name: normalizeText(category.name) || id,
      subcategories: Array.isArray(category.subcategories) ? category.subcategories : []
    });
  }

  return [...categoryMap.values()];
}

function extractKeywords(text) {
  const normalized = normalizeText(text)
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  return [...new Set(normalized
    .split(/\s+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !KEYWORD_STOP_WORDS.has(word)))];
}

function keywordSetForFacts(facts) {
  const keywords = new Set();

  for (const fact of facts) {
    for (const keyword of extractKeywords(fact.fact)) {
      keywords.add(keyword);
    }
  }

  return keywords;
}

function getOverlapSize(leftSet, rightSet) {
  let count = 0;

  for (const keyword of leftSet) {
    if (rightSet.has(keyword)) {
      count += 1;
    }
  }

  return count;
}

export function buildGraphData(facts, categories) {
  const nodes = [];
  const links = [];
  const subcategoryKeywordSets = [];

  for (const category of categories) {
    const categoryFacts = facts.filter((fact) => fact.category === category.id);

    nodes.push({
      id: category.id,
      name: category.name,
      type: "category",
      count: categoryFacts.length
    });

    for (const sub of category.subcategories || []) {
      const subcategoryName = normalizeText(sub.name);

      if (!subcategoryName) {
        continue;
      }

      const subcategoryFacts = categoryFacts.filter((fact) => fact.subcategory === subcategoryName || fact.subcategory === sub.id);
      const subcategoryId = `${category.id}_${subcategoryName}`;

      nodes.push({
        id: subcategoryId,
        name: subcategoryName,
        type: "subcategory",
        categoryId: category.id,
        count: subcategoryFacts.length
      });
      links.push({
        source: category.id,
        target: subcategoryId,
        type: "parent",
        weight: 1
      });
      subcategoryKeywordSets.push({ id: subcategoryId, keywords: keywordSetForFacts(subcategoryFacts) });
    }
  }

  for (let leftIndex = 0; leftIndex < subcategoryKeywordSets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < subcategoryKeywordSets.length; rightIndex += 1) {
      const weight = getOverlapSize(subcategoryKeywordSets[leftIndex].keywords, subcategoryKeywordSets[rightIndex].keywords);

      if (weight >= 2) {
        links.push({
          source: subcategoryKeywordSets[leftIndex].id,
          target: subcategoryKeywordSets[rightIndex].id,
          type: "overlap",
          weight
        });
      }
    }
  }

  return { nodes, links };
}

function getCssValue(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function getNodeColor(node, categories) {
  const categoryId = node.type === "category" ? node.id : node.categoryId;
  const categoryIndex = Math.max(0, categories.findIndex((category) => category.id === categoryId));
  return GRAPH_COLORS[categoryIndex % GRAPH_COLORS.length];
}

function createRadiusScale(nodes, type, range) {
  const counts = nodes.filter((node) => node.type === type).map((node) => node.count);
  const maxCount = Math.max(1, ...counts);
  return d3.scaleSqrt().domain([0, maxCount]).range(range);
}

function getLinkedNodeIds(nodeId, links) {
  const linkedNodeIds = new Set([nodeId]);

  for (const link of links) {
    const sourceId = typeof link.source === "object" ? link.source.id : link.source;
    const targetId = typeof link.target === "object" ? link.target.id : link.target;

    if (sourceId === nodeId) {
      linkedNodeIds.add(targetId);
    }

    if (targetId === nodeId) {
      linkedNodeIds.add(sourceId);
    }
  }

  return linkedNodeIds;
}

export async function initGraph(onCategoryClick) {
  const container = document.querySelector("#graph-container");
  const svgElement = document.querySelector("#graph-svg");

  if (!container || !svgElement || !window.d3) {
    return;
  }

  const [facts, categoriesResponse] = await Promise.all([
    getAllFacts(),
    fetch("./data/categories.json")
  ]);
  const baseCategories = await categoriesResponse.json();
  const categories = mergeCategories(baseCategories, readCustomCategories());
  const graphData = buildGraphData(facts, categories);
  const width = container.clientWidth || 960;
  const height = container.clientHeight || 560;
  const categoryRadius = createRadiusScale(graphData.nodes, "category", [20, 50]);
  const subcategoryRadius = createRadiusScale(graphData.nodes, "subcategory", [8, 20]);
  const lineColor = getCssValue("--line", "rgba(255,255,255,0.12)");

  d3.select(svgElement).selectAll("*").remove();

  const svg = d3.select(svgElement)
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", "知识图谱分类与事实数量分布");
  const viewport = svg.append("g");
  const link = viewport.append("g")
    .selectAll("line")
    .data(graphData.links)
    .join("line")
    .attr("class", "graph-link")
    .attr("stroke", (item) => item.type === "parent" ? lineColor : "rgba(255,255,255,0.15)")
    .attr("stroke-width", (item) => item.type === "parent" ? 1 : Math.min(4, Math.max(1, item.weight)));
  const node = viewport.append("g")
    .selectAll("g")
    .data(graphData.nodes)
    .join("g")
    .attr("class", "graph-node")
    .on("click", (event, item) => {
      event.stopPropagation();
      onCategoryClick?.(item.type === "category" ? item.id : item.categoryId);
    })
    .on("mouseenter", (event, item) => {
      const linkedNodeIds = getLinkedNodeIds(item.id, graphData.links);
      node.attr("opacity", (nodeItem) => linkedNodeIds.has(nodeItem.id) ? 1 : 0.2);
      link.attr("opacity", (linkItem) => {
        const sourceId = typeof linkItem.source === "object" ? linkItem.source.id : linkItem.source;
        const targetId = typeof linkItem.target === "object" ? linkItem.target.id : linkItem.target;
        return sourceId === item.id || targetId === item.id ? 1 : 0.12;
      });
    })
    .on("mouseleave", () => {
      node.attr("opacity", 1);
      link.attr("opacity", 1);
    });

  node.append("circle")
    .attr("r", (item) => item.type === "category" ? categoryRadius(item.count) : subcategoryRadius(item.count))
    .attr("fill", (item) => getNodeColor(item, categories))
    .attr("fill-opacity", (item) => item.type === "category" ? 1 : 0.7);
  node.append("text")
    .attr("class", "graph-count")
    .text((item) => item.count);
  node.append("text")
    .attr("class", "graph-label")
    .attr("dy", (item) => (item.type === "category" ? categoryRadius(item.count) : subcategoryRadius(item.count)) + 14)
    .text((item) => item.name);

  const simulation = d3.forceSimulation(graphData.nodes)
    .force("link", d3.forceLink(graphData.links).id((item) => item.id).distance((item) => item.type === "parent" ? 110 : 170).strength(0.35))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((item) => (item.type === "category" ? categoryRadius(item.count) : subcategoryRadius(item.count)) + 22));

  const drag = d3.drag()
    .on("start", (event, item) => {
      if (!event.active) {
        simulation.alphaTarget(0.3).restart();
      }

      item.fx = item.x;
      item.fy = item.y;
    })
    .on("drag", (event, item) => {
      item.fx = event.x;
      item.fy = event.y;
    })
    .on("end", (event, item) => {
      if (!event.active) {
        simulation.alphaTarget(0);
      }

      item.fx = null;
      item.fy = null;
    });

  node.call(drag);
  svg.call(d3.zoom().scaleExtent([0.35, 4]).on("zoom", (event) => viewport.attr("transform", event.transform)));

  simulation.on("tick", () => {
    link
      .attr("x1", (item) => item.source.x)
      .attr("y1", (item) => item.source.y)
      .attr("x2", (item) => item.target.x)
      .attr("y2", (item) => item.target.y);
    node.attr("transform", (item) => `translate(${item.x},${item.y})`);
  });
}
