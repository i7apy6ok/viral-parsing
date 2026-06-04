"use client";

import {
  Fragment,
  Suspense,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
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

type ManualSlot = {
  query: string;
  videos: SearchVideoResult[];
  loading: boolean;
  searchError: string | null;
  selectedIndex: number;
  customDuration: number | null;
  lastSearchQuery: string;
  searchPage: number;
};

type ManualGroup = {
  originalText: string;
  translation: string;
  slots: ManualSlot[];
  slotDurations: [number, number, number] | null;
};

type AIImageSlot = {
  imageUrl: string | null;
  loading: boolean;
  error: string | null;
  animating: boolean;
  animatedVideoUrl: string | null;
  animateError: string | null;
  customPrompt: string | null;
};

type AIImageGroup = {
  originalText: string;
  translation: string;
  slots: [AIImageSlot, AIImageSlot, AIImageSlot];
};

type AudioSegment = {
  start: number;
  end: number;
  text: string;
};

type ClipMode = "sentences" | "manual" | null;

const MANUAL_SLOTS_PER_SENTENCE = 3;
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
  voiceProgress: { current: number; total: number } | null;
  voiceError: string | null;
  voiceAudioUrl: string | null;
  voiceAudioBlob: Blob | null;
  audioDuration: number | null;
  audioSegments: AudioSegment[] | null;
  audioChunks: Blob[] | null;
  footageLoading: boolean;
  footageError: string | null;
  footageGroups: FootageGroup[];
  manualGroups: ManualGroup[];
  aiImageGroups: AIImageGroup[] | null;
  customFootageQuery: string;
  language: ScriptLanguage;
  clipMode: ClipMode;
  mergeLoading: boolean;
  mergeStatus: string | null;
  mergeError: string | null;
  openFootageIndex: number | null;
  footageSearchStarted: boolean;
  footagePage: number;
};

const FOOTAGE_DEFAULTS = {
  footageLoading: false,
  footageError: null,
  footageGroups: [] as FootageGroup[],
  manualGroups: [] as ManualGroup[],
  aiImageGroups: null as AIImageGroup[] | null,
  customFootageQuery: "",
  clipMode: null as ClipMode,
  mergeLoading: false,
  mergeStatus: null,
  mergeError: null,
  openFootageIndex: null,
  audioSegments: null,
  audioChunks: null,
  footageSearchStarted: false,
  footagePage: 0,
};

const GROUPS_PER_PAGE = 10;

function ShowMoreButton({
  current,
  total,
  onMore,
}: {
  current: number;
  total: number;
  onMore: () => void;
}) {
  if (current >= total) return null;
  return (
    <button
      type="button"
      onClick={onMore}
      style={{
        width: "100%",
        padding: "10px",
        marginTop: 16,
        background: "#1f2937",
        border: "1px solid #374151",
        borderRadius: 8,
        color: "#9ca3af",
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      Показать ещё {total - current} предложений
    </button>
  );
}

const WORKSPACE_STORAGE_KEY = (videoId: string) =>
  `viral-parsing:workspace:${videoId}`;

const RAILWAY_MERGE_URL =
  "https://viral-parsing-production.up.railway.app/merge";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function ToggleGroup<T extends string | null>({
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
      <span className="text-sm text-purple-300/70">{label}</span>
      <div className="flex rounded-lg border border-purple-900/50 bg-[#1a1035]/80 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${
              value === option.value
                ? "bg-zinc-700 text-white"
                : "text-purple-300/70 hover:text-zinc-200"
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
      <label className="text-sm text-purple-300/70">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-lg border border-purple-900/50 bg-[#1a1035] px-4 py-3 text-sm text-purple-50 outline-none transition-colors focus:border-purple-700 focus:ring-1 focus:ring-zinc-600"
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

function extractTranslations(text: string): string[] {
  const matches = text.match(/\(([^)]+)\)/g);
  return matches ? matches.map((match) => match.slice(1, -1)) : [];
}

function getPreservedTranslation(text: string): string | null {
  const trailing = parseRussianTranslation(text);
  if (trailing) {
    return trailing;
  }
  const translations = extractTranslations(text);
  return translations.length > 0 ? translations[translations.length - 1]! : null;
}

function splitHookIntoSentences(hook: string): string[] {
  const hookClean = stripTranslation(hook).trim();
  if (!hookClean) {
    return [];
  }
  const sentences = hookClean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [hookClean];
}

function getSentenceChunks(
  script: ScriptResult,
  selectedHook: number | null
): string[] {
  const hookIndex = getSelectedHookIndex(selectedHook);
  const hook = script.hooks[hookIndex] ?? script.hooks[0] ?? "";

  const bodyChunks =
    script.sentences && script.sentences.length > 0
      ? script.sentences.map(stripTranslation).filter(Boolean)
      : [stripTranslation(script.body)].filter(Boolean);

  const hookSentences = splitHookIntoSentences(hook);

  const ctaSentences = stripTranslation(script.cta)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ctaChunks =
    ctaSentences.length > 0
      ? ctaSentences
      : [stripTranslation(script.cta)].filter(Boolean);

  return [...hookSentences, ...bodyChunks, ...ctaChunks].filter(Boolean);
}

function resolveAudioChunkIndex(
  script: ScriptResult | null | undefined,
  selectedHook: number | null,
  groupText: string,
  fallbackIndex: number
): number {
  if (!script) return fallbackIndex;
  const chunks = getSentenceChunks(script, selectedHook);
  const normalized = groupText.trim();
  let idx = chunks.findIndex((c) => c.trim() === normalized);
  if (idx < 0) {
    idx = chunks.findIndex((c) => stripTranslation(c).trim() === normalized);
  }
  return idx >= 0 ? idx : fallbackIndex;
}

function getScriptSourceLabel(data: ScriptResult): string {
  const provider = data.provider;
  if (
    provider === "gemini-2.5-flash" ||
    provider?.includes("gemini")
  ) {
    return "Сценарий создан на основе просмотра видео (Gemini)";
  }
  if (provider === "claude-sonnet-4-6") {
    return "Сценарий по заголовку (Claude, без просмотра видео)";
  }
  if (provider === "groq-llama-3.3-70b") {
    return "Сценарий по заголовку (Groq, без просмотра видео)";
  }
  if (data.transcriptUsed) {
    return "Сценарий создан на основе транскрипции видео";
  }
  return provider
    ? `Сценарий по заголовку (${provider})`
    : "Сценарий создан";
}

function getVoiceLoadingLabel(
  progress: { current: number; total: number } | null | undefined
): string {
  if (progress && progress.total > 0) {
    return `Озвучиваем... ${progress.current}/${progress.total}`;
  }
  return "Озвучиваем…";
}

function ChunkAudioPlayer({
  blob,
  className = "mt-2 h-8 w-full",
}: {
  blob: Blob;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) return null;

  return <audio controls src={url} className={className} />;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const samples = buffer.length * numChannels;
  const dataSize = samples * (bitDepth / 8);
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
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
  queries: string[],
  pages?: number[],
  signal?: AbortSignal
): Promise<SearchVideoResult[]> {
  const res = await fetch("/api/search-videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries, pages }),
    signal,
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

const TRANSLATION_STYLE = { color: "#888", fontStyle: "italic" as const };

function parseTranslation(text: string): {
  originalText: string;
  translation: string;
} {
  const translation = parseRussianTranslation(text);
  if (!translation) {
    return { originalText: text.trim(), translation: "" };
  }
  return {
    originalText: toPexelsSearchQuery(text),
    translation,
  };
}

function splitTextWithTranslation(text: string): {
  main: string;
  translation: string | null;
} {
  const { originalText, translation } = parseTranslation(text);
  return {
    main: originalText,
    translation: translation || null,
  };
}

const EMPTY_AI_IMAGE_SLOT = (): AIImageSlot => ({
  imageUrl: null,
  loading: false,
  error: null,
  animating: false,
  animatedVideoUrl: null,
  animateError: null,
  customPrompt: null,
});

function buildAIImageGroups(
  sentences: string[],
  hook: string
): AIImageGroup[] {
  const allTexts = [hook, ...sentences].map((t) => t.trim()).filter(Boolean);
  return allTexts.map((text) => {
    const { originalText, translation } = parseTranslation(text);
    return {
      originalText,
      translation,
      slots: [
        EMPTY_AI_IMAGE_SLOT(),
        EMPTY_AI_IMAGE_SLOT(),
        EMPTY_AI_IMAGE_SLOT(),
      ],
    };
  });
}

function combineWithTranslation(
  main: string,
  translation: string | null
): string {
  const trimmed = main.trim();
  if (!translation) {
    return trimmed;
  }
  return `${trimmed} (${translation})`;
}

const SCRIPT_TEXTAREA_CLASS =
  "w-full resize-none overflow-hidden rounded-lg border border-transparent bg-[#1a1035] px-3 py-2 text-sm leading-relaxed text-purple-50 outline-none transition-colors placeholder:text-purple-400/50 focus:border-purple-700";

const TRANSLATION_BLOCK_STYLE = {
  color: "#888",
  fontStyle: "italic" as const,
  fontSize: "0.85em",
};

function ScriptEditableTextarea({
  value,
  translations = [],
  onChange,
  minRows = 2,
  onClick,
}: {
  value: string;
  translations?: string[];
  onChange: (main: string) => void;
  minRows?: number;
  onClick?: (event: MouseEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight(textareaRef.current);
    }
  }, [value]);

  return (
    <div className="space-y-1">
      <textarea
        ref={textareaRef}
        value={value}
        rows={minRows}
        onClick={onClick}
        onChange={(event) => {
          onChange(event.target.value);
          adjustHeight(event.target);
        }}
        onInput={(event) => adjustHeight(event.currentTarget)}
        className={SCRIPT_TEXTAREA_CLASS}
      />
      {translations.map((translation, index) => (
        <div key={index} style={TRANSLATION_BLOCK_STYLE}>
          {translation}
        </div>
      ))}
    </div>
  );
}

function renderWithTranslation(text: string): ReactNode {
  const regex = /\(([^)]+)\)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={key++} style={TRANSLATION_STYLE}>
        ({match[1]})
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
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

function getSelectedFootageClips(groups: FootageGroup[]): SearchVideoResult[] {
  return groups
    .filter((group) => !group.loading && group.videos.length > 0)
    .map(
      (group) =>
        group.videos[group.selectedIndex % group.videos.length]
    );
}

function splitWithVariance(total: number): [number, number, number] {
  const base = total / 3;
  const v = base * 0.2;
  const a = base + (Math.random() * 2 - 1) * v;
  const b = base + (Math.random() * 2 - 1) * v;
  const c = total - a - b;
  return [
    Math.max(0.1, Math.round(a * 10) / 10),
    Math.max(0.1, Math.round(b * 10) / 10),
    Math.max(0.1, Math.round(c * 10) / 10),
  ];
}

function getManualSegmentDuration(
  groups: ManualGroup[],
  groupIndex: number,
  audioDuration: number,
  language: ScriptLanguage
): number {
  const charCounts = groups.map((group) =>
    segmentTextForDuration(group.originalText, language).replace(/\s+/g, "")
      .length
  );
  const totalChars = charCounts.reduce((sum, count) => sum + count, 0);
  if (totalChars === 0) {
    return 0;
  }
  return (charCounts[groupIndex] / totalChars) * audioDuration;
}

function applyManualSlotDurations(
  groups: ManualGroup[],
  audioDuration: number | null,
  language: ScriptLanguage
): ManualGroup[] {
  if (audioDuration == null) {
    return groups;
  }

  return groups.map((group, groupIndex) => ({
    ...group,
    slotDurations:
      group.slotDurations ??
      splitWithVariance(
        getManualSegmentDuration(groups, groupIndex, audioDuration, language)
      ),
  }));
}

function createManualSlot(initialQuery: string): ManualSlot {
  return {
    query: initialQuery,
    videos: [],
    loading: false,
    searchError: null,
    selectedIndex: 0,
    customDuration: null,
    lastSearchQuery: "",
    searchPage: 1,
  };
}

function buildManualGroups(
  script: ScriptResult,
  language: ScriptLanguage,
  selectedHook: number | null
): ManualGroup[] {
  const sentences = script.sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const sentenceGroups: ManualGroup[] = sentences.map((sentenceText, index) => {
    const { main, translation } = splitTextWithTranslation(sentenceText);
    const initialQuery = (
      script.videoQueries[index] ??
      script.videoQueries[0] ??
      ""
    ).trim();

    return {
      originalText: main,
      translation: language !== "ru" && translation ? translation : "",
      slots: Array.from({ length: MANUAL_SLOTS_PER_SENTENCE }, () =>
        createManualSlot(initialQuery)
      ),
      slotDurations: null,
    };
  });

  const hookIndex = getSelectedHookIndex(selectedHook);
  const rawHook = (script.hooks[hookIndex] ?? script.hooks[0] ?? "").trim();
  const rawCta = script.cta?.trim() ?? "";
  const hookTrailingTranslation =
    language !== "ru" ? parseRussianTranslation(rawHook) : null;
  const hookInitialQuery = (
    script.videoQueries[0] ?? toPexelsSearchQuery(rawHook)
  ).trim();

  let groups: ManualGroup[] = sentenceGroups;

  if (rawHook) {
    const hookSentences = splitHookIntoSentences(rawHook);
    const hookGroups: ManualGroup[] = hookSentences.map(
      (sentenceText, index) => {
        const { main, translation } = splitTextWithTranslation(sentenceText);
        const isLastHook = index === hookSentences.length - 1;
        const groupTranslation =
          translation ||
          (isLastHook && hookTrailingTranslation
            ? hookTrailingTranslation
            : null);

        return {
          originalText: main,
          translation:
            language !== "ru" && groupTranslation ? groupTranslation : "",
          slots: Array.from({ length: MANUAL_SLOTS_PER_SENTENCE }, () =>
            createManualSlot(hookInitialQuery || main)
          ),
          slotDurations: null,
        };
      }
    );
    groups = [...hookGroups, ...groups];
  }

  if (rawCta) {
    const ctaTrailingTranslation =
      language !== "ru" ? parseRussianTranslation(rawCta) : null;
    const ctaInitialQuery = (
      script.videoQueries[script.videoQueries.length - 1] ??
      script.videoQueries[0] ??
      toPexelsSearchQuery(rawCta)
    ).trim();
    const ctaSentences = splitHookIntoSentences(rawCta);
    const ctaGroups: ManualGroup[] = ctaSentences.map((sentenceText, index) => {
      const { main, translation } = splitTextWithTranslation(sentenceText);
      const isLastCta = index === ctaSentences.length - 1;
      const groupTranslation =
        translation ||
        (isLastCta && ctaTrailingTranslation ? ctaTrailingTranslation : null);

      return {
        originalText: main,
        translation:
          language !== "ru" && groupTranslation ? groupTranslation : "",
        slots: Array.from({ length: MANUAL_SLOTS_PER_SENTENCE }, () =>
          createManualSlot(ctaInitialQuery || main)
        ),
        slotDurations: null,
      };
    });
    groups = [...groups, ...ctaGroups];
  }

  return groups;
}

function getManualSlotCalculatedDurations(
  groups: ManualGroup[],
  audioDuration: number,
  language: ScriptLanguage
): number[][] {
  const withDurations = applyManualSlotDurations(
    groups,
    audioDuration,
    language
  );

  return withDurations.map((group, groupIndex) => {
    if (group.slotDurations) {
      return [...group.slotDurations];
    }
    return splitWithVariance(
      getManualSegmentDuration(withDurations, groupIndex, audioDuration, language)
    );
  });
}

function getManualSlotEffectiveDuration(
  slot: ManualSlot,
  calculated: number
): number {
  return slot.customDuration ?? calculated;
}

function isManualSlotIncludedInMerge(
  slot: ManualSlot,
  calculated: number
): boolean {
  if (slot.loading || slot.videos.length === 0) {
    return false;
  }
  return getManualSlotEffectiveDuration(slot, calculated) !== 0;
}

function collectManualMergePayload(
  groups: ManualGroup[],
  calculated: number[][]
): { clips: SearchVideoResult[]; durations: number[] } {
  const clips: SearchVideoResult[] = [];
  const durations: number[] = [];

  groups.forEach((group, groupIndex) => {
    group.slots.forEach((slot, slotIndex) => {
      const slotCalculated = calculated[groupIndex]?.[slotIndex] ?? 0;
      if (!isManualSlotIncludedInMerge(slot, slotCalculated)) {
        return;
      }

      clips.push(
        slot.videos[slot.selectedIndex % slot.videos.length]
      );
      durations.push(getManualSlotEffectiveDuration(slot, slotCalculated));
    });
  });

  return { clips, durations };
}

function hasManualMergeClips(
  groups: ManualGroup[],
  calculated: number[][]
): boolean {
  return collectManualMergePayload(groups, calculated).clips.length > 0;
}

function normalizeSegmentDurations(
  durations: number[],
  totalAudioDuration: number
): number[] {
  if (durations.length === 0) {
    return [];
  }

  const sum = durations.reduce((total, duration) => total + duration, 0);
  if (sum <= 0) {
    return durations;
  }

  const scale = totalAudioDuration / sum;
  const normalized = durations.map(
    (duration) => Math.round(duration * scale * 10) / 10
  );

  const normalizedSum = normalized.reduce(
    (total, duration) => total + duration,
    0
  );
  const drift = Math.round((totalAudioDuration - normalizedSum) * 10) / 10;
  if (normalized.length > 0 && drift !== 0) {
    const lastIndex = normalized.length - 1;
    normalized[lastIndex] =
      Math.round((normalized[lastIndex] + drift) * 10) / 10;
  }

  return normalized;
}

function estimateSegmentDurations(
  texts: string[],
  totalAudioDuration: number,
  audioSegments: AudioSegment[] | null = null
): number[] {
  if (texts.length === 0) {
    return [];
  }

  let durations: number[];

  if (audioSegments && audioSegments.length > 0) {
    const charCounts = texts.map((t) => t.replace(/\s+/g, "").length);
    const totalChars = charCounts.reduce((a, b) => a + b, 0);

    durations = texts.map((_, index) => {
      const segment = audioSegments[index];
      if (segment) {
        return Math.round((segment.end - segment.start) * 10) / 10;
      }

      if (totalChars === 0) {
        return 0;
      }

      return (
        Math.round(
          (charCounts[index] / totalChars) * totalAudioDuration * 10
        ) / 10
      );
    });
  } else {
    const charCounts = texts.map((t) => t.replace(/\s+/g, "").length);
    const totalChars = charCounts.reduce((a, b) => a + b, 0);
    if (totalChars === 0) {
      return texts.map(() => 0);
    }

    durations = charCounts.map(
      (c) => Math.round((c / totalChars) * totalAudioDuration * 10) / 10
    );
  }

  return normalizeSegmentDurations(durations, totalAudioDuration);
}

function ManualSlotDurationInput({
  calculatedDuration,
  customDuration,
  onChange,
}: {
  calculatedDuration: number;
  customDuration: number | null;
  onChange: (value: number) => void;
}) {
  const displayValue = customDuration ?? calculatedDuration;

  return (
    <label className="flex cursor-pointer items-center gap-1 text-xs">
      <input
        type="number"
        min={0}
        step={0.1}
        value={displayValue}
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          if (Number.isFinite(parsed) && parsed >= 0) {
            onChange(Math.round(parsed * 10) / 10);
          }
        }}
        style={{ width: "60px" }}
        className="rounded border border-green-800/60 bg-[#1a1035] px-1.5 py-0.5 text-green-400 outline-none focus:border-green-600"
      />
      <span className="text-green-400">сек</span>
    </label>
  );
}

function ManualFootageQueryInput({
  inputRef,
  loading,
  searchError,
  onBlurCommit,
  onSearch,
}: {
  inputRef: (element: HTMLInputElement | null) => void;
  loading: boolean;
  searchError: string | null;
  onBlurCommit: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  const localRef = useRef<HTMLInputElement | null>(null);

  const setRefs = (element: HTMLInputElement | null) => {
    localRef.current = element;
    inputRef(element);
  };

  const runSearch = () => {
    const value = localRef.current?.value.trim() ?? "";
    onSearch(value);
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          ref={setRefs}
          type="text"
          onBlur={(e) => onBlurCommit(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-purple-900/50 bg-[#1a1035] px-2 text-xs text-purple-50 placeholder:text-purple-400/50 outline-none transition-colors focus:border-purple-700"
          style={{ height: "32px", boxSizing: "border-box" }}
          placeholder="Свой запрос в Стоки"
        />
        <button
          type="button"
          title="Найти другое"
          disabled={loading}
          onClick={runSearch}
          className="shrink-0 rounded-lg border border-purple-800/60 px-2.5 text-xs text-purple-200 transition-colors hover:border-purple-600 hover:bg-purple-800/60 disabled:opacity-50"
          style={{ height: "32px", boxSizing: "border-box" }}
        >
          🔄
        </button>
      </div>
      {searchError && (
        <p className="text-[10px] leading-snug text-red-400">{searchError}</p>
      )}
    </div>
  );
}

function ManualFootageSlot({
  slot,
  calculatedDuration,
  inputRef,
  onBlurCommit,
  onSearch,
  onDurationChange,
  onCycleVideo,
}: {
  slot: ManualSlot;
  calculatedDuration: number | null;
  inputRef: (element: HTMLInputElement | null) => void;
  onBlurCommit: (value: string) => void;
  onSearch: (value: string) => void;
  onDurationChange: (value: number) => void;
  onCycleVideo: () => void;
}) {
  const activeVideo =
    slot.videos.length > 0
      ? slot.videos[slot.selectedIndex % slot.videos.length]
      : null;

  return (
    <div className="space-y-2" style={{ flex: "1 1 0", minWidth: 0 }}>
      <ManualFootageQueryInput
        inputRef={inputRef}
        loading={slot.loading}
        searchError={slot.searchError}
        onBlurCommit={onBlurCommit}
        onSearch={onSearch}
      />

      {slot.loading ? (
        <div className="flex justify-center py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-800/60 border-t-purple-50" />
        </div>
      ) : !activeVideo ? (
        <p className="text-[10px] text-purple-400/50">Видео не найдены</p>
      ) : (
        <div className="space-y-1.5">
          <video
            src={activeVideo.url}
            poster={activeVideo.preview}
            muted
            loop
            playsInline
            onMouseEnter={(e) => {
              void e.currentTarget.play().catch(() => {});
            }}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
            style={{
              width: "100%",
              height: "360px",
              objectFit: "cover",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          />
          {calculatedDuration != null && (
            <ManualSlotDurationInput
              calculatedDuration={calculatedDuration}
              customDuration={slot.customDuration}
              onChange={onDurationChange}
            />
          )}
          {slot.videos.length > 1 && (
            <button
              type="button"
              onClick={onCycleVideo}
              className="w-full rounded-md border border-purple-800/60 px-2 py-1 text-[10px] text-purple-200 transition-colors hover:border-purple-600 hover:bg-purple-800/60"
            >
              Другой
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ManualFootageSection({
  videoId,
  panel,
  groups,
  slotInputRefs,
  onBlurCommit,
  onSearch,
  onDurationChange,
  onCycleVideo,
}: {
  videoId: string;
  panel: ScriptPanelState;
  slotInputRefs: React.MutableRefObject<
    Record<string, HTMLInputElement | null>
  >;
  onBlurCommit: (
    groupIndex: number,
    slotIndex: number,
    value: string
  ) => void;
  onSearch: (
    groupIndex: number,
    slotIndex: number,
    value: string
  ) => void;
  onDurationChange: (
    groupIndex: number,
    slotIndex: number,
    value: number
  ) => void;
  onCycleVideo: (groupIndex: number, slotIndex: number) => void;
  groups: ManualGroup[];
}) {
  const language = panel.language ?? "ru";
  const manualCalculated =
    panel.audioDuration != null
      ? getManualSlotCalculatedDurations(
          panel.manualGroups,
          panel.audioDuration,
          language
        )
      : null;

  if (groups.length === 0 && panel.manualGroups.length === 0) {
    return <p className="text-xs text-purple-400/50">Нет предложений в сценарии</p>;
  }

  return (
    <div className="space-y-6">
      {groups.map((group, groupIndex) => (
        <div key={`${group.originalText}-${groupIndex}`} className="space-y-2">
          <div className="space-y-1">
            <p className="text-xs font-bold leading-snug text-purple-50">
              {renderWithTranslation(
                group.translation
                  ? `${group.originalText} (${group.translation})`
                  : group.originalText
              )}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: "8px",
              width: "100%",
            }}
          >
            {group.slots.map((slot, slotIndex) => (
              <ManualFootageSlot
                key={`${groupIndex}-${slotIndex}`}
                slot={slot}
                inputRef={(element: HTMLInputElement | null) => {
                  slotInputRefs.current[
                    `${videoId}-${groupIndex}-${slotIndex}`
                  ] = element;
                }}
                calculatedDuration={
                  group.slotDurations?.[slotIndex] ??
                  manualCalculated?.[groupIndex]?.[slotIndex] ??
                  null
                }
                onBlurCommit={(value) =>
                  onBlurCommit(groupIndex, slotIndex, value)
                }
                onSearch={(value) => onSearch(groupIndex, slotIndex, value)}
                onDurationChange={(value) =>
                  onDurationChange(groupIndex, slotIndex, value)
                }
                onCycleVideo={() => onCycleVideo(groupIndex, slotIndex)}
              />
            ))}
          </div>
          {(() => {
            const chunkIndex = resolveAudioChunkIndex(
              panel.data,
              panel.selectedHook,
              group.originalText,
              groupIndex
            );
            const chunkBlob = panel.audioChunks?.[chunkIndex];
            return chunkBlob ? (
              <ChunkAudioPlayer blob={chunkBlob} className="mt-2 h-8 w-full" />
            ) : null;
          })()}
        </div>
      ))}
    </div>
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

function HomePage() {
  const searchParams = useSearchParams();
  const isWorkspace = searchParams.get("workspace") === "1";
  const workspaceVideoId = searchParams.get("v");
  const workspaceBootstrapped = useRef(false);

  const [keyword, setKeyword] = useState("");
  const [expandedSearch, setExpandedSearch] = useState(true);
  const [offer, setOffer] = useState("");
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [type, setType] = useState<VideoType>("short");
  const [period, setPeriod] = useState<Period>("30d");
  const [minViews, setMinViews] = useState(10000);
  const [sortBy, setSortBy] = useState<SortBy>("velocity");
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
  const manualSlotInputRefs = useRef<Record<string, HTMLInputElement | null>>(
    {}
  );
  const manualSlotSearchAbortRefs = useRef<Record<string, AbortController>>(
    {}
  );
  const [visibleCount, setVisibleCount] = useState(4);

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
    setVisibleCount(4);

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
      expandedSearch,
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
        voiceProgress: null,
        voiceError: null,
        voiceAudioUrl: null,
        voiceAudioBlob: null,
        audioDuration: null,
        language: current?.language ?? "ru",
        ...FOOTAGE_DEFAULTS,
      },
    }));

    if (!isWorkspace) {
      setTimeout(() => {
        document
          .getElementById("script-panel")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }

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
          videoType: type,
          videoDuration:
            video.durationSeconds > 0 ? video.durationSeconds : null,
        }),
      });

      const rawText = await res.text();
      let data: ScriptResult & { error?: string };
      try {
        data = JSON.parse(rawText) as ScriptResult & { error?: string };
      } catch {
        const preview = rawText.trim().slice(0, 200);
        throw new Error(
          preview.startsWith("<")
            ? `Сервер вернул HTML вместо JSON (${res.status}). Возможен таймаут API — попробуйте снова.`
            : preview || `Ошибка ${res.status}: ответ не JSON`
        );
      }

      if (!res.ok) {
        console.error("generate-script response:", res.status, data);
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
          voiceProgress: null,
          voiceError: null,
          voiceAudioUrl: null,
          voiceAudioBlob: null,
          audioDuration: null,
          language: prev[id]?.language ?? "ru",
          ...FOOTAGE_DEFAULTS,
        },
      }));
    } catch (err) {
      console.error("generate-script failed:", err);
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
          voiceProgress: null,
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

  const loadManualFootageForVideo = async (
    videoId: string,
    script: ScriptResult,
    selectedHook: number | null,
    language: ScriptLanguage
  ) => {
    const groups = buildManualGroups(script, language, selectedHook);
    const searchQueries = groups.map((group) =>
      toPexelsSearchQuery(group.slots[0]?.query.trim() ?? "")
    );
    const queriesToSend = searchQueries.filter(Boolean);

    if (queriesToSend.length === 0) {
      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          manualGroups: applyManualSlotDurations(
            groups,
            prev[videoId]?.audioDuration ?? null,
            language
          ),
          footageLoading: false,
          footageError: null,
        },
      }));
      return;
    }

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        footageLoading: true,
        footageError: null,
        manualGroups: groups.map((group) => ({
          ...group,
          slots: group.slots.map((slot) => ({
            ...slot,
            loading: Boolean(toPexelsSearchQuery(slot.query.trim())),
          })),
        })),
      },
    }));

    try {
      const results = await searchFootageVideos(queriesToSend);

      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          footageLoading: false,
          footageError: null,
          manualGroups: applyManualSlotDurations(
            groups.map((group, groupIndex) => {
              const searchQuery = searchQueries[groupIndex];
              const videos = searchQuery
                ? results.filter((video) => video.query === searchQuery)
                : [];

              return {
                ...group,
                slots: group.slots.map((slot) => ({
                  ...slot,
                  videos,
                  loading: false,
                  selectedIndex: 0,
                })),
              };
            }),
            prev[videoId]?.audioDuration ?? null,
            language
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
          manualGroups: applyManualSlotDurations(
            groups.map((group) => ({
              ...group,
              slots: group.slots.map((slot) => ({ ...slot, loading: false })),
            })),
            prev[videoId]?.audioDuration ?? null,
            language
          ),
        },
      }));
    }
  };

  const updateManualGroups = (
    videoId: string,
    updater: (groups: ManualGroup[]) => ManualGroup[]
  ) => {
    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        manualGroups: updater(prev[videoId]?.manualGroups ?? []),
      },
    }));
  };

  const updateAISlot = (
    videoId: string,
    groupIdx: number,
    slotIdx: number,
    patch: Partial<AIImageSlot>
  ) => {
    setScripts((prev) => {
      const panel = prev[videoId];
      if (!panel?.aiImageGroups) return prev;
      const groups = panel.aiImageGroups.map((g, gi) => {
        if (gi !== groupIdx) return g;
        const slots = g.slots.map((s, si) =>
          si === slotIdx ? { ...s, ...patch } : s
        ) as [AIImageSlot, AIImageSlot, AIImageSlot];
        return { ...g, slots };
      });
      return {
        ...prev,
        [videoId]: { ...panel, aiImageGroups: groups },
      };
    });
  };

  const handleGenerateAIImage = async (
    videoId: string,
    groupIdx: number,
    slotIdx: number
  ) => {
    const panel = scripts[videoId];
    if (!panel?.aiImageGroups) return;
    const group = panel.aiImageGroups[groupIdx];
    const slot = group.slots[slotIdx];
    const prompt = slot.customPrompt?.trim() || group.originalText;

    updateAISlot(videoId, groupIdx, slotIdx, { loading: true, error: null });

    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as {
        imageUrl?: string | null;
        error?: string | null;
      };
      updateAISlot(videoId, groupIdx, slotIdx, {
        loading: false,
        imageUrl: data.imageUrl ?? null,
        error: data.error ?? (res.ok ? null : "Ошибка генерации"),
      });
    } catch {
      updateAISlot(videoId, groupIdx, slotIdx, {
        loading: false,
        error: "Ошибка запроса",
      });
    }
  };

  const handleAnimateAIImage = async (
    videoId: string,
    groupIdx: number,
    slotIdx: number
  ) => {
    const panel = scripts[videoId];
    if (!panel?.aiImageGroups) return;
    const group = panel.aiImageGroups[groupIdx];
    const slot = group.slots[slotIdx];
    if (!slot.imageUrl) return;

    updateAISlot(videoId, groupIdx, slotIdx, {
      animating: true,
      animateError: null,
    });

    try {
      const res = await fetch("/api/animate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: slot.imageUrl,
          prompt: slot.customPrompt?.trim() || group.originalText,
        }),
      });
      const data = (await res.json()) as {
        videoUrl?: string | null;
        error?: string | null;
      };
      updateAISlot(videoId, groupIdx, slotIdx, {
        animating: false,
        animatedVideoUrl: data.videoUrl ?? null,
        animateError: data.error ?? (res.ok ? null : "Ошибка оживления"),
      });
    } catch {
      updateAISlot(videoId, groupIdx, slotIdx, {
        animating: false,
        animateError: "Ошибка запроса",
      });
    }
  };

  const commitManualSlotQuery = (
    videoId: string,
    groupIndex: number,
    slotIndex: number,
    query: string
  ) => {
    updateManualGroups(videoId, (groups) =>
      groups.map((group, gi) =>
        gi !== groupIndex
          ? group
          : {
              ...group,
              slots: group.slots.map((slot, si) =>
                si !== slotIndex ? slot : { ...slot, query }
              ),
            }
      )
    );
  };

  const setManualSlotCustomDuration = (
    videoId: string,
    groupIndex: number,
    slotIndex: number,
    customDuration: number
  ) => {
    updateManualGroups(videoId, (groups) =>
      groups.map((group, gi) =>
        gi !== groupIndex
          ? group
          : {
              ...group,
              slots: group.slots.map((slot, si) =>
                si !== slotIndex ? slot : { ...slot, customDuration }
              ),
            }
      )
    );
  };

  const handleSearchManualSlot = async (
    videoId: string,
    groupIndex: number,
    slotIndex: number,
    queryFromInput?: string
  ) => {
    const slot =
      scripts[videoId]?.manualGroups[groupIndex]?.slots[slotIndex];
    if (!slot) {
      return;
    }

    const group = scripts[videoId]?.manualGroups[groupIndex];
    const refValue =
      manualSlotInputRefs.current[
        `${videoId}-${groupIndex}-${slotIndex}`
      ]?.value.trim() ?? "";
    const rawQuery = (
      queryFromInput?.trim() ||
      refValue ||
      slot.query.trim() ||
      (group
        ? toPexelsSearchQuery(group.originalText)
        : "")
    ).trim();
    const searchQuery = toPexelsSearchQuery(rawQuery);
    if (!searchQuery) {
      return;
    }

    const isSameQuery = slot.lastSearchQuery === searchQuery;
    const page = isSameQuery
      ? Math.floor(Math.random() * 15) + 1
      : 1;

    updateManualGroups(videoId, (groups) =>
      groups.map((item, gi) =>
        gi !== groupIndex
          ? item
          : {
              ...item,
              slots: item.slots.map((s, si) =>
                si !== slotIndex
                  ? s
                  : {
                      ...s,
                      query: rawQuery,
                      loading: true,
                      searchError: null,
                      videos: [],
                      selectedIndex: 0,
                    }
              ),
            }
      )
    );

    setScripts((prev) => ({
      ...prev,
      [videoId]: { ...prev[videoId], footageError: null },
    }));

    const slotKey = `${videoId}-${groupIndex}-${slotIndex}`;
    const previousController = manualSlotSearchAbortRefs.current[slotKey];
    if (previousController) {
      previousController.abort();
    }

    const controller = new AbortController();
    manualSlotSearchAbortRefs.current[slotKey] = controller;
    const isCurrentSearch = () =>
      manualSlotSearchAbortRefs.current[slotKey] === controller;

    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const results = await searchFootageVideos(
        [searchQuery],
        [page],
        controller.signal
      );
      clearTimeout(timeoutId);
      if (!isCurrentSearch()) {
        return;
      }

      updateManualGroups(videoId, (groups) =>
        groups.map((item, gi) => {
          if (gi !== groupIndex) {
            return item;
          }

          return {
            ...item,
            slots: item.slots.map((s, si) => {
              if (si !== slotIndex) {
                return s;
              }

              return {
                ...s,
                query: rawQuery,
                lastSearchQuery: searchQuery,
                searchPage: page,
                videos: results.filter((video) => video.query === searchQuery),
                loading: false,
                searchError: null,
                selectedIndex: 0,
              };
            }),
          };
        })
      );
    } catch (err) {
      clearTimeout(timeoutId);
      if (!isCurrentSearch()) {
        return;
      }

      const isTimeout =
        err instanceof Error && err.name === "AbortError";

      updateManualGroups(videoId, (groups) =>
        groups.map((item, gi) =>
          gi !== groupIndex
            ? item
            : {
                ...item,
                slots: item.slots.map((s, si) =>
                  si !== slotIndex
                    ? s
                    : {
                        ...s,
                        query: rawQuery,
                        loading: false,
                        searchError: isTimeout
                          ? "Таймаут — попробуй другой запрос"
                          : "Ошибка поиска, попробуй другой запрос",
                      }
                ),
              }
        )
      );
    } finally {
      if (isCurrentSearch()) {
        delete manualSlotSearchAbortRefs.current[slotKey];
      }
    }
  };

  const handleCycleManualSlotVideo = (
    videoId: string,
    groupIndex: number,
    slotIndex: number
  ) => {
    updateManualGroups(videoId, (groups) =>
      groups.map((group, gi) => {
        if (gi !== groupIndex) {
          return group;
        }

        return {
          ...group,
          slots: group.slots.map((slot, si) => {
            if (si !== slotIndex || slot.videos.length === 0) {
              return slot;
            }

            return {
              ...slot,
              selectedIndex: (slot.selectedIndex + 1) % slot.videos.length,
            };
          }),
        };
      })
    );
  };

  const updateScriptHook = (
    videoId: string,
    index: number,
    main: string
  ) => {
    setScripts((prev) => {
      const panel = prev[videoId];
      if (!panel?.data) {
        return prev;
      }

      const previousHook = panel.data.hooks[index] ?? "";
      const preservedTranslation = getPreservedTranslation(previousHook);
      const fullText = combineWithTranslation(main, preservedTranslation);
      const hookMain = stripTranslation(fullText).trim();
      const selectedIndex = getSelectedHookIndex(panel.selectedHook);
      const language = panel.language ?? "ru";

      const hooks = [...panel.data.hooks];
      hooks[index] = fullText;

      let footageGroups = panel.footageGroups;
      if (index === selectedIndex && footageGroups.length > 0) {
        footageGroups = footageGroups.map((group, groupIndex) =>
          groupIndex === 0
            ? { ...group, originalQuery: fullText }
            : group
        );
      }

      let manualGroups = panel.manualGroups;
      if (index === selectedIndex && manualGroups.length > 0) {
        manualGroups = manualGroups.map((group, groupIndex) =>
          groupIndex === 0
            ? {
                ...group,
                originalText: hookMain,
                translation:
                  language !== "ru" && preservedTranslation
                    ? preservedTranslation
                    : "",
                slots: group.slots.map((slot) => ({
                  ...slot,
                  query: hookMain,
                })),
              }
            : group
        );
      }

      return {
        ...prev,
        [videoId]: {
          ...panel,
          data: { ...panel.data, hooks },
          footageGroups,
          manualGroups,
        },
      };
    });
  };

  const updateScriptBody = (videoId: string, main: string) => {
    setScripts((prev) => {
      const panel = prev[videoId];
      if (!panel?.data) {
        return prev;
      }

      const preservedTranslation = getPreservedTranslation(panel.data.body);
      return {
        ...prev,
        [videoId]: {
          ...panel,
          data: {
            ...panel.data,
            body: combineWithTranslation(main, preservedTranslation),
          },
        },
      };
    });
  };

  const updateScriptCta = (videoId: string, main: string) => {
    setScripts((prev) => {
      const panel = prev[videoId];
      if (!panel?.data) {
        return prev;
      }

      const preservedTranslation = getPreservedTranslation(panel.data.cta);
      const fullText = combineWithTranslation(main, preservedTranslation);
      const ctaMain = stripTranslation(fullText).trim();
      const language = panel.language ?? "ru";
      const hasCta = Boolean(panel.data.cta?.trim());

      let footageGroups = panel.footageGroups;
      if (hasCta && footageGroups.length > 0) {
        const lastIndex = footageGroups.length - 1;
        footageGroups = footageGroups.map((group, groupIndex) =>
          groupIndex === lastIndex
            ? { ...group, originalQuery: fullText }
            : group
        );
      }

      let manualGroups = panel.manualGroups;
      if (hasCta && manualGroups.length > 0) {
        const lastIndex = manualGroups.length - 1;
        manualGroups = manualGroups.map((group, groupIndex) =>
          groupIndex === lastIndex
            ? {
                ...group,
                originalText: ctaMain,
                translation:
                  language !== "ru" && preservedTranslation
                    ? preservedTranslation
                    : "",
                slots: group.slots.map((slot) => ({
                  ...slot,
                  query: ctaMain,
                })),
              }
            : group
        );
      }

      return {
        ...prev,
        [videoId]: {
          ...panel,
          data: {
            ...panel.data,
            cta: fullText,
          },
          footageGroups,
          manualGroups,
        },
      };
    });
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
        voiceProgress: null,
        voiceError: null,
        voiceAudioUrl: null,
        voiceAudioBlob: null,
        audioDuration: null,
        language: prev[videoId]?.language ?? "ru",
        ...FOOTAGE_DEFAULTS,
      },
    }));

    try {
      const chunks = getSentenceChunks(script, selectedHook);
      if (chunks.length === 0) throw new Error("Нет текста для озвучки");

      const synthesizeChunk = async (
        chunk: string,
        chunkIndex: number,
        attempt = 1
      ): Promise<ArrayBuffer> => {
        try {
          const res = await fetch("/api/synthesize-voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: chunk }),
          });
          const rawText = await res.text();
          let data: { error?: string; audioBase64?: string };
          try {
            data = JSON.parse(rawText) as {
              error?: string;
              audioBase64?: string;
            };
          } catch {
            console.error(
              `Chunk ${chunkIndex} non-JSON:`,
              rawText.slice(0, 200)
            );
            return new ArrayBuffer(0);
          }
          if (res.status === 429 && attempt < 6) {
            await new Promise((resolve) =>
              setTimeout(resolve, 3000 * attempt)
            );
            return synthesizeChunk(chunk, chunkIndex, attempt + 1);
          }
          if (!res.ok) {
            throw new Error(
              typeof data.error === "string"
                ? data.error
                : `Ошибка Voicer: ${res.status}`
            );
          }
          if (!data.audioBase64) throw new Error("Озвучка не вернула аудио");
          const binary = atob(data.audioBase64);
          const bytes = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) {
            bytes[j] = binary.charCodeAt(j);
          }
          return bytes.buffer;
        } catch (err) {
          console.error(`Chunk ${chunkIndex} failed:`, err);
          return new ArrayBuffer(0);
        }
      };

      const CONCURRENCY = 15;
      const audioBuffers: ArrayBuffer[] = new Array(chunks.length);
      const queue = chunks.map((chunk, i) => ({ chunk, i }));
      let completed = 0;

      const processQueue = async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) return;
          audioBuffers[item.i] = await synthesizeChunk(item.chunk, item.i);
          completed++;
          setScripts((prev) => ({
            ...prev,
            [videoId]: {
              ...prev[videoId],
              voiceProgress: { current: completed, total: chunks.length },
            },
          }));
        }
      };

      await Promise.all(
        Array.from({ length: CONCURRENCY }, () => processQueue())
      );

      const audioContext = new AudioContext();
      const decodedBuffers = await Promise.all(
        audioBuffers.map(async (buf, i) => {
          if (buf.byteLength === 0) {
            console.warn(`Chunk ${i} skipped (no audio)`);
            return null;
          }
          try {
            return await audioContext.decodeAudioData(buf.slice(0));
          } catch (decodeErr) {
            console.error(`Chunk ${i} decode failed:`, decodeErr);
            return null;
          }
        })
      );

      const validDecoded = decodedBuffers.filter(
        (b): b is AudioBuffer => b !== null
      );
      if (validDecoded.length === 0) {
        throw new Error("Не удалось озвучить ни одного чанка");
      }

      const chunkDurations = decodedBuffers.map((b) => b?.duration ?? 0);
      const totalDuration = chunkDurations.reduce((a, b) => a + b, 0);

      const sampleRate = validDecoded[0].sampleRate;
      const numberOfChannels = validDecoded[0].numberOfChannels;
      const totalSamples = Math.ceil(totalDuration * sampleRate);
      const combined = audioContext.createBuffer(
        numberOfChannels,
        totalSamples,
        sampleRate
      );
      let offset = 0;
      for (const buf of decodedBuffers) {
        if (!buf) continue;
        for (let ch = 0; ch < numberOfChannels; ch++) {
          combined.getChannelData(ch).set(buf.getChannelData(ch), offset);
        }
        offset += buf.length;
      }
      await audioContext.close();

      const wavBlob = audioBufferToWav(combined);

      // Сохраняем каждый чанк как отдельный WAV blob
      const audioChunkBlobs = decodedBuffers.map((buf) =>
        buf ? audioBufferToWav(buf) : new Blob()
      );

      const audioSegments: AudioSegment[] = [];
      let cursor = 0;
      chunks.forEach((text, i) => {
        const duration = chunkDurations[i];
        audioSegments.push({
          start: Math.round(cursor * 100) / 100,
          end: Math.round((cursor + duration) * 100) / 100,
          text,
        });
        cursor += duration;
      });

      const audioUrl = URL.createObjectURL(wavBlob);

      setScripts((prev) => {
        const panel = prev[videoId];
        const language = panel?.language ?? "ru";
        const manualGroups =
          panel?.clipMode === "manual" && panel.manualGroups.length > 0
            ? applyManualSlotDurations(
                panel.manualGroups,
                totalDuration,
                language
              )
            : panel?.manualGroups ?? [];
        return {
          ...prev,
          [videoId]: {
            ...panel,
            voiceLoading: false,
            voiceProgress: null,
            voiceError: null,
            voiceAudioUrl: audioUrl,
            voiceAudioBlob: wavBlob,
            audioDuration: totalDuration,
            audioSegments,
            audioChunks: audioChunkBlobs,
            manualGroups,
          },
        };
      });

    } catch (err) {
      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          voiceLoading: false,
          voiceProgress: null,
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
    clipMode: "sentences" | "manual",
    script: ScriptResult,
    selectedHook: number | null,
    language: ScriptLanguage
  ) => {
    if (clipMode === "manual") {
      setScripts((prev) => ({
        ...prev,
        [videoId]: {
          ...prev[videoId],
          clipMode: "manual",
          footageSearchStarted: true,
          footageError: null,
          footageGroups: [],
          openFootageIndex: null,
          manualGroups: [],
          aiImageGroups: null,
          footagePage: 0,
        },
      }));
      void loadManualFootageForVideo(
        videoId,
        script,
        selectedHook,
        language
      );
      return;
    }

    const hookIndex = getSelectedHookIndex(selectedHook);
    const hook = script.hooks[hookIndex] ?? script.hooks[0] ?? "";
    const sentences = (script.sentences ?? [])
      .map((s) => s.trim())
      .filter(Boolean);

    setScripts((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        clipMode: "sentences",
        footageSearchStarted: true,
        footageGroups: [],
        footageError: null,
        footageLoading: false,
        manualGroups: [],
        aiImageGroups: buildAIImageGroups(sentences, hook),
        footagePage: 0,
      },
    }));
  };

  const handleDownloadVideo = async (videoId: string) => {
    const panel = scripts[videoId];
    if (!panel?.voiceAudioUrl && !panel?.voiceAudioBlob) {
      return;
    }

    const isManual = panel.clipMode === "manual";
    const manualCalculated =
      isManual && panel.audioDuration != null
        ? getManualSlotCalculatedDurations(
            panel.manualGroups,
            panel.audioDuration,
            panel.language ?? "ru"
          )
        : null;

    let selectedClips: SearchVideoResult[];
    let durations: number[];

    if (isManual) {
      const groupsWithDurations = applyManualSlotDurations(
        panel.manualGroups,
        panel.audioDuration ?? 0,
        panel.language ?? "ru"
      );
      const calculated =
        manualCalculated ??
        groupsWithDurations.map(
          (group) => group.slotDurations ?? [0, 0, 0]
        );
      const payload = collectManualMergePayload(
        groupsWithDurations,
        calculated
      );

      if (payload.clips.length === 0) {
        setScripts((prev) => ({
          ...prev,
          [videoId]: {
            ...prev[videoId],
            mergeError:
              "Добавьте видео в слоты с длительностью больше 0 сек",
            mergeStatus: null,
          },
        }));
        return;
      }

      selectedClips = payload.clips;
      durations = payload.durations;
    } else {
      selectedClips = getSelectedFootageClips(panel.footageGroups);
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
      durations = [];
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

      if (!isManual) {
        const footageTexts = panel.footageGroups
          .filter((group) => !group.loading && group.videos.length > 0)
          .map((group) =>
            segmentTextForDuration(group.originalQuery, panel.language ?? "ru")
          );
        durations = estimateSegmentDurations(
          footageTexts,
          audioDuration,
          panel.audioSegments
        );
      }

      const clipUrls = selectedClips.map((clip) => clip.url);
      const startTimes = selectedClips.map(() => 0);

      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.wav");
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

  const activeVideo =
    openVideoId != null
      ? videos.find((item) => item.videoId === openVideoId) ?? null
      : null;

  useEffect(() => {
    if (!isWorkspace || !workspaceVideoId || workspaceBootstrapped.current) {
      return;
    }
    workspaceBootstrapped.current = true;

    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY(workspaceVideoId));
    if (!raw) {
      setError(
        "Не найдены данные видео. Нажмите «Создать сценарий» в списке поиска."
      );
      return;
    }

    try {
      const payload = JSON.parse(raw) as {
        video: ViralVideoResult;
        keyword: string;
        offer: string;
        scriptData?: ScriptResult;
      };
      setVideos([payload.video]);
      setKeyword(payload.keyword ?? "");
      setOffer(payload.offer ?? "");
      setOpenVideoId(workspaceVideoId);
      setError(null);

      if (payload.scriptData) {
        const scriptData =
          typeof payload.scriptData === "string"
            ? (JSON.parse(payload.scriptData) as ScriptResult)
            : (payload.scriptData as ScriptResult);
        setScripts((prev) => ({
          ...prev,
          [workspaceVideoId]: {
            loading: false,
            data: scriptData,
            error: null,
            selectedHook: null,
            copiedHook: null,
            copiedAll: false,
            voiceLoading: false,
            voiceProgress: null,
            voiceError: null,
            voiceAudioUrl: null,
            voiceAudioBlob: null,
            audioDuration: null,
            language: "ru",
            ...FOOTAGE_DEFAULTS,
          },
        }));
      } else {
        void handleGenerateScript(payload.video);
      }
    } catch {
      setError("Ошибка загрузки данных видео");
    }
    // handleGenerateScript стабилен для одноразовой инициализации workspace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorkspace, workspaceVideoId]);

  const renderScriptPanel = (video: ViralVideoResult) => {
    const panel = scripts[video.videoId];

    return (
      <div className="rounded-lg border border-purple-900/50 bg-[#0f0a1e]/80 p-4">
  {(!panel || panel.loading) && (
    <div className="flex items-center justify-center gap-3 py-6">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-800/60 border-t-purple-50" />
      <span className="text-sm text-purple-300/70">
        Генерируем сценарий…
      </span>
    </div>
  )}

  {panel?.error && !panel.loading && (
    <p className="text-sm text-red-400">{panel.error}</p>
  )}

  {panel?.data && !panel.loading && (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-purple-400/50">
        {getScriptSourceLabel(panel.data)}
      </p>
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-purple-400/50">
          Хуки — выбери ✓ и нажми, чтобы скопировать
        </h3>
        <div className="space-y-2">
          {panel.data.hooks.map((hook, i) => {
            return (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2 transition-colors ${
                  panel.selectedHook === i
                    ? "border-fuchsia-500/60 bg-[#231448]"
                    : "border-purple-800/60 bg-[#1a1035]"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setScripts((prev) => ({
                        ...prev,
                        [video.videoId]: {
                          ...prev[video.videoId],
                          selectedHook: i,
                        },
                      }))
                    }
                    className="text-xs text-fuchsia-400/80 transition-colors hover:text-fuchsia-300"
                  >
                    {panel.selectedHook === i ? "✓ " : ""}
                    Хук {i + 1}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyHook(
                        video.videoId,
                        i,
                        panel.data!.hooks[i]
                      )
                    }
                    className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                      panel.copiedHook === i
                        ? "border-emerald-500/50 text-emerald-400"
                        : "border-fuchsia-500/50 text-fuchsia-400 hover:border-fuchsia-400 hover:text-fuchsia-300"
                    }`}
                  >
                    {panel.copiedHook === i
                      ? "✓ Скопировано!"
                      : "Копировать"}
                  </button>
                </div>
                <ScriptEditableTextarea
                  value={stripTranslation(hook)}
                  translations={extractTranslations(hook)}
                  minRows={2}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(nextMain) =>
                    updateScriptHook(
                      video.videoId,
                      i,
                      nextMain
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-purple-400/50">
          Основная часть
        </h3>
        <ScriptEditableTextarea
          value={stripTranslation(panel.data.body)}
          translations={extractTranslations(panel.data.body)}
          minRows={4}
          onChange={(main) =>
            updateScriptBody(video.videoId, main)
          }
        />
      </div>

      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-purple-400/50">
          CTA
        </h3>
        <ScriptEditableTextarea
          value={stripTranslation(panel.data.cta)}
          translations={extractTranslations(panel.data.cta)}
          minRows={2}
          onChange={(main) =>
            updateScriptCta(video.videoId, main)
          }
        />
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
        className="w-full rounded-md bg-gradient-to-r from-violet-600 to-purple-600 py-2 text-sm font-medium text-white transition-colors hover:from-violet-500 hover:to-purple-500"
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
        className="w-full rounded-md border border-purple-700 bg-purple-900/60 py-2 text-sm text-purple-50 transition-colors hover:border-purple-600 hover:bg-purple-800/60 disabled:opacity-60"
      >
        {panel.voiceLoading
          ? getVoiceLoadingLabel(panel.voiceProgress)
          : "🎙 Озвучить сценарий"}
      </button>

      {panel.voiceLoading && (
        <>
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-800/60 border-t-purple-50" />
            <span className="text-xs text-purple-300/70">
              {getVoiceLoadingLabel(panel.voiceProgress)}
            </span>
          </div>
          <p
            style={{
              fontSize: 11,
              color: "#6b7280",
              textAlign: "center",
              marginTop: 4,
            }}
          >
            По одному предложению для естественного звучания
          </p>
        </>
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
            onChange={(mode) => {
              if (mode !== "sentences" && mode !== "manual") return;
              handleClipModeChange(
                video.videoId,
                mode,
                panel.data!,
                panel.selectedHook,
                panel.language ?? "ru"
              );
            }}
            options={[
              { value: "sentences", label: "По предложению" },
              { value: "manual", label: "Ручной" },
            ]}
          />

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-purple-400/50">
              Видеоряд
            </h3>

            {panel.clipMode === null ? (
              <p className="text-xs text-purple-400/50">
                Выберите режим подбора футажа выше.
              </p>
            ) : panel.clipMode === "manual" ? (
              <>
                {(() => {
                  const visibleCount =
                    (panel.footagePage + 1) * GROUPS_PER_PAGE;
                  const visibleManual = panel.manualGroups.slice(
                    0,
                    visibleCount
                  );
                  return (
                    <>
                {panel.footageLoading &&
                  panel.manualGroups.length === 0 && (
                    <div className="mb-3 flex items-center gap-2 py-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-800/60 border-t-purple-50" />
                      <span className="text-xs text-purple-300/70">
                        Ищем видео на Pexels…
                      </span>
                    </div>
                  )}

                {panel.footageError && (
                  <p className="mb-3 text-xs text-red-400">
                    {panel.footageError}
                  </p>
                )}

                <ManualFootageSection
                  videoId={video.videoId}
                  panel={panel}
                  groups={visibleManual}
                  slotInputRefs={manualSlotInputRefs}
                  onBlurCommit={(groupIndex, slotIndex, value) =>
                    commitManualSlotQuery(
                      video.videoId,
                      groupIndex,
                      slotIndex,
                      value
                    )
                  }
                  onSearch={(groupIndex, slotIndex, value) => {
                    commitManualSlotQuery(
                      video.videoId,
                      groupIndex,
                      slotIndex,
                      value
                    );
                    void handleSearchManualSlot(
                      video.videoId,
                      groupIndex,
                      slotIndex,
                      value
                    );
                  }}
                  onDurationChange={(
                    groupIndex,
                    slotIndex,
                    value
                  ) =>
                    setManualSlotCustomDuration(
                      video.videoId,
                      groupIndex,
                      slotIndex,
                      value
                    )
                  }
                  onCycleVideo={(groupIndex, slotIndex) =>
                    handleCycleManualSlotVideo(
                      video.videoId,
                      groupIndex,
                      slotIndex
                    )
                  }
                />
                <ShowMoreButton
                  current={visibleManual.length}
                  total={panel.manualGroups.length}
                  onMore={() =>
                    setScripts((prev) => ({
                      ...prev,
                      [video.videoId]: {
                        ...prev[video.videoId],
                        footagePage: panel.footagePage + 1,
                      },
                    }))
                  }
                />
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                {(() => {
                  const visibleCount =
                    (panel.footagePage + 1) * GROUPS_PER_PAGE;
                  const visibleAI = (panel.aiImageGroups ?? []).slice(
                    0,
                    visibleCount
                  );
                  return (
                    <>
                {visibleAI.map((group, gi) => (
                  <div key={gi} style={{ marginBottom: 32 }}>
                    <p
                      style={{
                        fontWeight: "bold",
                        fontSize: 14,
                        marginBottom: 4,
                      }}
                    >
                      {group.originalText}
                    </p>
                    {group.translation && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "#9ca3af",
                          fontStyle: "italic",
                          marginBottom: 8,
                        }}
                      >
                        {group.translation}
                      </p>
                    )}

                    <div style={{ display: "flex", gap: 12 }}>
                      {group.slots.map((slot, si) => (
                        <div
                          key={si}
                          style={{
                            flex: 1,
                            border: "1px solid #374151",
                            borderRadius: 8,
                            padding: 8,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <input
                            type="text"
                            placeholder={group.originalText}
                            value={slot.customPrompt ?? ""}
                            onChange={(e) =>
                              updateAISlot(video.videoId, gi, si, {
                                customPrompt: e.target.value || null,
                              })
                            }
                            style={{
                              fontSize: 11,
                              background: "#1f2937",
                              border: "1px solid #4b5563",
                              borderRadius: 4,
                              padding: "4px 8px",
                              color: "#f9fafb",
                              width: "100%",
                              boxSizing: "border-box",
                            }}
                          />

                          <div
                            style={{
                              height: 96,
                              borderRadius: 6,
                              overflow: "hidden",
                              background: "#111827",
                            }}
                          >
                            {slot.loading && (
                              <div
                                style={{
                                  height: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#6b7280",
                                  fontSize: 12,
                                }}
                              >
                                Генерация...
                              </div>
                            )}
                            {slot.animatedVideoUrl && (
                              <video
                                src={slot.animatedVideoUrl}
                                autoPlay
                                loop
                                muted
                                playsInline
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            )}
                            {slot.imageUrl &&
                              !slot.animatedVideoUrl &&
                              !slot.loading && (
                                <img
                                  src={slot.imageUrl}
                                  alt=""
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                  }}
                                />
                              )}
                            {!slot.imageUrl && !slot.loading && (
                              <div
                                style={{
                                  height: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#4b5563",
                                  fontSize: 12,
                                }}
                              >
                                нет картинки
                              </div>
                            )}
                          </div>

                          {slot.error && (
                            <p
                              style={{
                                color: "#f87171",
                                fontSize: 11,
                                margin: 0,
                              }}
                            >
                              {slot.error}
                            </p>
                          )}
                          {slot.animateError && (
                            <p
                              style={{
                                color: "#f87171",
                                fontSize: 11,
                                margin: 0,
                              }}
                            >
                              {slot.animateError}
                            </p>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              void handleGenerateAIImage(
                                video.videoId,
                                gi,
                                si
                              )
                            }
                            disabled={slot.loading}
                            style={{
                              fontSize: 12,
                              padding: "4px 8px",
                              borderRadius: 4,
                              border: "none",
                              cursor: slot.loading
                                ? "not-allowed"
                                : "pointer",
                              background: slot.loading
                                ? "#374151"
                                : "#2563eb",
                              color: "#fff",
                              opacity: slot.loading ? 0.6 : 1,
                            }}
                          >
                            {slot.imageUrl
                              ? "🔄 Перегенерировать"
                              : "✨ Сгенерировать"}
                          </button>

                          {slot.imageUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleAnimateAIImage(
                                  video.videoId,
                                  gi,
                                  si
                                )
                              }
                              disabled={slot.animating}
                              style={{
                                fontSize: 12,
                                padding: "4px 8px",
                                borderRadius: 4,
                                border: "none",
                                cursor: slot.animating
                                  ? "not-allowed"
                                  : "pointer",
                                background: slot.animating
                                  ? "#374151"
                                  : "#7c3aed",
                                color: "#fff",
                                opacity: slot.animating ? 0.6 : 1,
                              }}
                            >
                              {slot.animating
                                ? "⏳ Оживляем..."
                                : "🎬 Оживить"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <ShowMoreButton
                  current={visibleAI.length}
                  total={panel.aiImageGroups?.length ?? 0}
                  onMore={() =>
                    setScripts((prev) => ({
                      ...prev,
                      [video.videoId]: {
                        ...prev[video.videoId],
                        footagePage: panel.footagePage + 1,
                      },
                    }))
                  }
                />
                    </>
                  );
                })()}
              </>
            )}
          </div>

          {panel.clipMode !== null && (
            <>
              <button
                type="button"
                onClick={() => void handleDownloadVideo(video.videoId)}
                disabled={
                  panel.mergeLoading ||
                  (panel.clipMode === "manual"
                    ? !hasManualMergeClips(
                        panel.manualGroups,
                        panel.audioDuration != null
                          ? getManualSlotCalculatedDurations(
                              panel.manualGroups,
                              panel.audioDuration,
                              panel.language ?? "ru"
                            )
                          : panel.manualGroups.map((group) =>
                              group.slots.map(() => 0)
                            )
                      )
                    : panel.footageLoading ||
                      getSelectedFootageClips(
                        panel.footageGroups
                      ).length === 0)
                }
                className="mt-4 w-full rounded-md bg-gradient-to-r from-violet-600 to-purple-600 py-2 text-sm font-medium text-white transition-colors hover:from-violet-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
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
            </>
          )}
        </>
      )}
    </div>
  )}
      </div>
    );
  };

  return (
    <div
      className="min-h-screen bg-[#0f0a1e] text-purple-50"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at top, #2d1b69 0%, #0f0a1e 60%)",
      }}
    >
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1
          className={`mb-8 text-center text-2xl font-semibold tracking-tight sm:text-3xl ${
            isWorkspace
              ? "text-purple-50"
              : "bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent"
          }`}
        >
          {isWorkspace ? "Сценарий для видео" : "Найди вирусное видео"}
        </h1>
        {!isWorkspace && (
          <div className="mb-6 flex justify-center">
            <a
              href="/my-video"
              className="rounded-lg border border-purple-700/60 bg-purple-900/30 px-4 py-2 text-sm text-purple-300 transition-colors hover:border-purple-500 hover:bg-purple-800/40"
            >
              📹 Своё видео — создать сценарий без поиска
            </a>
          </div>
        )}

        {isWorkspace ? (
          <div className="space-y-4">
            {error && (
              <p className="text-center text-sm text-red-400">{error}</p>
            )}
            {activeVideo && openVideoId ? (
              <div id="script-panel">{renderScriptPanel(activeVideo)}</div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-800/60 border-t-purple-50" />
                <p className="text-sm text-purple-300/70">Генерируем сценарий…</p>
              </div>
            )}
          </div>
        ) : (
        <div className="space-y-6">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder="Введи нишу, например: менопауза диета"
            className="w-full rounded-lg border border-purple-900/50 bg-[#1a1035] px-4 py-3 text-purple-50 placeholder:text-purple-400/50 outline-none transition-colors focus:border-purple-700 focus:ring-1 focus:ring-zinc-600"
          />

          <label className="flex items-center gap-2 text-sm text-purple-300/70 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={expandedSearch}
              onChange={(e) => setExpandedSearch(e.target.checked)}
              className="rounded border-purple-700 bg-[#1a1035] accent-fuchsia-500"
            />
            Искать по смежным темам
          </label>

          <div className="space-y-2">
            <label className="text-sm text-purple-300/70">
              Ваш оффер (необязательно)
            </label>
            <textarea
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              rows={2}
              placeholder='Например: электронная книга "Диета при менопаузе" за 390₽'
              className="w-full resize-none rounded-lg border border-purple-900/50 bg-[#1a1035] px-4 py-3 text-sm text-purple-50 placeholder:text-purple-400/50 outline-none transition-colors focus:border-purple-700 focus:ring-1 focus:ring-zinc-600"
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
            <label className="text-sm text-purple-300/70">Мин. просмотров</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={minViews}
              onChange={(e) =>
                setMinViews(Math.max(0, Number(e.target.value) || 0))
              }
              className="w-full rounded-lg border border-purple-900/50 bg-[#1a1035] px-4 py-3 text-purple-50 outline-none transition-colors focus:border-purple-700 focus:ring-1 focus:ring-zinc-600"
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
              {
                value: "velocity",
                label: "🚀 Скорость роста (По просмотрам в час)",
              },
            ]}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="shrink-0 text-sm text-purple-300/70">Язык:</span>
            {LANGUAGE_OPTIONS.map(({ code, label }) => (
              <label
                key={code}
                className="flex cursor-pointer items-center gap-1.5 text-sm text-purple-200"
              >
                <input
                  type="checkbox"
                  checked={languages.includes(code)}
                  onChange={() =>
                    setLanguages((prev) => toggleLanguage(prev, code))
                  }
                  className="h-3.5 w-3.5 rounded border-purple-800/60 bg-[#1a1035] accent-zinc-400"
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
                className="h-4 w-4 rounded border-purple-800/60 bg-[#1a1035] text-purple-50 accent-zinc-400"
              />
              <span className="text-sm text-purple-200">Только новые каналы</span>
            </label>
            <div
              className={`flex flex-wrap items-center gap-2 text-sm ${
                newChannelsOnly ? "text-purple-200" : "text-purple-400/50"
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
                className="w-16 rounded-md border border-purple-900/50 bg-[#1a1035] px-2 py-1 text-center text-purple-50 outline-none transition-colors focus:border-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="w-16 rounded-md border border-purple-900/50 bg-[#1a1035] px-2 py-1 text-center text-purple-50 outline-none transition-colors focus:border-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span>месяцев</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 py-3 text-sm font-medium text-white transition-colors hover:from-violet-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Ищем…" : "Найти вирусные"}
          </button>

          {loading && (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-800/60 border-t-purple-50" />
            </div>
          )}

          {error && (
            <p className="text-center text-sm text-red-400">{error}</p>
          )}

          {!loading && videos.length === 0 && !error && (
            <p className="text-center text-sm text-purple-400/50">
              Результаты появятся здесь
            </p>
          )}

          {videos.length > 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {videos.slice(0, visibleCount).map((video) => {
              const panel = scripts[video.videoId];
              const isOpen = openVideoId === video.videoId;
              return (
              <Fragment key={video.videoId}>
              <article
                className={`overflow-hidden rounded-lg border bg-[#1a1035]/80 ${
                  isOpen
                    ? "border-fuchsia-500/60 ring-1 ring-fuchsia-500/40"
                    : "border-purple-900/50"
                }`}
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
                    <span className="absolute right-2 top-2 rounded-md bg-[#0f0a1e]/90 px-2 py-1 text-xs font-medium text-fuchsia-400">
                      🔥 x{Math.round(video.viralScore)}
                    </span>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <h2 className="line-clamp-2 text-sm font-medium leading-snug">
                    {video.title}
                  </h2>
                  <p className="text-xs text-purple-400/50">{video.channelTitle}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-purple-300/70">
                    <span>{formatNumber(video.viewCount)} просм.</span>
                    <span>{formatNumber(video.likeCount)} лайков</span>
                    {video.velocity > 0 && (
                      <span>
                        {formatNumber(video.velocity)} просм/час
                      </span>
                    )}
                    {video.repostCount != null && (
                      <span>{formatNumber(video.repostCount)} реп.</span>
                    )}
                    <span>канал: {video.channelAge}</span>
                  </div>
                  <a
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-md border border-purple-800/60 py-2 text-center text-sm text-zinc-200 transition-colors hover:border-purple-600 hover:bg-purple-800/60"
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
                            voiceProgress: null,
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
                      if (isOpen) {
                        setOpenVideoId(null);
                        return;
                      }
                      setOpenVideoId(video.videoId);
                      if (!panel?.data && !panel?.loading) {
                        void handleGenerateScript(video);
                      } else {
                        setTimeout(() => {
                          document
                            .getElementById("script-panel")
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                        }, 100);
                      }
                    }}
                    className="w-full rounded-md border border-purple-700 bg-purple-900/60 py-2 text-center text-sm text-purple-50 transition-colors hover:border-purple-600 hover:bg-purple-800/60"
                  >
                    {isOpen ? "Скрыть сценарий" : "Создать сценарий"}
                  </button>
                </div>

              </article>
              </Fragment>
            );
            })}
              </div>

              {videos.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + 4)}
                  className="w-full rounded-lg border border-purple-800/60 py-3 text-sm text-purple-200 transition-colors hover:border-purple-600 hover:bg-purple-800/60"
                >
                  Смотреть ещё ({videos.length - visibleCount} видео)
                </button>
              )}
              {openVideoId && (() => {
                const openVideo = videos.find((v) => v.videoId === openVideoId);
                return openVideo ? (
                  <div id="script-panel" className="mt-4 w-full">
                    {renderScriptPanel(openVideo)}
                  </div>
                ) : null;
              })()}
            </div>
          )}
        </div>
        )}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0f0a1e] text-purple-300/70">
          Загрузка…
        </div>
      }
    >
      <HomePage />
    </Suspense>
  );
}
