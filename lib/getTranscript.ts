const TRANSCRIPT_SERVICE_URL = "https://viral-parsing-production.up.railway.app/transcript";

export async function getTranscript(videoId: string): Promise<string | null> {
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
