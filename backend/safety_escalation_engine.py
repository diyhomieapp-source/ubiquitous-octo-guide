"""
DIYhomie — Safety, Confidence, Stop-Work & Professional Escalation deltas (Build Document 56).

Layered on safety_engine (Doc 43 evaluate_action/PPE/events), workspace/guided safety colors
(Docs 49/51/52) and Homie urgent detection (Doc 54). This engine adds:

- Persistent SafetyAssessments per project/task: risk color + separate confidence level +
  acknowledgment tier (informational | caution_confirmation | critical_confirmation | hard_stop)
- Safety checkpoints (electrical/plumbing/drilling/ladder) that gate task continuation
- Override records: yellow/orange may be explicitly overridden WITH a recorded reason;
  RED can never be overridden — only resolved, rerouted, or escalated
- Project safety history (warnings, checkpoints, overrides, problems, blockers)
- Urgent-language detection endpoint (gas/smoke/sparking/shock/flood/structural)

Collections: sa_assessments, sa_checkpoints, sa_overrides.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

ACK_TIERS = ["informational", "caution_confirmation", "critical_confirmation", "hard_stop"]

CHECKPOINTS = {
    "electrical": {"title": "Before touching wiring", "items": [
        "Correct breaker turned off",
        "Circuit tested with an appropriate tester",
        "No standing water or visible damage",
        "I confirm safe work conditions"]},
    "plumbing": {"title": "Before disconnecting", "items": [
        "Shutoff valve located",
        "Water supply turned off",
        "Towel or bucket positioned",
        "No uncontrolled active leak"]},
    "drilling": {"title": "Before drilling", "items": [
        "Target location confirmed",
        "Known utilities reviewed",
        "Correct fastener/anchor selected",
        "Eye protection available"]},
    "ladder": {"title": "Before you climb", "items": [
        "Ladder on stable, level ground",
        "Ladder fully locked/extended correctly",
        "I will reposition instead of overreaching"]},
}
_CHECKPOINT_KEYWORDS = {
    "electrical": ["wiring", "outlet", "breaker", "circuit", "switch", "electrical"],
    "plumbing": ["supply line", "shutoff", "plumbing", "drain", "faucet", "toilet", "valve", "pipe"],
    "drilling": ["drill", "anchor", "screw into", "fasten to the wall", "stud"],
    "ladder": ["ladder", "ceiling", "overhead", "roof edge"],
}

URGENT_PATTERNS = [
    (["smell gas", "gas leak", "gas smell"], "gas",
     "Do not switch anything on or off and do not create sparks. Leave the area, then contact your gas utility or emergency services from outside."),
    (["smoke", "fire", "burning smell"], "fire",
     "If there is fire or heavy smoke, leave immediately and call emergency services. Do not attempt DIY diagnosis."),
    (["sparking", "sparks", "got shocked", "shocked me", "electrocut"], "electrical",
     "Do not touch the outlet, wiring, or anything wet nearby. If safe, turn off the breaker. Contact a qualified electrician; call emergency services if anyone is injured."),
    (["water is everywhere", "flooding", "major leak", "burst pipe", "water everywhere"], "water",
     "Shut off the main water valve if you can reach it safely. Keep water away from electrical equipment. A plumber may be needed urgently."),
    (["ceiling is sagging", "wall is bulging", "floor is sinking", "crack is growing"], "structural",
     "Keep people away from the area and do not add weight. This needs a qualified professional assessment before any DIY work."),
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


def detect_checkpoint_type(text: str) -> Optional[str]:
    t = (text or "").lower()
    for ctype, kws in _CHECKPOINT_KEYWORDS.items():
        if any(k in t for k in kws):
            return ctype
    return None


def detect_urgent(text: str) -> Optional[dict]:
    t = (text or "").lower()
    for kws, category, guidance in URGENT_PATTERNS:
        if any(k in t for k in kws):
            return {"category": category, "guidance": guidance}
    return None


def _tier_for(color: str, checkpoint: Optional[str]) -> str:
    if color == "RED":
        return "hard_stop"
    if color == "ORANGE" or checkpoint in ("electrical", "plumbing"):
        return "critical_confirmation"
    if color == "YELLOW" or checkpoint:
        return "caution_confirmation"
    return "informational"


class AssessReq(BaseModel):
    project_id: str
    task_id: Optional[str] = None
    task_text: str


class CheckpointReq(BaseModel):
    project_id: str
    task_id: Optional[str] = None
    checkpoint_type: str
    checked_items: List[str] = []


class AckReq(BaseModel):
    confirmed: bool = True


class OverrideReq(BaseModel):
    reason: str


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/safetysys", dependencies=[Depends(get_current_user)])

    @r.get("/checkpoints/{ctype}")
    async def checkpoint_def(ctype: str, user: dict = Depends(get_current_user)):
        cp = CHECKPOINTS.get(ctype)
        if not cp:
            raise HTTPException(status_code=404, detail="Unknown checkpoint type.")
        return {"checkpoint_type": ctype, **cp}

    @r.post("/assessments")
    async def assess(req: AssessReq, user: dict = Depends(get_current_user)):
        """Doc 56 — persistent SafetyAssessment: risk color + separate confidence + ack tier."""
        p = await _db.hi_projects.find_one({"id": req.project_id, "user_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        from safety_engine import evaluate_action, ppe_for
        from project_workspace_engine import _safety_color
        res = evaluate_action(req.task_text, None)
        step = {"safety_note": (res.get("reasons") or [None])[0]} if res.get("verdict") != "allow" else None
        color = _safety_color(p, step)["color"]
        if res.get("verdict") in ("block_action", "escalate_to_professional"):
            color = "RED"
        elif res.get("verdict") == "require_verification" and color == "GREEN":
            color = "ORANGE"
        checkpoint = detect_checkpoint_type(req.task_text)
        tier = _tier_for(color, checkpoint)
        confidence = "high" if res.get("verdict") == "allow" and not checkpoint else "medium"
        doc = {"id": _nid(), "user_id": user["id"], "project_id": req.project_id,
               "task_id": req.task_id, "task_text": req.task_text.strip()[:300],
               "risk_color": color, "verdict": res.get("verdict"),
               "reasons": res.get("reasons", []), "ppe": ppe_for(req.task_text),
               "confidence_level": confidence, "acknowledgment_tier": tier,
               "checkpoint_type": checkpoint,
               "status": "blocked" if tier == "hard_stop" else "open",
               "acknowledged": False, "override": None,
               "created_at": _now(), "resolved_at": None}
        await _db.sa_assessments.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user, "safety_warning_shown", {"project_id": req.project_id, "risk_color": color, "tier": tier})
        if tier == "hard_stop":
            await _cap(user, "safety_stop_triggered", {"project_id": req.project_id})
        out = {"assessment": doc}
        if tier == "hard_stop":
            out["stop"] = {"title": "STOP — DO NOT CONTINUE YET",
                           "why": (res.get("reasons") or ["DIYhomie cannot verify this condition is safe."])[0],
                           "options": ["rescan", "show_safer_options", "bring_in_pro"],
                           "note": "Red conditions can't be dismissed — resolve, reroute, or escalate."}
        if checkpoint:
            out["checkpoint"] = {"checkpoint_type": checkpoint, **CHECKPOINTS[checkpoint]}
        return out

    @r.post("/assessments/{aid}/acknowledge")
    async def acknowledge(aid: str, req: AckReq, user: dict = Depends(get_current_user)):
        a = await _db.sa_assessments.find_one({"id": aid, "user_id": user["id"]}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Assessment not found.")
        if a["acknowledgment_tier"] == "hard_stop":
            raise HTTPException(status_code=409, detail="This is a hard stop — it can't be acknowledged away. Resolve the condition or bring in a pro.")
        if not req.confirmed:
            return {"ok": False, "message": "Take your time — confirm once the safety condition is actually met."}
        await _db.sa_assessments.update_one({"id": aid}, {"$set": {"acknowledged": True, "status": "resolved", "resolved_at": _now()}})
        await _cap(user, "safety_warning_acknowledged", {"project_id": a["project_id"], "tier": a["acknowledgment_tier"]})
        return {"ok": True, "unlocked": True}

    @r.post("/assessments/{aid}/override")
    async def override(aid: str, req: OverrideReq, user: dict = Depends(get_current_user)):
        """Yellow/orange only; recorded permanently. RED never overrides."""
        a = await _db.sa_assessments.find_one({"id": aid, "user_id": user["id"]}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Assessment not found.")
        await _cap(user, "safety_override_requested", {"project_id": a["project_id"], "risk_color": a["risk_color"]})
        if a["risk_color"] == "RED" or a["acknowledgment_tier"] == "hard_stop":
            raise HTTPException(status_code=409, detail="Red safety conditions cannot be overridden. Resolve the condition, choose a safer path, or bring in a professional.")
        reason = (req.reason or "").strip()[:400]
        if not reason:
            raise HTTPException(status_code=400, detail="An explicit reason is required to override a safety warning.")
        ov = {"id": _nid(), "project_id": a["project_id"], "task_id": a.get("task_id"),
              "assessment_id": aid, "user_id": user["id"], "warning_type": a["risk_color"],
              "user_reason": reason, "acknowledgment_version": 1, "created_at": _now()}
        await _db.sa_overrides.insert_one(dict(ov)); ov.pop("_id", None)
        await _db.sa_assessments.update_one({"id": aid}, {"$set": {"override": ov["id"], "status": "overridden", "resolved_at": _now()}})
        await _cap(user, "safety_override_recorded", {"project_id": a["project_id"], "risk_color": a["risk_color"]})
        return {"ok": True, "override": ov,
                "note": "Recorded in your project's safety history."}

    @r.post("/checkpoints")
    async def complete_checkpoint(req: CheckpointReq, user: dict = Depends(get_current_user)):
        cp = CHECKPOINTS.get(req.checkpoint_type)
        if not cp:
            raise HTTPException(status_code=400, detail="Unknown checkpoint type.")
        await _cap(user, "safety_checkpoint_started", {"project_id": req.project_id, "checkpoint_type": req.checkpoint_type})
        missing = [i for i in cp["items"] if i not in (req.checked_items or [])]
        complete = len(missing) == 0
        doc = {"id": _nid(), "user_id": user["id"], "project_id": req.project_id,
               "task_id": req.task_id, "checkpoint_type": req.checkpoint_type,
               "checked_items": req.checked_items, "complete": complete, "created_at": _now()}
        await _db.sa_checkpoints.insert_one(dict(doc)); doc.pop("_id", None)
        if complete:
            await _cap(user, "safety_checkpoint_completed", {"project_id": req.project_id, "checkpoint_type": req.checkpoint_type})
        return {"checkpoint": doc, "unlocked": complete,
                "missing": missing,
                "message": "Checkpoint complete — you're clear to continue." if complete
                else "Not yet — every item must be genuinely done before continuing."}

    @r.get("/projects/{pid}/history")
    async def safety_history(pid: str, user: dict = Depends(get_current_user)):
        """Doc 56 — project safety event history."""
        items = []
        for a in await _db.sa_assessments.find({"project_id": pid, "user_id": user["id"]}, {"_id": 0}).to_list(100):
            items.append({"type": "assessment", "at": a["created_at"], "risk_color": a["risk_color"],
                          "title": a["task_text"][:120], "status": a["status"], "tier": a["acknowledgment_tier"]})
        for c in await _db.sa_checkpoints.find({"project_id": pid, "user_id": user["id"]}, {"_id": 0}).to_list(100):
            items.append({"type": "checkpoint", "at": c["created_at"], "title": f"Checkpoint: {c['checkpoint_type']}",
                          "status": "complete" if c["complete"] else "incomplete"})
        for o in await _db.sa_overrides.find({"project_id": pid, "user_id": user["id"]}, {"_id": 0}).to_list(50):
            items.append({"type": "override", "at": o["created_at"], "risk_color": o["warning_type"],
                          "title": f"Override recorded: {o['user_reason'][:100]}"})
        for pr in await _db.ws_problems.find({"project_id": pid, "user_id": user["id"], "problem_type": {"$in": ["may_be_unsafe", "something_damaged"]}}, {"_id": 0}).to_list(50):
            items.append({"type": "problem", "at": pr["created_at"], "title": f"Safety concern reported: {pr.get('note') or pr['problem_type']}"[:120]})
        items.sort(key=lambda x: x["at"], reverse=True)
        return {"items": items[:100]}

    @r.post("/urgent")
    async def urgent(req: AssessReq, user: dict = Depends(get_current_user)):
        hit = detect_urgent(req.task_text)
        if not hit:
            return {"urgent": False}
        await _cap(user, "emergency_intent_detected", {"category": hit["category"]})
        return {"urgent": True, "category": hit["category"],
                "message": hit["guidance"],
                "note": "Ordinary project guidance is paused. DIYhomie won't attempt detailed DIY diagnosis during a potential emergency.",
                "actions": ["call_emergency_services", "bring_in_pro", "im_safe_now"]}

    return r
