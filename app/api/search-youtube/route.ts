import { NextResponse } from "next/server";

type VideoType = "short" | "long";
export type Period = "7d" | "14d" | "30d" | "90d" | "all";
export type SortBy = "viralScore" | "views" | "likes" | "velocity";

export type VideoLanguage = "ru" | "en" | "es";

type SearchBody = {
  keyword: string;
  type: VideoType;
  newChannelsOnly: boolean;
  minDays?: number;
  maxMonths?: number;
  period: Period;
  minViews?: number;
  sortBy: SortBy;
  languages: string[];
  expandedSearch?: boolean;
};

type YouTubeSearchItem = {
  id: { videoId: string };
  snippet: {
    title: string;
    channelId: string;
    channelTitle: string;
    publishedAt?: string;
    thumbnails: {
      medium?: { url: string };
      high?: { url: string };
      default?: { url: string };
    };
  };
};

type YouTubeVideoItem = {
  id: string;
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
};

type VideoDetails = {
  statistics: YouTubeVideoItem["statistics"];
  durationSeconds: number;
};

type YouTubeChannelItem = {
  id: string;
  snippet: { publishedAt: string; title: string };
  statistics: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
  };
};

export type ViralVideoResult = {
  videoId: string;
  title: string;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  repostCount?: number;
  channelTitle: string;
  channelAge: string;
  viralScore: number;
  velocity: number;
  url: string;
  platform?: "youtube" | "vk";
  durationSeconds: number;
};

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const DEFAULT_MIN_VIEWS = 1000;
const YOUTUBE_ID_CHUNK_SIZE = 50;
const MIN_LONG_DURATION_SECONDS = 4 * 60;

const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

const VALID_PERIODS: Period[] = ["7d", "14d", "30d", "90d", "all"];
const VALID_SORT: SortBy[] = ["viralScore", "views", "likes", "velocity"];
const VALID_LANGUAGES: VideoLanguage[] = ["ru", "en", "es"];

const LANGUAGE_TO_REGION: Record<VideoLanguage, string> = {
  ru: "RU",
  en: "US",
  es: "ES",
};

const LANGUAGE_TO_RELEVANCE: Record<VideoLanguage, string> = {
  ru: "ru",
  en: "en",
  es: "es",
};

function chunkIds(ids: string[], size = YOUTUBE_ID_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

async function fetchYouTube<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const keys = [
    process.env.YOUTUBE_API_KEY,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
  ].filter(Boolean) as string[];

  if (keys.length === 0) {
    throw new Error("Нет доступных YouTube API ключей");
  }

  for (const apiKey of keys) {
    console.log("Using API key ending:", apiKey.slice(-6));
    const url = new URL(`${YOUTUBE_API}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (res.status === 403 && JSON.stringify(data).includes("quota")) {
      continue;
    }

    if (!res.ok) {
      throw new Error(data?.error?.message ?? "YouTube API error");
    }

    return data as T;
  }

  throw new Error(
    "Квота YouTube API исчерпана на всех ключах. Попробуйте завтра."
  );
}

/** ISO 8601: PT4M30S, PT1H2M3S */
function parseIso8601Duration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

async function fetchVideoDetails(
  videoIds: string[]
): Promise<Map<string, VideoDetails>> {
  const detailsByVideoId = new Map<string, VideoDetails>();
  const chunks = chunkIds(videoIds);
  const part = "statistics,contentDetails";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const videosData = await fetchYouTube<{ items?: YouTubeVideoItem[] }>(
        "videos",
        {
          part,
          id: chunk.join(","),
        }
      );
      for (const item of videosData.items ?? []) {
        const durationIso = item.contentDetails?.duration ?? "PT0S";
        detailsByVideoId.set(item.id, {
          statistics: item.statistics,
          durationSeconds: parseIso8601Duration(durationIso),
        });
      }
      console.log(
        `videos.list chunk ${i + 1}/${chunks.length}:`,
        videosData.items?.length ?? 0
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `videos.list chunk ${i + 1}/${chunks.length} (${chunk.length} ids) failed:`,
        message
      );
      throw error;
    }
  }

  return detailsByVideoId;
}

async function fetchChannels(
  channelIds: string[]
): Promise<YouTubeChannelItem[]> {
  const allChannels: YouTubeChannelItem[] = [];
  const chunks = chunkIds(channelIds);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const channelsData = await fetchYouTube<{ items?: YouTubeChannelItem[] }>(
        "channels",
        {
          part: "snippet,statistics",
          id: chunk.join(","),
        }
      );
      const items = channelsData.items ?? [];
      allChannels.push(...items);
      console.log(
        `channels.list chunk ${i + 1}/${chunks.length}:`,
        items.length
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `channels.list chunk ${i + 1}/${chunks.length} (${chunk.length} ids) failed:`,
        message
      );
      throw error;
    }
  }

  return allChannels;
}

function periodToPublishedAfter(period: Period): string | undefined {
  if (period === "all") return undefined;
  const days = PERIOD_DAYS[period];
  return new Date(Date.now() - days * 86400000).toISOString();
}

function parseCount(value?: string): number {
  return parseInt(value ?? "0", 10) || 0;
}

function formatChannelAge(publishedAt: string): string {
  const created = new Date(publishedAt);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 1) return "менее 1 дня";
  if (diffDays < 30) return `${diffDays} дн.`;
  const months = Math.floor(diffDays / 30);
  return `${months} мес.`;
}

/** Дата создания канала (channels.list snippet.publishedAt), не видео */
function isChannelInNewRange(
  channelPublishedAt: string,
  minDays: number,
  maxMonths: number
): boolean {
  const created = new Date(channelPublishedAt);
  const now = new Date();
  const oldestAllowed = new Date(now);
  oldestAllowed.setDate(now.getDate() - minDays);
  const newestAllowed = new Date(now);
  newestAllowed.setDate(now.getDate() - maxMonths * 30);

  return created >= newestAllowed && created <= oldestAllowed;
}

function getThumbnail(
  thumbnails: YouTubeSearchItem["snippet"]["thumbnails"]
): string {
  return (
    thumbnails.medium?.url ??
    thumbnails.high?.url ??
    thumbnails.default?.url ??
    ""
  );
}

function buildSearchQuery(keyword: string, type: VideoType): string {
  const q = keyword.trim();
  if (type === "short") {
    return `${q} #shorts`;
  }
  return q;
}

function buildSearchParams(
  keyword: string,
  type: VideoType,
  period: Period,
  regionCode: string,
  relevanceLanguage: string
): Record<string, string> {
  const params: Record<string, string> = {
    part: "snippet",
    q: buildSearchQuery(keyword, type),
    type: "video",
    maxResults: "50",
    order: "viewCount",
    regionCode,
    relevanceLanguage,
  };
  if (type === "short") {
    params.videoDuration = "short";
  }
  const publishedAfter = periodToPublishedAfter(period);
  if (publishedAfter) {
    params.publishedAfter = publishedAfter;
  }
  return params;
}

async function fetchSearchItems(
  keyword: string,
  type: VideoType,
  period: Period,
  languages: VideoLanguage[]
): Promise<YouTubeSearchItem[]> {
  const seen = new Set<string>();
  const merged: YouTubeSearchItem[] = [];

  for (const lang of languages) {
    const regionCode = LANGUAGE_TO_REGION[lang];
    const relevanceLanguage = LANGUAGE_TO_RELEVANCE[lang];
    try {
      const searchData = await fetchYouTube<{ items?: YouTubeSearchItem[] }>(
        "search",
        buildSearchParams(keyword, type, period, regionCode, relevanceLanguage)
      );
      console.log(
        `search.list [${lang}, regionCode=${regionCode}]:`,
        searchData.items?.length ?? 0
      );

      for (const item of searchData.items ?? []) {
        const videoId = item.id.videoId;
        if (seen.has(videoId)) continue;
        seen.add(videoId);
        merged.push(item);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `search.list [${lang}, regionCode=${regionCode}] failed:`,
        message
      );
      throw error;
    }
  }

  console.log("После объединения (уникальные videoId):", merged.length);
  return merged;
}

function sortResults(results: ViralVideoResult[], sortBy: SortBy): void {
  const comparators: Record<
    SortBy,
    (a: ViralVideoResult, b: ViralVideoResult) => number
  > = {
    viralScore: (a, b) => b.viralScore - a.viralScore,
    views: (a, b) => b.viewCount - a.viewCount,
    likes: (a, b) => b.likeCount - a.likeCount,
    velocity: (a, b) => b.velocity - a.velocity,
  };
  results.sort(comparators[sortBy]);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<SearchBody>;
    const {
      keyword,
      type,
      newChannelsOnly,
      minDays: rawMinDays,
      maxMonths: rawMaxMonths,
      period = "all",
      minViews = DEFAULT_MIN_VIEWS,
      sortBy = "views",
      languages: rawLanguages,
      expandedSearch = true,
    } = body;

    if (!keyword?.trim()) {
      return NextResponse.json(
        { error: "keyword is required" },
        { status: 400 }
      );
    }

    if (type !== "short" && type !== "long") {
      return NextResponse.json(
        { error: 'type must be "short" or "long"' },
        { status: 400 }
      );
    }

    if (typeof newChannelsOnly !== "boolean") {
      return NextResponse.json(
        { error: "newChannelsOnly must be a boolean" },
        { status: 400 }
      );
    }

    const minDays =
      typeof rawMinDays === "number" && rawMinDays > 0 ? rawMinDays : 5;
    const maxMonths =
      typeof rawMaxMonths === "number" && rawMaxMonths > 0
        ? rawMaxMonths
        : 3;

    if (newChannelsOnly) {
      console.log("[newChannelsOnly] диапазон:", {
        minDays,
        maxMonths,
        maxAgeDays: maxMonths * 30,
      });
    }

    if (!VALID_PERIODS.includes(period as Period)) {
      return NextResponse.json({ error: "invalid period" }, { status: 400 });
    }

    if (!VALID_SORT.includes(sortBy as SortBy)) {
      return NextResponse.json({ error: "invalid sortBy" }, { status: 400 });
    }

    if (!Array.isArray(rawLanguages) || rawLanguages.length === 0) {
      return NextResponse.json(
        { error: "languages must be a non-empty array" },
        { status: 400 }
      );
    }

    const languages = rawLanguages.filter((l): l is VideoLanguage =>
      VALID_LANGUAGES.includes(l as VideoLanguage)
    );

    if (languages.length === 0) {
      return NextResponse.json(
        { error: "languages must include ru, en, or es" },
        { status: 400 }
      );
    }

    console.log("languages:", languages);

    const minViewsNum =
      typeof minViews === "number" && minViews >= 0
        ? minViews
        : DEFAULT_MIN_VIEWS;

    const publishedAfter = periodToPublishedAfter(period as Period);
    if (publishedAfter) {
      console.log("publishedAfter:", publishedAfter, "period:", period);
    }

    // Генерируем синонимы через OpenRouter если expandedSearch включён
    let keywords = [keyword.trim()];
    if (expandedSearch && process.env.OPENROUTER_API_KEY) {
      try {
        const synRes = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "HTTP-Referer": "https://viral-parsing.vercel.app",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              max_tokens: 200,
              messages: [
                {
                  role: "user",
                  content: `Дай 5 синонимов и смежных поисковых запросов для YouTube на тему "${keyword.trim()}". Только слова/фразы через запятую, без нумерации и пояснений. Пример для "диета": похудение, правильное питание, калории, дефицит калорий, жиросжигание`,
                },
              ],
            }),
          }
        );
        if (synRes.ok) {
          const synData = (await synRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const synText = synData.choices?.[0]?.message?.content ?? "";
          const synonyms = synText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 5);
          keywords = [keyword.trim(), ...synonyms];
          console.log("[expandedSearch] keywords:", keywords);
        }
      } catch (err) {
        console.warn("[expandedSearch] synonym generation failed:", err);
      }
    }

    // Параллельный поиск по всем ключевым словам
    const allSearchResults = await Promise.all(
      keywords.map((kw) =>
        fetchSearchItems(kw, type, period as Period, languages)
      )
    );
    // Дедупликация по videoId
    const seenIds = new Set<string>();
    const searchItems = allSearchResults.flat().filter((item) => {
      const id = item.id?.videoId;
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
    console.log("[search] total items after dedup:", searchItems.length);

    console.log("Найдено видео:", searchItems.length);
    if (searchItems.length === 0) {
      return NextResponse.json([]);
    }

    const videoIds = searchItems.map((item) => item.id.videoId);
    const videoDetailsById = await fetchVideoDetails(videoIds);
    console.log("videos.list всего деталей:", videoDetailsById.size);

    const channelIds = Array.from(
      new Set(searchItems.map((item) => item.snippet.channelId))
    );
    const channels = await fetchChannels(channelIds);
    console.log("channels.list всего каналов:", channels.length);
    console.log("Пример канала:", {
      channelId: channels[0]?.id,
      channelTitle: channels[0]?.snippet?.title,
      channelCreatedAt: channels[0]?.snippet?.publishedAt,
      subscribers: channels[0]?.statistics?.subscriberCount,
    });

    const channelById = new Map(channels.map((item) => [item.id, item]));

    const afterChannelFilter: ViralVideoResult[] = [];
    let channelFilterLogCount = 0;
    let skippedByNewChannel = 0;
    let skippedByDuration = 0;

    for (const item of searchItems) {
      const videoId = item.id.videoId;
      const channelId = item.snippet.channelId;
      const channel = channelById.get(channelId);
      const videoDetails = videoDetailsById.get(videoId);

      if (!channel || !videoDetails) continue;

      if (
        type === "long" &&
        videoDetails.durationSeconds <= MIN_LONG_DURATION_SECONDS
      ) {
        skippedByDuration++;
        continue;
      }

      const statistics = videoDetails.statistics;

      const channelCreatedAt = channel.snippet.publishedAt;

      if (newChannelsOnly) {
        const passes = isChannelInNewRange(
          channelCreatedAt,
          minDays,
          maxMonths
        );
        if (channelFilterLogCount < 5) {
          console.log("[newChannelsOnly] канал:", {
            channelId,
            channelTitle: channel.snippet.title,
            channelCreatedAt,
            minDays,
            maxMonths,
            passes,
            source: "channels.list snippet.publishedAt",
          });
          channelFilterLogCount++;
        }
        if (!passes) {
          skippedByNewChannel++;
          continue;
        }
      }

      const viewCount = parseCount(statistics.viewCount);
      const subscriberCount = parseCount(channel.statistics.subscriberCount);
      const channelTotalViews = parseCount(channel.statistics.viewCount);
      const channelVideoCount = parseCount(channel.statistics.videoCount) || 1;
      const avgViewsPerVideo = channelTotalViews / channelVideoCount;
      const viralMultiplier =
        avgViewsPerVideo > 0
          ? viewCount / avgViewsPerVideo
          : viewCount / (subscriberCount + 1);
      const viralScore = viralMultiplier;

      const publishedAt = item.snippet.publishedAt;
      const hoursAgo = publishedAt
        ? (Date.now() - new Date(publishedAt).getTime()) / 3600000
        : 0;
      const velocity =
        hoursAgo > 0 ? Math.round(viewCount / hoursAgo) : 0;

      afterChannelFilter.push({
        videoId,
        title: item.snippet.title,
        thumbnail: getThumbnail(item.snippet.thumbnails),
        viewCount,
        likeCount: parseCount(statistics.likeCount),
        commentCount: parseCount(statistics.commentCount),
        channelTitle: item.snippet.channelTitle,
        channelAge: formatChannelAge(channelCreatedAt),
        viralScore,
        velocity,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        durationSeconds: videoDetails?.durationSeconds ?? 0,
      });
    }

    console.log(
      "После фильтра каналов:",
      afterChannelFilter.length,
      "| отсеяно newChannelsOnly:",
      skippedByNewChannel,
      "| отсеяно duration:",
      skippedByDuration
    );

    let results = afterChannelFilter.filter((v) => v.viewCount >= minViewsNum);
    console.log(
      `После minViews (>= ${minViewsNum}):`,
      results.length,
      "отсеяно:",
      afterChannelFilter.length - results.length
    );

    const sortByValue = sortBy as SortBy;

    if (sortByValue === "viralScore") {
      const beforeViral = results.length;
      results = results.filter((v) => v.viralScore > 3);
      console.log(
        "После viralScore > 3:",
        results.length,
        "отсеяно:",
        beforeViral - results.length
      );
    }

    sortResults(results, sortByValue);

    if (
      results.length === 0 &&
      afterChannelFilter.length > 0 &&
      sortByValue === "viralScore"
    ) {
      const fallback = afterChannelFilter.filter(
        (v) => v.viewCount >= minViewsNum
      );
      sortResults(fallback, sortByValue);
      results = fallback.slice(0, 10);
      console.log("Fallback: топ-10 без viralScore > 3:", results.length);
    }

    console.log("Итого в ответе:", results.length, "sortBy:", sortBy);

    return NextResponse.json(results);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
