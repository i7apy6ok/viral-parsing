import { NextResponse } from "next/server";

export const maxDuration = 120;

type ScriptLanguage = "ru" | "en" | "es";

type GenerateScriptBody = {
  videoId: string;
  title: string;
  niche: string;
  offer?: string;
  language?: ScriptLanguage;
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

// ---------------------------------------------------------------------------
// Prompt builder — no transcript block, Gemini watches the video directly
// ---------------------------------------------------------------------------
function buildPrompt(
  niche: string,
  title: string,
  offer?: string,
  language: ScriptLanguage = "ru"
): string {
  const offerTrimmed = offer?.trim() ?? "";
  const ctaInstruction = offerTrimmed
    ? `CTA должен вести на: ${offerTrimmed}`
    : "Завершение с призывом подписаться или оставить комментарий.";

  return `Ты эксперт по вирусному контенту для русскоязычной аудитории.

Пиши живым разговорным языком, избегай канцелярита и очевидных ИИ-шных фраз. Текст должен звучать как живой человек говорит на камеру.

Тема ниши: ${niche}
Название оригинального видео: ${title}

Посмотри видео выше и создай адаптированный сценарий для короткого видео (30-60 сек):

1. ТРИ ВАРИАНТА ХУКА (первые 3 секунды):
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
Важно: sentences используются для TTS-озвучки по чанкам, поэтому не склеивай предложения вместе.
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
// Response parsing (shared between all providers)
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

function parseScriptResponse(text: string): Omit<ScriptResult, "transcriptUsed" | "provider"> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<
        Omit<ScriptResult, "transcriptUsed" | "provider">
      >;
      if (parsed.hooks && parsed.body && parsed.cta && parsed.visualHook) {
        const body = String(parsed.body);
        return {
          hooks: parsed.hooks.slice(0, 3).map(String),
          body,
          cta: String(parsed.cta),
          visualHook: String(parsed.visualHook),
          videoQueries: normalizeVideoQueries(parsed.videoQueries),
          sentences: normalizeSentences(parsed.sentences, body),
        };
      }
    } catch {
      /* fallback to section parser */
    }
  }

  const hookMatches = Array.from(
    text.matchAll(/Хук\s*\d[^:]*:\s*([^\n]+)/gi)
  ).map((m) => m[1].trim());

  const bodyMatch = text.match(
    /ОСНОВНАЯ ЧАСТЬ[^:]*:?\s*([\s\S]*?)(?=3\.\s*CTA|CTA\s*\(|$)/i
  );
  const ctaMatch = text.match(/CTA[^:]*:?\s*([^\n]+(?:\n(?!4\.)[^\n]+)*)/i);
  const visualMatch = text.match(/ВИЗУАЛЬНЫЙ ХУК[^:]*:?\s*([^\n]+(?:\n[^\n]+)*)/i);
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
// Provider: OpenRouter + Gemini 2.5 Flash (PRIMARY)
// Gemini natively understands YouTube video URLs — no transcript needed
// ---------------------------------------------------------------------------
async function generateWithOpenRouter(
  videoId: string,
  prompt: string
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // Recommended by OpenRouter for ranking/attribution
        "HTTP-Referer": "https://viral-parsing.vercel.app",
        "X-Title": "Viral Parsing Script Generator",
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        max_tokens: 2500,
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
      throw new Error(`OpenRouter returned invalid JSON: ${rawText.slice(0, 200)}`);
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
      throw new Error(`Empty response from OpenRouter/Gemini: ${JSON.stringify(data)}`);
    }

    console.log(`[OpenRouter] OK for ${videoId}, response length ${content.length}`);
    return parseScriptResponse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Provider: Anthropic Claude via OneProvider (SECONDARY fallback)
// Falls back to text-only prompt when Gemini is unavailable
// ---------------------------------------------------------------------------
type ClaudeApiError = Error & { response?: { data?: unknown } };

async function generateWithClaude(
  prompt: string
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const url = `${baseUrl}/v1/messages`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

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
        max_tokens: 2500,
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
      const apiError = (data as { error?: { message?: string; type?: string } })?.error;
      const typeSuffix = apiError?.type ? ` (${apiError.type})` : "";
      const err = new Error(
        `Claude API ${res.status}: ${apiError?.message ?? JSON.stringify(data)}${typeSuffix}`
      ) as ClaudeApiError;
      err.response = { data };
      throw err;
    }

    const content = (data as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    if (typeof content !== "string") {
      throw new Error(`Empty response from Claude: ${JSON.stringify(data)}`);
    }

    console.log(`[Claude] OK, response length ${content.length}`);
    return parseScriptResponse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Provider: Groq (LAST RESORT fallback)
// ---------------------------------------------------------------------------
async function generateWithGroq(
  prompt: string
): Promise<Omit<ScriptResult, "transcriptUsed" | "provider">> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 2500,
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
      throw new Error(`Groq API ${res.status}: ${apiError?.message ?? JSON.stringify(data)}`);
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
// Orchestrator: OpenRouter → Claude → Groq
// ---------------------------------------------------------------------------
async function generateScript(
  videoId: string,
  prompt: string
): Promise<{ result: Omit<ScriptResult, "transcriptUsed" | "provider">; provider: string }> {
  // 1. Try OpenRouter + Gemini (watches video natively)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const result = await generateWithOpenRouter(videoId, prompt);
      return { result, provider: "gemini-2.5-flash" };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      console.warn(
        `[orchestrator] OpenRouter failed (timeout: ${isTimeout}): ${
          error instanceof Error ? error.message : error
        }, trying Claude...`
      );
    }
  } else {
    console.warn("[orchestrator] OPENROUTER_API_KEY not set, skipping Gemini");
  }

  // 2. Try Claude via OneProvider
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await generateWithClaude(prompt);
      return { result, provider: "claude-sonnet-4-6" };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      console.warn(
        `[orchestrator] Claude failed (timeout: ${isTimeout}): ${
          error instanceof Error ? error.message : error
        }, trying Groq...`
      );
    }
  } else {
    console.warn("[orchestrator] ANTHROPIC_API_KEY not set, skipping Claude");
  }

  // 3. Last resort: Groq
  const result = await generateWithGroq(prompt);
  return { result, provider: "groq-llama-3.3-70b" };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateScriptBody>;
    const { videoId, title, niche, offer, language: rawLanguage } = body;
    const language = normalizeLanguage(rawLanguage);

    if (!videoId?.trim()) {
      return NextResponse.json({ error: "videoId is required" }, { status: 400 });
    }
    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!niche?.trim()) {
      return NextResponse.json({ error: "niche is required" }, { status: 400 });
    }

    console.log(`[generate-script] videoId=${videoId}, niche=${niche}, lang=${language}`);

    const prompt = buildPrompt(niche.trim(), title.trim(), offer, language);
    const { result, provider } = await generateScript(videoId.trim(), prompt);

    return NextResponse.json({
      ...result,
      transcriptUsed: provider === "gemini-2.5-flash",
      provider,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[generate-script] fatal error:", message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
