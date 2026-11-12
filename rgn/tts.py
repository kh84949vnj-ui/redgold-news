"""ElevenLabs text-to-speech. Key and voice come from .env (never committed)."""
from __future__ import annotations

import os
from pathlib import Path

import requests


def synthesize(text: str, out_path: Path) -> Path:
    key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    voice = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
    model = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2").strip()
    if not key or not voice:
        raise SystemExit("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env to use --tts.")
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": key, "Accept": "audio/mpeg"},
        json={"text": text, "model_id": model},
        timeout=120,
    )
    if r.status_code != 200:
        raise SystemExit(f"ElevenLabs error {r.status_code}: {r.text[:300]}")
    out_path.write_bytes(r.content)
    return out_path
