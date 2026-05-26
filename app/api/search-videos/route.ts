import { NextResponse } from "next/server";

type SearchVideosBody = {
  queries?: string[];
};

type PexelsVideoFile = {
  quality?: string;
  file_type?: string;
  link?: string;
  width?: number;
  height?: number;
};

type PexelsVideo = {
  id: number;
  duration: number;
  image: string;
  video_files?: PexelsVideoFile[];
};

type PexelsSearchResponse = {
  videos?: PexelsVideo[];
};

export type SearchVideoResult = {
  query: string;
  id: number;
  url: string;
  preview: string;
  duration: number;
};

const PEXELS_SEARCH_URL = "https://api.pexels.com/videos/search";

function pickHdMp4Url(videoFiles: PexelsVideoFile[]): string | null {
  const mp4Files = videoFiles.filter((file) => file.file_type === "video/mp4");
  if (mp4Files.length === 0) {
    return null;
  }

  const hdFiles = mp4Files.filter((file) => file.quality === "hd");
  const candidates = hdFiles.length > 0 ? hdFiles : mp4Files;

  const best = candidates.reduce((current, file) => {
    const currentArea = (current.width ?? 0) * (current.height ?? 0);
    const fileArea = (file.width ?? 0) * (file.height ?? 0);
    return fileArea > currentArea ? file : current;
  });

  return best.link ?? null;
}

async function searchPexelsVideos(
  query: string,
  apiKey: string
): Promise<SearchVideoResult[]> {
  const params = new URLSearchParams({
    query,
    per_page: "3",
    orientation: "portrait",
  });

  const res = await fetch(`${PEXELS_SEARCH_URL}?${params}`, {
    headers: {
      Authorization: apiKey,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Pexels API error:", query, res.status, errorText);
    return [];
  }

  const data = (await res.json()) as PexelsSearchResponse;
  const videos = data.videos ?? [];

  return videos
    .map((video) => {
      const url = pickHdMp4Url(video.video_files ?? []);
      if (!url) {
        return null;
      }

      return {
        query,
        id: video.id,
        url,
        preview: video.image,
        duration: video.duration,
      };
    })
    .filter((video): video is SearchVideoResult => video !== null);
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "PEXELS_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as SearchVideosBody;
    const queries = (body.queries ?? [])
      .map((query) => query.trim())
      .filter(Boolean);

    if (queries.length === 0) {
      return NextResponse.json(
        { error: "queries must be a non-empty array" },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      queries.map((query) => searchPexelsVideos(query, apiKey))
    );

    return NextResponse.json(results.flat());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("search-videos error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
