import asyncio
import glob
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from supabase import Client, create_client
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Transcript Service")

AUDIO_TEMP_BUCKET = "audio-temp"
_supabase_client: Client | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        supabase_url = os.environ.get("SUPABASE_URL", "").strip()
        supabase_key = os.environ.get("SUPABASE_KEY", "").strip()
        if not supabase_url or not supabase_key:
            raise HTTPException(
                status_code=500,
                detail="SUPABASE_URL and SUPABASE_KEY must be configured",
            )
        _supabase_client = create_client(supabase_url, supabase_key)
    return _supabase_client


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
            "--extractor-args",
            "youtube:player_client=android_creator",
            "--user-agent",
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
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


def fetch_transcript_with_whisper(video_id: str) -> str | None:
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        print("[transcript] GROQ_API_KEY not set, Whisper skipped")
        return None

    tmpdir = tempfile.mkdtemp(prefix="whisper_")
    audio_path: Path | None = None

    try:
        url = f"https://www.youtube.com/watch?v={video_id}"
        output_template = str(Path(tmpdir) / f"{video_id}.%(ext)s")
        cmd = [
            "yt-dlp",
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "64K",
            "-o",
            output_template,
            "--no-warnings",
            "--extractor-args",
            "youtube:player_client=android_creator",
            "--user-agent",
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
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
            print(f"[transcript] yt-dlp audio failed for {video_id}: {stderr}")
            return None

        expected_mp3 = Path(tmpdir) / f"{video_id}.mp3"
        if expected_mp3.is_file():
            audio_path = expected_mp3
        else:
            mp3_files = sorted(glob.glob(str(Path(tmpdir) / "*.mp3")))
            if mp3_files:
                audio_path = Path(mp3_files[0])

        if not audio_path or not audio_path.is_file():
            print(f"[transcript] No mp3 found for {video_id} in {tmpdir}")
            return None

        with open(audio_path, "rb") as audio_file:
            response = requests.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (audio_path.name, audio_file, "audio/mpeg")},
                data={
                    "model": "whisper-large-v3-turbo",
                    "response_format": "text",
                },
                timeout=60,
            )

        if response.ok and response.text.strip():
            return response.text.strip()

        print(
            f"[transcript] Groq Whisper failed for {video_id}: "
            f"{response.status_code} {response.text[:500]}"
        )
        return None
    except subprocess.TimeoutExpired:
        print(f"[transcript] yt-dlp audio timeout for {video_id}")
        return None
    except requests.RequestException as e:
        print(f"[transcript] Groq Whisper request error for {video_id}: {e}")
        return None
    except Exception as e:
        print(f"[transcript] Whisper error for {video_id}: {e}")
        return None
    finally:
        if audio_path and audio_path.is_file():
            audio_path.unlink(missing_ok=True)
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/transcript")
def transcript(body: TranscriptRequest):
    print(f"[transcript] Request received for videoId: {body.videoId}")
    video_id = body.videoId.strip()

    if not re.fullmatch(r"[\w-]{6,}", video_id):
        raise HTTPException(status_code=400, detail="Invalid videoId")

    transcript_text = fetch_transcript_with_ytdlp(video_id)

    if not transcript_text:
        print(f"[transcript] No subtitles for {video_id}, trying Whisper...")
        transcript_text = fetch_transcript_with_whisper(video_id)

    if not transcript_text:
        raise HTTPException(status_code=404, detail="Transcript not available")

    return {"transcript": transcript_text}


def upload_audio_to_supabase_sync(file_path: Path) -> str:
    try:
        supabase = get_supabase()
        filename = file_path.name
        file_bytes = file_path.read_bytes()

        supabase.storage.from_(AUDIO_TEMP_BUCKET).upload(
            path=filename,
            file=file_bytes,
            file_options={"content-type": "audio/mpeg", "upsert": "true"},
        )

        public_url = supabase.storage.from_(AUDIO_TEMP_BUCKET).get_public_url(filename)
        if isinstance(public_url, dict):
            url = public_url.get("publicUrl") or public_url.get("publicURL")
            if url:
                return str(url).strip()
        return str(public_url).strip()
    except HTTPException:
        raise
    except Exception as e:
        logging.warning(f"Supabase upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Supabase upload failed: {e}") from e


def remove_audio_from_supabase_sync(filename: str) -> None:
    supabase = get_supabase()
    supabase.storage.from_(AUDIO_TEMP_BUCKET).remove([filename])


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


def rendi_output_url(data: dict) -> str:
    out = data.get("output_files", {}).get("out_1")
    if isinstance(out, dict):
        url = out.get("storage_url") or out.get("url")
        if url:
            return url
    if isinstance(out, str):
        return out
    raise HTTPException(
        status_code=500,
        detail=f"Rendi output URL missing: {data.get('output_files')}",
    )


def merge_with_rendi(
    RENDI_API_KEY: str,
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

    headers = {"X-API-KEY": RENDI_API_KEY}
    logging.warning(
        f"Headers being sent: X-API-KEY length={len(RENDI_API_KEY) if RENDI_API_KEY else 0}"
    )
    logging.warning(
        f"Key first 10: '{RENDI_API_KEY[:10] if RENDI_API_KEY else None}' "
        f"last 5: '{RENDI_API_KEY[-5:] if RENDI_API_KEY else None}'"
    )

    job_response = requests.post(
        "https://api.rendi.dev/v1/run-ffmpeg-command",
        headers=headers,
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

    job_data = job_response.json()
    command_id = job_data.get("command_id") or job_data.get("id")
    if not command_id:
        raise HTTPException(
            status_code=500,
            detail=f"Rendi response missing command_id: {job_data}",
        )

    for _ in range(120):
        time.sleep(5)
        poll = requests.get(
            f"https://api.rendi.dev/v1/commands/{command_id}",
            headers=headers,
            timeout=30,
        )
        poll.raise_for_status()
        data = poll.json()
        status = data.get("status")
        if status in ("COMPLETED", "SUCCESS"):
            return rendi_output_url(data)
        if status in ("FAILED", "ERROR"):
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
    logging.warning(
        "/merge incoming: "
        f"clip_urls={clip_urls!r} "
        f"start_times={start_times!r} "
        f"durations={durations!r} "
        f"audio_duration={audio_duration!r} "
        f"audio_filename={audio.filename!r} "
        f"audio_content_type={audio.content_type!r}"
    )

    if not clip_urls:
        raise HTTPException(status_code=400, detail="At least one clip URL is required")

    if len(clip_urls) != len(start_times) or len(clip_urls) != len(durations):
        raise HTTPException(
            status_code=400,
            detail="clip_urls, start_times, and durations must have the same length",
        )

    RENDI_API_KEY = os.environ.get("RENDI_API_KEY", "").strip()
    logging.warning(
        f"RENDI_API_KEY loaded: {'YES' if RENDI_API_KEY else 'NO - KEY IS MISSING'}"
    )
    if not RENDI_API_KEY:
        raise HTTPException(status_code=500, detail="RENDI_API_KEY not configured")

    get_supabase()

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = Path(f"/tmp/rendi_audio/{audio_filename}")
    audio_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        await save_upload(audio, audio_path)
        try:
            audio_public_url = await asyncio.get_event_loop().run_in_executor(
                None, lambda: upload_audio_to_supabase_sync(audio_path)
            )
        except HTTPException:
            raise
        except Exception as e:
            logging.warning(f"Supabase upload executor error: {e}")
            raise HTTPException(
                status_code=500, detail=f"Supabase upload failed: {e}"
            ) from e

        output_url = merge_with_rendi(
            RENDI_API_KEY,
            clip_urls,
            start_times,
            durations,
            audio_public_url,
            audio_duration,
        )

        try:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: remove_audio_from_supabase_sync(audio_filename)
            )
        except Exception as cleanup_err:
            logging.warning(f"Supabase audio cleanup failed: {cleanup_err}")

        return JSONResponse({"url": output_url})
    except HTTPException:
        raise
    except Exception as e:
        logging.warning(f"Merge failed: {e}")
        raise HTTPException(status_code=500, detail=f"Merge failed: {e}") from e
    finally:
        audio_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
