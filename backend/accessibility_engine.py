"""
Build Doc 30 — Accessibility, Localization & Inclusive Guidance Engine (MVP).
Namespace: /api/hi/access

- Per-user accessibility & language settings (hi_access_settings).
- get_access_context(user_id): prompt block consumed by Homie chat + project planner
  so AI guidance adapts to reading level, simplified mode and language.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

_db = None
_logger = None

LANGUAGES = [
    {"code": "en", "label": "English"}, {"code": "es", "label": "Español"},
    {"code": "fr", "label": "Français"}, {"code": "de", "label": "Deutsch"},
    {"code": "pt", "label": "Português"}, {"code": "zh", "label": "中文"},
]
READING_LEVELS = ["simple", "standard", "detailed"]
TEXT_SIZES = ["standard", "large", "extra_large"]

_DEFAULTS = {"language": "en", "reading_level": "standard", "simplified_mode": False,
             "text_size": "standard", "voice_guidance": False, "high_contrast": False,
             "reduce_motion": False}


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _get_settings(user_id: str) -> dict:
    s = await _db.hi_access_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not s:
        s = {"user_id": user_id, **_DEFAULTS, "created_at": _now(), "updated_at": _now()}
        await _db.hi_access_settings.insert_one(dict(s))
        s.pop("_id", None)
    return s


# ---------------------------------------------------------------- external hook
async def get_access_context(user_id: str) -> str:
    """Prompt block so AI guidance adapts to accessibility & language settings."""
    if _db is None:
        return ""
    try:
        s = await _db.hi_access_settings.find_one({"user_id": user_id}, {"_id": 0})
        if not s:
            return ""
        parts = []
        lang = s.get("language", "en")
        if lang != "en":
            label = next((x["label"] for x in LANGUAGES if x["code"] == lang), lang)
            parts.append(f"Respond entirely in {label} ({lang}).")
        rl = s.get("reading_level", "standard")
        if rl == "simple":
            parts.append("Use SHORT sentences, everyday words, no jargon. Define any technical term in parentheses. One instruction per sentence.")
        elif rl == "detailed":
            parts.append("Provide thorough, detailed explanations including the 'why' behind each step.")
        if s.get("simplified_mode"):
            parts.append("SIMPLIFIED MODE: give only the essential steps, at most 5 items, no optional extras.")
        if s.get("voice_guidance"):
            parts.append("User prefers voice/screen-reader friendly output: avoid tables and heavy formatting, use plain sequential sentences.")
        return ("ACCESSIBILITY & LANGUAGE — adapt to these: " + " ".join(parts)) if parts else ""
    except Exception:
        return ""


class SettingsReq(BaseModel):
    language: Optional[str] = None
    reading_level: Optional[str] = None
    simplified_mode: Optional[bool] = None
    text_size: Optional[str] = None
    voice_guidance: Optional[bool] = None
    high_contrast: Optional[bool] = None
    reduce_motion: Optional[bool] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/access", tags=["accessibility"])

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"languages": LANGUAGES, "reading_levels": READING_LEVELS, "text_sizes": TEXT_SIZES}

    @r.get("/settings")
    async def get_settings(user: dict = Depends(get_current_user)):
        return await _get_settings(user["id"])

    @r.put("/settings")
    async def update_settings(req: SettingsReq, user: dict = Depends(get_current_user)):
        await _get_settings(user["id"])
        upd = {"updated_at": _now()}
        if req.language is not None and req.language in {x["code"] for x in LANGUAGES}:
            upd["language"] = req.language
        if req.reading_level is not None and req.reading_level in READING_LEVELS:
            upd["reading_level"] = req.reading_level
        if req.text_size is not None and req.text_size in TEXT_SIZES:
            upd["text_size"] = req.text_size
        for f in ("simplified_mode", "voice_guidance", "high_contrast", "reduce_motion"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = bool(v)
        await _db.hi_access_settings.update_one({"user_id": user["id"]}, {"$set": upd})
        try:
            import analytics_engine
            await analytics_engine.capture(user, "accessibility_settings_updated",
                                           {k: str(upd[k]) for k in upd if k != "updated_at"})
        except Exception:
            pass
        return await _db.hi_access_settings.find_one({"user_id": user["id"]}, {"_id": 0})

    return r
