import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: "ANTHROPIC_API_KEY is not configured",
    });
  }

  try {
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
        model: "claude-sonnet-4-6",
        max_tokens: 100,
        messages: [
          { role: "user", content: "Скажи только: Привет, я работаю!" },
        ],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const errorMessage =
        typeof data?.error?.message === "string"
          ? data.error.message
          : "Claude API request failed";
      return NextResponse.json({ success: false, error: errorMessage });
    }

    const message = data.content?.[0]?.text;
    if (typeof message !== "string") {
      return NextResponse.json({
        success: false,
        error: "Empty response from Claude",
      });
    }

    return NextResponse.json({ success: true, message });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMessage });
  }
}
