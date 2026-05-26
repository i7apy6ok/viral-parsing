import { NextResponse } from "next/server";
import { getTranscript } from "@/lib/getTranscript";

type GenerateScriptBody = {
  videoId: string;
  title: string;
  niche: string;
  offer?: string;
};

export type ScriptResult = {
  hooks: string[];
  body: string;
  cta: string;
  visualHook: string;
  videoQueries: string[];
  transcriptUsed: boolean;
};

const CLAUDE_MODEL = "claude-sonnet-4-6";

function buildPrompt(
  niche: string,
  title: string,
  transcript: string | null,
  offer?: string
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
5-7 коротких запросов для поиска стокового видео. Запросы должны описывать визуальный ряд для каждой части сценария: хук, основная часть, CTA. Формулируй конкретно и визуально, как для поиска на Pexels. Пример: "woman looking at scale disappointed", "healthy food close up", "woman smiling mirror".

Отвечай структурированно, на русском языке.

В конце верни ТОЛЬКО валидный JSON (без markdown и пояснений) в формате:
{"hooks":["текст хука 1","текст хука 2","текст хука 3"],"body":"основная часть","cta":"призыв к действию","visualHook":"визуальный хук","videoQueries":["query 1","query 2","query 3","query 4","query 5"]}`;
}

function normalizeVideoQueries(queries: unknown): string[] {
  if (!Array.isArray(queries)) {
    return [];
  }

  return queries
    .map(String)
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 7);
}

function parseScriptResponse(text: string): Omit<ScriptResult, "transcriptUsed"> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<
        Omit<ScriptResult, "transcriptUsed">
      >;
      if (parsed.hooks && parsed.body && parsed.cta && parsed.visualHook) {
        return {
          hooks: parsed.hooks.slice(0, 3).map(String),
          body: String(parsed.body),
          cta: String(parsed.cta),
          visualHook: String(parsed.visualHook),
          videoQueries: normalizeVideoQueries(parsed.videoQueries),
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

  return {
    hooks:
      hookMatches.length >= 3
        ? hookMatches.slice(0, 3)
        : ["", "", ""].map((_, i) => hookMatches[i] ?? `Хук ${i + 1}`),
    body: bodyMatch?.[1]?.trim() ?? text.slice(0, 500),
    cta: ctaMatch?.[1]?.trim() ?? "",
    visualHook: visualMatch?.[1]?.trim() ?? "",
    videoQueries: normalizeVideoQueries(fallbackVideoQueries),
  };
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
  });

  const data = await res.json();

  if (!res.ok) {
    const message =
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Claude API request failed";
    console.error("Claude API error:", data);
    throw new Error(message);
  }

  const content = data.content?.[0]?.text;
  if (typeof content !== "string") {
    throw new Error("Empty response from Claude");
  }

  return parseScriptResponse(content);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateScriptBody>;
    const { videoId, title, niche, offer } = body;

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
      offer
    );
    const script = await generateWithClaude(prompt);

    return NextResponse.json({
      ...script,
      transcriptUsed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("generate-script error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
