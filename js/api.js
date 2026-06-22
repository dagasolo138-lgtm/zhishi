const API_URL = "https://api.deepseek.com/chat/completions";
const API_KEY_STORAGE_KEY = "zhishi_deepseek_api_key";
const MODEL = "deepseek-v4-flash";

function requiredText(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function readApiKey() {
  return (localStorage.getItem(API_KEY_STORAGE_KEY) || "").trim();
}

function callSafely(callback, value) {
  if (typeof callback === "function") {
    callback(value);
  }
}

function createApiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function buildApiError(response) {
  const fallback = `DeepSeek API request failed with status ${response.status}.`;
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const message = payload?.error?.message || payload?.message;
      return createApiError(message || fallback, response.status);
    }

    const text = await response.text();
    return createApiError(text.trim() || fallback, response.status);
  } catch {
    return createApiError(fallback, response.status);
  }
}

function getSSEData(eventBlock) {
  return eventBlock
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

function parseEventBlock(eventBlock) {
  const data = getSSEData(eventBlock);

  if (!data) {
    return { done: false, content: "" };
  }

  if (data === "[DONE]") {
    return { done: true, content: "" };
  }

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new Error("DeepSeek returned an unreadable SSE JSON chunk.");
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice?.delta?.content ?? choice?.message?.content ?? "";

  return {
    done: false,
    content: typeof content === "string" ? content : ""
  };
}

/**
 * Report whether this browser has a non-empty DeepSeek API Key saved locally.
 * @returns {boolean}
 */
export function hasConfiguredApiKey() {
  return Boolean(readApiKey());
}

/**
 * Call DeepSeek Chat Completions through a streaming SSE response.
 * `onChunk` receives each text delta. `onDone` receives the assembled final text.
 * @param {object} options
 * @param {string} options.systemPrompt
 * @param {string} options.userPrompt
 * @param {(chunk: string) => void} [options.onChunk]
 * @param {(fullText: string) => void} [options.onDone]
 * @param {(error: Error) => void} [options.onError]
 * @returns {Promise<string>}
 */
export async function streamGenerate({
  systemPrompt,
  userPrompt,
  onChunk,
  onDone,
  onError
} = {}) {
  try {
    const systemContent = requiredText(systemPrompt, "systemPrompt");
    const userContent = requiredText(userPrompt, "userPrompt");
    const apiKey = readApiKey();

    if (!apiKey) {
      throw new Error("未配置 DeepSeek API Key，请先在设置面板保存 API Key。");
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent }
        ]
      })
    });

    if (!response.ok) {
      throw await buildApiError(response);
    }

    if (!response.body) {
      throw new Error("浏览器未提供可读取的流式响应。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";
    let streamEnded = false;

    const consumeEvent = (eventBlock) => {
      if (!eventBlock.trim() || streamEnded) {
        return;
      }

      const event = parseEventBlock(eventBlock);

      if (event.done) {
        streamEnded = true;
        return;
      }

      if (event.content) {
        fullText += event.content;
        callSafely(onChunk, event.content);
      }
    };

    while (!streamEnded) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const eventBlock = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        consumeEvent(eventBlock);
        separatorIndex = buffer.indexOf("\n\n");
      }

      if (done) {
        const finalBlock = buffer + decoder.decode();
        consumeEvent(finalBlock);
        break;
      }
    }

    if (!fullText.trim()) {
      throw new Error("DeepSeek 未返回可用文本。");
    }

    callSafely(onDone, fullText);
    return fullText;
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    callSafely(onError, normalizedError);
    throw normalizedError;
  }
}
