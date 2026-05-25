"use client";

import { useState } from "react";
import type { ScriptResult } from "../api/generate-script/route";

const TEST_PAYLOAD = {
  videoId: "dQw4w9WgXcQ",
  title: "Как повысить тестостерон естественным путём",
  niche: "мужское здоровье",
};

export default function TestScriptPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptResult | null>(null);

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TEST_PAYLOAD),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Ошибка генерации");
      }

      setResult(data as ScriptResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка генерации");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="mb-6 text-2xl font-semibold">Тест генерации сценария</h1>

        <pre className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400">
          {JSON.stringify(TEST_PAYLOAD, null, 2)}
        </pre>

        <button
          type="button"
          onClick={handleTest}
          disabled={loading}
          className="rounded-lg bg-zinc-100 px-6 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-white disabled:opacity-60"
        >
          {loading ? "Генерируем…" : "Тест сценария"}
        </button>

        {loading && (
          <div className="mt-8 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-100" />
          </div>
        )}

        {error && (
          <p className="mt-6 text-sm text-red-400">{error}</p>
        )}

        {result && !loading && (
          <div className="mt-8 space-y-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-sm">
            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Хуки
              </h2>
              <ol className="list-inside list-decimal space-y-2 text-zinc-300">
                {result.hooks.map((hook, i) => (
                  <li key={i}>{hook}</li>
                ))}
              </ol>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Основная часть
              </h2>
              <p className="whitespace-pre-wrap leading-relaxed text-zinc-300">
                {result.body}
              </p>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                CTA
              </h2>
              <p className="text-zinc-300">{result.cta}</p>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Визуальный хук
              </h2>
              <p className="text-zinc-300">{result.visualHook}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
