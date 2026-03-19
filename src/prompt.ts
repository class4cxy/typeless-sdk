/**
 * System prompt builder — ported from src-tauri/src/llm/prompt.rs
 *
 * Builds the LLM system prompt dynamically based on context:
 * - App type (email / chat / document / general)
 * - Custom vocabulary / dictionary terms
 * - Translation target language
 */

export type AppType = "email" | "chat" | "code" | "document" | "general";

/**
 * A vocabulary entry with an optional list of phonetic aliases.
 *
 * Use `soundsLike` to list the approximate spellings that the STT engine may
 * produce for this term. The LLM will replace any matching alias in the
 * transcript with the canonical `term`.
 *
 * @example
 * { term: 'OpenTypeless', soundsLike: ['open type less', 'opentypeless'] }
 * { term: 'Tauri',        soundsLike: ['towery', 'tori'] }
 */
export interface VocabularyEntry {
  /** The exact term as it must appear in the output */
  term: string;
  /**
   * Phonetic approximations or alternate spellings the STT engine may produce.
   * The LLM will treat any of these as a match and replace with `term`.
   */
  soundsLike?: string[];
}

const BASE_PROMPT = `You are a voice-to-text assistant. Transform raw speech transcription into clean, polished text that reads as if it were typed — not transcribed.

Rules:
1. PUNCTUATION: Add appropriate punctuation (commas, periods, colons, question marks) where the speech pauses or clauses naturally end. This is the most important rule — raw transcription has no punctuation.
2. CLEANUP: Remove filler words (um, uh, 嗯, 那个, 就是说, like, you know), false starts, and repetitions.
3. LISTS: When the user enumerates items (signaled by words like 第一/第二, 首先/然后/最后, 一是/二是, first/second/third, etc.), format as a numbered list. CRITICAL: each list item MUST be on its own line.
4. PARAGRAPHS: When the speech covers multiple distinct topics, separate them with a blank line. Do NOT split a single flowing thought into multiple paragraphs.
5. Preserve the user's language (including mixed languages), all substantive content, technical terms, and proper nouns exactly. Do NOT add any words, phrases, or content that were not present in the original speech.
6. Output ONLY the processed text. No explanations, no quotes around output. Do not end the output with a terminal period (. or 。). Be consistent: do not mix formatting styles or punctuation conventions.

Examples:

Input: "我觉得这个方案还不错就是价格有点贵"
Output: 我觉得这个方案还不错，就是价格有点贵

Input: "today I had a meeting with the team we discussed the project timeline and the budget"
Output: Today I had a meeting with the team. We discussed the project timeline and the budget

Input: "首先我们需要买牛奶然后要去洗衣服最后记得写代码"
Output:
1. 买牛奶
2. 去洗衣服
3. 记得写代码

Input: "今天开会讨论了三个事情一是项目进度二是预算问题三是人员安排"
Output:
今天开会讨论了三个事情：
1. 项目进度
2. 预算问题
3. 人员安排

Input: "嗯那个就是说我们这个项目的话进展还是比较顺利的然后预算方面的话也没有超支"
Output: 我们这个项目进展比较顺利，预算方面也没有超支`;

const EMAIL_ADDON =
  "\nContext: Email. Use formal tone, complete sentences. Preserve salutations and sign-offs if present.";
const CHAT_ADDON =
  "\nContext: Chat/IM. Keep it casual and concise. Short sentences. For lists, use simple line breaks instead of Markdown. No over-formatting.";
const DOCUMENT_ADDON =
  "\nContext: Document editor. Use clear paragraph structure. Markdown headings and lists are encouraged for organization.";

const LANG_NAMES: Record<string, string> = {
  en: "English",
  zh: "Chinese (中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  es: "Spanish (Español)",
  pt: "Portuguese (Português)",
  ru: "Russian (Русский)",
  ar: "Arabic (العربية)",
  hi: "Hindi (हिन्दी)",
  th: "Thai (ไทย)",
  vi: "Vietnamese (Tiếng Việt)",
  it: "Italian (Italiano)",
  nl: "Dutch (Nederlands)",
  tr: "Turkish (Türkçe)",
  pl: "Polish (Polski)",
  uk: "Ukrainian (Українська)",
  id: "Indonesian (Bahasa Indonesia)",
  ms: "Malay (Bahasa Melayu)",
};

export interface BuildPromptOptions {
  /** Context type — affects tone and formatting style. Default: 'general' */
  appType?: AppType;
  /**
   * Custom vocabulary terms the LLM must use with exact spelling.
   * Accepts plain strings or `VocabularyEntry` objects with optional
   * `soundsLike` aliases — phonetic approximations the STT may produce.
   *
   * @example
   * vocabulary: [
   *   { term: 'OpenTypeless', soundsLike: ['open type less', 'opentypeless'] },
   *   { term: 'Tauri', soundsLike: ['towery'] },
   *   'KPI',
   * ]
   */
  vocabulary?: (string | VocabularyEntry)[];
  /** Whether to translate the output. Requires targetLang. */
  translateEnabled?: boolean;
  /** BCP-47 language code for translation target (e.g. 'en', 'zh', 'ja') */
  targetLang?: string;
}

/**
 * Build the LLM system prompt for voice-to-text polishing.
 *
 * @example
 * const prompt = buildSystemPrompt({
 *   appType: 'chat',
 *   vocabulary: ['OpenTypeless', 'Tauri'],
 *   translateEnabled: true,
 *   targetLang: 'en',
 * });
 */
export function buildSystemPrompt(options: BuildPromptOptions = {}): string {
  const {
    appType = "general",
    vocabulary = [],
    translateEnabled = false,
    targetLang = "",
  } = options;

  let prompt = BASE_PROMPT;

  switch (appType) {
    case "email":
      prompt += EMAIL_ADDON;
      break;
    case "chat":
      prompt += CHAT_ADDON;
      break;
    case "document":
      prompt += DOCUMENT_ADDON;
      break;
  }

  if (vocabulary.length > 0) {
    prompt += `\n\nVOCABULARY CORRECTION (highest priority — applies before all other rules):
The transcript may contain phonetic approximations or misspellings of technical terms. Scan the entire transcript and replace any word or phrase that matches — exactly or phonetically — one of the terms below with the canonical spelling given. Do this even when the match is only approximate.`;
    for (const entry of vocabulary) {
      if (typeof entry === "string") {
        prompt += `\n- "${entry}"`;
      } else {
        const aliases =
          entry.soundsLike && entry.soundsLike.length > 0
            ? ` (transcript may show: ${entry.soundsLike.map((s) => `"${s}"`).join(", ")})`
            : "";
        prompt += `\n- "${entry.term}"${aliases}`;
      }
    }
  }

  const trimmedLang = targetLang.trim();
  if (translateEnabled && trimmedLang) {
    const langName = LANG_NAMES[trimmedLang] ?? trimmedLang;
    prompt += `\n\nAFTER cleaning the text, translate the entire result into ${langName}. Output ONLY the translated text.`;
  }

  return prompt;
}
