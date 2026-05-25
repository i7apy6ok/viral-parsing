import glob
import os
import re
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Transcript Service")


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
