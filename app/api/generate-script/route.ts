import { NextResponse } from "next/server";

export const maxDuration = 300;

type ScriptLanguage = "ru" | "en" | "es";

type VideoType = "short" | "long";
type ScriptProvider = "gemini" | "claude" | "groq";

type GenerateScriptBody = {
  videoId: string;
  title: string;
  niche: string;
  offer?: string;
  language?: ScriptLanguage;
  videoType?: VideoType;
  videoDuration?: number;
  preferredProvider?: ScriptProvider;
  transcript?: string;
  videoBase64?: string;
  videoMimeType?: string;
};

export type ScriptResult = {
  hooks: string[];
  body: string;
  cta: string;
  visualHook: string;
  videoQueries: string[];
  sentences: string[];
  transcriptUsed: boolean;
  provider?: string;
};

const CLAUDE_MODEL = "claude-sonnet-4-6";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_MODEL = "google/gemini-2.5-flash";

const LANGUAGE_LABELS: Record<ScriptLanguage, string> = {
  ru: "русский",
  en: "английский",
  es: "испанский",
};

function normalizeLanguage(language: unknown): ScriptLanguage {
  if (language === "en" || language === "es" || language === "ru") {
    return language;
  }
  return "ru";
}

function normalizeProvider(provider: unknown): ScriptProvider {
  if (provider === "claude" || provider === "groq" || provider === "gemini") {
    return provider;
  }
  return "gemini";
}

// ---------------------------------------------------------------------------
// Transcript fetcher — YouTube auto-captions, no API quota
// ---------------------------------------------------------------------------
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // Fetch the video page to get the transcript URL
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      },
    });
    const html = await pageRes.text();

    // Extract captions JSON from page
    const captionsMatch = html.match(/"captions":\s*(\{[^}]+\})/);
    if (!captionsMatch) {
      // Try timedtext API directly
      const timedRes = await fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=ru&fmt=json3`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (!timedRes.ok) return null;
      const timedData = (await timedRes.json()) as {
        events?: Array<{ segs?: Array<{ utf8?: string }> }>;
      };
      if (!timedData.events?.length) {
        // try English
        const enRes = await fetch(
          `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!enRes.ok) return null;
        const enData = (await enRes.json()) as {
          events?: Array<{ segs?: Array<{ utf8?: string }> }>;
        };
        if (!enData.events?.length) return null;
        return enData.events
          .flatMap((e) => e.segs ?? [])
          .map((s) => s.utf8 ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
      }
      return timedData.events
        .flatMap((e) => e.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
    }

    // Parse playerCaptionsTracklistRenderer from page HTML
    const trackMatch = html.match(
      /"playerCaptionsTracklistRenderer":\s*\{"captionTracks":\s*(\[[\s\S]*?\])/
    );
    if (!trackMatch) return null;

    const tracks = JSON.parse(trackMatch[1]) as Array<{
      baseUrl?: string;
      languageCode?: string;
    }>;

    // Prefer Russian, then English, then first available
    const track =
      tracks.find((t) => t.languageCode === "ru") ??
      tracks.find((t) => t.languageCode === "en") ??
      tracks[0];

    if (!track?.baseUrl) return null;

    const captionRes = await fetch(track.baseUrl + "&fmt=json3");
    if (!captionRes.ok) return null;

    const captionData = (await captionRes.json()) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };

    if (!captionData.events?.length) return null;

    const text = captionData.events
      .flatMap((e) => e.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000); // limit to ~8k chars to fit context

    console.log(`[transcript] fetched ${text.length} chars for ${videoId}`);
    return text.length > 100 ? text : null;
  } catch (err) {
    console.warn(`[transcript] failed for ${videoId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
function buildPrompt(
  niche: string,
  title: string,
  offer?: string,
  language: ScriptLanguage = "ru",
  transcript?: string,
  videoType: VideoType = "short",
  videoDuration?: number
): string {
  const offerTrimmed = offer?.trim() ?? "";
  const ctaInstruction = offerTrimmed
    ? `CTA должен вести на: ${offerTrimmed}`
    : "Завершение с призывом подписаться или оставить комментарий.";

  const transcriptBlock = transcript
    ? `\nТРАНСКРИПТ ВИДЕО:\n"""\n${transcript}\n"""\n`
    : "";

  const videoInstruction = transcript
    ? "Используй транскрипт выше для создания сценария."
    : "Посмотри видео выше и создай адаптированный сценарий.";

  const isLong = videoType === "long";

  const durationMin = videoDuration ? Math.round(videoDuration / 60) : null;
  const targetWords = durationMin ? durationMin * 130 : 1300;
  const targetSentences = durationMin ? durationMin * 8 : 80;

  const formatInstruction = isLong
    ? `Создай ДЛИННЫЙ подробный сценарий для YouTube видео.
ДЛИНА ОРИГИНАЛА: ${durationMin ? durationMin + " минут" : "длинное видео"}.
ТРЕБОВАНИЕ: сценарий должен содержать МИНИМУМ ${targetWords} слов и МИНИМУМ ${targetSentences} предложений в sentences[].
Раскрывай каждый факт подробно. Не сокращай. Добавляй детали, примеры, контекст.`
    : `Создай адаптированный сценарий для короткого видео (30-60 сек).`;

  const structureInstruction = isLong
    ? `1. ТРИ ВАРИАНТА ХУКА (первые 15-30 секунд):
Хук 1 (Провокация + обещание): ...
Хук 2 (Боль/проблема + интрига): ...
Хук 3 (Шокирующий факт + вопрос): ...

2. ОСНОВНАЯ ЧАСТЬ (7-12 минут):
Подробное раскрытие темы с примерами, историями, фактами. Несколько логических блоков с переходами. Каждый блок — отдельный абзац. Минимум 500 слов.

3. CTA (призыв к действию, 30-60 сек):
${ctaInstruction}

4. ВИЗУАЛЬНЫЙ ХУК:
Что показать в первый кадр (без лица, текст на экране).

5. ПОИСКОВЫЕ ЗАПРОСЫ ДЛЯ PEXELS (на английском):
15-25 коротких запросов, по одному на каждый смысловой блок. Формулируй конкретно и визуально. Пример: "woman looking at scale disappointed", "healthy food close up".

6. ПРЕДЛОЖЕНИЯ (sentences) — ОБЯЗАТЕЛЬНО:
Разбей ВСЁ содержимое body на отдельные предложения.
sentences[] должен содержать МИНИМУМ ${targetSentences} элементов.
Каждый элемент — ровно одно предложение. Не объединяй предложения.
Это критически важно — не сокращай массив sentences.`
    : `1. ТРИ ВАРИАНТА ХУКА (первые 3 секунды):
Хук 1 (Провокация): ...
Хук 2 (Боль/проблема): ...
Хук 3 (Интрига/вопрос): ...

2. ОСНОВНАЯ ЧАСТЬ (20-40 сек):
Ключевые тезисы из оригинала адаптированные для новой аудитории.

3. CTA (призыв к действию, 5 сек):
${ctaInstruction}

4. ВИЗУАЛЬНЫЙ ХУК:
Что показать в первый кадр (без лица, текст на экране).

5. ПОИСКОВЫЕ ЗАПРОСЫ ДЛЯ PEXELS (на английском):
7-15 коротких запросов, по одному на каждое предложение основной части. Запросы должны описывать визуальный ряд для каждой части сценария: хук, основная часть, CTA. Формулируй конкретно и визуально, как для поиска на Pexels. Пример: "woman looking at scale disappointed", "healthy food close up", "woman smiling mirror".

6. ПРЕДЛОЖЕНИЯ (sentences):
Разбей основную часть (body) на отдельные предложения для озвучки по одному.
Каждый элемент массива sentences — ровно одно предложение, не больше.
Важно: sentences используются для TTS-озвучки по чанкам, поэтому не склеивай предложения вместе.`;

  const longWarning = isLong
    ? `КРИТИЧЕСКИ ВАЖНО: Ты пишешь ДЛИННЫЙ сценарий на ${durationMin ?? 15} минут.
Минимум ${targetWords} слов. Минимум ${targetSentences} предложений в sentences[].
НЕ СОКРАЩАЙ. Если напишешь меньше ${targetWords} слов — задание провалено.
Пиши подробно, как опытный рассказчик — каждый факт раскрывай, добавляй детали и контекст.\n\n`
    : "";

  return `${longWarning}Ты эксперт по вирусному контенту для русскоязычной аудитории.

Пиши живым разговорным языком, избегай канцелярита и очевидных ИИ-шных фраз. Текст должен звучать как живой человек говорит на камеру.

Тема ниши: ${niche}
Название оригинального видео: ${title}
${transcriptBlock}
${videoInstruction} ${formatInstruction}

${structureInstruction}
${
  language !== "ru"
    ? `
ЯЗЫК СЦЕНАРИЯ: ${LANGUAGE_LABELS[language]}.
Пиши хуки, body, cta, visualHook и каждый элемент sentences на ${LANGUAGE_LABELS[language]} языке.
В КОНЦЕ каждой фразы в hooks, body, cta, visualHook и каждого элемента sentences добавляй перевод на русский в круглых скобках.
Пример: "Hello world (Привет мир)".
videoQueries для Pexels — только на английском, без скобок и без перевода.`
    : `
Отвечай структурированно, на русском языке.`
}

В конце верни ТОЛЬКО валидный JSON (без markdown и пояснений) в формате:
{"hooks":["текст хука 1","текст хука 2","текст хука 3"],"body":"основная часть","cta":"призыв к действию","visualHook":"визуальный хук","videoQueries":["query 1","query 2","query 3","query 4","query 5"],"sentences":["Предложение 1.","Предложение 2.","Предложение 3."]}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------
function splitBodyToSentences(body: string): string[] {
  return body
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizeSentences(sentences: unknown, body: string): string[] {
  if (Array.isArray(sentences) && sentences.length > 0) {
    return sentences
      .map(String)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }
  return splitBodyToSentences(body);
}

function normalizeVideoQueries(queries: unknown): string[] {
  if (!Array.isArray(queries)) return [];
  return queries
    .map(String)
    .map((q) => q.trim())
    .filter(Boolean);
}

function parseScriptResponse(
  text: string
): Omit<ScriptResult, "transcriptUsed" | "provider"> {
  // Шаг 1: чистим markdown-обёртку
  let cleaned = text.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Шаг 2: находим JSON-объект
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const jsonStr = cleaned.slice(start, end + 1);
    try {
      const parsed = JSON.parse(jsonStr) as Partial<
        Omit<ScriptResult, "transcriptUsed" | "provider">
      >;
      console.log("[parseScriptResponse] parsed keys:", Object.keys(parsed));
      console.log(
        "[parseScriptResponse] hooks type:",
        typeof parsed.hooks,
        Array.isArray(parsed.hooks)
      );
      if (
        Array.isArray(parsed.hooks) &&
        parsed.hooks.length > 0 &&
        parsed.body &&
        parsed.cta
      ) {
        const body = String(parsed.body);
        return {
          hooks: parsed.hooks.slice(0, 3).map(String),
          body,
          cta: String(parsed.cta),
          visualHook: String(parsed.visualHook ?? ""),
          videoQueries: normalizeVideoQueries(parsed.videoQueries),
          sentences: normalizeSentences(parsed.sentences, body),
        };
      }
    } catch {
      // fallback ниже
    }
  }

  // Шаг 3: fallback — regex по секциям
  const hookMatches = Array.from(
    text.matchAll(/Хук\s*\d[^:]*:\s*([^\n]+)/gi)
  ).map((m) => m[1].trim());

  const bodyMatch = text.match(
    /ОСНОВНАЯ ЧАСТЬ[^:]*:?\s*([\s\S]*?)(?=3\.\s*CTA|CTA\s*\(|$)/i
  );
  const ctaMatch = text.match(/CTA[^:]*:?\s*([^\n]+(?:\n(?!4\.)[^\n]+)*)/i);
  const visualMatch = text.match(
    /ВИЗУАЛЬНЫЙ ХУК[^:]*:?\s*([^\n]+(?:\n[^\n]+)*)/i
  );
  const videoQueriesMatch = text.match(
    /ПОИСКОВЫЕ ЗАПРОСЫ[^:]*:?\s*([\s\S]*?)(?=Отвечай|$)/i
  );

  const fallbackVideoQueries = videoQueriesMatch?.[1]
    ? Array.from(
        videoQueriesMatch[1].matchAll(/["']([^"']+)["']|[-•]\s*([^\n]+)/g)
      )
        .map((m) => (m[1] ?? m[2]).trim())
        .filter(Boolean)
    : [];

  const body = bodyMatch?.[1]?.trim() ?? text.slice(0, 500);

  return {
    hooks:
      hookMatches.length >= 3
        ? hookMatches.slice(0, 3)
        : ["", "", ""].map((_, i) => hookMatches[i] ?? `Хук ${i + 1}`),
    body,
    cta: ctaMatch?.[1]?.trim() ?? "",
    visualHook: visualMatch?.[1]?.trim() ?? "",
    videoQueries: normalizeVideoQueries(fallbackVideoQueries),
    sentences: splitBodyToSentences(body),
  };
}

// ---------------------------------------------------------------------------
// Provider 1: Gemini via OpenRouter + video_url (PRIMARY)
// ---------------------------------------------------------------------------
async function generateWithOpenRouter(
  videoId: string,
  prompt: string,
  videoType: VideoType = "short"
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = videoType === "long" ? 240000 : 110000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://viral-parsing.vercel.app",
        "X-Title": "Viral Parsing Script Generator",
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        max_tokens: 16000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "video_url",
                video_url: {
                  url: `https://www.youtube.com/watch?v=${videoId}`,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        `OpenRouter returned invalid JSON: ${rawText.slice(0, 200)}`
      );
    }

    if (!res.ok) {
      const apiError = (data as { error?: { message?: string } })?.error;
      throw new Error(
        `OpenRouter API ${res.status}: ${apiError?.message ?? JSON.stringify(data)}`
      );
    }

    const content = (
      data as { choices?: Array<{ message?: { content?: string } }> }
    ).choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error(
        `Empty response from OpenRouter/Gemini: ${JSON.stringify(data)}`
      );
    }

    console.log(
      `[OpenRouter] OK for ${videoId}, response length ${content.length}`
    );
    return parseScriptResponse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateWithOpenRouterFile(
  prompt: string,
  videoBase64: string,
  videoMimeType: string,
  videoType: VideoType = "short"
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = videoType === "long" ? 240000 : 110000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const dataUrl = `data:${videoMimeType};base64,${videoBase64}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://viral-parsing.vercel.app",
        "X-Title": "Viral Parsing Script Generator",
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        max_tokens: 16000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "video_url",
                video_url: { url: dataUrl },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        `OpenRouter (file) returned invalid JSON: ${rawText.slice(0, 200)}`
      );
    }

    if (!res.ok) {
      const apiError = (data as { error?: { message?: string } })?.error;
      throw new Error(
        `OpenRouter (file) API ${res.status}: ${apiError?.message ?? JSON.stringify(data)}`
      );
    }

    const content = (
      data as { choices?: Array<{ message?: { content?: string } }> }
    ).choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error(
        `Empty response from OpenRouter/Gemini (file): ${JSON.stringify(data)}`
      );
    }

    console.log(`[OpenRouter] OK for uploaded file, length ${content.length}`);
    return parseScriptResponse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Provider 2: Gemini via OpenRouter + transcript (SECONDARY)
// ---------------------------------------------------------------------------
async function generateWithGeminiTranscript(
  transcript: string,
  prompt: string
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 40000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://viral-parsing.vercel.app",
        "X-Title": "Viral Parsing Script Generator",
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        max_tokens: 2500,
        messages: [
          {
            role: "user",
            content: prompt, // text only, transcript is inside prompt
          },
        ],
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        `OpenRouter (transcript) returned invalid JSON: ${rawText.slice(0, 200)}`
      );
    }

    if (!res.ok) {
      const apiError = (data as { error?: { message?: string } })?.error;
      throw new Error(
        `OpenRouter (transcript) API ${res.status}: ${apiError?.message ?? JSON.stringify(data)}`
      );
    }

    const content = (
      data as { choices?: Array<{ message?: { content?: string } }> }
    ).choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error(
        `Empty response from Gemini (transcript): ${JSON.stringify(data)}`
      );
    }

    console.log(
      `[Gemini+transcript] OK, response length ${content.length}`
    );
    return parseScriptResponse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Provider 3: Claude (TERTIARY fallback)
// ---------------------------------------------------------------------------
type ClaudeApiError = Error & { response?: { data?: unknown } };

async function generateWithClaude(
  prompt: string,
  videoType: VideoType = "short"
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const maxTokens = videoType === "long" ? 16000 : 8000;
  const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const url = `${baseUrl}/v1/messages`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Claude returned invalid JSON: ${rawText.slice(0, 200)}`);
    }

    if (!res.ok) {
      const apiError = (
        data as { error?: { message?: string; type?: string } }
      )?.error;
      const typeSuffix = apiError?.type ? ` (${apiError.type})` : "";
      const err = new Error(
        `Claude API ${res.status}: ${apiError?.message ?? JSON.stringify(data)}${typeSuffix}`
      ) as ClaudeApiError;
      err.response = { data };
      throw err;
    }

    const content = (
      data as { content?: Array<{ text?: string }> }
    ).content?.[0]?.text;
    if (typeof content !== "string") {
      throw new Error(`Empty response from Claude: ${JSON.stringify(data)}`);
    }

    console.log(
      `[Claude] OK (${videoType}, max_tokens=${maxTokens}), response length ${content.length}`
    );
    return parseScriptResponse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Provider 4: Groq (LAST RESORT)
// ---------------------------------------------------------------------------
async function generateWithGroq(
  prompt: string
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Groq returned invalid JSON: ${rawText.slice(0, 200)}`);
    }

    if (!res.ok) {
      const apiError = (data as { error?: { message?: string } })?.error;
      throw new Error(
        `Groq API ${res.status}: ${apiError?.message ?? JSON.stringify(data)}`
      );
    }

    const content = (
      data as { choices?: Array<{ message?: { content?: string } }> }
    ).choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error(`Empty response from Groq: ${JSON.stringify(data)}`);
    }

    console.log(`[Groq] OK, response length ${content.length}`);
    return parseScriptResponse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: Gemini(video) → Gemini(transcript) → Claude → Groq
// ---------------------------------------------------------------------------
async function generateScript(
  videoId: string,
  niche: string,
  title: string,
  offer: string | undefined,
  language: ScriptLanguage,
  videoType: VideoType = "short",
  preferredProvider: ScriptProvider = "gemini",
  clientTranscript?: string,
  videoBase64?: string,
  videoMimeType?: string,
  videoDuration?: number
): Promise<{
  result: Omit<ScriptResult, "transcriptUsed" | "provider">;
  provider: string;
}> {
  const isUploadedFile = Boolean(videoBase64?.trim());
  const promptNoTranscript = buildPrompt(
    niche,
    title,
    offer,
    language,
    undefined,
    videoType,
    videoDuration
  );

  const clientTx = clientTranscript?.trim() || null;

  let autoTranscript: string | null = null;
  if (
    videoType === "long" &&
    !clientTx &&
    !isUploadedFile &&
    videoId &&
    !videoId.startsWith("file_")
  ) {
    try {
      console.log("[generate-script] Fetching transcript for long video:", videoId);
      const appBase =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const tRes = await fetch(`${appBase}/api/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
        signal: AbortSignal.timeout(250000),
      });
      const tText = await tRes.text();
      if (tRes.ok) {
        const tData = JSON.parse(tText) as { transcript?: string };
        autoTranscript = tData.transcript ?? null;
        console.log(
          "[generate-script] Got transcript, length:",
          autoTranscript?.length
        );
      }
    } catch (e) {
      console.log("[generate-script] Transcript fetch failed:", e);
    }
  }

  const fetchedTranscript =
    clientTx === null && !isUploadedFile && !autoTranscript
      ? await fetchTranscript(videoId)
      : null;

  const effectiveTranscript = clientTx ?? autoTranscript ?? fetchedTranscript;

  const promptWithTranscript = buildPrompt(
    niche,
    title,
    offer,
    language,
    effectiveTranscript ?? undefined,
    videoType,
    videoDuration
  );

  const claudePrompt = effectiveTranscript
    ? promptWithTranscript
    : promptNoTranscript;
  const groqFallbackPrompt = promptWithTranscript ?? promptNoTranscript;

  if (preferredProvider === "groq") {
    const result = await generateWithGroq(promptWithTranscript);
    return { result, provider: "groq-llama-3.3-70b" };
  }

  if (preferredProvider === "claude") {
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const result = await generateWithClaude(claudePrompt, videoType);
        return { result, provider: "claude-sonnet-4-6" };
      } catch (error) {
        const isTimeout =
          error instanceof Error && error.name === "AbortError";
        console.warn(
          `[orchestrator] Claude (preferred) failed (timeout: ${isTimeout}): ${
            error instanceof Error ? error.message : error
          }, trying Groq...`
        );
      }
    }
    const result = await generateWithGroq(groqFallbackPrompt);
    return { result, provider: "groq-llama-3.3-70b (fallback)" };
  }

  // preferredProvider === "gemini"
  if (
    isUploadedFile &&
    videoBase64 &&
    process.env.OPENROUTER_API_KEY &&
    preferredProvider === "gemini"
  ) {
    try {
      const result = await generateWithOpenRouterFile(
        promptNoTranscript,
        videoBase64,
        videoMimeType || "video/mp4",
        videoType
      );
      return { result, provider: "gemini-2.5-flash-file" };
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      console.warn(
        `[orchestrator] Gemini file failed (timeout: ${isTimeout}): ${
          error instanceof Error ? error.message : error
        }, trying transcript path...`
      );
    }
  }

  if (
    !clientTx &&
    !isUploadedFile &&
    process.env.OPENROUTER_API_KEY &&
    videoType !== "long"
  ) {
    try {
      const result = await generateWithOpenRouter(
        videoId,
        promptNoTranscript,
        videoType
      );
      return { result, provider: "gemini-2.5-flash" };
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      console.warn(
        `[orchestrator] Gemini video_url failed (timeout: ${isTimeout}): ${
          error instanceof Error ? error.message : error
        }, trying transcript path...`
      );
    }
  }

  if (process.env.OPENROUTER_API_KEY && effectiveTranscript) {
    try {
      const result = await generateWithGeminiTranscript(
        effectiveTranscript,
        promptWithTranscript
      );
      return { result, provider: "gemini-2.5-flash-transcript" };
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      console.warn(
        `[orchestrator] Gemini transcript failed (timeout: ${isTimeout}): ${
          error instanceof Error ? error.message : error
        }, trying Claude...`
      );
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await generateWithClaude(claudePrompt, videoType);
      return { result, provider: "claude-sonnet-4-6" };
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      console.warn(
        `[orchestrator] Claude failed (timeout: ${isTimeout}): ${
          error instanceof Error ? error.message : error
        }, trying Groq...`
      );
    }
  }

  const result = await generateWithGroq(groqFallbackPrompt);
  return { result, provider: "groq-llama-3.3-70b (fallback)" };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateScriptBody>;
    const {
      videoId,
      title,
      niche,
      offer,
      language: rawLanguage,
      videoType = "short",
      videoDuration,
      preferredProvider: rawProvider,
      transcript: clientTranscript,
      videoBase64,
      videoMimeType,
    } = body;
    const language = normalizeLanguage(rawLanguage);
    const preferredProvider = normalizeProvider(rawProvider);

    if (!videoId?.trim()) {
      const error = "videoId is required";
      console.error("[generate-script] error:", error);
      return NextResponse.json({ error }, { status: 400 });
    }
    if (!title?.trim()) {
      const error = "title is required";
      console.error("[generate-script] error:", error);
      return NextResponse.json({ error }, { status: 400 });
    }
    if (!niche?.trim()) {
      const error = "niche is required";
      console.error("[generate-script] error:", error);
      return NextResponse.json({ error }, { status: 400 });
    }

    console.log(
      `[generate-script] videoId=${videoId}, niche=${niche}, lang=${language}, provider=${preferredProvider}`
    );

    const { result, provider } = await generateScript(
      videoId.trim(),
      niche.trim(),
      title.trim(),
      offer,
      language,
      videoType,
      preferredProvider,
      clientTranscript,
      videoBase64,
      videoMimeType,
      typeof videoDuration === "number" && videoDuration > 0
        ? videoDuration
        : undefined
    );

    return NextResponse.json({
      ...result,
      transcriptUsed: provider.startsWith("gemini"),
      provider,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[generate-script] fatal error:", message);
    if (error instanceof Error && error.stack) {
      console.error("[generate-script] stack:", error.stack);
    }
    console.error("[generate-script] full error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
