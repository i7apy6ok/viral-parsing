import { NextRequest, NextResponse } from "next/server";

async function enhancePromptForImage(rawPrompt: string): Promise<string> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `You are an expert at writing image generation prompts for Flux.
Convert this short text into a detailed visual prompt in English (max 80 words).
Focus on: visual composition, lighting, mood, style details. No people unless specified. No text in image.
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

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();
  if (!prompt) return NextResponse.json({ error: "No prompt" }, { status: 400 });

  const enhancedPrompt = await enhancePromptForImage(prompt);

  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: enhancedPrompt,
      image_size: "landscape_16_9",
      num_images: 1,
      num_inference_steps: 4,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({ imageUrl: data?.images?.[0]?.url ?? null });
}
