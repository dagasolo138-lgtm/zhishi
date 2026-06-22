const REQUIRED_FIELDS = ["category", "subcategory", "fact", "source_hint", "quality_score"];
const AMBIGUOUS_TERMS = [
  "可能",
  "大约",
  "据说",
  "approximately",
  "about",
  "roughly",
  "reportedly"
];
const MIN_FACT_LENGTH = 10;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stripCodeFence(rawText) {
  return rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJSONArray(rawText) {
  const cleaned = stripCodeFence(rawText);

  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    return cleaned;
  }

  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");

  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return cleaned.slice(firstBracket, lastBracket + 1);
  }

  return cleaned;
}

function containsAmbiguousTerm(factText) {
  const normalized = factText.toLocaleLowerCase();
  return AMBIGUOUS_TERMS.find((term) => normalized.includes(term.toLocaleLowerCase())) || "";
}

function countContentCharacters(value) {
  return value.replace(/\s/g, "").length;
}

function normalizeQualityScore(value) {
  const score = Number(value);
  return Number.isInteger(score) ? score : NaN;
}

function validateItem(item, index) {
  const reasons = [];

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return {
      valid: false,
      invalid: {
        index,
        item,
        reasons: ["条目必须是对象。"]
      }
    };
  }

  const normalized = {
    ...item,
    category: text(item.category),
    subcategory: text(item.subcategory),
    leaf: text(item.leaf),
    fact: text(item.fact),
    source_hint: text(item.source_hint),
    quality_score: normalizeQualityScore(item.quality_score)
  };

  for (const field of REQUIRED_FIELDS) {
    if (field === "quality_score") {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        reasons.push(`缺少或为空的字段：${field}`);
      }
      continue;
    }

    if (!normalized[field]) {
      reasons.push(`缺少或为空的字段：${field}`);
    }
  }

  if (!Number.isInteger(normalized.quality_score) || normalized.quality_score < 1 || normalized.quality_score > 10) {
    reasons.push("quality_score 必须是 1-10 的整数。");
  } else if (normalized.quality_score < 5) {
    reasons.push("quality_score 小于 5，事实质量不足。");
  }

  if (normalized.fact) {
    if (countContentCharacters(normalized.fact) < MIN_FACT_LENGTH) {
      reasons.push(`fact 字段不得少于 ${MIN_FACT_LENGTH} 个非空白字符。`);
    }

    const ambiguousTerm = containsAmbiguousTerm(normalized.fact);
    if (ambiguousTerm) {
      reasons.push(`fact 字段包含模糊词：${ambiguousTerm}`);
    }
  }

  if (reasons.length > 0) {
    return {
      valid: false,
      invalid: {
        index,
        item,
        reasons
      }
    };
  }

  return {
    valid: true,
    item: normalized
  };
}

/**
 * Parse DeepSeek output and separate valid facts from invalid entries.
 * Accepted input is a JSON array. Markdown code fences and surrounding text are tolerated.
 * @param {string} rawText
 * @returns {{valid: object[], invalid: object[]}}
 */
export function validate(rawText) {
  const invalid = [];

  if (typeof rawText !== "string" || !rawText.trim()) {
    return {
      valid: [],
      invalid: [
        {
          index: null,
          item: rawText,
          reasons: ["模型返回内容为空。"]
        }
      ]
    };
  }

  let parsed;

  try {
    parsed = JSON.parse(extractJSONArray(rawText));
  } catch (error) {
    return {
      valid: [],
      invalid: [
        {
          index: null,
          item: rawText,
          reasons: [`JSON 解析失败：${error.message}`]
        }
      ]
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      valid: [],
      invalid: [
        {
          index: null,
          item: parsed,
          reasons: ["模型返回内容必须是 JSON 数组。"]
        }
      ]
    };
  }

  const valid = [];

  parsed.forEach((item, index) => {
    const result = validateItem(item, index);

    if (result.valid) {
      valid.push(result.item);
    } else {
      invalid.push(result.invalid);
    }
  });

  return { valid, invalid };
}
