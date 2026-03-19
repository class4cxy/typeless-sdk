/**
 * typeless-sdk
 *
 * Convert audio files to polished text using STT + LLM.
 *
 * Pipeline:  audio file  →  STT (file upload)  →  LLM polish (+ vocabulary)  →  clean text
 *
 * Quick start:
 * ```ts
 * import { VoiceTextSDK } from 'typeless-sdk';
 *
 * const sdk = new VoiceTextSDK({
 *   stt: {
 *     endpoint: 'https://api.openai.com/v1/audio/transcriptions',
 *     model: 'whisper-1',
 *     apiKey: process.env.OPENAI_API_KEY!,
 *   },
 *   llm: {
 *     baseUrl: 'https://api.openai.com/v1',
 *     apiKey: process.env.OPENAI_API_KEY!,
 *     model: 'gpt-4o-mini',
 *   },
 * });
 *
 * const { transcript, polishedText } = await sdk.process('/path/to/recording.m4a', {
 *   vocabulary: ['OpenTypeless', 'Tauri'],
 *   language: 'zh',
 * });
 * ```
 *
 * Requires Node.js >= 18.
 */

// Re-export everything for consumers who want fine-grained control
export { buildSystemPrompt } from "./prompt";
export type { AppType, BuildPromptOptions } from "./prompt";

export { transcribeAudio } from "./stt";
export type { SttConfig, SttAdapter } from "./stt";

export { polishText } from "./llm";
export type { LlmConfig, PolishOptions } from "./llm";

// ---------------------------------------------------------------------------
// SDK class
// ---------------------------------------------------------------------------

import { transcribeAudio, type SttConfig, type SttAdapter } from "./stt";
import { polishText, type LlmConfig, type PolishOptions } from "./llm";
import type { AppType } from "./prompt";

export interface SDKConfig {
  /**
   * STT provider — either a built-in Whisper-compatible config or a custom adapter function.
   *
   * Built-in (Whisper file-upload):
   * ```ts
   * stt: { endpoint, model, apiKey, language?, extraFields?, timeoutMs? }
   * ```
   *
   * Custom adapter (any protocol):
   * ```ts
   * stt: async (audio, filename) => myTranscribe(audio, filename)
   * ```
   */
  stt: SttConfig | SttAdapter;
  llm: LlmConfig;
}

/** @internal Normalise stt config/adapter into a uniform callable. */
function resolveAdapter(stt: SttConfig | SttAdapter): SttAdapter {
  if (typeof stt === "function") return stt;
  return (audio, filename) => transcribeAudio(audio, stt, filename);
}

export interface ProcessOptions {
  /**
   * Custom vocabulary / dictionary terms.
   * The LLM will always use these exact spellings in the output.
   */
  vocabulary?: string[];
  /**
   * BCP-47 language code hint for STT (e.g. 'zh', 'en').
   * Overrides the language in `stt` config for this call.
   * Omit or use 'multi' for automatic detection.
   */
  language?: string;
  /** Context type — affects LLM tone and formatting. Default: 'general' */
  appType?: AppType;
  /** Translate the polished output to another language */
  translateEnabled?: boolean;
  /** BCP-47 target language for translation (e.g. 'en', 'ja') */
  targetLang?: string;
  /**
   * Called with each streamed LLM token.
   * When provided, LLM runs in streaming mode.
   */
  onChunk?: (chunk: string) => void;
  /**
   * Set to false to skip LLM polishing and return the raw STT transcript.
   * Default: true
   */
  polish?: boolean;
}

export interface ProcessResult {
  /** Raw transcript from STT */
  transcript: string;
  /** LLM-polished text (equals transcript when polish=false) */
  polishedText: string;
}

/**
 * High-level SDK class combining STT + LLM in a single interface.
 *
 * @example
 * const sdk = new VoiceTextSDK({
 *   stt: {
 *     endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
 *     model: 'whisper-large-v3-turbo',
 *     apiKey: '...',
 *   },
 *   llm: {
 *     baseUrl: 'https://api.deepseek.com',
 *     apiKey: '...',
 *     model: 'deepseek-chat',
 *   },
 * });
 *
 * // One-shot: audio → polished text
 * const { polishedText } = await sdk.process('meeting.m4a', {
 *   vocabulary: ['季报', 'Q4', 'KPI'],
 *   appType: 'document',
 * });
 *
 * // Streaming LLM output
 * await sdk.process('voice-note.wav', {
 *   onChunk: (token) => process.stdout.write(token),
 * });
 */
export class VoiceTextSDK {
  constructor(private readonly config: SDKConfig) {}

  /**
   * Transcribe an audio file to raw text via STT.
   *
   * @param audio    - File path or audio Buffer/Uint8Array
   * @param filename - Filename hint when audio is a Buffer (used for MIME type)
   */
  async transcribe(
    audio: string | Buffer | Uint8Array,
    filename?: string,
  ): Promise<string> {
    return resolveAdapter(this.config.stt)(audio, filename);
  }

  /**
   * Polish a raw transcript with the LLM.
   *
   * @param rawText - Raw STT transcript
   * @param options - Vocabulary, context type, translation, streaming
   */
  async polish(
    rawText: string,
    options?: PolishOptions,
  ): Promise<string> {
    return polishText(rawText, this.config.llm, options);
  }

  /**
   * Full pipeline: audio → STT transcript → LLM polished text.
   *
   * @param audio   - File path or audio Buffer/Uint8Array
   * @param options - Processing options
   * @returns Both the raw transcript and the polished text
   */
  async process(
    audio: string | Buffer | Uint8Array,
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    const {
      vocabulary,
      language,
      appType,
      translateEnabled,
      targetLang,
      onChunk,
      polish = true,
    } = options;

    // Per-call language override: only applies to built-in SttConfig.
    // Custom adapter functions manage their own config and ignore this option.
    const effectiveStt: SttConfig | SttAdapter =
      language !== undefined && typeof this.config.stt !== "function"
        ? { ...this.config.stt, language }
        : this.config.stt;

    const transcript = await resolveAdapter(effectiveStt)(audio);

    if (!polish) {
      return { transcript, polishedText: transcript };
    }

    const polishedText = await polishText(transcript, this.config.llm, {
      vocabulary,
      appType,
      translateEnabled,
      targetLang,
      onChunk,
    });

    return { transcript, polishedText };
  }
}
