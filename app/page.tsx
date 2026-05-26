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
  query: string;
  videos: SearchVideoResult[];
  loading: boolean;
  selectedIndex: number;
};

type ScriptPanelState = {
  open: boolean;
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
  footageLoading: boolean;
  footageError: string | null;
  footageGroups: FootageGroup[];
  customFootageQuery: string;
  mergeLoading: boolean;
  mergeStatus: string | null;
  mergeError: string | null;
};

const FOOTAGE_DEFAULTS = {
  footageLoading: false,
  footageError: null,
  footageGroups: [] as FootageGroup[],
  customFootageQuery: "",
  mergeLoading: false,
  mergeStatus: null,
  mergeError: null,
};

const RAILWAY_MERGE_URL =
  "https://viral-parsing-production.up.railway.app/merge";

function proxyUrl(url: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

async function fetchPexelsClipBlob(pexelsUrl: string): Promise<Blob> {
  const res = await fetch(proxyUrl(pexelsUrl));

  if (!res.ok) {
    throw new Error("Не удалось загрузить видеоклип");
  }

  return res.blob();
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

function formatVoiceScript(
  script: ScriptResult,
  selectedHook: number | null
): string {
  const hookIndex = getSelectedHookIndex(selectedHook);
  const hook = script.hooks[hookIndex] ?? script.hooks[0] ?? "";

  return [hook, script.body, script.cta].filter(Boolean).join("\n\n");
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

function buildFootageGroups(
  queries: string[],
  results: SearchVideoResult[],
  previousGroups: FootageGroup[] = []
): FootageGroup[] {
  return queries.map((query) => {
    const previous = previousGroups.find((group) => group.query === query);

    return {
      query,
      videos: results.filter((video) => video.query === query),
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

  const handleSearch = async () => {
    if (!keyword.trim()) {
      setError("Введите нишу для поиска");
      return;
    }

    setLoading(true);
    setError(null);
    setVideos([]);
    setScripts({});

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

    if (current?.open) {
      setScripts((prev) => ({
        ...prev,
        [id]: { ...current, open: false },
      }));
      return;
    }

    if (current?.data) {
      setScripts((prev) => ({
        ...prev,
        [id]: { ...current, open: true },
      }));
      return;
    }

    setScripts((prev) => ({
      ...prev,
      [id]: {
        open: true,
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
        ...FOOTAGE_DEFAULTS,
      },
    }));

    try {
      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: id,
          title: video.title,
          niche: keyword.trim(),
          offer: offer.trim(),
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
          open: true,
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
          ...FOOTAGE_DEFAULTS,
        },
      }));
    } catch (err) {
      setScripts((prev) => ({
        ...prev,
        [id]: {
          open: true,
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
          ...FOOTAGE_DEFAULTS,
        },
      }));
    }
  };

  const loadFootageForVideo = async (
    videoId: string,
    queries: string[]
  ) => {
    const trimmedQueries = queries.map((query) => query.trim()).filter(Boolean);
    if (trimmedQueries.length === 0) {
      return;
    }

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        footageLoading: true,
        footageError: null,
        footageGroups: trimmedQueries.map((query) => ({
          query,
          videos: [],
          loading: true,
          selectedIndex: 0,
        })),
      },
    }));

    try {
      const results = await searchFootageVideos(trimmedQueries);

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          footageLoading: false,
          footageError: null,
          footageGroups: buildFootageGroups(
            trimmedQueries,
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
            query,
            videos: [],
            loading: true,
            selectedIndex: 0,
          },
        ],
      },
    }));

    try {
      const results = await searchFootageVideos([query]);

      setScripts((prev) => {
        const groups = [...prev[videoId].footageGroups];
        const index = groups.findLastIndex(
          (group) => group.query === query && group.loading
        );

        if (index >= 0) {
          groups[index] = {
            ...groups[index],
            videos: results,
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

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          voiceLoading: false,
          voiceError: null,
          voiceAudioUrl: audioUrl,
          voiceAudioBlob: blob,
        },
      }));

      if (script.videoQueries?.length) {
        void loadFootageForVideo(videoId, script.videoQueries);
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
        },
      }));
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
        mergeStatus: "Скачиваем файлы...",
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

      const clipBlobs = await Promise.all(
        selectedClips.map(async (clip, index) => {
          try {
            return await fetchPexelsClipBlob(clip.url);
          } catch {
            throw new Error(`Не удалось скачать клип ${index + 1}`);
          }
        })
      );

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          mergeStatus: "Склеиваем видео, это займёт 1-2 минуты...",
        },
      }));

      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.mp3");
      clipBlobs.forEach((clipBlob, index) => {
        formData.append("clips", clipBlob, `clip_${index}.mp4`);
      });

      const mergeController = new AbortController();
      const mergeTimeoutId = setTimeout(() => mergeController.abort(), 120_000);

      let mergeRes: Response;
      try {
        // Напрямую на Railway из браузера — без Vercel API (долгий ответ)
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

      const resultBlob = await mergeRes.blob();

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
          ? "Превышено время ожидания склейки (2 мин)"
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
            {videos.map((video) => {
              const panel = scripts[video.videoId];
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
                  <button
                    type="button"
                    onClick={() => handleGenerateScript(video)}
                    className="w-full rounded-md border border-zinc-600 bg-zinc-800 py-2 text-center text-sm text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700"
                  >
                    {panel?.open ? "Скрыть сценарий" : "Создать сценарий"}
                  </button>
                </div>

                {panel?.open && (
                  <div className="border-t border-zinc-800 bg-zinc-950/80 p-4">
                    {panel.loading && (
                      <div className="flex items-center justify-center gap-3 py-6">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
                        <span className="text-sm text-zinc-400">
                          Генерируем сценарий…
                        </span>
                      </div>
                    )}

                    {panel.error && !panel.loading && (
                      <p className="text-sm text-red-400">{panel.error}</p>
                    )}

                    {panel.data && !panel.loading && (
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

                                  return (
                                  <div key={`${group.query}-${queryIndex}`}>
                                    <p className="mb-2 text-xs leading-snug text-zinc-400">
                                      {group.query}
                                    </p>

                                    {group.loading ? (
                                      <div className="flex justify-center py-4">
                                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
                                      </div>
                                    ) : !activeVideo ? (
                                      <p className="text-xs text-zinc-500">
                                        Видео не найдены
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        <LazyFootageVideo
                                          videoUrl={activeVideo.url}
                                          poster={activeVideo.preview}
                                        />
                                        <p className="text-xs text-zinc-500">
                                          {activeVideo.duration} сек
                                        </p>
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
        </div>
      </main>
    </div>
  );
}
