import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { imageUrl, prompt } = await req.json();
  if (!imageUrl) return NextResponse.json({ error: "No imageUrl" }, { status: 400 });

  const res = await fetch(
    "https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt: prompt ?? "cinematic motion, smooth camera movement",
        duration: "5",
        aspect_ratio: "16:9",
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({ videoUrl: data?.video?.url ?? null });
}
