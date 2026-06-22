const OFFICIAL_INDEX_URL = new URL("../data/official/index.json", import.meta.url);

let officialFactsCache = null;

async function fetchJSON(url, label) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`无法读取${label}：${response.status}`);
  }

  return response.json();
}

function normalizeOfficialFact(fact, category, index, timestamp) {
  return {
    id: `official_${category}_${index}`,
    category,
    subcategory: typeof fact?.subcategory === "string" ? fact.subcategory.trim() : "官方知识库",
    leaf: typeof fact?.leaf === "string" ? fact.leaf.trim() : "",
    fact: typeof fact?.fact === "string" ? fact.fact.trim() : "",
    source_hint: typeof fact?.source_hint === "string" ? fact.source_hint.trim() : "官方知识库",
    quality_score: Number.isInteger(Number(fact?.quality_score)) ? Number(fact.quality_score) : 10,
    timestamp,
    source_type: "official"
  };
}

async function readOfficialFacts() {
  const timestamp = Date.now();
  const indexData = await fetchJSON(OFFICIAL_INDEX_URL, "官方知识库索引");

  if (!Array.isArray(indexData.files)) {
    throw new Error("官方知识库索引格式错误。");
  }

  const fileFacts = await Promise.all(indexData.files.map(async (fileName) => {
    const fileUrl = new URL(fileName, OFFICIAL_INDEX_URL);
    const fileData = await fetchJSON(fileUrl, `官方知识库文件 ${fileName}`);
    const category = typeof fileData.category === "string" ? fileData.category.trim() : "";

    if (!category || !Array.isArray(fileData.facts)) {
      return [];
    }

    return fileData.facts
      .map((fact, index) => normalizeOfficialFact(fact, category, index, timestamp))
      .filter((fact) => fact.fact && fact.category && fact.subcategory && fact.source_hint);
  }));

  return fileFacts.flat();
}

export function loadOfficialFacts() {
  if (!officialFactsCache) {
    officialFactsCache = readOfficialFacts();
  }

  return officialFactsCache;
}
