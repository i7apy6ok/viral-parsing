import glob
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import requests
from starlette.background import BackgroundTask

app = FastAPI(title="Transcript Service")

DOWNLOAD_HEADERS = {"User-Agent": "Mozilla/5.0"}


def download_file(url: str, path: Path) -> None:
    response = requests.get(
        url,
        headers=DOWNLOAD_HEADERS,
        stream=True,
        timeout=120,
    )
    response.raise_for_status()

    with open(path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


class TranscriptRequest(BaseModel):
    videoId: str = Field(..., min_length=1)


def parse_vtt(content: str) -> str:
    """Extract plain text from WebVTT, without timestamps."""
    parts: list[str] = []

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.upper() == "WEBVTT" or line.startswith("NOTE"):
            continue
        if "-->" in line:
            continue
        if re.fullmatch(r"\d+", line):
            continue

        line = re.sub(r"<[^>]+>", "", line).strip()
        if line:
            parts.append(line)

    text = " ".join(parts)
    return re.sub(r"\s+", " ", text).strip()


def fetch_transcript_with_ytdlp(video_id: str) -> str | None:
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory(prefix="transcript_") as tmpdir:
        output_template = str(Path(tmpdir) / "%(id)s")

        cmd = [
            "yt-dlp",
            "--write-auto-sub",
            "--skip-download",
            "--sub-lang",
            "ru",
            "--no-warnings",
            "-o",
            output_template,
            url,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            stderr = (result.stderr or result.stdout or "").strip()
            print(f"yt-dlp failed for {video_id}: {stderr}")
            return None

        vtt_files = sorted(glob.glob(str(Path(tmpdir) / f"{video_id}*.vtt")))
        if not vtt_files:
            vtt_files = sorted(glob.glob(str(Path(tmpdir) / "*.vtt")))

        if not vtt_files:
            print(f"No VTT files found for {video_id} in {tmpdir}")
            return None

        content = Path(vtt_files[0]).read_text(encoding="utf-8", errors="replace")
        transcript = parse_vtt(content)
        return transcript or None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/transcript")
def transcript(body: TranscriptRequest):
    video_id = body.videoId.strip()

    if not re.fullmatch(r"[\w-]{6,}", video_id):
        raise HTTPException(status_code=400, detail="Invalid videoId")

    transcript_text = fetch_transcript_with_ytdlp(video_id)

    if not transcript_text:
        raise HTTPException(
            status_code=404,
            detail="Russian auto-subtitles not found for this video",
        )

    return {"transcript": transcript_text}


class MergeRequest(BaseModel):
    audio_url: str
    video_clips: list[str]  # список URL видео с Pexels


@app.post("/merge")
async def merge_video(body: MergeRequest):
    with tempfile.TemporaryDirectory(prefix="merge_") as tmpdir:
        tmpdir = Path(tmpdir)

        # Скачиваем аудио
        audio_path = tmpdir / "audio.mp3"
        download_file(body.audio_url, audio_path)

        # Скачиваем видео клипы
        clip_paths = []
        for i, url in enumerate(body.video_clips):
            clip_path = tmpdir / f"clip_{i}.mp4"
            download_file(url, clip_path)
            clip_paths.append(clip_path)

        # Создаём список файлов для concat
        list_file = tmpdir / "clips.txt"
        with open(list_file, "w") as f:
            for p in clip_paths:
                f.write(f"file '{p}'\n")

        # Склеиваем видео
        merged_video = tmpdir / "merged.mp4"
        subprocess.run([
            "ffmpeg", "-f", "concat", "-safe", "0",
            "-i", str(list_file), "-c", "copy",
            str(merged_video)
        ], check=True)

        # Накладываем аудио
        output_path = tmpdir / "output.mp4"
        subprocess.run([
            "ffmpeg", "-i", str(merged_video), "-i", str(audio_path),
            "-c:v", "copy", "-c:a", "aac",
            "-map", "0:v:0", "-map", "1:a:0",
            "-shortest", str(output_path)
        ], check=True)

        persist_dir = Path(tempfile.mkdtemp(prefix="merge_out_"))
        persist_path = persist_dir / "result.mp4"
        shutil.copy2(output_path, persist_path)

        return FileResponse(
            str(persist_path),
            media_type="video/mp4",
            filename="result.mp4",
            background=BackgroundTask(shutil.rmtree, persist_dir, ignore_errors=True),
        )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
