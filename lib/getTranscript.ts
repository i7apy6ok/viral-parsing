const TRANSCRIPT_SERVICE_URL = "https://viral-parsing-production.up.railway.app/transcript";
const RAPIDAPI_TRANSCRIPT_URL =
  "https://youtube-transcript3.p.rapidapi.com/api/transcript";

type RapidApiSegment = {
  text: string;
  start: number;
  duration: number;
};

async function getTranscriptFromRailway(
  videoId: string
): Promise<string | null> {
  try {
    const res = await fetch(TRANSCRIPT_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });

    if (!res.ok) {
      console.error("getTranscript service error:", res.status, videoId);
      return null;
    }

    const data = (await res.json()) as { transcript?: string };
    const transcript = data.transcript?.trim();
    return transcript || null;
  } catch (error) {
    console.error("getTranscript unavailable:", videoId, error);
    return null;
  }
}

async function getTranscriptFromRapidApi(
  videoId: string
): Promise<string | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.log("[getTranscript] RapidAPI skipped: RAPIDAPI_KEY not set");
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const url = `${RAPIDAPI_TRANSCRIPT_URL}?videoId=${encodeURIComponent(videoId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "youtube-transcript3.p.rapidapi.com",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.log(
        `[getTranscript] RapidAPI failed: HTTP ${res.status} for ${videoId}`
      );
      return null;
    }

    const segments = (await res.json()) as RapidApiSegment[];
    if (!Array.isArray(segments) || segments.length === 0) {
      console.log(`[getTranscript] RapidAPI empty for ${videoId}`);
      return null;
    }

    const transcript = segments.map((s) => s.text).join(" ").trim();
    if (!transcript) {
      console.log(`[getTranscript] RapidAPI empty text for ${videoId}`);
      return null;
    }

    console.log(
      `[getTranscript] RapidAPI ok for ${videoId}, length ${transcript.length}`
    );
    return transcript;
  } catch (error) {
    console.log(
      `[getTranscript] RapidAPI error for ${videoId}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getTranscript(videoId: string): Promise<string | null> {
  const railwayTranscript = await getTranscriptFromRailway(videoId);
  if (railwayTranscript) {
    return railwayTranscript;
  }

  console.log("[getTranscript] Railway null, trying RapidAPI...");
  return getTranscriptFromRapidApi(videoId);
}
