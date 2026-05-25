import { NextResponse } from "next/server";
import type { Period, SortBy, ViralVideoResult } from "../search-youtube/route";

type VideoType = "short" | "long";

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
};

type VkVideo = {
  id: number;
  owner_id: number;
  title: string;
  duration: number;
  views: number;
  date: number;
  comments?: number;
  likes?: { count?: number };
  reposts?: { count?: number };
  photo_800?: string;
  photo_320?: string;
  image?: Array<{ url?: string; width?: number }>;
};

type VkUser = {
  id: number;
  first_name: string;
  last_name: string;
  followers_count?: number;
};

type VkGroup = {
  id: number;
  name: string;
  start_date?: number;
  members_count?: number;
};

type OwnerInfo = {
  title: string;
  followers: number;
  registeredAt: Date | null;
};

const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.131";
const DEFAULT_MIN_VIEWS = 1000;

const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

const VALID_PERIODS: Period[] = ["7d", "14d", "30d", "90d", "all"];
const VALID_SORT: SortBy[] = ["viralScore", "views", "likes"];

async function vkApi<T>(
  method: string,
  params: Record<string, string | number>
): Promise<T> {
  const token = process.env.VK_ACCESS_TOKEN;
  if (!token) {
    throw new Error("VK_ACCESS_TOKEN is not configured");
  }

  const url = new URL(`${VK_API}/${method}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("v", VK_VERSION);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  try {
    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      const message =
        typeof data.error.error_msg === "string"
          ? data.error.error_msg
          : "VK API request failed";
      console.error(`VK API [${method}]:`, data.error);
      throw new Error(message);
    }

    return data.response as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`VK API [${method}] failed:`, message);
    throw error;
  }
}

function periodToMinTimestamp(period: Period): number | null {
  if (period === "all") return null;
  const days = PERIOD_DAYS[period];
  return Math.floor((Date.now() - days * 86400000) / 1000);
}

function formatChannelAge(registeredAt: Date | null): string {
  if (!registeredAt) return "—";

  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - registeredAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 1) return "менее 1 дня";
  if (diffDays < 30) return `${diffDays} дн.`;
  return `${Math.floor(diffDays / 30)} мес.`;
}

function isAccountInNewRange(
  registeredAt: Date | null,
  minDays: number,
  maxMonths: number
): boolean {
  if (!registeredAt) return false;

  const now = new Date();
  const oldestAllowed = new Date(now);
  oldestAllowed.setDate(now.getDate() - minDays);
  const newestAllowed = new Date(now);
  newestAllowed.setDate(now.getDate() - maxMonths * 30);

  return registeredAt >= newestAllowed && registeredAt <= oldestAllowed;
}

function getThumbnail(video: VkVideo): string {
  if (video.photo_800) return video.photo_800;
  if (video.photo_320) return video.photo_320;
  const sorted = [...(video.image ?? [])].sort(
    (a, b) => (b.width ?? 0) - (a.width ?? 0)
  );
  return sorted[0]?.url ?? "";
}

function sortResults(results: ViralVideoResult[], sortBy: SortBy): void {
  const comparators: Record<
    SortBy,
    (a: ViralVideoResult, b: ViralVideoResult) => number
  > = {
    viralScore: (a, b) => b.viralScore - a.viralScore,
    views: (a, b) => b.viewCount - a.viewCount,
    likes: (a, b) => b.likeCount - a.likeCount,
  };
  results.sort(comparators[sortBy]);
}

async function fetchOwnersInfo(
  ownerIds: number[]
): Promise<Map<number, OwnerInfo>> {
  const map = new Map<number, OwnerInfo>();
  const userIds = ownerIds.filter((id) => id > 0);
  const groupIds = ownerIds.filter((id) => id < 0).map((id) => Math.abs(id));

  if (userIds.length > 0) {
    const users = await vkApi<VkUser[]>("users.get", {
      user_ids: userIds.join(","),
      fields: "followers_count",
    });
    console.log("users.get raw response:", JSON.stringify(users).slice(0, 500));

    for (const user of users ?? []) {
      map.set(user.id, {
        title: `${user.first_name} ${user.last_name}`.trim(),
        followers: user.followers_count ?? 0,
        registeredAt: null,
      });
    }
  }

  if (groupIds.length > 0) {
    const groups = await vkApi<VkGroup[]>("groups.getById", {
      group_ids: groupIds.join(","),
      fields: "members_count,start_date",
    });
    console.log(
      "groups.getById raw response:",
      JSON.stringify(groups).slice(0, 500)
    );

    for (const group of groups ?? []) {
      map.set(-group.id, {
        title: group.name,
        followers: group.members_count ?? 0,
        registeredAt: group.start_date
          ? new Date(group.start_date * 1000)
          : null,
      });
    }
  }

  return map;
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

    if (!VALID_PERIODS.includes(period as Period)) {
      return NextResponse.json({ error: "invalid period" }, { status: 400 });
    }

    if (!VALID_SORT.includes(sortBy as SortBy)) {
      return NextResponse.json({ error: "invalid sortBy" }, { status: 400 });
    }

    const minDays =
      typeof rawMinDays === "number" && rawMinDays > 0 ? rawMinDays : 5;
    const maxMonths =
      typeof rawMaxMonths === "number" && rawMaxMonths > 0
        ? rawMaxMonths
        : 3;
    const minViewsNum =
      typeof minViews === "number" && minViews >= 0
        ? minViews
        : DEFAULT_MIN_VIEWS;
    const sortByValue = sortBy as SortBy;
    const minPeriodTs = periodToMinTimestamp(period as Period);

    const searchResponse = await vkApi<{ count?: number; items?: VkVideo[] }>(
      "video.search",
      {
        q: keyword.trim(),
        count: 200,
        sort: 1,
        adult: 0,
      }
    );

    const rawVideos = searchResponse.items ?? [];
    console.log("VK video.search:", rawVideos.length);
    rawVideos.slice(0, 3).forEach((video, i) => {
      console.log(`rawVideos[${i}]:`, {
        id: video.id,
        duration: video.duration,
        views: video.views,
      });
    });

    let videos = rawVideos;

    if (minPeriodTs !== null) {
      videos = videos.filter((video) => video.date >= minPeriodTs);
      console.log("После фильтра period:", videos.length);
    }

    videos = videos.filter((video) => video.views >= minViewsNum);
    console.log(`После minViews (>= ${minViewsNum}):`, videos.length);

    const ownerIds = Array.from(new Set(videos.map((v) => v.owner_id)));
    const ownersById = await fetchOwnersInfo(ownerIds);
    console.log("Загружено авторов:", ownersById.size);

    const results: ViralVideoResult[] = [];
    let skippedByNewChannel = 0;

    for (const video of videos) {
      const owner = ownersById.get(video.owner_id);
      if (!owner) continue;

      if (newChannelsOnly) {
        const passes = isAccountInNewRange(
          owner.registeredAt,
          minDays,
          maxMonths
        );
        if (!passes) {
          skippedByNewChannel++;
          continue;
        }
      }

      const viewCount = video.views ?? 0;
      const likeCount = video.likes?.count ?? 0;
      const commentCount = video.comments ?? 0;
      const repostCount = video.reposts?.count ?? 0;
      const viralScore = viewCount / (owner.followers + 1);
      const videoId = `${video.owner_id}_${video.id}`;

      results.push({
        videoId,
        title: video.title,
        thumbnail: getThumbnail(video),
        viewCount,
        likeCount,
        commentCount,
        repostCount,
        channelTitle: owner.title,
        channelAge: formatChannelAge(owner.registeredAt),
        viralScore,
        url: `https://vk.com/video${video.owner_id}_${video.id}`,
        platform: "vk",
      });
    }

    console.log("После фильтра авторов:", results.length);
    if (newChannelsOnly) {
      console.log("Отсеяно по newChannelsOnly:", skippedByNewChannel);
    }

    let filtered = results;

    if (sortByValue === "viralScore") {
      filtered = filtered.filter((v) => v.viralScore > 1);
    }

    sortResults(filtered, sortByValue);

    if (
      filtered.length === 0 &&
      results.length > 0 &&
      sortByValue === "viralScore"
    ) {
      const fallback = [...results];
      sortResults(fallback, sortByValue);
      filtered = fallback.slice(0, 10);
    }

    console.log("Итого в ответе:", filtered.length, "sortBy:", sortByValue);

    return NextResponse.json(filtered);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
