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
    ? category.subcategories
        .map((item) => {
          if (typeof item === "string") {
            const name = item.trim();
            return name ? { name, leaves: [] } : null;
          }

          if (!item || typeof item !== "object") {
            return null;
          }

          const name = typeof item.name === "string" ? item.name.trim() : "";
          const leaves = Array.isArray(item.leaves)
            ? item.leaves.filter((leaf) => typeof leaf === "string" && leaf.trim())
            : [];
          return name ? { name, leaves } : null;
        })
        .filter(Boolean)
    : [];
  const keywords = Array.isArray(category.keywords)
    ? category.keywords.filter((item) => typeof item === "string" && item.trim())
    : [];

  if (!id || !name || subcategories.length === 0 || keywords.length === 0) {
    throw new TypeError("category is missing id, name, subcategories, or keywords.");
  }

  return { id, name, subcategories, keywords };
}

/**
 * Build DeepSeek prompts for a single category generation round.
 * The local storage layer assigns record ids and timestamps after validation.
 * @param {object} category One item from data/categories.json.
 * @param {string} recentKeywords Compact keywords from latest stored facts used as duplicate references.
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildPrompt(category, recentKeywords = "") {
  const normalizedCategory = requiredCategory(category);
  const recentKeywordsText = typeof recentKeywords === "string" && recentKeywords.trim()
    ? recentKeywords.trim()
    : "当前知识库没有可用于去重的近期关键词。";
  const example = {
    category: normalizedCategory.id,
    subcategory: normalizedCategory.subcategories[0].name,
    leaf: normalizedCategory.subcategories[0].leaves[0] || "",
    fact: "一条至少十个中文字符、可独立核验且表述明确的客观事实。",
    source_hint: "权威教材或机构名称",
    quality_score: 8
  };

  const systemPrompt = [
    "你是一个客观事实生成器。",
    "只能输出一个合法 JSON 数组，禁止输出 Markdown、代码围栏、解释、标题或任何数组外文字。",
    "数组必须恰好包含 10 个对象。",
    "每个对象必须且只能包含 category、subcategory、leaf、fact、source_hint、quality_score 六个字段。",
    "记录 id 和 timestamp 由本地程序生成，禁止输出这两个字段。",
    "fact 必须是可独立核验的客观陈述，使用准确、直接的中文，不得表达观点、预测、建议或未经证实的传闻。",
    `fact 不得包含以下模糊词：${FORBIDDEN_FACT_TERMS.join("、")}。`,
    "每条 fact 至少包含 10 个非空白字符。",
    "source_hint 只写能帮助追溯信息的权威来源提示，例如机构、教材、标准或数据库名称；不得虚构网址、DOI、页码或具体引文。",
    "quality_score 必须是 1-10 的整数，表示该事实的可信度与信息密度。",
    "quality_score 评分标准：10 = 精确、可独立核验、信息密度高；7-9 = 准确但较宽泛；4-6 = 模糊或信息量低；1-3 = 不应出现，validator 会过滤。",
    "避免复述、改写或仅替换少量词语来重复给出的近期事实。"
  ].join("\n");

  const userPrompt = [
    `本轮只生成“${normalizedCategory.name}”分类的事实。`,
    `category 字段必须始终精确等于：${normalizedCategory.id}`,
    `subcategory 字段只能从以下列表中选择：${normalizedCategory.subcategories.map((item) => item.name).join("、")}`,
    `leaf 字段必须从当前 subcategory 对应的 leaves 数组中选择；若无匹配子类则留空字符串。子类与细分类对应关系：${normalizedCategory.subcategories.map((item) => `${item.name}：${item.leaves.join("、") || "（无）"}`).join("；")}`,
    `优先聚焦关键词：${normalizedCategory.keywords.join("、")}`,
    "输出对象格式示例：",
    JSON.stringify(example),
    "近期已生成关键词（避免重复这些概念）：",
    recentKeywordsText,
    "再次确认：只输出恰好 10 条的 JSON 数组。"
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}
