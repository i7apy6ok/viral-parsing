import { NextResponse } from "next/server";

const DOWNLOAD_HEADERS = {
  "User-Agent": "Mozilla/5.0",
};

export async function proxyMediaRequest(
  request: Request,
  defaultContentType: string
): Promise<Response> {
  const urlParam = new URL(request.url).searchParams.get("url");

  if (!urlParam?.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return NextResponse.json({ error: "Invalid url protocol" }, { status: 400 });
  }

  const upstream = await fetch(targetUrl.toString(), {
    headers: DOWNLOAD_HEADERS,
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Upstream error: ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const contentType =
    upstream.headers.get("content-type") ?? defaultContentType;
  const contentLength = upstream.headers.get("content-length");

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
  });

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
