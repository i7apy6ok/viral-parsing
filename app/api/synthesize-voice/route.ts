import { NextResponse } from "next/server";

export const maxDuration = 300;

type SynthesizeBody = {
  text: string;
  voice_id?: string;
};

type CreateTaskResponse = {
  task_id?: string;
  id?: string;
};

type TaskStatusResponse = {
  status?: string;
};

export type AudioSegment = {
  start: number;
  end: number;
  text: string;
};

type GroqVerboseTranscription = {
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
};

async function transcribeWithGroq(
  audioBuffer: ArrayBuffer
): Promise<AudioSegment[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("GROQ_API_KEY is not configured, skipping Whisper");
    return [];
  }

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audioBuffer], { type: "audio/mpeg" }),
    "audio.mp3"
  );
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  const groqRes = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    }
  );

  if (!groqRes.ok) {
    const errorText = await groqRes.text();
    console.error("Groq Whisper error:", groqRes.status, errorText);
    return [];
  }

  const groqData = (await groqRes.json()) as GroqVerboseTranscription;
  return (groqData.segments ?? [])
    .map((segment) => ({
      start: Number(segment.start ?? 0),
      end: Number(segment.end ?? 0),
      text: String(segment.text ?? "").trim(),
    }))
    .filter((segment) => segment.end > segment.start);
}

const VOICER_BASE_URL = "https://voiceapi.csv666.ru";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;
const VOICER_FETCH_TIMEOUT_MS = 200_000;
const VOICER_MAX_WAIT_SEC =
  (MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function voicerErrorMessage(status: number): string {
  if (status === 401) return "Неверный API ключ Voicer";
  if (status === 402) return "Недостаточно баланса Voicer — пополните счёт";
  if (status === 429) return "Слишком много задач, подождите";
  return `Ошибка Voicer: ${status}`;
}

async function voicerFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
  attempt = 1
): Promise<Response> {
  const url = `${VOICER_BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    VOICER_FETCH_TIMEOUT_MS
  );

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "X-API-Key": apiKey,
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new VoicerHttpError(
        504,
        `Превышено время ожидания ответа Voicer (${VOICER_FETCH_TIMEOUT_MS / 1000} сек)`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  console.log(
    `Voicer ${options.method ?? "GET"} ${path} → ${res.status}${attempt > 1 ? ` (retry ${attempt})` : ""}`
  );

  if (res.status === 429 && attempt < 6) {
    const delayMs = 3000 * attempt;
    console.log(`Voicer 429, retry in ${delayMs}ms`);
    await sleep(delayMs);
    return voicerFetch(path, apiKey, options, attempt + 1);
  }

  if (res.status === 401 || res.status === 402 || res.status === 429) {
    throw new VoicerHttpError(res.status, voicerErrorMessage(res.status));
  }

  return res;
}

class VoicerHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<SynthesizeBody>;
    const { text, voice_id } = body;

    if (!text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = process.env.VOICER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "VOICER_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const voiceId = voice_id?.trim() || DEFAULT_VOICE_ID;

    const createRes = await voicerFetch("/tasks", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.trim(),
        template: {
          voice_id: voiceId,
          voice_settings: { stability: 0.85, speed: 1.0 },
        },
      }),
    });

    if (!createRes.ok) {
      return NextResponse.json(
        { error: voicerErrorMessage(createRes.status) },
        { status: createRes.status }
      );
    }

    const createData = (await createRes.json()) as CreateTaskResponse;
    const taskId = createData.task_id ?? createData.id;

    if (!taskId) {
      console.error("Voicer: task_id отсутствует в ответе", createData);
      return NextResponse.json(
        { error: "Voicer не вернул task_id" },
        { status: 502 }
      );
    }

    console.log("Voicer task_id:", taskId);

    let finalStatus: string | undefined;

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const statusRes = await voicerFetch(
        `/tasks/${taskId}/status`,
        apiKey
      );

      if (!statusRes.ok) {
        return NextResponse.json(
          { error: voicerErrorMessage(statusRes.status) },
          { status: statusRes.status }
        );
      }

      const statusData = (await statusRes.json()) as TaskStatusResponse;
      finalStatus = statusData.status;
      console.log(
        `Voicer poll ${attempt}/${MAX_POLL_ATTEMPTS}: status=${finalStatus}`
      );

      if (finalStatus === "error") {
        return NextResponse.json(
          { error: "Ошибка синтеза речи" },
          { status: 500 }
        );
      }

      if (finalStatus === "ending") {
        break;
      }

      if (attempt === MAX_POLL_ATTEMPTS) {
        return NextResponse.json(
          {
            error: `Превышено время ожидания (${VOICER_MAX_WAIT_SEC} сек)`,
          },
          { status: 504 }
        );
      }
    }

    if (finalStatus !== "ending") {
      return NextResponse.json(
        {
          error: `Превышено время ожидания (${VOICER_MAX_WAIT_SEC} сек)`,
        },
        { status: 504 }
      );
    }

    const resultRes = await voicerFetch(`/tasks/${taskId}/result`, apiKey);

    if (!resultRes.ok) {
      return NextResponse.json(
        { error: voicerErrorMessage(resultRes.status) },
        { status: resultRes.status }
      );
    }

    const audioBuffer = await resultRes.arrayBuffer();
    const segments = await transcribeWithGroq(audioBuffer);

    return NextResponse.json({
      audioBase64: Buffer.from(audioBuffer).toString("base64"),
      segments,
    });
  } catch (error) {
    if (error instanceof VoicerHttpError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("synthesize-voice error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
