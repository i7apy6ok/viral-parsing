import { proxyMediaRequest } from "@/lib/proxyMedia";

export async function GET(request: Request) {
  try {
    return await proxyMediaRequest(request, "video/mp4");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("proxy-video error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
