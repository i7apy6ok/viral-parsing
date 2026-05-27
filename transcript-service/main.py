import glob
import logging
import os
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Transcript Service")

TEMP_FILES: dict[str, Path] = {}
RAILWAY_PUBLIC_BASE = os.environ.get(
    "PUBLIC_BASE_URL",
    "https://viral-parsing-production.up.railway.app",
)
MERGE_FILES_DIR = Path(tempfile.gettempdir()) / "viral_merge_files"

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


@app.get("/files/{filename}")
async def serve_file(filename: str):
    path = TEMP_FILES.get(filename)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(path))


async def save_upload(upload: UploadFile, path: Path) -> None:
    with open(path, "wb") as f:
        while chunk := await upload.read(8192):
            f.write(chunk)


def upload_suffix(upload: UploadFile, default: str) -> str:
    suffix = Path(upload.filename or "").suffix
    return suffix if suffix else default


def build_rendi_command(
    clip_urls: list[str],
    start_times: list[float],
    durations: list[float],
    audio_rendi_url: str,
    audio_duration: float,
) -> tuple[dict[str, str], dict[str, str], str]:
    input_files: dict[str, str] = {}
    for i, url in enumerate(clip_urls):
        input_files[f"in_{i + 1}"] = url
    input_files["in_audio"] = audio_rendi_url

    cmd_parts: list[str] = []
    for i, (start, duration) in enumerate(zip(start_times, durations)):
        cmd_parts.extend([
            "-ss", str(start), "-t", str(duration), "-i", f"{{{{in_{i + 1}}}}}",
        ])
    cmd_parts.extend(["-i", "{{in_audio}}"])

    n = len(clip_urls)
    filter_complex = ""
    for i in range(n):
        filter_complex += (
            f"[{i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
            f"pad=1080:1920:-1:-1:color=black,fps=30,setsar=1[v{i}];"
        )
    filter_complex += "".join(f"[v{i}]" for i in range(n))
    filter_complex += f"concat=n={n}:v=1:a=0[vout]"

    cmd_parts.extend([
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", f"{n}:a:0",
        "-t", str(audio_duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-ar", "44100",
        "-movflags", "+faststart",
        "{{out_1}}",
    ])

    ffmpeg_command = " ".join(cmd_parts)
    output_files = {"out_1": "output.mp4"}
    return input_files, output_files, ffmpeg_command


def merge_with_rendi(
    rendi_api_key: str,
    clip_urls: list[str],
    start_times: list[float],
    durations: list[float],
    audio_rendi_url: str,
    audio_duration: float,
) -> str:
    input_files, output_files, ffmpeg_command = build_rendi_command(
        clip_urls,
        start_times,
        durations,
        audio_rendi_url,
        audio_duration,
    )

    logging.warning(
        f"Sending to Rendi with key: {rendi_api_key[:10] if rendi_api_key else 'NONE'}..."
    )

    job_response = requests.post(
        "https://api.rendi.dev/v1/run-ffmpeg-command",
        headers={"X-API-KEY": rendi_api_key},
        json={
            "input_files": input_files,
            "output_files": output_files,
            "ffmpeg_command": ffmpeg_command,
        },
        timeout=30,
    )
    try:
        job_response.raise_for_status()
    except Exception as e:
        logging.warning(
            f"Rendi error response: {job_response.status_code} - {job_response.text}"
        )
        raise

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
            return data["output_files"]["out_1"]
        if data["status"] == "FAILED":
            raise HTTPException(status_code=500, detail=f"Rendi error: {data}")

    raise HTTPException(status_code=504, detail="Rendi timeout after 10 minutes")


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

    RENDI_API_KEY = os.environ.get("RENDI_API_KEY")
    logging.warning(
        f"RENDI_API_KEY loaded: {'YES' if RENDI_API_KEY else 'NO - KEY IS MISSING'}"
    )
    if not RENDI_API_KEY:
        raise HTTPException(status_code=500, detail="RENDI_API_KEY not configured")

    MERGE_FILES_DIR.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    audio_path = MERGE_FILES_DIR / f"{file_id}{upload_suffix(audio, '.mp3')}"

    try:
        await save_upload(audio, audio_path)
        TEMP_FILES[file_id] = audio_path
        audio_public_url = f"{RAILWAY_PUBLIC_BASE}/files/{file_id}"

        output_url = merge_with_rendi(
            RENDI_API_KEY,
            clip_urls,
            start_times,
            durations,
            audio_public_url,
            audio_duration,
        )
        return JSONResponse({"url": output_url})
    finally:
        TEMP_FILES.pop(file_id, None)
        audio_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
