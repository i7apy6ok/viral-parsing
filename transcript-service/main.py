import glob
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Transcript Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


async def save_upload(upload: UploadFile, path: Path) -> None:
    with open(path, "wb") as f:
        while chunk := await upload.read(8192):
            f.write(chunk)


def upload_suffix(upload: UploadFile, default: str) -> str:
    suffix = Path(upload.filename or "").suffix
    return suffix if suffix else default


@app.post("/merge")
async def merge_video(
    audio: UploadFile = File(...),
    clip_urls: list[str] = Form(...),
    start_times: list[float] = Form(...),
    durations: list[float] = Form(...),
    audio_duration: float = Form(...),
):
    if not clip_urls:
        raise HTTPException(status_code=400, detail="At least one clip URL is required")

    if len(clip_urls) != len(start_times) or len(clip_urls) != len(durations):
        raise HTTPException(
            status_code=400,
            detail="clip_urls, start_times, and durations must have the same length",
        )

    rendi_api_key = os.environ.get("RENDI_API_KEY")
    if not rendi_api_key:
        raise HTTPException(status_code=500, detail="RENDI_API_KEY not configured")

    with tempfile.TemporaryDirectory(prefix="merge_") as tmpdir:
        tmpdir = Path(tmpdir)
        audio_path = tmpdir / f"audio{upload_suffix(audio, '.mp3')}"
        await save_upload(audio, audio_path)

        with open(audio_path, "rb") as audio_file:
            audio_upload = requests.post(
                "https://api.rendi.dev/v1/files",
                headers={"X-API-KEY": rendi_api_key},
                files={"file": (audio_path.name, audio_file, "audio/mpeg")},
                timeout=60,
            )
        audio_upload.raise_for_status()
        audio_rendi_url = audio_upload.json()["url"]

    command: list[str] = []
    for url, start, duration in zip(clip_urls, start_times, durations):
        command.extend(["-ss", str(start), "-t", str(duration), "-i", url])
    command.extend(["-i", audio_rendi_url])

    n = len(clip_urls)
    filter_complex = ""
    for i in range(n):
        filter_complex += (
            f"[{i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
            f"pad=1080:1920:-1:-1:color=black,fps=30,setsar=1[v{i}];"
        )
    filter_complex += "".join(f"[v{i}]" for i in range(n))
    filter_complex += f"concat=n={n}:v=1:a=0[vout]"

    command.extend([
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", f"{n}:a:0",
        "-t", str(audio_duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-ar", "44100",
        "-movflags", "+faststart",
        "output.mp4",
    ])

    job_response = requests.post(
        "https://api.rendi.dev/v1/run-ffmpeg-command",
        headers={"X-API-KEY": rendi_api_key},
        json={"ffmpeg_command": command},
        timeout=30,
    )
    job_response.raise_for_status()
    job_id = job_response.json()["id"]

    for _ in range(120):
        time.sleep(5)
        poll = requests.get(
            f"https://api.rendi.dev/v1/commands/{job_id}",
            headers={"X-API-KEY": rendi_api_key},
            timeout=30,
        )
        poll.raise_for_status()
        data = poll.json()
        if data["status"] == "COMPLETED":
            output_url = data["outputs"]["output.mp4"]
            return JSONResponse({"url": output_url})
        if data["status"] == "FAILED":
            raise HTTPException(status_code=500, detail=f"Rendi error: {data}")

    raise HTTPException(status_code=504, detail="Rendi timeout after 10 minutes")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
