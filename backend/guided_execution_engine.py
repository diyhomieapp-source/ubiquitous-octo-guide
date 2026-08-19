"""
DIYhomie — Guided Task Execution, Adaptive Coaching & Hands-Free Work Mode (Build Document 52).

Turns a project step (hi_project_steps) into a guided execution session: one instruction at a
time, safety-first, replayable, voice-command capable, pause/resume at the exact micro-point.

- GuidedStep structured objects built from project steps (+ LLM micro-step expansion, cached)
- Work-mode states: SAFETY_CHECK -> PREPARE -> DEMONSTRATE -> USER_ACTION -> VERIFY -> ...
- Deterministic voice-command parser ("repeat", "slow it down", "I'm done", "bring in a pro"...)
- Completion transitions ("Nice work... up next"), pause-state capture, welcome-back resume
- Verification never claims more than it can confirm (user_confirmation for MVP)

Collections: ge_sessions. Reads/writes: hi_projects, hi_project_steps.
Reuses: safety_engine (safety cards), project_workspace_engine._safety_color, analytics_engine.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Callable = None

WORK_STATES = ["TASK_OPENED", "SAFETY_CHECK", "PREPARE", "DEMONSTRATE", "USER_ACTION",
               "VERIFY", "CORRECT_OR_CONTINUE", "COMPLETE_STEP", "NEXT_STEP", "TASK_COMPLETE"]
INTERRUPT_STATES = ["PAUSED", "LOW_CONFIDENCE", "TARGET_LOST", "MISSING_TOOL", "MISSING_MATERIAL",
                    "SAFETY_STOP", "USER_ASKED_FOR_HELP", "PRO_ESCALATION"]
MODES = ["standard", "voice", "ar", "watch_first", "read_more"]

# Doc 52 §6 — deterministic voice-command grammar. Keyword sets checked in order.
VOICE_COMMANDS = [
    ("bring_in_pro", ["bring in a pro", "call a pro", "professional", "hire"]),
    ("help", ["i need help", "help me", "help", "stuck"]),
    ("repeat", ["repeat", "say that again", "again please", "show me again", "one more time"]),
    ("slow", ["slow", "slower", "slow it down", "slow motion"]),
    ("tool", ["what tool", "which tool", "tool do i need"]),
    ("why", ["why", "why are we", "why does this matter"]),
    ("whats_next", ["what comes next", "what's next", "whats next", "next step"]),
    ("done", ["i'm done", "im done", "done", "finished", "i finished"]),
    ("pause", ["pause", "take a break", "stop for now"]),
    ("continue", ["continue", "resume", "keep going", "let's go", "ready", "i'm ready", "im ready"]),
    ("back", ["go back", "previous step", "back up"]),
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


async def _cap(user, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


def parse_voice_command(text: str) -> Optional[str]:
    t = (text or "").lower().strip()
    if not t:
        return None
    for cmd, keys in VOICE_COMMANDS:
        if any(k in t for k in keys):
            return cmd
    return None


async def _guided_step(step: dict, project: dict, seq: int, total: int) -> dict:
    """Doc 52 §4 — structured GuidedStep object from a project step."""
    from project_workspace_engine import _safety_color
    safety = _safety_color(project, step)
    instr = step.get("instruction") or ""
    return {
        "id": step["id"], "project_id": project["id"],
        "sequence_order": seq, "total_steps": total,
        "title": instr[:110],
        "instruction_text": instr,
        "voice_text": instr,
        "explanation_text": step.get("why") or None,
        "required_tools": step.get("tools_needed") or [],
        "required_materials": step.get("materials_needed") or [],
        "safety_level": safety,
        "safety_card": step.get("safety_note"),
        "estimated_time": step.get("estimated_time"),
        "target_type": "project_area",
        "verification_method": "user_confirmation",
        "verification_question": f"Is this done and looking right — {instr[:80].rstrip('.')}?",
        "common_mistakes": step.get("common_mistakes") or [],
        "micro_steps": step.get("micro_steps") or [],
        "status": step.get("status"),
        "replay_options": ["normal", "slow", "another_angle", "with_voice", "without_voice"],
        "modes": MODES,
    }


async def _session_payload(sess: dict, user: dict) -> dict:
    project = await _db.hi_projects.find_one({"id": sess["project_id"]}, {"_id": 0})
    steps = await _db.hi_project_steps.find({"project_id": sess["project_id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(300)
    cur = next((s for s in steps if s["id"] == sess.get("current_step_id")), None)
    if not cur or cur.get("status") in ("completed", "skipped"):
        cur = next((s for s in steps if s["status"] in ("active", "waiting")), None) or \
              next((s for s in steps if s["status"] == "not_started"), None)
        if cur:
            await _db.ge_sessions.update_one({"id": sess["id"]}, {"$set": {"current_step_id": cur["id"]}})
            sess["current_step_id"] = cur["id"]
    done = len([s for s in steps if s["status"] in ("completed", "skipped")])
    if not cur:
        return {"session": sess, "work_state": "TASK_COMPLETE", "step": None,
                "progress": {"done": done, "total": len(steps)},
                "message": "Everything in this plan is complete. Great work."}
    seq = steps.index(cur) + 1
    gs = await _guided_step(cur, project, seq, len(steps))
    nxt = next((s for s in steps[steps.index(cur) + 1:] if s["status"] == "not_started"), None)
    work_state = "SAFETY_CHECK" if (gs["safety_card"] or gs["safety_level"]["color"] in ("ORANGE", "RED")) else "USER_ACTION"
    if gs["safety_level"]["color"] == "RED":
        work_state = "SAFETY_STOP"
    return {"session": sess, "work_state": work_state, "step": gs,
            "project": {"id": project["id"], "title": project["title"]},
            "progress": {"done": done, "total": len(steps)},
            "next_step_preview": (nxt or {}).get("instruction", "")[:110] or None,
            "resume_note": sess.get("pause_note")}


class StartReq(BaseModel):
    project_id: str
    step_id: Optional[str] = None
    mode: Optional[str] = "standard"


class EventReq(BaseModel):
    event: str  # repeat | slow | another_angle | why | tool | whats_next | help | mode_changed
    mode: Optional[str] = None


class DoneReq(BaseModel):
    confirmed: bool = True
    note: Optional[str] = None


class PauseReq(BaseModel):
    note: Optional[str] = None


class VoiceReq(BaseModel):
    text: str


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/guided", dependencies=[Depends(get_current_user)])

    async def _sess(sid, uid):
        s = await _db.ge_sessions.find_one({"id": sid, "user_id": uid}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Guided session not found.")
        return s

    @r.post("/sessions")
    async def start(req: StartReq, user: dict = Depends(get_current_user)):
        project = await _db.hi_projects.find_one({"id": req.project_id, "user_id": user["id"]}, {"_id": 0})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found.")
        existing = await _db.ge_sessions.find_one(
            {"user_id": user["id"], "project_id": req.project_id, "status": {"$in": ["active", "paused"]}}, {"_id": 0})
        if existing:
            resumed = existing["status"] == "paused"
            await _db.ge_sessions.update_one({"id": existing["id"]}, {"$set": {"status": "active", "last_active_at": _now()}})
            existing["status"] = "active"
            payload = await _session_payload(existing, user)
            if resumed:
                payload["welcome_back"] = ("Welcome back. You paused here" +
                                           (f": {existing.get('pause_note')}" if existing.get("pause_note") else ".") +
                                           " Let's pick up exactly where you left off.")
                await _cap(user, "guided_task_resumed", {"project_id": req.project_id})
            return payload
        sess = {"id": _nid(), "user_id": user["id"], "project_id": req.project_id,
                "current_step_id": req.step_id, "mode": req.mode if req.mode in MODES else "standard",
                "status": "active", "pause_note": None,
                "started_at": _now(), "last_active_at": _now()}
        await _db.ge_sessions.insert_one(dict(sess)); sess.pop("_id", None)
        await _cap(user, "guided_task_started", {"project_id": req.project_id, "mode": sess["mode"]})
        payload = await _session_payload(sess, user)
        await _cap(user, "guided_step_viewed", {"project_id": req.project_id, "step_id": (payload.get("step") or {}).get("id")})
        return payload

    @r.get("/sessions/{sid}")
    async def get_session(sid: str, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        return await _session_payload(s, user)

    @r.post("/sessions/{sid}/micro")
    async def micro_steps(sid: str, user: dict = Depends(get_current_user)):
        """Doc 52 §10 — break the current step into extremely small actions (LLM, cached on step)."""
        s = await _sess(sid, user["id"])
        step = await _db.hi_project_steps.find_one({"id": s.get("current_step_id")}, {"_id": 0})
        if not step:
            raise HTTPException(status_code=404, detail="No current step.")
        if step.get("micro_steps"):
            return {"micro_steps": step["micro_steps"], "cached": True}
        project = await _db.hi_projects.find_one({"id": s["project_id"]}, {"_id": 0, "title": 1})
        micro = []
        try:
            data = await _llm_json(
                "You are a master contractor breaking one DIY step into micro-actions for a beginner. "
                "Return JSON: {\"micro_steps\": [{\"action\": str (<=100 chars, one tiny physical action), "
                "\"grip_or_position\": str|null (what to hold / where to grip), \"caution\": str|null}]}. "
                "3 to 6 micro-steps. Never include actions requiring a professional.",
                f"Project: {(project or {}).get('title')}\nStep: {step.get('instruction')}\n"
                f"Safety note: {step.get('safety_note') or 'none'}",
                max_tokens=500)
            micro = (data or {}).get("micro_steps") or []
        except Exception:
            pass
        if not micro:
            micro = [{"action": step.get("instruction", "")[:100], "grip_or_position": None, "caution": step.get("safety_note")}]
        await _db.hi_project_steps.update_one({"id": step["id"]}, {"$set": {"micro_steps": micro}})
        return {"micro_steps": micro, "cached": False}

    @r.post("/sessions/{sid}/event")
    async def step_event(sid: str, req: EventReq, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        step = await _db.hi_project_steps.find_one({"id": s.get("current_step_id")}, {"_id": 0})
        await _db.ge_sessions.update_one({"id": sid}, {"$set": {"last_active_at": _now()}})
        instr = (step or {}).get("instruction", "")
        ev = req.event
        payload: dict = {"ok": True, "event": ev}
        if ev == "repeat":
            await _cap(user, "guided_instruction_repeated", {"project_id": s["project_id"]})
            payload["message"] = instr
        elif ev == "slow":
            await _cap(user, "guided_step_slow_mode_used", {"project_id": s["project_id"]})
            payload["message"] = "Let's take it slowly. " + instr
            payload["speed"] = "SLOW"
        elif ev == "another_angle":
            await _cap(user, "guided_step_replayed", {"project_id": s["project_id"]})
            payload["message"] = "Here's the same action from the other view."
            payload["camera_view"] = "OVERHEAD"
        elif ev == "why":
            payload["message"] = (step or {}).get("why") or "This step protects the work that comes after it — skipping it usually means redoing something later."
        elif ev == "tool":
            tools = (step or {}).get("tools_needed") or []
            payload["message"] = ("You'll need: " + ", ".join(t.replace("_", " ") for t in tools) + ".") if tools else "No special tool — just your hands for this one."
        elif ev == "whats_next":
            steps = await _db.hi_project_steps.find({"project_id": s["project_id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(300)
            idx = next((i for i, x in enumerate(steps) if x["id"] == (step or {}).get("id")), -1)
            nxt = next((x for x in steps[idx + 1:] if x["status"] == "not_started"), None) if idx >= 0 else None
            payload["message"] = f"After this: {nxt['instruction'][:120]}" if nxt else "This is the last step — then we verify and wrap up."
        elif ev == "help":
            await _cap(user, "guided_help_requested", {"project_id": s["project_id"]})
            payload["message"] = "No problem — let's slow down. " + instr
            payload["options"] = ["repeat", "slow", "micro_steps", "report_problem", "bring_in_pro"]
        elif ev == "mode_changed":
            mode = req.mode if req.mode in MODES else "standard"
            await _db.ge_sessions.update_one({"id": sid}, {"$set": {"mode": mode}})
            if mode == "voice":
                await _cap(user, "guided_voice_mode_started", {"project_id": s["project_id"]})
            elif mode == "ar":
                await _cap(user, "guided_ar_mode_started", {"project_id": s["project_id"]})
            payload["message"] = f"Switched to {mode.replace('_', ' ')} mode."
            payload["mode"] = mode
        else:
            raise HTTPException(status_code=400, detail="Unknown event.")
        return payload

    @r.post("/sessions/{sid}/voice-command")
    async def voice_command(sid: str, req: VoiceReq, user: dict = Depends(get_current_user)):
        """Doc 52 §6 — hands-free grammar. Returns the parsed command; client executes it.
        Safety-critical confirmations are never bypassed: 'done' still requires the verify question."""
        await _sess(sid, user["id"])
        cmd = parse_voice_command(req.text)
        if not cmd:
            return {"command": None, "message": "I didn't catch that. Try 'repeat', 'slow it down', 'I'm done', or 'I need help'."}
        confirmations = {
            "done": "Before we move on — is it fully done and looking right?",
            "bring_in_pro": "Want me to package your project for a professional?",
            "pause": "Pausing here. I'll save exactly where you are.",
        }
        return {"command": cmd, "heard": req.text.strip()[:200], "confirmation": confirmations.get(cmd)}

    @r.post("/sessions/{sid}/done")
    async def step_done(sid: str, req: DoneReq, user: dict = Depends(get_current_user)):
        """Verify -> complete -> transition. Never claims verification beyond user confirmation."""
        s = await _sess(sid, user["id"])
        step = await _db.hi_project_steps.find_one({"id": s.get("current_step_id")}, {"_id": 0})
        if not step:
            raise HTTPException(status_code=404, detail="No current step.")
        if not req.confirmed:
            await _cap(user, "guided_step_failed", {"project_id": s["project_id"], "step_id": step["id"]})
            return {"advanced": False, "work_state": "CORRECT_OR_CONTINUE",
                    "message": "No rush. Let's look at it again — small corrections now beat rework later.",
                    "options": ["repeat", "slow", "micro_steps", "report_problem", "bring_in_pro"]}
        await _db.hi_project_steps.update_one({"id": step["id"]}, {"$set": {"status": "completed", "completed_at": _now()}})
        await _cap(user, "guided_verification_completed", {"project_id": s["project_id"], "step_id": step["id"], "method": "user_confirmation"})
        await _cap(user, "guided_step_completed", {"project_id": s["project_id"], "step_id": step["id"]})
        await _db.ge_sessions.update_one({"id": sid}, {"$set": {"current_step_id": None, "last_active_at": _now()}})
        s["current_step_id"] = None
        payload = await _session_payload(s, user)
        if payload["work_state"] == "TASK_COMPLETE":
            await _db.ge_sessions.update_one({"id": sid}, {"$set": {"status": "completed"}})
            await _db.hi_projects.update_one({"id": s["project_id"]}, {"$set": {"updated_at": _now()}})
            payload["completion"] = {"title": "Task complete", "message": "Nice work. Everything in this plan is done — let's verify and wrap up the project."}
        else:
            nxt = payload.get("step") or {}
            payload["completion"] = {
                "title": "Nice work.",
                "completed": step.get("instruction", "")[:110],
                "up_next": nxt.get("title"),
                "estimated_time": nxt.get("estimated_time"),
            }
            await _cap(user, "guided_step_viewed", {"project_id": s["project_id"], "step_id": nxt.get("id")})
        payload["advanced"] = True
        return payload

    @r.post("/sessions/{sid}/pause")
    async def pause(sid: str, req: PauseReq, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        step = await _db.hi_project_steps.find_one({"id": s.get("current_step_id")}, {"_id": 0, "instruction": 1, "safety_note": 1})
        note = (req.note or "").strip()[:300] or None
        await _db.ge_sessions.update_one({"id": sid}, {"$set": {"status": "paused", "pause_note": note, "last_active_at": _now()}})
        await _cap(user, "guided_task_paused", {"project_id": s["project_id"]})
        before_return = (step or {}).get("safety_note")
        return {"status": "paused",
                "paused_at": (step or {}).get("instruction", "")[:110] or "current step",
                "message": "Saved. You'll come back to this exact step.",
                "before_you_return": before_return}

    @r.post("/sessions/{sid}/pro")
    async def pro(sid: str, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        await _cap(user, "guided_pro_requested", {"project_id": s["project_id"]})
        return {"ok": True, "project_id": s["project_id"],
                "message": "Good call. Use Bring In a Pro to send your full project brief — no re-explaining needed."}

    return r
