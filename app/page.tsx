"use client";

import { useEffect, useRef, useState } from "react";
import type { ScriptResult } from "./api/generate-script/route";
import type { SearchVideoResult } from "./api/search-videos/route";
import type {
  Period,
  SortBy,
  VideoLanguage,
  ViralVideoResult,
} from "./api/search-youtube/route";

type FootageGroup = {
  originalQuery: string;
  query: string;
  videos: SearchVideoResult[];
  loading: boolean;
  selectedIndex: number;
};

type ClipMode = "sentences" | "blocks";
type ScriptLanguage = "ru" | "en" | "es";

const SCRIPT_LANGUAGE_OPTIONS: { value: ScriptLanguage; label: string }[] = [
  { value: "ru", label: "🇷🇺 Русский" },
  { value: "en", label: "🇬🇧 English" },
  { value: "es", label: "🇪🇸 Español" },
];

type ScriptPanelState = {
  loading: boolean;
  data: ScriptResult | null;
  error: string | null;
  selectedHook: number | null;
  copiedHook: number | null;
  copiedAll: boolean;
  voiceLoading: boolean;
  voiceError: string | null;
  voiceAudioUrl: string | null;
  voiceAudioBlob: Blob | null;
  audioDuration: number | null;
  footageLoading: boolean;
  footageError: string | null;
  footageGroups: FootageGroup[];
  customFootageQuery: string;
  language: ScriptLanguage;
  clipMode: ClipMode;
  mergeLoading: boolean;
  mergeStatus: string | null;
  mergeError: string | null;
  openFootageIndex: number | null;
};

const FOOTAGE_DEFAULTS = {
  footageLoading: false,
  footageError: null,
  footageGroups: [] as FootageGroup[],
  customFootageQuery: "",
  clipMode: "sentences" as const,
  mergeLoading: false,
  mergeStatus: null,
  mergeError: null,
  openFootageIndex: null,
};

const RAILWAY_MERGE_URL =
  "https://viral-parsing-production.up.railway.app/merge";

function proxyUrl(url: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

const LANGUAGE_OPTIONS: { code: VideoLanguage; label: string }[] = [
  { code: "ru", label: "🇷🇺 Русский" },
  { code: "en", label: "🇺🇸 Английский" },
  { code: "es", label: "🇪🇸 Испанский" },
];

type Platform = "youtube" | "vk";
type VideoType = "short" | "long";

function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-zinc-400">{label}</span>
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${
              value === option.value
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-zinc-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatNumber(n: number): string {
  return n.toLocaleString("ru-RU");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function getSelectedHookIndex(selectedHook: number | null): number {
  return selectedHook ?? 0;
}

function formatCopyAllScript(
  script: ScriptResult,
  selectedHook: number | null
): string {
  const hookIndex = getSelectedHookIndex(selectedHook);
  const hook = script.hooks[hookIndex] ?? script.hooks[0] ?? "";

  return [hook, "", script.body, "", script.cta, "", script.visualHook].join(
    "\n"
  );
}

function stripTranslation(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

function formatVoiceScript(
  script: ScriptResult,
  selectedHook: number | null
): string {
  const hookIndex = getSelectedHookIndex(selectedHook);
  const hook = script.hooks[hookIndex] ?? script.hooks[0] ?? "";

  return [hook, script.body, script.cta]
    .map(stripTranslation)
    .filter(Boolean)
    .join("\n\n");
}

function toggleLanguage(
  current: VideoLanguage[],
  code: VideoLanguage
): VideoLanguage[] {
  if (current.includes(code)) {
    if (current.length === 1) return current;
    return current.filter((l) => l !== code);
  }
  return [...current, code];
}

async function searchFootageVideos(
  queries: string[]
): Promise<SearchVideoResult[]> {
  const res = await fetch("/api/search-videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? "Ошибка поиска видео");
  }

  return data as SearchVideoResult[];
}

function parseRussianTranslation(query: string): string | null {
  const match = query.match(/\(([^)]+)\)\s*$/);
  return match?.[1]?.trim() ?? null;
}

function toPexelsSearchQuery(query: string): string {
  const trimmed = query.trim();
  const withoutTranslation = trimmed.replace(/\s*\([^)]+\)\s*$/, "").trim();
  return withoutTranslation || trimmed;
}

function segmentTextForDuration(
  originalQuery: string,
  language: ScriptLanguage
): string {
  if (language === "ru") {
    return originalQuery;
  }
  return toPexelsSearchQuery(originalQuery);
}

function buildFootageGroups(
  displayQueries: string[],
  searchQueries: string[],
  results: SearchVideoResult[],
  previousGroups: FootageGroup[] = []
): FootageGroup[] {
  return displayQueries.map((query, index) => {
    const search = searchQueries[index] ?? toPexelsSearchQuery(query);
    const previous =
      previousGroups[index] ??
      previousGroups.find((group) => group.originalQuery === query);

    return {
      originalQuery: previous?.originalQuery ?? query,
      query: previous?.query ?? search,
      videos: results.filter((video) => video.query === search),
      loading: false,
      selectedIndex: previous?.selectedIndex ?? 0,
    };
  });
}

function getSelectedFootageClips(groups: FootageGroup[]): SearchVideoResult[] {
  return groups
    .filter((group) => !group.loading && group.videos.length > 0)
    .map(
      (group) =>
        group.videos[group.selectedIndex % group.videos.length]
    );
}

function getFootageQueries(script: ScriptResult, clipMode: ClipMode): string[] {
  if (clipMode === "sentences") {
    return script.sentences
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  return script.videoQueries
    .map((query) => query.trim())
    .filter(Boolean);
}

function estimateSegmentDurations(
  texts: string[],
  totalAudioDuration: number
): number[] {
  if (texts.length === 0) {
    return [];
  }

  const charCounts = texts.map((t) => t.replace(/\s+/g, "").length);
  const totalChars = charCounts.reduce((a, b) => a + b, 0);
  if (totalChars === 0) {
    return texts.map(() => 0);
  }

  return charCounts.map(
    (c) => Math.round((c / totalChars) * totalAudioDuration * 10) / 10
  );
}

function FootageQueryInput({
  defaultQuery,
  disabled,
  onBlurCommit,
  onSearch,
}: {
  defaultQuery: string;
  disabled: boolean;
  onBlurCommit: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex gap-2">
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultQuery}
        disabled={disabled}
        onBlur={(e) => onBlurCommit(e.target.value.trim())}
        className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-600"
        placeholder="Запрос для Pexels"
      />
      <button
        type="button"
        title="Найти другое"
        disabled={disabled}
        onClick={() => {
          const value = inputRef.current?.value.trim() ?? defaultQuery;
          onSearch(value);
        }}
        className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 disabled:opacity-50"
      >
        🔄
      </button>
    </div>
  );
}

function FootageDurationLabel({
  pexelsDuration,
  estimatedDuration,
}: {
  pexelsDuration: number;
  estimatedDuration: number | null;
}) {
  if (estimatedDuration == null) {
    return <p className="text-xs text-zinc-500">{pexelsDuration} сек</p>;
  }

  return (
    <p className="text-xs">
      <span className="text-zinc-500">{pexelsDuration} сек</span>
      <span className="text-zinc-500"> → </span>
      <span className="text-green-400">{estimatedDuration} сек</span>
    </p>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function LazyFootageVideo({
  videoUrl,
  poster,
}: {
  videoUrl: string;
  poster: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || !videoRef.current) {
      return;
    }

    void videoRef.current.play().catch(() => {});
  }, [isVisible, videoUrl]);

  return (
    <div
      ref={containerRef}
      className="mx-auto max-w-[180px] overflow-hidden rounded-lg border border-zinc-700"
    >
      {isVisible ? (
        <video
          ref={videoRef}
          key={videoUrl}
          src={proxyUrl(videoUrl)}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          className="aspect-[9/16] w-full bg-zinc-900 object-cover"
        />
      ) : (
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="aspect-[9/16] w-full bg-zinc-900 object-cover"
        />
      )}
    </div>
  );
}

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [offer, setOffer] = useState("");
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [type, setType] = useState<VideoType>("short");
  const [period, setPeriod] = useState<Period>("30d");
  const [minViews, setMinViews] = useState(10000);
  const [sortBy, setSortBy] = useState<SortBy>("views");
  const [languages, setLanguages] = useState<VideoLanguage[]>([
    "ru",
    "en",
    "es",
  ]);
  const [newChannelsOnly, setNewChannelsOnly] = useState(false);
  const [channelMinDays, setChannelMinDays] = useState(5);
  const [channelMaxMonths, setChannelMaxMonths] = useState(3);
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<ViralVideoResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scripts, setScripts] = useState<Record<string, ScriptPanelState>>(
    {}
  );
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(3);

  const handleSearch = async () => {
    if (!keyword.trim()) {
      setError("Введите нишу для поиска");
      return;
    }

    setLoading(true);
    setError(null);
    setOpenVideoId(null);
    setVideos([]);
    setScripts({});
    setVisibleCount(3);

    const searchPayload = {
      keyword: keyword.trim(),
      type,
      newChannelsOnly,
      minDays: channelMinDays,
      maxMonths: channelMaxMonths,
      period,
      minViews,
      sortBy,
      languages,
    };

    const endpoint =
      platform === "vk" ? "/api/search-vk" : "/api/search-youtube";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchPayload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка поиска");
      }

      setVideos(data as ViralVideoResult[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка поиска");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateScript = async (video: ViralVideoResult) => {
    const id = video.videoId;
    const current = scripts[id];

    if (current?.data || current?.loading) {
      return;
    }

    setScripts((prev) => ({
      ...prev,
      [id]: {
        loading: true,
        data: null,
        error: null,
        selectedHook: null,
        copiedHook: null,
        copiedAll: false,
        voiceLoading: false,
        voiceError: null,
        voiceAudioUrl: null,
        voiceAudioBlob: null,
        audioDuration: null,
        language: current?.language ?? "ru",
        ...FOOTAGE_DEFAULTS,
      },
    }));

    const scriptLanguage = current?.language ?? "ru";

    try {
      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: id,
          title: video.title,
          niche: keyword.trim(),
          offer: offer.trim(),
          language: scriptLanguage,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка генерации сценария");
      }

      const scriptData = data as ScriptResult;

      setScripts((prev) => ({
        ...prev,
        [id]: {
          loading: false,
          data: scriptData,
          error: null,
          selectedHook: null,
          copiedHook: null,
          copiedAll: false,
          voiceLoading: false,
          voiceError: null,
          voiceAudioUrl: null,
          voiceAudioBlob: null,
          audioDuration: null,
          language: prev[id]?.language ?? "ru",
          ...FOOTAGE_DEFAULTS,
        },
      }));
    } catch (err) {
      setScripts((prev) => ({
        ...prev,
        [id]: {
          loading: false,
          data: null,
          error:
            err instanceof Error ? err.message : "Ошибка генерации сценария",
          selectedHook: null,
          copiedHook: null,
          copiedAll: false,
          voiceLoading: false,
          voiceError: null,
          voiceAudioUrl: null,
          voiceAudioBlob: null,
          audioDuration: null,
          language: prev[id]?.language ?? "ru",
          ...FOOTAGE_DEFAULTS,
        },
      }));
    }
  };

  const loadFootageForVideo = async (
    videoId: string,
    queries: string[]
  ) => {
    const items = queries
      .map((query) => query.trim())
      .filter(Boolean)
      .map((query) => ({
        display: query,
        search: toPexelsSearchQuery(query),
      }))
      .filter((item) => item.search);

    if (items.length === 0) {
      return;
    }

    const displayQueries = items.map((item) => item.display);
    const searchQueries = items.map((item) => item.search);

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        footageLoading: true,
        footageError: null,
        openFootageIndex: null,
        footageGroups: items.map((item) => ({
          originalQuery: item.display,
          query: item.search,
          videos: [],
          loading: true,
          selectedIndex: 0,
        })),
      },
    }));

    try {
      const results = await searchFootageVideos(searchQueries);

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          footageLoading: false,
          footageError: null,
          footageGroups: buildFootageGroups(
            displayQueries,
            searchQueries,
            results,
            prev[videoId]?.footageGroups ?? []
          ),
        },
      }));
    } catch (err) {
      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          footageLoading: false,
          footageError:
            err instanceof Error ? err.message : "Ошибка поиска видео",
        },
      }));
    }
  };

  const commitFootageQuery = (
    videoId: string,
    queryIndex: number,
    query: string
  ) => {
    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        footageGroups: prev[videoId].footageGroups.map((group, index) =>
          index === queryIndex ? { ...group, query } : group
        ),
      },
    }));
  };

  const handleSearchFootageGroup = async (
    videoId: string,
    queryIndex: number,
    queryFromInput?: string
  ) => {
    const group = scripts[videoId]?.footageGroups[queryIndex];
    if (!group) {
      return;
    }

    const rawQuery = (queryFromInput ?? group.query).trim();
    const searchQuery = toPexelsSearchQuery(rawQuery);
    if (!searchQuery) {
      return;
    }

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        footageError: null,
        footageGroups: prev[videoId].footageGroups.map((item, index) =>
          index === queryIndex
            ? {
                ...item,
                query: rawQuery,
                loading: true,
                videos: [],
                selectedIndex: 0,
              }
            : item
        ),
      },
    }));

    try {
      const results = await searchFootageVideos([searchQuery]);

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          footageGroups: prev[videoId].footageGroups.map((item, index) => {
            if (index !== queryIndex) {
              return item;
            }

            return {
              originalQuery: item.originalQuery,
              query: rawQuery,
              videos: results.filter((video) => video.query === searchQuery),
              loading: false,
              selectedIndex: 0,
            };
          }),
        },
      }));
    } catch (err) {
      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          footageLoading: false,
          footageError:
            err instanceof Error ? err.message : "Ошибка поиска видео",
          footageGroups: prev[videoId].footageGroups.map((item, index) =>
            index === queryIndex ? { ...item, loading: false } : item
          ),
        },
      }));
    }
  };

  const handleCycleFootageVideo = (videoId: string, queryIndex: number) => {
    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        footageGroups: prev[videoId].footageGroups.map((group, index) => {
          if (index !== queryIndex || group.videos.length === 0) {
            return group;
          }

          return {
            ...group,
            selectedIndex: (group.selectedIndex + 1) % group.videos.length,
          };
        }),
      },
    }));
  };

  const handleCustomFootageQuery = async (videoId: string) => {
    const query = scripts[videoId]?.customFootageQuery.trim();
    if (!query) {
      return;
    }

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        customFootageQuery: "",
        footageError: null,
        footageGroups: [
          ...prev[videoId].footageGroups,
          {
            originalQuery: query,
            query: toPexelsSearchQuery(query),
            videos: [],
            loading: true,
            selectedIndex: 0,
          },
        ],
      },
    }));

    const searchQuery = toPexelsSearchQuery(query);

    try {
      const results = await searchFootageVideos([searchQuery]);

      setScripts((prev) => {
        const groups = [...prev[videoId].footageGroups];
        const index = groups.findLastIndex(
          (group) => group.originalQuery === query && group.loading
        );

        if (index >= 0) {
          groups[index] = {
            ...groups[index],
            videos: results.filter((video) => video.query === searchQuery),
            loading: false,
          };
        }

        return {
          ...prev,
          [videoId]: {
            ...prev[videoId],
            footageGroups: groups,
          },
        };
      });
    } catch (err) {
      setScripts((prev) => {
        const groups = prev[videoId].footageGroups.filter(
          (group) => !(group.query === query && group.loading)
        );

        return {
          ...prev,
          [videoId]: {
            ...prev[videoId],
            footageGroups: groups,
            footageError:
              err instanceof Error ? err.message : "Ошибка поиска видео",
          },
        };
      });
    }
  };

  const handleCopyHook = async (
    videoId: string,
    index: number,
    hookText: string
  ) => {
    await copyText(hookText);
    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        selectedHook: index,
        copiedHook: index,
        copiedAll: false,
      },
    }));
    setTimeout(() => {
      setScripts((prev) => ({
        ...prev,
        [videoId]: { ...prev[videoId], copiedHook: null },
      }));
    }, 2000);
  };

  const handleCopyAll = async (
    videoId: string,
    script: ScriptResult,
    selectedHook: number | null
  ) => {
    await copyText(formatCopyAllScript(script, selectedHook));
    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        copiedAll: true,
        copiedHook: null,
      },
    }));
    setTimeout(() => {
      setScripts((prev) => ({
        ...prev,
        [videoId]: { ...prev[videoId], copiedAll: false },
      }));
    }, 2000);
  };

  const handleSynthesizeVoice = async (
    videoId: string,
    script: ScriptResult,
    selectedHook: number | null
  ) => {
    const panel = scripts[videoId];
    if (panel?.voiceAudioUrl) {
      URL.revokeObjectURL(panel.voiceAudioUrl);
    }

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        voiceLoading: true,
        voiceError: null,
        voiceAudioUrl: null,
        voiceAudioBlob: null,
        audioDuration: null,
        language: prev[videoId]?.language ?? "ru",
        ...FOOTAGE_DEFAULTS,
      },
    }));

    try {
      const res = await fetch("/api/synthesize-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: formatVoiceScript(script, selectedHook),
        }),
      });

      if (!res.ok) {
        let errorMessage = "Ошибка озвучки";
        try {
          const data = await res.json();
          if (typeof data.error === "string") {
            errorMessage = data.error;
          }
        } catch {
          errorMessage = `Ошибка Voicer: ${res.status}`;
        }
        throw new Error(errorMessage);
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);

      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(
        await blob.arrayBuffer()
      );
      const audioDuration = audioBuffer.duration;
      await audioContext.close();

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          voiceLoading: false,
          voiceError: null,
          voiceAudioUrl: audioUrl,
          voiceAudioBlob: blob,
          audioDuration,
        },
      }));

      const queries = getFootageQueries(script, "sentences");
      if (queries.length) {
        void loadFootageForVideo(videoId, queries);
      }
    } catch (err) {
      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          voiceLoading: false,
          voiceError:
            err instanceof Error ? err.message : "Ошибка озвучки",
          voiceAudioUrl: null,
          voiceAudioBlob: null,
          audioDuration: null,
          language: prev[videoId]?.language ?? "ru",
        },
      }));
    }
  };

  const handleClipModeChange = (
    videoId: string,
    clipMode: ClipMode,
    script: ScriptResult
  ) => {
    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        clipMode,
      },
    }));

    const queries = getFootageQueries(script, clipMode);
    if (queries.length) {
      void loadFootageForVideo(videoId, queries);
    }
  };

  const handleDownloadVideo = async (videoId: string) => {
    const panel = scripts[videoId];
    if (!panel?.voiceAudioUrl && !panel?.voiceAudioBlob) {
      return;
    }

    const selectedClips = getSelectedFootageClips(panel.footageGroups);
    if (selectedClips.length === 0) {
      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          mergeError: "Нет выбранных видеоклипов",
          mergeStatus: null,
        },
      }));
      return;
    }

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        mergeLoading: true,
        mergeStatus: "Склеиваем видео, это займёт несколько минут...",
        mergeError: null,
      },
    }));

    try {
      let audioBlob: Blob;

      if (panel.voiceAudioBlob) {
        audioBlob = panel.voiceAudioBlob;
      } else if (panel.voiceAudioUrl) {
        const audioRes = await fetch(panel.voiceAudioUrl);
        if (!audioRes.ok) {
          throw new Error("Не удалось скачать аудио");
        }
        audioBlob = await audioRes.blob();
      } else {
        throw new Error("Не удалось скачать аудио");
      }

      let audioDuration = panel.audioDuration;
      if (audioDuration == null) {
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(
          await audioBlob.arrayBuffer()
        );
        audioDuration = audioBuffer.duration;
        await audioContext.close();
      }

      const footageTexts = panel.footageGroups
        .filter((group) => !group.loading && group.videos.length > 0)
        .map((group) =>
          segmentTextForDuration(group.originalQuery, panel.language ?? "ru")
        );
      const durations = estimateSegmentDurations(footageTexts, audioDuration);

      const clipUrls = selectedClips.map((clip) => clip.url);
      const startTimes = selectedClips.map(() => 0);

      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.mp3");
      clipUrls.forEach((url) => formData.append("clip_urls", url));
      startTimes.forEach((t) => formData.append("start_times", String(t)));
      durations.forEach((d) => formData.append("durations", String(d)));
      formData.append("audio_duration", String(audioDuration));

      const mergeController = new AbortController();
      const mergeTimeoutId = setTimeout(() => mergeController.abort(), 600_000);

      let mergeRes: Response;
      try {
        mergeRes = await fetch(RAILWAY_MERGE_URL, {
          method: "POST",
          body: formData,
          signal: mergeController.signal,
        });
      } finally {
        clearTimeout(mergeTimeoutId);
      }

      if (!mergeRes.ok) {
        let errorMessage = "Ошибка склейки видео";
        try {
          const data = await mergeRes.json();
          if (typeof data.detail === "string") {
            errorMessage = data.detail;
          } else if (typeof data.error === "string") {
            errorMessage = data.error;
          }
        } catch {
          errorMessage = `Ошибка склейки: ${mergeRes.status}`;
        }
        throw new Error(errorMessage);
      }

      const { url } = (await mergeRes.json()) as { url: string };
      const videoRes = await fetch(url);
      if (!videoRes.ok) {
        throw new Error("Не удалось скачать готовое видео");
      }
      const resultBlob = await videoRes.blob();

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          mergeLoading: false,
          mergeStatus: "Готово!",
          mergeError: null,
        },
      }));

      downloadBlob(resultBlob, "result.mp4");

      setTimeout(() => {
        setScripts((prev) => ({
          ...prev,
          [videoId]: {
            ...prev[videoId],
            mergeStatus: null,
          },
        }));
      }, 3000);
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Превышено время ожидания склейки (10 мин)"
          : err instanceof Error
            ? err.message
            : "Ошибка создания видео";

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          mergeLoading: false,
          mergeStatus: null,
          mergeError: message,
        },
      }));
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="mb-8 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Найди вирусное видео
        </h1>

        <div className="space-y-6">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder="Введи нишу, например: менопауза диета"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
          />

          <div className="space-y-2">
            <label className="text-sm text-zinc-400">
              Ваш оффер (необязательно)
            </label>
            <textarea
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              rows={2}
              placeholder='Например: электронная книга "Диета при менопаузе" за 390₽'
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
          </div>

          <ToggleGroup
            label="Платформа"
            value={platform}
            onChange={setPlatform}
            options={[
              { value: "youtube", label: "YouTube" },
              { value: "vk", label: "ВКонтакте" },
            ]}
          />

          <ToggleGroup
            label="Тип видео"
            value={type}
            onChange={setType}
            options={[
              { value: "short", label: "Короткие (Shorts/Клипы)" },
              { value: "long", label: "Длинные" },
            ]}
          />

          <SelectField
            label="Период"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "7d", label: "За 7 дней" },
              { value: "14d", label: "За 14 дней" },
              { value: "30d", label: "За месяц" },
              { value: "90d", label: "За 3 месяца" },
              { value: "all", label: "Всё время" },
            ]}
          />

          <div className="space-y-2">
            <label className="text-sm text-zinc-400">Мин. просмотров</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={minViews}
              onChange={(e) =>
                setMinViews(Math.max(0, Number(e.target.value) || 0))
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none transition-colors focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
          </div>

          <SelectField
            label="Сортировка"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: "viralScore", label: "Вирусность (ER)" },
              { value: "views", label: "Просмотры" },
              { value: "likes", label: "Лайки" },
            ]}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="shrink-0 text-sm text-zinc-400">Язык:</span>
            {LANGUAGE_OPTIONS.map(({ code, label }) => (
              <label
                key={code}
                className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-300"
              >
                <input
                  type="checkbox"
                  checked={languages.includes(code)}
                  onChange={() =>
                    setLanguages((prev) => toggleLanguage(prev, code))
                  }
                  className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 accent-zinc-400"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={newChannelsOnly}
                onChange={(e) => setNewChannelsOnly(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-zinc-100 accent-zinc-400"
              />
              <span className="text-sm text-zinc-300">Только новые каналы</span>
            </label>
            <div
              className={`flex flex-wrap items-center gap-2 text-sm ${
                newChannelsOnly ? "text-zinc-300" : "text-zinc-500"
              }`}
            >
              <span>от</span>
              <input
                type="number"
                min={1}
                disabled={!newChannelsOnly}
                value={channelMinDays}
                onChange={(e) =>
                  setChannelMinDays(
                    Math.max(1, Number(e.target.value) || 1)
                  )
                }
                className="w-16 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-center text-zinc-100 outline-none transition-colors focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span>дней</span>
              <span className="ml-1">до</span>
              <input
                type="number"
                min={1}
                disabled={!newChannelsOnly}
                value={channelMaxMonths}
                onChange={(e) =>
                  setChannelMaxMonths(
                    Math.max(1, Number(e.target.value) || 1)
                  )
                }
                className="w-16 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-center text-zinc-100 outline-none transition-colors focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span>месяцев</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="w-full rounded-lg bg-zinc-100 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Ищем…" : "Найти вирусные"}
          </button>

          {loading && (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
            </div>
          )}

          {error && (
            <p className="text-center text-sm text-red-400">{error}</p>
          )}

          {!loading && videos.length === 0 && !error && (
            <p className="text-center text-sm text-zinc-500">
              Результаты появятся здесь
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {videos.slice(0, visibleCount).map((video) => {
              const panel = scripts[video.videoId];
              const segmentDurations =
                panel &&
                panel.audioDuration != null &&
                panel.footageGroups.length > 0
                  ? estimateSegmentDurations(
                      panel.footageGroups.map((g) =>
                        segmentTextForDuration(
                          g.originalQuery,
                          panel.language ?? "ru"
                        )
                      ),
                      panel.audioDuration
                    )
                  : null;
              return (
              <article
                key={video.videoId}
                className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 sm:col-span-1"
              >
                <div className="relative">
                  {video.thumbnail && (
                    <img
                      src={video.thumbnail}
                      alt=""
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  {video.viralScore >= 2 && (
                    <span className="absolute right-2 top-2 rounded-md bg-zinc-950/90 px-2 py-1 text-xs font-medium text-amber-400">
                      🔥 x{Math.round(video.viralScore)}
                    </span>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <h2 className="line-clamp-2 text-sm font-medium leading-snug">
                    {video.title}
                  </h2>
                  <p className="text-xs text-zinc-500">{video.channelTitle}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                    <span>{formatNumber(video.viewCount)} просм.</span>
                    <span>{formatNumber(video.likeCount)} лайков</span>
                    {video.repostCount != null && (
                      <span>{formatNumber(video.repostCount)} реп.</span>
                    )}
                    <span>канал: {video.channelAge}</span>
                  </div>
                  <a
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-md border border-zinc-700 py-2 text-center text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
                  >
                    Открыть видео
                  </a>
                  <ToggleGroup
                    label="Язык сценария и озвучки"
                    value={panel?.language ?? "ru"}
                    onChange={(language) =>
                      setScripts((prev) => ({
                        ...prev,
                        [video.videoId]: {
                          ...(prev[video.videoId] ?? {
                            loading: false,
                            data: null,
                            error: null,
                            selectedHook: null,
                            copiedHook: null,
                            copiedAll: false,
                            voiceLoading: false,
                            voiceError: null,
                            voiceAudioUrl: null,
                            voiceAudioBlob: null,
                            audioDuration: null,
                            ...FOOTAGE_DEFAULTS,
                          }),
                          language,
                        },
                      }))
                    }
                    options={SCRIPT_LANGUAGE_OPTIONS}
                  />

                  <button
                    type="button"
                    onClick={() => {
                      if (openVideoId === video.videoId) {
                        setOpenVideoId(null);
                      } else {
                        setOpenVideoId(video.videoId);
                        void handleGenerateScript(video);
                      }
                    }}
                    className="w-full rounded-md border border-zinc-600 bg-zinc-800 py-2 text-center text-sm text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700"
                  >
                    {openVideoId === video.videoId
                      ? "Скрыть сценарий"
                      : "Создать сценарий"}
                  </button>
                </div>

                {openVideoId === video.videoId && (
                  <div className="border-t border-zinc-800 bg-zinc-950/80 p-4">
                    {(!panel || panel.loading) && (
                      <div className="flex items-center justify-center gap-3 py-6">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
                        <span className="text-sm text-zinc-400">
                          Генерируем сценарий…
                        </span>
                      </div>
                    )}

                    {panel?.error && !panel.loading && (
                      <p className="text-sm text-red-400">{panel.error}</p>
                    )}

                    {panel?.data && !panel.loading && (
                      <div className="space-y-4 text-sm">
                        <p className="text-xs text-zinc-500">
                          {panel.data.transcriptUsed
                            ? "Сценарий создан на основе транскрипции видео"
                            : "Транскрипция недоступна — сценарий по заголовку"}
                        </p>
                        <div>
                          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Хуки — выбери ✓ и нажми, чтобы скопировать
                          </h3>
                          <div className="space-y-2">
                            {panel.data.hooks.map((hook, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() =>
                                  handleCopyHook(video.videoId, i, hook)
                                }
                                className={`w-full rounded-lg border px-3 py-2 text-left text-zinc-200 transition-colors hover:border-amber-500/50 hover:bg-zinc-800 ${
                                  panel.selectedHook === i
                                    ? "border-amber-500/60 bg-zinc-800"
                                    : "border-zinc-700 bg-zinc-900"
                                }`}
                              >
                                <span className="text-xs text-amber-400/80">
                                  {panel.copiedHook === i
                                    ? "Скопировано!"
                                    : `${panel.selectedHook === i ? "✓ " : ""}Хук ${i + 1}`}
                                </span>
                                {panel.copiedHook !== i && (
                                  <p className="mt-1 leading-snug">{hook}</p>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Основная часть
                          </h3>
                          <p className="whitespace-pre-wrap leading-relaxed text-zinc-300">
                            {panel.data.body}
                          </p>
                        </div>

                        <div>
                          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                            CTA
                          </h3>
                          <p className="leading-relaxed text-zinc-300">
                            {panel.data.cta}
                          </p>
                        </div>

                        <div>
                          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Визуальный хук
                          </h3>
                          <p className="leading-relaxed text-zinc-300">
                            {panel.data.visualHook}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            handleCopyAll(
                              video.videoId,
                              panel.data!,
                              panel.selectedHook
                            )
                          }
                          className="w-full rounded-md bg-zinc-100 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-white"
                        >
                          {panel.copiedAll ? "Скопировано!" : "Скопировать всё"}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleSynthesizeVoice(
                              video.videoId,
                              panel.data!,
                              panel.selectedHook
                            )
                          }
                          disabled={panel.voiceLoading}
                          className="w-full rounded-md border border-zinc-600 bg-zinc-800 py-2 text-sm text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 disabled:opacity-60"
                        >
                          {panel.voiceLoading
                            ? "Озвучиваем…"
                            : "🎙 Озвучить сценарий"}
                        </button>

                        {panel.voiceLoading && (
                          <div className="flex justify-center py-2">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
                          </div>
                        )}

                        {panel.voiceError && !panel.voiceLoading && (
                          <p className="text-sm text-red-400">
                            {panel.voiceError}
                          </p>
                        )}

                        {panel.voiceAudioUrl && !panel.voiceLoading && (
                          <>
                            <audio
                              controls
                              src={panel.voiceAudioUrl}
                              className="w-full"
                            />

                            <ToggleGroup
                              label="Язык сценария и озвучки"
                              value={panel.language ?? "ru"}
                              onChange={(language) =>
                                setScripts((prev) => ({
                                  ...prev,
                                  [video.videoId]: {
                                    ...prev[video.videoId],
                                    language,
                                  },
                                }))
                              }
                              options={SCRIPT_LANGUAGE_OPTIONS}
                            />

                            <ToggleGroup
                              label="Режим подбора футажа"
                              value={panel.clipMode}
                              onChange={(mode) =>
                                handleClipModeChange(
                                  video.videoId,
                                  mode,
                                  panel.data!
                                )
                              }
                              options={[
                                { value: "sentences", label: "По предложению" },
                                { value: "blocks", label: "По блокам" },
                              ]}
                            />

                            <div>
                              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                                Видеоряд
                              </h3>

                              {panel.footageLoading &&
                                panel.footageGroups.length === 0 && (
                                  <div className="flex items-center gap-2 py-3">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
                                    <span className="text-xs text-zinc-400">
                                      Ищем видео на Pexels…
                                    </span>
                                  </div>
                                )}

                              {panel.footageError && (
                                <p className="mb-3 text-xs text-red-400">
                                  {panel.footageError}
                                </p>
                              )}

                              <div className="space-y-4">
                                {panel.footageGroups.map((group, queryIndex) => {
                                  const activeVideo =
                                    group.videos.length > 0
                                      ? group.videos[
                                          group.selectedIndex %
                                            group.videos.length
                                        ]
                                      : null;

                                  const russianTranslation =
                                    panel.language !== "ru"
                                      ? parseRussianTranslation(
                                          group.originalQuery
                                        )
                                      : null;
                                  const scriptLine =
                                    panel.language !== "ru"
                                      ? toPexelsSearchQuery(group.originalQuery)
                                      : group.originalQuery;

                                  return (
                                  <div
                                    key={`${group.originalQuery}-${queryIndex}`}
                                  >
                                    <div className="mb-2 space-y-1">
                                      <p className="text-xs leading-snug text-zinc-300">
                                        {scriptLine}
                                      </p>
                                      {russianTranslation && (
                                        <p className="text-xs italic leading-snug text-zinc-500">
                                          {russianTranslation}
                                        </p>
                                      )}
                                      <FootageQueryInput
                                        key={`${video.videoId}-${queryIndex}-${group.originalQuery}`}
                                        defaultQuery={group.query}
                                        disabled={group.loading}
                                        onBlurCommit={(value) =>
                                          commitFootageQuery(
                                            video.videoId,
                                            queryIndex,
                                            value
                                          )
                                        }
                                        onSearch={(value) => {
                                          commitFootageQuery(
                                            video.videoId,
                                            queryIndex,
                                            value
                                          );
                                          void handleSearchFootageGroup(
                                            video.videoId,
                                            queryIndex,
                                            value
                                          );
                                        }}
                                      />
                                    </div>

                                    {group.loading ? (
                                      <div className="flex justify-center py-4">
                                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
                                      </div>
                                    ) : !activeVideo ? (
                                      <p className="text-xs text-zinc-500">
                                        Видео не найдены
                                      </p>
                                    ) : queryIndex === panel.openFootageIndex ? (
                                      <div className="space-y-2">
                                        <LazyFootageVideo
                                          videoUrl={activeVideo.url}
                                          poster={activeVideo.preview}
                                        />
                                        <FootageDurationLabel
                                          pexelsDuration={activeVideo.duration}
                                          estimatedDuration={
                                            segmentDurations?.[queryIndex] ?? null
                                          }
                                        />
                                        {group.videos.length > 1 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleCycleFootageVideo(
                                                video.videoId,
                                                queryIndex
                                              )
                                            }
                                            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
                                          >
                                            Подобрать другой фрагмент
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        <img
                                          src={activeVideo.preview}
                                          alt=""
                                          loading="lazy"
                                          onClick={() =>
                                            setScripts((prev) => ({
                                              ...prev,
                                              [video.videoId]: {
                                                ...prev[video.videoId],
                                                openFootageIndex: queryIndex,
                                              },
                                            }))
                                          }
                                          className="mx-auto max-w-[180px] aspect-[9/16] w-full cursor-pointer rounded-lg border border-zinc-700 object-cover opacity-60 transition-opacity hover:opacity-100"
                                        />
                                        <FootageDurationLabel
                                          pexelsDuration={activeVideo.duration}
                                          estimatedDuration={
                                            segmentDurations?.[queryIndex] ?? null
                                          }
                                        />
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>

                              <input
                                type="text"
                                value={panel.customFootageQuery}
                                onChange={(e) =>
                                  setScripts((prev) => ({
                                    ...prev,
                                    [video.videoId]: {
                                      ...prev[video.videoId],
                                      customFootageQuery: e.target.value,
                                    },
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void handleCustomFootageQuery(video.videoId);
                                  }
                                }}
                                placeholder="Свой запрос для Pexels, Enter — поиск"
                                className="mt-4 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
                              />

                              <button
                                type="button"
                                onClick={() => void handleDownloadVideo(video.videoId)}
                                disabled={
                                  panel.mergeLoading ||
                                  panel.footageLoading ||
                                  getSelectedFootageClips(panel.footageGroups)
                                    .length === 0
                                }
                                className="mt-4 w-full rounded-md bg-zinc-100 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {panel.mergeLoading
                                  ? panel.mergeStatus ?? "Скачиваем..."
                                  : "Скачать видео"}
                              </button>

                              {panel.mergeError && (
                                <p className="mt-2 text-xs text-red-400">
                                  {panel.mergeError}
                                </p>
                              )}

                              {panel.mergeStatus &&
                                !panel.mergeLoading &&
                                panel.mergeStatus === "Готово!" && (
                                  <p className="mt-2 text-xs text-emerald-400">
                                    {panel.mergeStatus}
                                  </p>
                                )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
            })}
          </div>

          {videos.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + 3)}
              className="w-full rounded-lg border border-zinc-700 py-3 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
            >
              Смотреть ещё ({videos.length - visibleCount} видео)
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
