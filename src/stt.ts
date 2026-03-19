/**
 * STT (Speech-to-Text) module — Whisper-compatible file-upload providers.
 *
 * Ported from src-tauri/src/stt/whisper_compat.rs
 *
 * Accepts any Whisper-compatible transcription API. All provider details
 * (endpoint, model, extra fields) are specified by the caller — nothing is
 * hard-coded here.
 *
 * Common endpoints:
 *   OpenAI Whisper  → https://api.openai.com/v1/audio/transcriptions         (model: whisper-1)
 *   Groq Whisper    → https://api.groq.com/openai/v1/audio/transcriptions     (model: whisper-large-v3-turbo)
 *   GLM-ASR         → https://open.bigmodel.cn/api/paas/v4/audio/transcriptions (model: glm-asr-2512, extraFields: {stream:'false'})
 *   SiliconFlow     → https://api.siliconflow.cn/v1/audio/transcriptions      (model: FunAudioLLM/SenseVoiceSmall)
 *
 * Accepts any audio format the provider supports: mp3, wav, m4a, webm, flac, ogg, etc.
 * No local audio processing — raw audio bytes are uploaded directly.
 *
 * Requires Node.js >= 18 (native fetch + FormData + Blob).
 */

import { readFile } from "fs/promises";
import { extname } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SttConfig {
  /** Full transcription API endpoint URL */
  endpoint: string;
  /** Model name to request (e.g. 'whisper-1', 'whisper-large-v3-turbo') */
  model: string;
  /** Provider API key */
  apiKey: string;
  /**
   * BCP-47 language code hint (e.g. 'zh', 'en', 'ja').
   * Omit or set to 'multi' for automatic detection.
   */
  language?: string;
  /**
   * Extra multipart form fields required by some providers.
   * e.g. GLM-ASR needs `{ stream: 'false' }`
   */
  extraFields?: Record<string, string>;
  /** Request timeout in milliseconds. Default: 60_000 */
  timeoutMs?: number;
}

/**
 * Custom STT adapter function.
 *
 * Use this when the built-in Whisper-compatible file-upload protocol doesn't
 * fit your provider (e.g. chat/completions-based audio APIs, WebSocket, gRPC…).
 *
 * @param audio    - File path or raw audio bytes (Buffer / Uint8Array)
 * @param filename - Filename hint for MIME-type inference (e.g. 'recording.m4a')
 * @returns        - Raw transcript text
 *
 * @example
 * const sdk = new VoiceTextSDK({
 *   stt: async (audio, filename) => {
 *     // your own HTTP call here
 *     return myCustomTranscribe(audio, filename);
 *   },
 *   llm: { ... },
 * });
 */
export type SttAdapter = (
  audio: string | Buffer | Uint8Array,
  filename?: string,
) => Promise<string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mpeg": "audio/mpeg",
  ".mpga": "audio/mpeg",
};

function getMimeType(filename: string): string {
  return MIME_MAP[extname(filename).toLowerCase()] ?? "audio/wav";
}

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

// ---------------------------------------------------------------------------
// Core transcription function
// ---------------------------------------------------------------------------

/**
 * Transcribe audio using a Whisper-compatible STT API.
 *
 * @param audio - Path to audio file (string) or raw audio data (Buffer/Uint8Array)
 * @param config - STT provider configuration
 * @param filename - Filename hint when `audio` is a Buffer. Used to infer MIME type.
 *                   Defaults to `'audio.wav'`.
 * @returns Raw transcript text from the provider
 *
 * @throws If the API returns an error or an empty transcript
 *
 * @example
 * // From file path
 * const text = await transcribeAudio('/path/to/recording.m4a', {
 *   provider: 'openai-whisper',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   language: 'zh',
 * });
 *
 * @example
 * // From Buffer
 * const audioBuffer = await readFile('recording.mp3');
 * const text = await transcribeAudio(audioBuffer, {
 *   provider: 'groq-whisper',
 *   apiKey: process.env.GROQ_API_KEY!,
 * }, 'recording.mp3');
 */
export async function transcribeAudio(
  audio: string | Buffer | Uint8Array,
  config: SttConfig,
  filename = "audio.wav",
): Promise<string> {
  const timeoutMs = config.timeoutMs ?? 60_000;

  let audioData: Buffer | Uint8Array;
  let audioFilename: string;

  if (typeof audio === "string") {
    audioData = await readFile(audio);
    audioFilename = basename(audio);
  } else {
    audioData = audio;
    audioFilename = filename;
  }

  const mimeType = getMimeType(audioFilename);
  const blob = new Blob([audioData], { type: mimeType });

  const formData = new FormData();
  formData.append("file", blob, audioFilename);
  formData.append("model", config.model);

  if (config.language && config.language !== "multi") {
    formData.append("language", config.language);
  }

  if (config.extraFields) {
    for (const [key, value] of Object.entries(config.extraFields)) {
      formData.append(key, value);
    }
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `STT HTTP ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as { text?: string };
  const transcript = (data.text ?? "").trim();

  if (!transcript) {
    throw new Error("STT returned an empty transcript");
  }

  return transcript;
}
