const FORBIDDEN_FACT_TERMS = [
  "可能",
  "大约",
  "据说",
  "approximately",
  "about",
  "roughly",
  "reportedly"
];

function requiredCategory(category) {
  if (!category || typeof category !== "object") {
    throw new TypeError("category must be a category object.");
  }

  const id = typeof category.id === "string" ? category.id.trim() : "";
  const name = typeof category.name === "string" ? category.name.trim() : "";
  const subcategories = Array.isArray(category.subcategories)
    ? category.subcategories.filter((item) => typeof item === "string" && item.trim())
    : [];
  const keywords = Array.isArray(category.keywords)
    ? category.keywords.filter((item) => typeof item === "string" && item.trim())
    : [];

  if (!id || !name || subcategories.length === 0 || keywords.length === 0) {
    throw new TypeError("category is missing id, name, subcategories, or keywords.");
  }

  return { id, name, subcategories, keywords };
}

function formatRecentFacts(recentFacts) {
  if (!Array.isArray(recentFacts) || recentFacts.length === 0) {
    return "当前知识库没有可用于去重的近期事实。";
  }

  const lines = recentFacts
    .slice(0, 20)
    .map((item, index) => {
      const fact = typeof item?.fact === "string" ? item.fact.trim() : "";
      return fact ? `${index + 1}. ${fact}` : "";
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : "当前知识库没有可用于去重的近期事实。";
}

/**
 * Build DeepSeek prompts for a single category generation round.
 * @param {object} category One item from data/categories.json.
 * @param {object[]} recentFacts Latest stored facts used as duplicate references.
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildPrompt(category, recentFacts = []) {
  const normalizedCategory = requiredCategory(category);
  const recentFactsText = formatRecentFacts(recentFacts);
  const example = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    category: normalizedCategory.id,
    subcategory: normalizedCategory.subcategories[0],
    fact: "一条至少十个中文字符、可独立核验且表述明确的客观事实。",
    source_hint: "权威教材或机构名称",
    timestamp: 0
  };

  const systemPrompt = [
    "你是一个客观事实生成器。",
    "只能输出一个合法 JSON 数组，禁止输出 Markdown、代码围栏、解释、标题或任何数组外文字。",
    "数组必须恰好包含 10 个对象。",
    "每个对象必须严格包含 id、category、subcategory、fact、source_hint、timestamp 六个字段。",
    "fact 必须是可独立核验的客观陈述，使用准确、直接的中文，不得表达观点、预测、建议或未经证实的传闻。",
    `fact 不得包含以下模糊词：${FORBIDDEN_FACT_TERMS.join("、")}。`,
    "每条 fact 至少包含 10 个非空白字符。",
    "source_hint 只写能帮助追溯信息的权威来源提示，例如机构、教材、标准或数据库名称；不得虚构网址、DOI、页码或具体引文。",
    "id 使用 UUID 格式字符串；timestamp 使用整数时间戳。",
    "避免复述、改写或仅替换少量词语来重复给出的近期事实。"
  ].join("\n");

  const userPrompt = [
    `本轮只生成“${normalizedCategory.name}”分类的事实。`,
    `category 字段必须始终精确等于：${normalizedCategory.id}`,
    `subcategory 字段只能从以下列表中选择：${normalizedCategory.subcategories.join("、")}`,
    `优先聚焦关键词：${normalizedCategory.keywords.join("、")}`,
    "输出对象格式示例：",
    JSON.stringify(example),
    "近期事实去重参考：",
    recentFactsText,
    "再次确认：只输出恰好 10 条的 JSON 数组。"
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}
