import { NextResponse } from "next/server";
import { getTranscript } from "@/lib/getTranscript";

export const maxDuration = 60;

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
};

const CLAUDE_MODEL = "claude-sonnet-4-6";

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

function buildPrompt(
  niche: string,
  title: string,
  transcript: string | null,
  offer?: string,
  language: ScriptLanguage = "ru"
): string {
  const offerTrimmed = offer?.trim() ?? "";
  const ctaInstruction = offerTrimmed
    ? `CTA должен вести на: ${offerTrimmed}`
    : "Завершение с призывом подписаться или оставить комментарий.";

  const sourceBlock = transcript
    ? `Вот транскрипция вирусного видео: ${transcript}. Создай похожий сценарий для Shorts`
    : `Название оригинального видео: ${title}\nТекст оригинала: субтитры недоступны`;

  return `Ты эксперт по вирусному контенту для русскоязычной аудитории.

Пиши живым разговорным языком, избегай канцелярита и очевидных ИИ-шных фраз. Текст должен звучать как живой человек говорит на камеру.

Тема ниши: ${niche}
${transcript ? `Название оригинального видео: ${title}\n${sourceBlock}` : sourceBlock}

Создай адаптированный сценарий для короткого видео (30-60 сек):

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
Разбей основную часть (body) на отдельные предложения — каждое предложение отдельный элемент массива sentences.
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
  if (!Array.isArray(queries)) {
    return [];
  }

  return queries
    .map(String)
    .map((q) => q.trim())
    .filter(Boolean);
}

function parseScriptResponse(text: string): Omit<ScriptResult, "transcriptUsed"> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<
        Omit<ScriptResult, "transcriptUsed">
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

type ClaudeApiError = Error & {
  response?: { data?: unknown };
};

function claudeErrorMessage(status: number, data: unknown): string {
  if (data && typeof data === "object" && data !== null) {
    const apiError = (data as { error?: { message?: string; type?: string } })
      .error;
    if (typeof apiError?.message === "string") {
      const typeSuffix =
        typeof apiError.type === "string" ? ` (${apiError.type})` : "";
      return `Claude API ${status}: ${apiError.message}${typeSuffix}`;
    }
    return `Claude API ${status}: ${JSON.stringify(data)}`;
  }
  return `Claude API ${status}: ${String(data)}`;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 3000
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === retries;
      const isTimeout = error instanceof Error && error.name === "AbortError";
      console.log(`Claude attempt ${attempt} failed (timeout: ${isTimeout}). ${isLast ? "Giving up." : "Retrying..."}`);
      if (isLast) throw error;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("unreachable");
}

async function generateWithClaude(
  prompt: string
): Promise<Omit<ScriptResult, "transcriptUsed">> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const url = `${baseUrl}/v1/messages`;

  console.log("Claude request URL:", url);
  console.log("Claude key prefix:", apiKey?.substring(0, 15));

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);

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
    clearTimeout(timeoutId);

    const data = await res.json();

    if (!res.ok) {
      const err = new Error(claudeErrorMessage(res.status, data)) as ClaudeApiError;
      err.response = { data };
      throw err;
    }

    const content = data.content?.[0]?.text;
    if (typeof content !== "string") {
      throw new Error(
        `Empty response from Claude: ${JSON.stringify(data)}`
      );
    }

    return parseScriptResponse(content);
  } catch (error: unknown) {
    const err = error as ClaudeApiError;
    console.error(
      "Claude API error:",
      err?.message,
      JSON.stringify(err?.response?.data || error)
    );
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}

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

    const transcript = await getTranscript(videoId.trim());
    const transcriptUsed = transcript !== null;

    console.log(
      "generate-script:",
      videoId,
      transcriptUsed ? `transcript ${transcript!.length} chars` : "no transcript"
    );

    const prompt = buildPrompt(
      niche.trim(),
      title.trim(),
      transcript,
      offer,
      language
    );
    const script = await withRetry(() => generateWithClaude(prompt));

    return NextResponse.json({
      ...script,
      transcriptUsed,
    });
  } catch (error: unknown) {
    const err = error as ClaudeApiError;
    console.error(
      "Claude API error:",
      err?.message,
      JSON.stringify(err?.response?.data || error)
    );
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
