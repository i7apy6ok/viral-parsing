import { NextRequest, NextResponse } from "next/server";
import { Innertube } from "youtubei.js";

export const maxDuration = 300;

type TranscriptSegment = {
  snippet?: { text?: string };
};

export async function POST(req: NextRequest) {
  const { videoId } = (await req.json()) as { videoId?: string };
  if (!videoId) {
    return NextResponse.json({ error: "No videoId" }, { status: 400 });
  }

  // Попытка 1: субтитры через youtubei.js
  try {
    const yt = await Innertube.create({ retrieve_player: false });
    const info = await yt.getInfo(videoId);
    const transcriptData = await info.getTranscript();
    const segments =
      transcriptData?.transcript?.content?.body?.initial_segments ?? [];
    if (segments.length > 0) {
      const text = (segments as TranscriptSegment[])
        .map((s) => s.snippet?.text ?? "")
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 200) {
        return NextResponse.json({ transcript: text, source: "subtitles" });
      }
    }
  } catch (e) {
    console.log(
      "[transcribe] youtubei.js failed, trying transcript-service:",
      e
    );
  }

  // Попытка 2: transcript-service (FastAPI с yt-dlp + Whisper)
  const mergeBase = process.env.MERGE_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${mergeBase}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
      signal: AbortSignal.timeout(240000),
    });
    if (res.ok) {
      const data = (await res.json()) as { transcript?: string };
      if (data.transcript) {
        return NextResponse.json({
          transcript: data.transcript,
          source: "whisper",
        });
      }
    }
  } catch (e) {
    console.log("[transcribe] transcript-service failed:", e);
  }

  return NextResponse.json(
    { error: "Не удалось получить транскрипт" },
    { status: 500 }
  );
}
