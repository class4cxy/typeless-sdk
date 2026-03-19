/**
 * LLM polishing module — OpenAI-compatible chat completions.
 *
 * Ported from src-tauri/src/llm/openai.rs
 *
 * Supports any OpenAI-compatible provider — endpoint is fully specified by the
 * caller, nothing is hard-coded here.
 *
 * Common base URLs:
 *   OpenAI      → https://api.openai.com/v1
 *   DeepSeek    → https://api.deepseek.com
 *   Groq        → https://api.groq.com/openai/v1
 *   Gemini      → https://generativelanguage.googleapis.com/v1beta/openai
 *   Ollama      → http://localhost:11434/v1
 *   OpenRouter  → https://openrouter.ai/api/v1
 *   GLM         → https://open.bigmodel.cn/api/paas/v4
 *   SiliconFlow → https://api.siliconflow.cn/v1
 *
 * Features:
 *   - Custom vocabulary injection into system prompt
 *   - Streaming mode via onChunk callback
 *   - GLM thinking-mode handling (reasoning_content fallback)
 *   - Translation support
 *
 * Requires Node.js >= 18 (native fetch).
 */

import { buildSystemPrompt, type AppType, type BuildPromptOptions } from "./prompt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { AppType } from "./prompt.js";

export interface LlmConfig {
  /** OpenAI-compatible API base URL (e.g. 'https://api.openai.com/v1') */
  baseUrl: string;
  /** Provider API key */
  apiKey: string;
  /** Model name (e.g. 'gpt-4o', 'deepseek-chat', 'glm-4-flash') */
  model: string;
  /** Maximum tokens to generate. Default: 4096 */
  maxTokens?: number;
  /** Sampling temperature (0–2). Default: 0.3 */
  temperature?: number;
  /** Request timeout in milliseconds. Default: 60_000 */
  timeoutMs?: number;
}

export interface PolishOptions extends BuildPromptOptions {
  /**
   * Called with each streamed token chunk.
   * When provided, the request runs in streaming mode (SSE).
   */
  onChunk?: (chunk: string) => void;
}

// ---------------------------------------------------------------------------
// Streaming SSE parser
// ---------------------------------------------------------------------------

interface StreamDelta {
  content?: string;
  reasoning_content?: string;
}

interface StreamEvent {
  choices?: Array<{ delta?: StreamDelta }>;
}

async function parseStreamingResponse(
  response: Response,
  onChunk: (chunk: string) => void,
): Promise<string> {
  if (!response.body) {
    throw new Error("LLM streaming: response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let reasoningText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let lineEnd: number;
      while ((lineEnd = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6);
        if (data === "[DONE]") break;

        let event: StreamEvent;
        try {
          event = JSON.parse(data) as StreamEvent;
        } catch {
          continue;
        }

        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullText += delta.content;
          onChunk(delta.content);
        }

        // GLM thinking-mode: output may land exclusively in reasoning_content
        if (delta.reasoning_content) {
          reasoningText += delta.reasoning_content;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullText && reasoningText) {
    onChunk(reasoningText);
    fullText = reasoningText;
  }

  if (!fullText) {
    throw new Error("LLM streaming returned no content");
  }

  return fullText;
}

// ---------------------------------------------------------------------------
// Core polish function
// ---------------------------------------------------------------------------

/**
 * Polish raw transcript text using an OpenAI-compatible LLM.
 *
 * @param rawText  - Raw transcript from STT
 * @param config   - LLM provider configuration
 * @param options  - Polishing options (vocabulary, translation, streaming, etc.)
 * @returns Polished text
 *
 * @example
 * // Non-streaming
 * const polished = await polishText(transcript, {
 *   provider: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-4o-mini',
 * }, {
 *   vocabulary: ['Tauri'],
 *   appType: 'chat',
 * });
 *
 * @example
 * // Streaming
 * const polished = await polishText(transcript, config, {
 *   onChunk: (chunk) => process.stdout.write(chunk),
 * });
 */
export async function polishText(
  rawText: string,
  config: LlmConfig,
  options: PolishOptions = {},
): Promise<string> {
  const { onChunk, ...promptOptions } = options;
  const isStreaming = typeof onChunk === "function";

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const maxTokens = config.maxTokens ?? 4096;
  const timeoutMs = config.timeoutMs ?? 60_000;

  const systemPrompt = buildSystemPrompt(promptOptions);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: rawText },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature: config.temperature ?? 0.3,
    stream: isStreaming,
  };

  // GLM thinking-mode models (glm-4.7, glm-4.5, glm-z1, etc.) require explicit
  // opt-in and a fixed temperature. Standard models like glm-4-flash do not.
  const GLM_THINKING_PREFIXES = ["glm-4.7", "glm-4.5", "glm-z1"];
  if (GLM_THINKING_PREFIXES.some((prefix) => config.model.startsWith(prefix))) {
    body["thinking"] = { type: "enabled" };
    body["temperature"] = 1.0;
    body["top_p"] = 0.95;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `LLM HTTP ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  if (isStreaming) {
    return parseStreamingResponse(response, onChunk!);
  }

  // Non-streaming
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const polished = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!polished) {
    throw new Error("LLM returned empty content");
  }

  return polished;
}
