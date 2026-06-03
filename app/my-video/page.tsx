"use client";

import { Suspense, useState } from "react";
import type { ScriptResult } from "../api/generate-script/route";

type ScriptProvider = "gemini" | "claude" | "groq";

const PROVIDER_OPTIONS: {
  value: ScriptProvider;
  label: string;
  description: string;
}[] = [
  {
    value: "gemini",
    label: "Gemini 2.5 Flash",
    description: "Смотрит видео напрямую",
  },
  {
    value: "claude",
    label: "Claude Sonnet",
    description: "Лучший для контента",
  },
  {
    value: "groq",
    label: "Groq Llama",
    description: "Быстрый, бесплатный",
  },
];

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  return match?.[1] ?? null;
}

function MyVideoPage() {
  const [url, setUrl] = useState("");
  const [niche, setNiche] = useState("");
  const [offer, setOffer] = useState("");
  const [provider, setProvider] = useState<ScriptProvider>("gemini");
  const [language, setLanguage] = useState<"ru" | "en" | "es">("ru");
  const [videoType, setVideoType] = useState<"short" | "long">("long");
  const [loading, setLoading] = useState(false);
  const [script, setScript] = useState<ScriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsUpload, setNeedsUpload] = useState(false);
  const [needsTranscript, setNeedsTranscript] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [copiedHook, setCopiedHook] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const videoId = extractVideoId(url);

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = () => reject(new Error("Ошибка чтения файла"));
      reader.readAsDataURL(file);
    });
  }

  async function handleGenerate(transcriptOverride?: string) {
    if (!videoId && !videoFile) {
      setError("Введите ссылку на YouTube видео или загрузите файл");
      return;
    }
    setLoading(true);
    setError(null);
    setScript(null);
    setNeedsUpload(false);
    setNeedsTranscript(false);

    try {
      let body: Record<string, unknown>;

      if (videoFile) {
        const sizeMb = videoFile.size / 1024 / 1024;
        if (sizeMb > 50) {
          throw new Error(
            "Файл слишком большой (максимум 50 МБ). Используйте ссылку на YouTube."
          );
        }
        const base64 = await fileToBase64(videoFile);
        body = {
          videoId: `file_${Date.now()}`,
          title: videoFile.name,
          niche: niche.trim() || "общая тема",
          offer: offer.trim(),
          language,
          videoType,
          preferredProvider: provider,
          transcript: transcriptOverride ?? (transcript.trim() || undefined),
          videoBase64: base64,
          videoMimeType: videoFile.type || "video/mp4",
        };
      } else {
        let videoDuration: number | null = null;
        if (videoId && !videoFile) {
          try {
            const durRes = await fetch(
              `/api/search-youtube?videoId=${videoId}`
            );
            if (durRes.ok) {
              const durData = (await durRes.json()) as {
                durationSeconds?: number;
              };
              videoDuration = durData?.durationSeconds ?? null;
            }
          } catch {
            /* ignore */
          }
        }

        body = {
          videoId,
          title: url,
          niche: niche.trim() || "общая тема",
          offer: offer.trim(),
          language,
          videoType,
          preferredProvider: provider,
          transcript: transcriptOverride ?? (transcript.trim() || undefined),
          videoDuration: videoDuration ?? undefined,
        };
      }

      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as ScriptResult & { error?: string };
      if (!res.ok) {
        console.error("generate-script response:", res.status, data);
      }

      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка генерации сценария");
      }

      if (
        !data.transcriptUsed &&
        provider === "gemini" &&
        !transcriptOverride &&
        !transcript &&
        !videoFile
      ) {
        setNeedsUpload(true);
      }

      if (
        data.provider?.toLowerCase().includes("groq") &&
        videoType === "long"
      ) {
        setNeedsTranscript(true);
      }

      setScript(data);

      const fakeVideoId = String(body.videoId ?? videoId ?? `file_${Date.now()}`);
      const workspacePayload = {
        video: {
          videoId: fakeVideoId,
          title: videoFile ? videoFile.name : url,
          thumbnail: videoId
            ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
            : "",
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          channelTitle: "",
          channelAge: "",
          viralScore: 0,
          velocity: 0,
          url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
          platform: "youtube" as const,
          durationSeconds: 0,
        },
        keyword: niche.trim() || "общая тема",
        offer: offer.trim(),
        scriptData: data,
      };
      sessionStorage.setItem(
        `viral-parsing:workspace:${fakeVideoId}`,
        JSON.stringify(workspacePayload)
      );
      window.location.href = `/?workspace=1&v=${fakeVideoId}`;
    } catch (err) {
      console.error("generate-script failed:", err);
      const msg = err instanceof Error ? err.message : "Ошибка генерации";
      setError(msg);
      if (videoType === "long" && videoId && !videoFile) {
        setNeedsTranscript(true);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleCopyHook(i: number, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedHook(i);
    setTimeout(() => setCopiedHook(null), 2000);
  }

  function handleCopyAll() {
    if (!script) return;
    const text = [
      `ХУК:\n${script.hooks[0]}`,
      `\nОСНОВНАЯ ЧАСТЬ:\n${script.body}`,
      `\nCTA:\n${script.cta}`,
    ].join("\n");
    void navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  return (
    <div className="min-h-screen bg-[#0f0a1e] text-zinc-100">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-8">
          <a
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-sm text-purple-400/70 hover:text-purple-300"
          >
            ← Назад к поиску
          </a>
          <h1 className="text-2xl font-bold text-zinc-100">Своё видео</h1>
          <p className="mt-1 text-sm text-purple-300/60">
            Вставь ссылку на YouTube видео — нейросеть создаст сценарий
          </p>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm text-purple-300/70">
            Ссылка на YouTube видео
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full rounded-lg border border-purple-900/50 bg-[#1a1035] px-4 py-3 text-sm text-zinc-100 placeholder-purple-400/30 outline-none focus:border-purple-600"
          />
          {videoId && (
            <p className="mt-1 text-xs text-purple-400/50">ID: {videoId}</p>
          )}
        </div>

        {/* OR divider */}
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-purple-900/50" />
          <span className="text-sm font-medium text-purple-400/60">ИЛИ</span>
          <div className="h-px flex-1 bg-purple-900/50" />
        </div>

        {/* File upload */}
        <div className="mb-6">
          <label className="mb-1.5 block text-sm text-purple-300/70">
            Загрузить видео
          </label>
          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-purple-700/60 bg-[#1a1035] py-4 text-sm text-purple-300/70 transition-colors hover:border-purple-500 hover:bg-purple-900/20">
            <span>📁</span>
            <span>
              {videoFile ? videoFile.name : "Выбрать файл (mp4, mov, avi)"}
            </span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setVideoFile(file);
                if (file) setUrl("");
              }}
            />
          </label>
          {videoFile && (
            <button
              type="button"
              onClick={() => setVideoFile(null)}
              className="mt-1 text-xs text-purple-400/50 hover:text-purple-300"
            >
              ✕ Убрать файл
            </button>
          )}
        </div>

        {/* Niche */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm text-purple-300/70">
            Ниша / тема (необязательно)
          </label>
          <input
            type="text"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="Например: диета, история, финансы"
            className="w-full rounded-lg border border-purple-900/50 bg-[#1a1035] px-4 py-3 text-sm text-zinc-100 placeholder-purple-400/30 outline-none focus:border-purple-600"
          />
        </div>

        {/* Offer */}
        <div className="mb-6">
          <label className="mb-1.5 block text-sm text-purple-300/70">
            Ваш оффер (необязательно)
          </label>
          <input
            type="text"
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="Например: книга за 390₽, подписка на канал"
            className="w-full rounded-lg border border-purple-900/50 bg-[#1a1035] px-4 py-3 text-sm text-zinc-100 placeholder-purple-400/30 outline-none focus:border-purple-600"
          />
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm text-purple-300/70">
            Тип видео
          </label>
          <div className="flex gap-2">
            {(["short", "long"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVideoType(t)}
                style={{
                  background: videoType === t ? "#7c3aed" : "#1f2937",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                {t === "short"
                  ? "🎬 Шортс (до 1 мин)"
                  : "📺 Длинное (5-30 мин)"}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm text-purple-300/70">
            Нейросеть-сценарист
          </label>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setProvider(opt.value)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  provider === opt.value
                    ? "border-fuchsia-500/60 bg-[#231448] text-zinc-100"
                    : "border-purple-900/50 bg-[#1a1035] text-purple-300/70 hover:border-purple-700"
                }`}
              >
                <div className="text-xs font-medium">{opt.label}</div>
                <div className="mt-0.5 text-xs text-purple-400/50">
                  {opt.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm text-purple-300/70">
            Язык сценария
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "ru", label: "🇷🇺 Русский" },
              { value: "en", label: "🇬🇧 English" },
              { value: "es", label: "🇪🇸 Español" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLanguage(opt.value as "ru" | "en" | "es")}
                className={`rounded-lg border py-2 text-sm transition-colors ${
                  language === opt.value
                    ? "border-fuchsia-500/60 bg-[#231448] text-zinc-100"
                    : "border-purple-900/50 bg-[#1a1035] text-purple-300/70 hover:border-purple-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={loading || (!url.trim() && !videoFile)}
          className="mb-6 w-full rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading
            ? "Генерируем сценарий…"
            : videoFile
              ? `Создать сценарий по файлу: ${videoFile.name.slice(0, 30)}`
              : "Создать сценарий"}
        </button>

        {error && (
          <p className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {(needsUpload || needsTranscript) && (script || needsTranscript) && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-900/10 px-4 py-4">
            <p className="mb-3 text-sm text-amber-300">
              ⚠️ Gemini не смогла просмотреть видео напрямую. Сценарий создан по
              названию. Для лучшего результата добавь транскрипт вручную:
            </p>
            <div className="mb-3 flex gap-2">
              <a
                href="https://tubetranscript.com"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/30"
              >
                Открыть tubetranscript.com ↗
              </a>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `https://www.youtube.com/watch?v=${videoId}`
                  )
                }
                className="rounded border border-purple-700 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-900/30"
              >
                Скопировать ссылку на видео
              </button>
            </div>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Вставь транскрипт сюда…"
              rows={5}
              className="mb-3 w-full rounded-lg border border-purple-900/50 bg-[#1a1035] px-3 py-2 text-sm text-zinc-100 placeholder-purple-400/30 outline-none focus:border-purple-600"
            />
            <button
              type="button"
              onClick={() => void handleGenerate(transcript)}
              disabled={loading || !transcript.trim()}
              className="w-full rounded-lg border border-fuchsia-600 py-2 text-sm text-fuchsia-300 transition-colors hover:bg-fuchsia-900/30 disabled:opacity-40"
            >
              Пересоздать сценарий по транскрипту
            </button>
          </div>
        )}

        {script && (
          <div className="space-y-4 rounded-lg border border-purple-900/50 bg-[#0f0a1e]/80 p-4 text-sm">
            <p className="text-xs text-purple-400/50">
              {script.transcriptUsed ? "✓ Видео просмотрено" : "По заголовку"} ·{" "}
              {script.provider}
            </p>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-purple-400/50">
                Хуки
              </h3>
              <div className="space-y-2">
                {script.hooks.map((hook, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-purple-800/60 bg-[#1a1035] px-3 py-2"
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-fuchsia-400/80">
                        Хук {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyHook(i, hook)}
                        className="rounded border border-fuchsia-500/50 px-2 py-0.5 text-xs text-fuchsia-400 hover:border-fuchsia-400"
                      >
                        {copiedHook === i ? "✓ Скопировано!" : "Копировать"}
                      </button>
                    </div>
                    <p className="text-zinc-200">{hook}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-purple-400/50">
                Основная часть
              </h3>
              <div className="rounded-lg border border-purple-800/60 bg-[#1a1035] px-3 py-2">
                <p className="whitespace-pre-wrap text-zinc-200">{script.body}</p>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-purple-400/50">
                CTA
              </h3>
              <div className="rounded-lg border border-purple-800/60 bg-[#1a1035] px-3 py-2">
                <p className="text-zinc-200">{script.cta}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyAll}
              className="w-full rounded-lg bg-purple-900/60 py-2 text-sm text-purple-100 transition-colors hover:bg-purple-800/60"
            >
              {copiedAll ? "✓ Скопировано!" : "Скопировать всё"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyVideo() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0f0a1e] text-purple-300/70">
          Загрузка…
        </div>
      }
    >
      <MyVideoPage />
    </Suspense>
  );
}
