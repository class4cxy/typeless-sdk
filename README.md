# typeless-sdk

**音频 + 自定义词库 → 整理后的文本。**

将任意音频文件通过 STT 转录、LLM 润色，输出干净可用的文字。从 [OpenTypeless](https://github.com/tover0314-w/opentypeless) 桌面应用的核心 pipeline 提取，无桌面依赖，零运行时第三方包。

**English** | [中文](#中文文档)

---

## Features

- 🎙️ **STT** — built-in Whisper-compatible file-upload (OpenAI, Groq, GLM-ASR, SiliconFlow, …) **or bring your own adapter** for any protocol
- 🤖 **LLM polish** — supports any OpenAI-compatible chat API (OpenAI, DeepSeek, Gemini, Ollama, GLM, …)
- 📖 **Custom vocabulary** — inject domain-specific terms that must always be spelled exactly right
- 🌊 **Streaming** — receive LLM tokens as they arrive via callback
- 🌐 **Translation** — speak in one language, output in another (20+ languages)
- 🎯 **Context modes** — adjust LLM tone for email, chat, document, or code
- 📦 **Zero runtime deps** — uses native `fetch`, `FormData`, and `Blob` (Node.js ≥ 18)
- 🔷 **Full TypeScript** — strict types, declaration maps, source maps

---

## Pipeline

```
audio file (any format)
    │
    │  built-in: multipart upload          custom: any protocol
    ▼                                              ▼
STT API (Whisper-compatible)          SttAdapter function (you provide)
OpenAI / Groq / GLM-ASR / …          chat/completions, WebSocket, gRPC, …
    │                                              │
    └──────────────────┬────────────────────────────┘
                       │  raw transcript
                       ▼
              LLM API (OpenAI-compatible)
     OpenAI / DeepSeek / Gemini / Ollama / GLM / …
                       │
                       │  system prompt includes:
                       │    · punctuation & cleanup rules
                       │    · custom vocabulary terms
                       │    · context type (email / chat / document)
                       │    · translation instruction (optional)
                       ▼
                  polished text
```

---

## Requirements

- Node.js **≥ 18** (native `fetch`, `FormData`, `Blob`, `AbortSignal.timeout`)
- TypeScript **≥ 5** (dev)

---

## Installation

```bash
npm install typeless-sdk
# or
pnpm add typeless-sdk
```

---

## Quick Start

```typescript
import { VoiceTextSDK } from 'typeless-sdk';

const sdk = new VoiceTextSDK({
  stt: {
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    apiKey: process.env.GROQ_API_KEY!,
  },
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o-mini',
  },
});

const { transcript, polishedText } = await sdk.process('meeting.m4a', {
  vocabulary: ['OpenTypeless', 'KPI', 'EBITDA'],
  language: 'zh',
  appType: 'document',
});

console.log('Raw:    ', transcript);
console.log('Cleaned:', polishedText);
```

---

## API Reference

### `new VoiceTextSDK(config)`

High-level class. Wraps STT + LLM into three methods.

`stt` accepts either a built-in config object (Whisper-compatible file upload) or a custom adapter function for any other protocol:

```typescript
// Built-in: Whisper-compatible file upload
const sdk = new VoiceTextSDK({
  stt: {
    endpoint: string,   // /audio/transcriptions URL
    model: string,
    apiKey: string,
    language?: string,
    extraFields?: Record<string, string>,
    timeoutMs?: number,
  },
  llm: LlmConfig,
});

// Custom adapter: any STT protocol
const sdk = new VoiceTextSDK({
  stt: async (audio, filename) => {
    // audio: string (file path) | Buffer | Uint8Array
    // return the raw transcript string
    return myTranscribe(audio, filename);
  },
  llm: LlmConfig,
});
```

> **Note:** When using a custom adapter, the per-call `language` option in `sdk.process()` is ignored — the adapter manages its own configuration.

---

#### `sdk.process(audio, options?)` → `Promise<ProcessResult>`

Full pipeline: audio → transcript → polished text.

```typescript
const { transcript, polishedText } = await sdk.process(
  'recording.m4a',          // string path or Buffer / Uint8Array
  {
    vocabulary?: (string | VocabularyEntry)[],  // custom terms; use VocabularyEntry for soundsLike aliases
    language?: string,       // BCP-47 hint for STT ('zh', 'en', …)
    appType?: AppType,       // 'general' | 'email' | 'chat' | 'document' | 'code'
    translateEnabled?: boolean,
    targetLang?: string,     // BCP-47 translation target ('en', 'ja', …)
    onChunk?: (token: string) => void,  // enables LLM streaming mode
    polish?: boolean,        // set false to skip LLM, return raw transcript
  }
);
```

---

#### `sdk.transcribe(audio, filename?)` → `Promise<string>`

STT only — returns the raw transcript.

```typescript
const raw = await sdk.transcribe('/path/to/audio.mp3');
// or from Buffer:
const raw = await sdk.transcribe(buffer, 'recording.mp3');
```

---

#### `sdk.polish(rawText, options?)` → `Promise<string>`

LLM polish only — takes a raw string, returns cleaned text.

```typescript
const cleaned = await sdk.polish('嗯那个就是说我们的方案还不错', {
  vocabulary: ['方案A'],
  appType: 'chat',
});
// → '我们的方案A还不错'
```

---

### Standalone functions

For finer control, import the underlying functions directly:

```typescript
import { transcribeAudio, polishText, buildSystemPrompt } from 'typeless-sdk';
```

#### `transcribeAudio(audio, config, filename?)`

```typescript
const transcript = await transcribeAudio(
  '/path/to/audio.wav',   // string | Buffer | Uint8Array
  {
    endpoint: string,      // full API endpoint URL
    model: string,         // e.g. 'whisper-1'
    apiKey: string,
    language?: string,     // BCP-47 or 'multi' for auto-detect
    extraFields?: Record<string, string>,  // provider-specific fields
    timeoutMs?: number,    // default: 60_000
  }
);
```

#### `polishText(rawText, config, options?)`

```typescript
const polished = await polishText(
  rawTranscript,
  {
    baseUrl: string,       // OpenAI-compatible base URL
    apiKey: string,
    model: string,
    maxTokens?: number,    // default: 4096
    temperature?: number,  // default: 0.3
    timeoutMs?: number,    // default: 60_000
  },
  {
    appType?: AppType,
    vocabulary?: string[],
    translateEnabled?: boolean,
    targetLang?: string,
    onChunk?: (chunk: string) => void,
  }
);
```

#### `buildSystemPrompt(options?)`

Build the system prompt string directly, useful for debugging or custom integrations.

```typescript
const prompt = buildSystemPrompt({
  appType: 'email',
  vocabulary: ['API', 'SLA'],
  translateEnabled: true,
  targetLang: 'en',
});
```

---

## Provider Reference

### STT Providers

#### Built-in: Whisper-compatible file upload

Pass an `SttConfig` object. All providers below use the same multipart upload API.

| Provider | endpoint | model | extraFields |
|---|---|---|---|
| **OpenAI Whisper** | `https://api.openai.com/v1/audio/transcriptions` | `whisper-1` | — |
| **Groq** | `https://api.groq.com/openai/v1/audio/transcriptions` | `whisper-large-v3-turbo` | — |
| **GLM-ASR** (ZhipuAI) | `https://open.bigmodel.cn/api/paas/v4/audio/transcriptions` | `glm-asr-2512` | `{ stream: 'false' }` |
| **SiliconFlow** | `https://api.siliconflow.cn/v1/audio/transcriptions` | `FunAudioLLM/SenseVoiceSmall` | — |

Supported audio formats: `mp3`, `wav`, `m4a`, `mp4`, `webm`, `flac`, `ogg`, `mpeg`, `mpga`.

**Recommendation:** Groq + `whisper-large-v3-turbo` for the best speed/cost ratio. GLM-ASR for Chinese.

#### Custom adapter

Pass an `SttAdapter` function when your provider uses a different protocol (chat/completions with base64 audio, WebSocket, etc.):

```typescript
const sdk = new VoiceTextSDK({
  stt: async (audio, filename = 'audio.wav') => {
    const blob = audio instanceof Blob ? audio : new Blob([audio]);
    const res = await fetch('https://your-api/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'your-asr-model',
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: await toDataUri(blob) } }] }],
      }),
    });
    const data = await res.json();
    return data.choices[0].message.content;
  },
  llm: { ... },
});
```

### LLM Providers

Any provider with an OpenAI-compatible `/chat/completions` endpoint works. Set `baseUrl` to:

| Provider | baseUrl |
|---|---|
| **OpenAI** | `https://api.openai.com/v1` |
| **DeepSeek** | `https://api.deepseek.com` |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` |
| **Groq** | `https://api.groq.com/openai/v1` |
| **Ollama** (local) | `http://localhost:11434/v1` |
| **OpenRouter** | `https://openrouter.ai/api/v1` |
| **ZhipuAI GLM** | `https://open.bigmodel.cn/api/paas/v4` |
| **SiliconFlow** | `https://api.siliconflow.cn/v1` |

> **Note:** GLM thinking-mode models (`glm-4.7`, `glm-4.5`, `glm-z1`, etc.) are automatically detected by model name prefix and handled correctly — thinking mode is enabled, temperature is forced to 1.0, and `reasoning_content` is used as fallback when `content` is empty. Standard models like `glm-4-flash` are unaffected.

---

## Usage Examples

### Streaming output

```typescript
process.stdout.write('Polishing: ');

const { polishedText } = await sdk.process('voice-memo.m4a', {
  onChunk: (token) => process.stdout.write(token),
});

console.log('\nDone:', polishedText);
```

### STT only (skip LLM)

```typescript
const { transcript } = await sdk.process('audio.wav', { polish: false });
```

### Translation

```typescript
const { polishedText } = await sdk.process('chinese-meeting.m4a', {
  language: 'zh',
  translateEnabled: true,
  targetLang: 'en',
});
// speaks Chinese → outputs English
```

### From Buffer

```typescript
import { readFile } from 'fs/promises';

const audio = await readFile('recording.mp3');
const { polishedText } = await sdk.transcribe(audio, 'recording.mp3');
// or run the full pipeline via the low-level function:
// const text = await transcribeAudio(audio, sttConfig, 'recording.mp3');
```

### Using GLM for both STT and LLM

```typescript
const sdk = new VoiceTextSDK({
  stt: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions',
    model: 'glm-asr-2512',
    apiKey: process.env.GLM_API_KEY!,
    extraFields: { stream: 'false' },
    language: 'zh',
  },
  llm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.GLM_API_KEY!,
    model: 'glm-4-flash',
  },
});
```

### Custom vocabulary (domain-specific terms)

Plain strings work for terms the STT usually gets right:

```typescript
const { polishedText } = await sdk.process('standup.m4a', {
  vocabulary: ['gRPC', 'KPI', '季报'],
  appType: 'document',
});
```

For terms the STT frequently mis-transcribes, add `soundsLike` aliases.
The LLM will match the phonetic approximation and correct it to the exact spelling:

```typescript
import type { VocabularyEntry } from 'typeless-sdk';

const { polishedText } = await sdk.process('standup.m4a', {
  vocabulary: [
    { term: 'OpenTypeless', soundsLike: ['open type less', 'opentypeless'] },
    { term: 'Tauri',        soundsLike: ['towery', 'tori'] },
    { term: 'gRPC',         soundsLike: ['grpc', 'g rpc'] },
    'KPI',   // plain string — no alias needed
  ],
  appType: 'document',
});
```

### Per-call language override

```typescript
// Default STT config is 'zh', but override to 'en' for this specific file
// (only works with built-in SttConfig; custom adapters manage their own config)
const result = await sdk.process('english-note.mp3', { language: 'en' });
```

---

## LLM Polishing Rules

The system prompt (in `src/prompt.ts`) instructs the LLM to apply these rules to raw STT output:

| Rule | Example |
|---|---|
| **Add punctuation** | `今天开会讨论了三件事` → `今天开会，讨论了三件事：` |
| **Remove fillers** | `嗯那个就是说我们进展不错` → `我们进展不错` |
| **Format lists** | `首先买牛奶然后洗衣服` → numbered list, each item on its own line |
| **Resolve corrections** | `订去上海的票额不对是杭州的` → `订去杭州的票` |
| **Context tone** | Email → formal; Chat → casual; Document → Markdown-friendly |
| **Enforce vocabulary** | Custom terms always appear with exact casing and spelling |
| **Translate** | Entire output translated after polishing (when enabled) |

---

## Project Structure

```
typeless-sdk/
├── package.json          # ESM package, Node ≥ 18, zero runtime deps
├── tsconfig.json         # strict TypeScript → dist/
└── src/
    ├── index.ts          # VoiceTextSDK class + all exports
    ├── stt.ts            # transcribeAudio() — Whisper-compatible upload; SttAdapter type
    ├── llm.ts            # polishText() — OpenAI-compatible chat completions
    └── prompt.ts         # buildSystemPrompt() — context-aware prompt builder
```

---

## 中文文档

### 简介

从 [OpenTypeless](https://github.com/tover0314-w/opentypeless) 桌面应用提取的核心 pipeline，封装成独立的 Node.js SDK。

**核心能力：音频 + 自定义词库 → 整理后的文本**

```
音频文件  →  STT（内置 Whisper 文件上传 或 自定义 adapter）  →  LLM 润色（+ 词库注入）  →  干净文本
```

零运行时依赖，Node.js ≥ 18，纯 TypeScript。

---

### 安装

```bash
npm install typeless-sdk
# 或
pnpm add typeless-sdk
```

---

### 快速开始

```typescript
import { VoiceTextSDK } from 'typeless-sdk';

const sdk = new VoiceTextSDK({
  stt: {
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    apiKey: process.env.GROQ_API_KEY!,
  },
  llm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.GLM_API_KEY!,
    model: 'glm-4-flash',
  },
});

const { transcript, polishedText } = await sdk.process('会议录音.m4a', {
  vocabulary: ['季报', 'Q4', 'KPI', 'OpenTypeless'],  // 自定义词库
  language: 'zh',
  appType: 'document',
});

console.log('原始转录：', transcript);
console.log('润色结果：', polishedText);
```

---

### STT 提供商配置

#### 内置：Whisper 兼容文件上传

传入 `SttConfig` 对象即可使用内置上传协议：

| 提供商 | endpoint | model | extraFields |
|---|---|---|---|
| **OpenAI Whisper** | `https://api.openai.com/v1/audio/transcriptions` | `whisper-1` | — |
| **Groq**（最快） | `https://api.groq.com/openai/v1/audio/transcriptions` | `whisper-large-v3-turbo` | — |
| **GLM-ASR**（中文最准） | `https://open.bigmodel.cn/api/paas/v4/audio/transcriptions` | `glm-asr-2512` | `{ stream: 'false' }` |
| **SiliconFlow** | `https://api.siliconflow.cn/v1/audio/transcriptions` | `FunAudioLLM/SenseVoiceSmall` | — |

支持的音频格式：`mp3`、`wav`、`m4a`、`mp4`、`webm`、`flac`、`ogg` 等。

#### 自定义 adapter

当你的 STT 服务不走标准文件上传协议时（如通过 chat/completions 传 base64 音频），传入一个函数即可：

```typescript
const sdk = new VoiceTextSDK({
  stt: async (audio, filename) => {
    // 在这里实现任意 STT 协议，返回转录文字即可
    return myCustomTranscribe(audio, filename);
  },
  llm: { ... },
});
```

> 使用自定义 adapter 时，`sdk.process()` 的 `language` 参数不会生效，请在 adapter 内部自行管理配置。

---

### LLM 提供商配置

| 提供商 | baseUrl |
|---|---|
| **OpenAI** | `https://api.openai.com/v1` |
| **DeepSeek** | `https://api.deepseek.com` |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` |
| **Groq** | `https://api.groq.com/openai/v1` |
| **Ollama（本地）** | `http://localhost:11434/v1` |
| **OpenRouter** | `https://openrouter.ai/api/v1` |
| **智谱 GLM** | `https://open.bigmodel.cn/api/paas/v4` |
| **SiliconFlow** | `https://api.siliconflow.cn/v1` |

---

### 核心 API

#### `sdk.process(audio, options?)` — 完整流程

```typescript
const { transcript, polishedText } = await sdk.process(
  'audio.m4a',              // 文件路径 或 Buffer / Uint8Array
  {
    vocabulary?: string[],       // 自定义词库，LLM 严格保持这些词的拼写
    language?: string,           // STT 语言提示（'zh'、'en' 等）
    appType?: AppType,           // 场景：'general' | 'email' | 'chat' | 'document' | 'code'
    translateEnabled?: boolean,  // 是否翻译
    targetLang?: string,         // 翻译目标语言（'en'、'ja' 等）
    onChunk?: (token) => void,   // 流式回调（提供时启用 streaming 模式）
    polish?: boolean,            // 设为 false 跳过 LLM，只返回原始转录
  }
);
```

#### `sdk.transcribe(audio)` — 仅 STT

```typescript
const rawText = await sdk.transcribe('audio.mp3');
```

#### `sdk.polish(rawText, options?)` — 仅 LLM 润色

```typescript
const cleaned = await sdk.polish('嗯那个就是说我们的项目进展不错', {
  vocabulary: ['项目X'],
  appType: 'chat',
});
```

---

### 典型场景示例

**会议录音转文档**
```typescript
const { polishedText } = await sdk.process('standup.m4a', {
  vocabulary: ['Sprint', 'P0', 'LGTM'],
  appType: 'document',
  language: 'zh',
});
```

**说中文输出英文**
```typescript
const { polishedText } = await sdk.process('chinese.m4a', {
  language: 'zh',
  translateEnabled: true,
  targetLang: 'en',
});
```

**流式输出（边生成边显示）**
```typescript
await sdk.process('audio.wav', {
  onChunk: (token) => process.stdout.write(token),
});
```

**仅做转录，不润色**
```typescript
const { transcript } = await sdk.process('audio.mp3', { polish: false });
```

---

### LLM 润色规则

| 规则 | 效果 |
|---|---|
| 添加标点 | `今天讨论了三件事` → `今天讨论了三件事：` |
| 去除口头禅 | `嗯那个就是说` → 删除 |
| 格式化列表 | 检测到「首先/然后」自动生成编号列表 |
| 理解口头纠正 | `去上海额不对是杭州` → `去杭州` |
| 场景适配 | 邮件正式、聊天简洁、文档 Markdown 友好 |
| 词库强制 | 自定义词始终以指定形式出现 |
| 翻译 | 润色完成后整体翻译 |

---

## License

MIT — Part of the [OpenTypeless](https://github.com/tover0314-w/opentypeless) project.
