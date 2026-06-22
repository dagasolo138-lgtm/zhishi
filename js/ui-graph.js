import { getAllFacts } from "./storage.js";
import { loadSettings } from "./settings-store.js";

const STOP_WORDS = new Set([
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

let activeSimulation = null;

const CATEGORY_COLORS = [
  "#7dd3fc",
  "#a78bfa",
  "#f9a8d4",
  "#86efac",
  "#fde68a",
  "#fca5a5",
  "#67e8f9",
  "#c4b5fd"
];

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractKeywords(text) {
  return normalizeText(text)
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .split(/\s+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function readCategoryBadgeColor(categoryId) {
  const probe = document.createElement("span");
  probe.className = `category-badge category-badge--${categoryId || "uncategorized"}`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);

  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function createCategoryColorMap(categories) {
  return new Map(categories.map((category, index) => {
    const badgeColor = readCategoryBadgeColor(category.id);
    return [category.id, badgeColor || CATEGORY_COLORS[index % CATEGORY_COLORS.length]];
  }));
}

function getFactCategory(fact) {
  return normalizeText(fact?.category);
}

function getFactSubcategory(fact) {
  return normalizeText(fact?.subcategory);
}

function countFactsByCategory(facts, categoryId) {
  return facts.filter((fact) => getFactCategory(fact) === categoryId).length;
}

function countFactsBySubcategory(facts, categoryId, subcategoryName) {
  return facts.filter((fact) => (
    getFactCategory(fact) === categoryId && getFactSubcategory(fact) === subcategoryName
  )).length;
}

function getSubcategoryKeywords(facts, categoryId, subcategoryName) {
  const keywords = new Set();

  facts
    .filter((fact) => getFactCategory(fact) === categoryId && getFactSubcategory(fact) === subcategoryName)
    .forEach((fact) => {
      extractKeywords(fact.fact).forEach((keyword) => keywords.add(keyword));
    });

  return keywords;
}

function getOverlapCount(leftKeywords, rightKeywords) {
  let count = 0;

  leftKeywords.forEach((keyword) => {
    if (rightKeywords.has(keyword)) {
      count += 1;
    }
  });

  return count;
}

function getNodeRadius(node) {
  const [min, max] = node.type === "category" ? [20, 50] : [8, 20];
  const scaled = min + Math.sqrt(Math.max(0, node.count)) * (node.type === "category" ? 4 : 2);
  return Math.min(max, Math.max(min, scaled));
}

function mergeCategories(categories, customCategories) {
  const merged = [...categories];
  const existingIds = new Set(merged.map((category) => category.id));

  customCategories.forEach((category) => {
    if (category?.id && !existingIds.has(category.id)) {
      merged.push(category);
      existingIds.add(category.id);
    }
  });

  return merged;
}

function buildGraphData(facts, categories) {
  const nodes = [];
  const links = [];
  const subcategoryNodes = [];

  categories.forEach((category) => {
    const categoryId = normalizeText(category.id);
    const subcategories = Array.isArray(category.subcategories) ? category.subcategories : [];

    if (!categoryId) {
      return;
    }

    nodes.push({
      id: categoryId,
      name: normalizeText(category.name) || categoryId,
      type: "category",
      count: countFactsByCategory(facts, categoryId)
    });

    subcategories.forEach((sub) => {
      const subcategoryName = normalizeText(sub.name || sub.id);

      if (!subcategoryName) {
        return;
      }

      const subcategoryNode = {
        id: `${categoryId}_${subcategoryName}`,
        name: subcategoryName,
        type: "subcategory",
        categoryId,
        count: countFactsBySubcategory(facts, categoryId, subcategoryName),
        keywords: getSubcategoryKeywords(facts, categoryId, subcategoryName)
      };

      nodes.push(subcategoryNode);
      subcategoryNodes.push(subcategoryNode);
      links.push({ source: categoryId, target: subcategoryNode.id, type: "parent", weight: 1 });
    });
  });

  for (let index = 0; index < subcategoryNodes.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < subcategoryNodes.length; nextIndex += 1) {
      const left = subcategoryNodes[index];
      const right = subcategoryNodes[nextIndex];
      const weight = getOverlapCount(left.keywords, right.keywords);

      if (weight >= 2) {
        links.push({ source: left.id, target: right.id, type: "keyword", weight });
      }
    }
  }

  return {
    nodes: nodes.map(({ keywords, ...node }) => node),
    links
  };
}

function getConnectedIds(node, links) {
  const connected = new Set([node.id]);

  links.forEach((link) => {
    const sourceId = typeof link.source === "object" ? link.source.id : link.source;
    const targetId = typeof link.target === "object" ? link.target.id : link.target;

    if (sourceId === node.id) {
      connected.add(targetId);
    }

    if (targetId === node.id) {
      connected.add(sourceId);
    }
  });

  return connected;
}

function drag(simulation, d3Instance) {
  function dragstarted(event) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragended(event) {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  return d3Instance.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
}

function renderGraph(graphData, onCategoryClick) {
  const d3Instance = window.d3;

  if (activeSimulation) {
    activeSimulation.stop();
  }

  const svg = d3Instance.select("#graph-svg");
  const container = document.querySelector("#graph-container");
  const width = container?.clientWidth || 960;
  const height = container?.clientHeight || 640;
  const colorMap = createCategoryColorMap(graphData.nodes.filter((node) => node.type === "category"));

  svg.selectAll("*").remove();
  svg.attr("viewBox", [0, 0, width, height]);

  const viewport = svg.append("g");
  const link = viewport
    .append("g")
    .selectAll("line")
    .data(graphData.links)
    .join("line")
    .attr("class", "graph-link")
    .attr("stroke", (item) => (item.type === "parent" ? "var(--line)" : "rgba(255,255,255,0.15)"))
    .attr("stroke-width", (item) => (item.type === "parent" ? 1 : Math.min(4, Math.max(1, item.weight))));

  const node = viewport
    .append("g")
    .selectAll("g")
    .data(graphData.nodes)
    .join("g")
    .attr("class", "graph-node")
    .on("click", (event, item) => {
      event.stopPropagation();
      onCategoryClick(item.type === "category" ? item.id : item.categoryId);
    });

  node
    .append("circle")
    .attr("r", getNodeRadius)
    .attr("fill", (item) => colorMap.get(item.type === "category" ? item.id : item.categoryId) || CATEGORY_COLORS[0])
    .attr("fill-opacity", (item) => (item.type === "category" ? 1 : 0.7));

  node
    .append("text")
    .attr("class", "graph-count")
    .text((item) => item.count);

  node
    .append("text")
    .attr("class", "graph-label")
    .attr("dy", (item) => getNodeRadius(item) + 14)
    .text((item) => item.name);

  const simulation = d3Instance.forceSimulation(graphData.nodes)
    .force("link", d3Instance.forceLink(graphData.links).id((item) => item.id).distance((item) => (item.type === "parent" ? 110 : 170)))
    .force("charge", d3Instance.forceManyBody().strength(-260))
    .force("center", d3Instance.forceCenter(width / 2, height / 2))
    .force("collision", d3Instance.forceCollide().radius((item) => getNodeRadius(item) + 26));

  activeSimulation = simulation;
  node.call(drag(simulation, d3Instance));

  node
    .on("mouseenter", (event, item) => {
      const connectedIds = getConnectedIds(item, graphData.links);
      node.attr("opacity", (target) => (connectedIds.has(target.id) ? 1 : 0.22));
      link.attr("opacity", (target) => {
        const sourceId = typeof target.source === "object" ? target.source.id : target.source;
        const targetId = typeof target.target === "object" ? target.target.id : target.target;
        return sourceId === item.id || targetId === item.id ? 1 : 0.12;
      });
    })
    .on("mouseleave", () => {
      node.attr("opacity", 1);
      link.attr("opacity", 1);
    });

  svg.call(d3Instance.zoom().scaleExtent([0.35, 3]).on("zoom", (event) => {
    viewport.attr("transform", event.transform);
  }));

  simulation.on("tick", () => {
    link
      .attr("x1", (item) => item.source.x)
      .attr("y1", (item) => item.source.y)
      .attr("x2", (item) => item.target.x)
      .attr("y2", (item) => item.target.y);

    node.attr("transform", (item) => `translate(${item.x},${item.y})`);
  });
}

async function loadCategories() {
  const response = await fetch("./data/categories.json");
  const categories = await response.json();
  const { customCategories } = loadSettings();

  return mergeCategories(categories, customCategories);
}

export async function initGraph(onCategoryClick) {
  if (!window.d3) {
    throw new Error("D3.js is not loaded.");
  }

  const [facts, categories] = await Promise.all([
    getAllFacts(),
    loadCategories()
  ]);

  renderGraph(buildGraphData(facts, categories), onCategoryClick);
}
