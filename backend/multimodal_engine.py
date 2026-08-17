"""
DIYhomie — Homie Avatar, Voice & Multimodal Conversation Runtime (Build Blueprint 34).

A UI runtime over the SAME property-aware Homie intelligence & safety controls (not a separate
chatbot). Supports text, voice, and future avatar modes with shared context and graceful
fallback to text. Voice output & avatar animation run natively; this engine owns everything
provider-neutral & testable: multimodal sessions, speech-input records (STT via existing
/api/hi/transcribe), structured responses (concise spoken answer + full text + action cards +
avatar emotion/gesture intent), hands-free project commands (low-risk only, confirmation-gated),
interruption/fallback state, and admin controls.

Emergency safety always wins: it stops avatar/hands-free and shows a calm safety response.
Financial/reward actions are never completed by voice.

Collections: mm_sessions, mm_speech, mm_voice, mm_avatar, mm_settings.
"""
import hashlib
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from bson.binary import Binary
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

MODES = ["text", "voice", "avatar_future", "mixed"]
EMOTIONS = ["neutral", "encouraging", "cautionary", "urgent", "celebratory"]
GESTURES = ["none", "point", "explain", "pause", "warning"]
HANDSFREE_COMMANDS = ["repeat", "next_step", "previous_step", "stuck", "show_tools", "pause", "ask", "stop"]

EMERGENCY_KEYWORDS = ["gas smell", "gas leak", "smell gas", "fire", "flames", "electric shock", "shocked",
                      "sparking", "flooding", "burst pipe", "carbon monoxide", "can't breathe", "chest pain",
                      "unconscious", "bleeding badly", "medical emergency"]
HIGH_RISK_HINTS = ["electrical panel", "gas line", "load-bearing", "structural", "roof", "asbestos", "main breaker", "240v", "sewer"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[multimodal:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _settings() -> dict:
    s = await _db.mm_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "voice_input_enabled": True, "voice_output_enabled": True,
             "avatar_enabled": False, "providers": ["openai"], "fallback_order": ["voice", "text"],
             "high_risk_avatar_disabled": True, "free_voice_daily_limit": 10, "updated_at": _now()}
        await _db.mm_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


async def _session(sid, user_id) -> dict:
    s = await _db.mm_sessions.find_one({"id": sid, "user_id": user_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found.")
    return s


def _is_emergency(text: str) -> bool:
    t = (text or "").lower()
    return any(k in t for k in EMERGENCY_KEYWORDS)


async def _project_high_risk(project_id: Optional[str]) -> bool:
    if not project_id:
        return False
    p = await _db.hi_projects.find_one({"id": project_id}, {"_id": 0})
    if not p:
        return False
    status = (p.get("status") or "").lower()
    title = (p.get("title") or "").lower()
    if status in ("escalated", "paused"):
        return True
    return any(h in title for h in HIGH_RISK_HINTS)


# ============================================================= orchestrated response
async def _respond(user: dict, session: dict, text: str) -> dict:
    """Produce a structured, safety-checked response (shared Homie intelligence)."""
    if _is_emergency(text):
        return {"emergency": True, "spoken": "This may be an emergency. Get to safety and call your local emergency number now.",
                "full_text": "It sounds like this could be an emergency. Please stop what you're doing, get yourself and others to safety, and call your local emergency number immediately. I can't help with emergencies here.",
                "action_cards": [{"label": "See emergency steps", "route": "/home-intel/sync"}],
                "emotion": "urgent", "gesture": "warning", "clarifying_question": None, "stop_condition": "Exit to safety immediately."}
    # build minimal grounded context
    ctx_bits = []
    if session.get("project_id"):
        p = await _db.hi_projects.find_one({"id": session["project_id"]}, {"_id": 0, "title": 1, "status": 1})
        if p:
            ctx_bits.append(f"Active project: {p.get('title')} (status {p.get('status')})")
    if session.get("room_id"):
        rm = await _db.hi_rooms.find_one({"id": session["room_id"]}, {"_id": 0, "name": 1})
        if rm:
            ctx_bits.append(f"Room: {rm.get('name')}")
    ctx = " | ".join(ctx_bits) or "No specific project/room context."
    try:
        system = ("You are Homie, a careful home-improvement assistant. Use ONLY the given context; never invent product "
                  "prices, current local codes, or provider availability. Never claim to be a licensed professional and never "
                  "guarantee structural, legal, permit or financial outcomes. Return STRICT JSON with keys: "
                  "spoken (ONE concise next-action sentence, max 30 words), full_text (short helpful answer), "
                  "action_cards (array of {label} max 3), emotion (one of neutral,encouraging,cautionary,urgent,celebratory), "
                  "gesture (one of none,point,explain,pause,warning), clarifying_question (string or null), "
                  "stop_condition (string or null — when the user should stop and get a pro).")
        data = await _llm_json(system, f"Context: {ctx}\nUser said: {text}", max_tokens=500, feature_area="multimodal_voice")
        if not isinstance(data, dict):
            raise ValueError("bad response")
        cards = data.get("action_cards") or []
        norm_cards = []
        for c in cards[:3]:
            if isinstance(c, dict) and c.get("label"):
                norm_cards.append({"label": str(c["label"])[:60]})
            elif isinstance(c, str):
                norm_cards.append({"label": c[:60]})
        return {"emergency": False, "spoken": (data.get("spoken") or data.get("full_text") or "Here's what to do next.")[:220],
                "full_text": data.get("full_text") or data.get("spoken") or "",
                "action_cards": norm_cards,
                "emotion": data.get("emotion") if data.get("emotion") in EMOTIONS else "neutral",
                "gesture": data.get("gesture") if data.get("gesture") in GESTURES else "explain",
                "clarifying_question": data.get("clarifying_question") or None,
                "stop_condition": data.get("stop_condition") or None}
    except Exception as e:
        _sentry("multimodal_context_failure", str(e))
        return {"emergency": False, "spoken": "I had trouble answering just now — please try again.",
                "full_text": "Sorry, I couldn't generate an answer right now. Please try again in a moment, or type your question.",
                "action_cards": [], "emotion": "neutral", "gesture": "none", "clarifying_question": None, "stop_condition": None,
                "degraded": True}


# ============================================================= models
class StartReq(BaseModel):
    interaction_mode: str = "text"
    conversation_id: Optional[str] = None
    property_id: Optional[str] = None
    room_id: Optional[str] = None
    project_id: Optional[str] = None


class SpeechReq(BaseModel):
    transcript: str
    transcript_confidence: float = 1.0
    language: str = "en"


class AskReq(BaseModel):
    text: str
    from_voice: bool = False


class HandsFreeReq(BaseModel):
    command: str
    confirm: bool = False
    note: Optional[str] = None


class PlaybackReq(BaseModel):
    status: str


class TTSReq(BaseModel):
    text: str
    speed: float = 1.0


class SimplifyReq(BaseModel):
    text: str


TTS_VOICE = "coral"  # warm, friendly — Homie's voice


def _clean_for_tts(text: str) -> str:
    text = re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF]", "", text)  # emoji
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"[*_#>~|]", "", text)
    return re.sub(r"\s+", " ", text).strip()


async def _tts_generate(text: str, speed: float) -> str:
    """Generate (or reuse cached) speech; returns cache key."""
    clean = _clean_for_tts(text)[:4000]
    if not clean:
        raise HTTPException(status_code=400, detail="Nothing to speak.")
    speed = max(0.5, min(2.0, speed))
    key = hashlib.sha256(f"{clean}|{TTS_VOICE}|{speed}|tts-1|mp3".encode()).hexdigest()
    cached = await _db.tts_cache.find_one({"key": key}, {"_id": 1})
    if cached:
        return key
    from emergentintegrations.llm.openai import OpenAITextToSpeech
    tts = OpenAITextToSpeech(api_key=os.environ.get("EMERGENT_LLM_KEY", ""))
    audio_bytes = await tts.generate_speech(text=clean, model="tts-1", voice=TTS_VOICE, speed=speed)
    await _db.tts_cache.update_one({"key": key}, {"$set": {"key": key, "audio": Binary(audio_bytes),
                                                           "voice": TTS_VOICE, "created_at": _now()}}, upsert=True)
    return key


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/voice", dependencies=[Depends(get_current_user)])

    @r.post("/tts")
    async def tts(req: TTSReq, user: dict = Depends(get_current_user)):
        s = await _settings()
        if not s["voice_output_enabled"]:
            raise HTTPException(status_code=403, detail="Spoken replies are turned off right now.")
        try:
            key = await _tts_generate(req.text, req.speed)
        except HTTPException:
            raise
        except Exception as e:
            if _logger:
                _logger.warning(f"TTS generation failed: {e}")
            raise HTTPException(status_code=502, detail="Couldn't generate speech right now — captions are still available.")
        await _cap(user["id"], "voice_tts_generated", {"chars": len(req.text)})
        return {"url": f"/api/hi/voice/tts/{key}.mp3"}

    @r.post("/sessions/{sid}/simplify")
    async def simplify(sid: str, req: SimplifyReq, user: dict = Depends(get_current_user)):
        await _session(sid, user["id"])
        text = (req.text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Nothing to simplify.")
        system = ("You are Homie. Rewrite the following answer in SIMPLER language: short sentences, everyday words, "
                  "no jargon, keep every safety warning. Return STRICT JSON {spoken: string (one simple sentence, "
                  "max 25 words), full_text: string (the simpler version, max 120 words)}")
        try:
            data = await _llm_json(system, text[:2000], max_tokens=400, feature_area="multimodal_simplify")
            spoken = str(data.get("spoken") or "")[:220]
            full = str(data.get("full_text") or "")[:1200]
            if not full:
                raise ValueError("empty")
        except Exception:
            raise HTTPException(status_code=502, detail="Couldn't simplify right now — try again in a moment.")
        await _cap(user["id"], "voice_simplified", {})
        return {"spoken": spoken, "full_text": full}

    @r.get("/config")
    async def config(user: dict = Depends(get_current_user)):
        s = await _settings()
        return {"voice_input_enabled": s["voice_input_enabled"], "voice_output_enabled": s["voice_output_enabled"],
                "avatar_enabled": s["avatar_enabled"], "commands": HANDSFREE_COMMANDS,
                "note": "Voice recording and spoken playback run on a real device build. Text works everywhere."}

    @r.post("/sessions")
    async def start(req: StartReq, user: dict = Depends(get_current_user)):
        if req.interaction_mode not in MODES:
            raise HTTPException(status_code=400, detail="Invalid interaction mode.")
        s = await _settings()
        mode = req.interaction_mode
        if mode == "avatar_future" and not s["avatar_enabled"]:
            mode = "text"  # graceful fallback
        doc = {"id": _nid(), "user_id": user["id"], "conversation_id": req.conversation_id,
               "property_id": req.property_id, "room_id": req.room_id, "project_id": req.project_id,
               "interaction_mode": mode, "status": "active", "created_at": _now(), "updated_at": _now()}
        await _db.mm_sessions.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "voice_session_started" if mode in ("voice", "mixed") else "avatar_session_started" if mode == "avatar_future" else "multimodal_session_started", {"mode": mode})
        return {"session": doc, "avatar_fell_back": req.interaction_mode == "avatar_future" and mode == "text"}

    @r.get("/sessions/{sid}")
    async def get_session(sid: str, user: dict = Depends(get_current_user)):
        s = await _session(sid, user["id"])
        speech = await _db.mm_speech.find({"multimodal_session_id": sid}, {"_id": 0}).sort("created_at", -1).to_list(20)
        return {"session": s, "recent_speech": speech}

    @r.post("/sessions/{sid}/speech")
    async def speech(sid: str, req: SpeechReq, user: dict = Depends(get_current_user)):
        await _session(sid, user["id"])
        s = await _settings()
        if not s["voice_input_enabled"]:
            raise HTTPException(status_code=403, detail="Voice input is turned off right now. You can type instead.")
        rec = {"id": _nid(), "multimodal_session_id": sid, "transcript": req.transcript[:2000],
               "transcript_confidence": max(0.0, min(1.0, req.transcript_confidence)), "language": req.language,
               "processing_status": "completed", "created_at": _now()}
        await _db.mm_speech.insert_one(dict(rec)); rec.pop("_id", None)
        await _cap(user["id"], "voice_transcript_completed", {"confidence": rec["transcript_confidence"]})
        low_conf = rec["transcript_confidence"] < 0.5
        return {"speech": rec, "low_confidence": low_conf,
                "prompt_repeat": low_conf, "message": "I didn't catch that clearly — mind repeating, or type it?" if low_conf else None}

    @r.post("/sessions/{sid}/ask")
    async def ask(sid: str, req: AskReq, user: dict = Depends(get_current_user)):
        session = await _session(sid, user["id"])
        if not req.text.strip():
            raise HTTPException(status_code=400, detail="Say or type something first.")
        resp = await _respond(user, session, req.text.strip())
        s = await _settings()
        # persist voice response record + avatar instruction intent
        vr = {"id": _nid(), "multimodal_session_id": sid, "response_reference": resp["full_text"][:500],
              "voice_profile_key": "homie_default", "playback_status": "queued" if s["voice_output_enabled"] and not resp.get("degraded") else "stopped",
              "created_at": _now()}
        await _db.mm_voice.insert_one(dict(vr)); vr.pop("_id", None)
        avatar = None
        if s["avatar_enabled"] and not resp["emergency"]:
            avatar = {"id": _nid(), "multimodal_session_id": sid, "response_reference": resp["full_text"][:200],
                      "emotion": resp["emotion"], "gesture": resp["gesture"], "animation_context": "guidance",
                      "status": "queued", "created_at": _now()}
            await _db.mm_avatar.insert_one(dict(avatar)); avatar.pop("_id", None)
            await _cap(user["id"], "avatar_instruction_delivered", {"emotion": resp["emotion"]})
        await _db.mm_sessions.update_one({"id": sid}, {"$set": {"updated_at": _now()}})
        if req.from_voice:
            await _cap(user["id"], "voice_response_played", {})
        return {"response": resp, "voice_response_id": vr["id"], "avatar_instruction": avatar,
                "captions": resp["full_text"], "voice_output_enabled": s["voice_output_enabled"]}

    @r.put("/voice/{vid}/playback")
    async def playback(vid: str, req: PlaybackReq, user: dict = Depends(get_current_user)):
        if req.status not in ("queued", "playing", "completed", "failed", "stopped"):
            raise HTTPException(status_code=400, detail="Invalid playback status.")
        await _db.mm_voice.update_one({"id": vid}, {"$set": {"playback_status": req.status}})
        return {"ok": True, "status": req.status}

    @r.post("/sessions/{sid}/handsfree")
    async def handsfree(sid: str, req: HandsFreeReq, user: dict = Depends(get_current_user)):
        session = await _session(sid, user["id"])
        if req.command not in HANDSFREE_COMMANDS:
            raise HTTPException(status_code=400, detail="Unknown command.")
        pid = session.get("project_id")
        if not pid and req.command not in ("ask", "stop", "pause"):
            raise HTTPException(status_code=400, detail="Start hands-free from inside a project.")
        # hands-free disabled for high-risk / professional projects
        if await _project_high_risk(pid) and req.command in ("next_step", "previous_step"):
            raise HTTPException(status_code=409, detail="Hands-free step progress is off for high-risk or professional work. Please review each step carefully.")
        await _cap(user["id"], "hands_free_command_used", {"command": req.command})

        if req.command == "stop":
            await _db.mm_sessions.update_one({"id": sid}, {"$set": {"status": "completed", "updated_at": _now()}})
            return {"spoken": "Stopped. Your progress is saved.", "session_status": "completed"}
        if req.command == "pause":
            await _db.mm_sessions.update_one({"id": sid}, {"$set": {"status": "paused", "updated_at": _now()}})
            return {"spoken": "Project paused.", "session_status": "paused"}
        if req.command == "ask":
            return {"spoken": "Sure — what would you like to ask Homie?", "prompt_ask": True}

        steps = await _db.hi_project_steps.find({"project_id": pid}, {"_id": 0}).sort("sequence_number", 1).to_list(200)
        if not steps:
            return {"spoken": "This project doesn't have steps yet. Open it to build the plan."}
        cur_idx = next((i for i, s in enumerate(steps) if s.get("status") == "active"), None)
        if cur_idx is None:
            cur_idx = next((i for i, s in enumerate(steps) if s.get("status") == "not_started"), 0)
        cur = steps[cur_idx]

        if req.command in ("repeat",):
            return {"spoken": (cur.get("title") or "Current step") + ". " + (cur.get("instruction") or "")[:200], "step": cur}
        if req.command == "stuck":
            return {"spoken": "No problem. Re-read the step, check you have the right tools, and if it involves anything risky, it's okay to stop and call a pro.",
                    "step": cur, "stop_ok": True}
        if req.command == "show_tools":
            mats = await _db.hi_project_materials.find({"project_id": pid, "category": "tool"}, {"_id": 0}).to_list(50)
            tools = [m.get("name") for m in mats] or ["No specific tools listed for this project."]
            await _cap(user["id"], "hands_free_command_used", {"command": "show_tools"})
            return {"spoken": "You'll need: " + ", ".join([t for t in tools if t][:6]) + ".", "tools": tools}
        if req.command == "previous_step":
            if cur_idx == 0:
                return {"spoken": "You're on the first step.", "step": cur}
            prev = steps[cur_idx - 1]
            return {"spoken": "Going back. " + (prev.get("title") or ""), "step": prev, "note": "Review only — this didn't change your progress."}
        if req.command == "next_step":
            # require explicit confirmation to change project state; never auto-complete
            if not req.confirm:
                return {"needs_confirmation": True, "spoken": f"Ready to mark '{cur.get('title')}' done and move on? Say confirm.", "step": cur}
            await _db.hi_project_steps.update_one({"id": cur["id"], "status": {"$nin": ["completed", "skipped"]}},
                                                  {"$set": {"status": "completed", "completed_at": _now()}})
            nxt = steps[cur_idx + 1] if cur_idx + 1 < len(steps) else None
            if nxt:
                await _db.hi_project_steps.update_one({"id": nxt["id"], "status": "not_started"}, {"$set": {"status": "active"}})
                return {"spoken": "Done. Next: " + (nxt.get("title") or ""), "step": nxt}
            return {"spoken": "That was the last step. Nice work!", "step": None, "project_complete_ready": True}
        return {"spoken": "Okay."}

    return r


# ============================================================= admin router
class SettingsReq(BaseModel):
    voice_input_enabled: Optional[bool] = None
    voice_output_enabled: Optional[bool] = None
    avatar_enabled: Optional[bool] = None
    high_risk_avatar_disabled: Optional[bool] = None
    free_voice_daily_limit: Optional[int] = None


def build_tts_router() -> APIRouter:
    """Public audio serving — keys are unguessable SHA-256 hashes."""
    r = APIRouter(prefix="/api/hi/voice", tags=["voice-tts"])

    @r.get("/tts/{key}.mp3")
    async def get_tts(key: str):
        doc = await _db.tts_cache.find_one({"key": key}, {"_id": 0, "audio": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Audio not found.")
        return Response(content=bytes(doc["audio"]), media_type="audio/mpeg",
                        headers={"Cache-Control": "public, max-age=31536000"})

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/voice", dependencies=[Depends(require_admin)])

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def put_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _now()
            await _db.mm_settings.update_one({"id": "singleton"}, {"$set": upd}, upsert=True)
        return await _settings()

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        total_sessions = await _db.mm_sessions.count_documents({})
        voice_responses = await _db.mm_voice.count_documents({})
        failed_playback = await _db.mm_voice.count_documents({"playback_status": "failed"})
        low_conf = await _db.mm_speech.count_documents({"transcript_confidence": {"$lt": 0.5}})
        return {"total_sessions": total_sessions, "voice_responses": voice_responses,
                "failed_playback": failed_playback, "low_confidence_transcripts": low_conf,
                "sessions_by_mode": {m: await _db.mm_sessions.count_documents({"interaction_mode": m}) for m in MODES},
                "settings": await _settings()}

    return r


# ============================================================= seed
async def seed_voice():
    if _db is None:
        return
    try:
        await _settings()
        if _logger:
            _logger.info("multimodal voice (B34) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"multimodal voice seed failed: {e}")
