import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

type AnimateModel = "kling" | "wan26";

async function enhancePromptForVideo(rawPrompt: string): Promise<string> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `You are an expert at writing image-to-video animation prompts.
Convert this text into a motion prompt in English (max 50 words).
Focus on: camera movement, motion type, speed, atmosphere. Stay faithful to the scene, NO fantasy elements, NO wings, NO magical effects unless text implies them.
Return ONLY the prompt, nothing else.

Text: "${rawPrompt}"`,
          },
        ],
      }),
    });
    if (!res.ok) return rawPrompt;
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content?.trim() as string) || rawPrompt;
  } catch {
    return rawPrompt;
  }
}

async function animateWithKling(imageUrl: string, prompt: string): Promise<string> {
  const res = await fetch(
    "https://fal.run/fal-ai/kling-video/v2.1/standard/image-to-video",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt,
        duration: "5",
        aspect_ratio: "16:9",
      }),
    }
  );
  if (!res.ok) throw new Error(`Kling error: ${await res.text()}`);
  const data = await res.json();
  const videoUrl = data?.video?.url ?? null;
  if (!videoUrl) throw new Error("Kling не вернул видео");
  return videoUrl;
}

const RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/wan-2-6-i2v";

async function animateWithWan(imageUrl: string, prompt: string): Promise<string> {
  const submitRes = await fetch(`${RUNPOD_ENDPOINT}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({
      input: {
        prompt,
        image: imageUrl,
        negative_prompt: "",
        size: "720p",
        duration: 5,
        shot_type: "single",
        seed: -1,
        enable_prompt_expansion: false,
        enable_safety_checker: true,
      },
    }),
  });
  if (!submitRes.ok) throw new Error(`RunPod submit error: ${await submitRes.text()}`);
  const { id: jobId } = await submitRes.json();
  if (!jobId) throw new Error("RunPod не вернул job id");

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${RUNPOD_ENDPOINT}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` },
    });
    if (!statusRes.ok) throw new Error(`RunPod status error: ${await statusRes.text()}`);
    const data = await statusRes.json();
    if (data.status === "COMPLETED") {
      const out = data.output;

      const url =
        data.result ??
        (typeof out === "string" ? out : null) ??
        (Array.isArray(out)
          ? (out[0]?.video_url ?? out[0]?.url ?? out[0])
          : null) ??
        (out && typeof out === "object"
          ? (out.video_url ?? out.url ?? out.mp4 ?? out.video)
          : null) ??
        null;

      if (!url)
        throw new Error(
          `Wan 2.6 неизвестная структура: ${JSON.stringify(data)}`
        );
      return url as string;
    }
    if (data.status === "FAILED" || data.status === "CANCELLED") {
      throw new Error(`Wan 2.6 job ${data.status}: ${data.error ?? ""}`);
    }
  }
  throw new Error("Wan 2.6: превышено время ожидания (2 мин)");
}

export async function POST(req: NextRequest) {
  const { imageUrl, prompt, model } = (await req.json()) as {
    imageUrl?: string;
    prompt?: string;
    model?: AnimateModel;
  };
  if (!imageUrl) return NextResponse.json({ error: "No imageUrl" }, { status: 400 });

  const enhancedPrompt = await enhancePromptForVideo(prompt ?? "");
  const animateModel: AnimateModel = model === "wan26" ? "wan26" : "kling";

  try {
    const videoUrl =
      animateModel === "wan26"
        ? await animateWithWan(imageUrl, enhancedPrompt)
        : await animateWithKling(imageUrl, enhancedPrompt);
    return NextResponse.json({ videoUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка анимации" },
      { status: 500 }
    );
  }
}
