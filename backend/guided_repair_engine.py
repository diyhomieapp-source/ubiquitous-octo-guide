"""
DIYhomie — Guided Repair & Evidence-to-Plan Engine (Build Document 2).

The first reusable DIYhomie intelligence workflow. Turns a homeowner's plain-language
description + evidence into a persistent, safety-aware repair assessment and an actionable
project plan. Establishes the reusable patterns future intelligence reuses:

  Symptom -> Evidence -> Assessment -> Verification -> Plan -> Execution -> Outcome

System rules enforced here:
  - Evidence before certainty (assessments carry confidence + missing_information)
  - Safety before convenience (deterministic static triage runs BEFORE any AI)
  - Project memory before repeated questions (Project Position + Evidence Workspace)
  - Plan before product recommendation (no material quantities / product links this sprint)
  - Professional escalation when confidence or risk requires it
  - Reality can revise the plan (reality-check / replan loop with preserved history)

Built natively on the existing MongoDB + JWT stack (NOT Supabase). Every record is
user-scoped; AI never becomes the canonical record without validation.

Namespace: /api/hi/repair/*  (+ admin /api/hi/admin/repair/*)
Collections: gr_issues, gr_evidence, gr_assessments, gr_questions, gr_plans,
             gr_positions, gr_decisions, gr_triage, gr_messages, gr_quality_queue
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

# ----------------------------------------------------------------- taxonomy
CATEGORIES = [
    "water_moisture", "plumbing", "electrical_concern", "appliance", "hvac",
    "drywall_interior_surface", "doors_windows", "flooring", "exterior",
    "pest_unknown_condition", "other_unsure",
]
URGENCIES = ["whenever", "soon", "urgent", "emergency_review"]
RISK_LEVELS = ["normal", "caution", "elevated", "emergency_review"]
CONFIDENCE_LEVELS = ["verified", "high_confidence", "conditional", "uncertain"]
RECOMMENDED_PATHS = ["observe", "inspect", "repair", "pause", "escalate"]
PHASES = [
    "ISSUE_REPORTED", "ASSESSMENT", "INFORMATION_NEEDED", "SAFE_INSPECTION",
    "PLAN_READY", "IN_PROGRESS", "BLOCKED_ESCALATED", "VERIFICATION",
    "COMPLETED", "DOCUMENTED",
]
EVIDENCE_TYPES = ["photo", "video", "audio", "document", "measurement", "observation"]
DECISION_STATUSES = ["recommended", "accepted", "rejected", "superseded"]
DIFFICULTIES = ["beginner", "intermediate", "advanced", "professional_review"]

# ----------------------------------------------------------------- static safety triage
# HARD STOPS — never generate a DIY plan; show an urgent safety panel.
_HARD_STOP = [
    (["smell of gas", "smell gas", "gas leak", "gas smell", "hissing gas", "gas line hiss", "hissing sound near the gas", "rotten egg smell"],
     "gas", "Possible gas leak. Do not use switches, flames or your phone near the area — leave the building and call your gas utility or emergency services from outside."),
    (["fire", "flames", "smoke coming", "smoke from", "sparking", "sparks", "arcing", "burning smell", "smells like burning", "hot outlet", "outlet is hot", "burning outlet", "melting outlet"],
     "fire_electrical", "Fire, sparking or a hot/burning outlet is dangerous. Stop, get to safety and call your local emergency number. Do not touch the outlet or device."),
    (["electric shock", "electrical shock", "got shocked", "shocked me", "shock when i touch"],
     "shock", "Electric shock is an emergency. Do not touch the item again. Turn off power at the breaker only if safe, and call a licensed electrician or emergency services."),
    (["carbon monoxide", "co detector going off", "co alarm", "co2 alarm going"],
     "carbon_monoxide", "Possible carbon monoxide. Get everyone outside to fresh air immediately and call emergency services. Do not re-enter until cleared."),
    (["ceiling collapse", "ceiling collapsing", "ceiling is falling", "wall collapse", "wall collapsing", "sagging ceiling", "bulging ceiling"],
     "structural_collapse", "A collapsing ceiling or wall is dangerous. Keep everyone away from the area and contact a structural professional. Do not go underneath it."),
]
# Combination hard stops (both cues present).
_HARD_STOP_COMBO = [
    (["flood", "flooding", "standing water", "water everywhere"], ["outlet", "electric", "panel", "breaker", "wiring", "energized"],
     "water_electrical", "Water near electrical equipment is dangerous. Do not enter the water. If safe, shut off power at the main breaker from a dry location, otherwise call an electrician / emergency services."),
]
# SOFT ESCALATIONS — continue with observation-only steps; require professional verification.
_SOFT = [
    (["breaker keeps tripping", "breaker trips", "keeps tripping", "repeated tripping", "trips every time"],
     "electrical", "Repeated breaker trips can indicate an overloaded or faulty circuit. Only safe observation is appropriate — an electrician should verify before any repair."),
    (["mold", "black mold", "mildew growth", "musty"],
     "mold", "Possible mold. Avoid disturbing it. Document it and have air quality / remediation verified before removal."),
    (["structural", "foundation crack", "cracked foundation", "shifting", "settling", "sloping floor", "beam"],
     "structural", "Possible structural movement. Observation and photos only — a structural professional should verify before any work."),
    (["sewage", "sewer backup", "sewage backup", "raw sewage"],
     "sewage", "Sewage backup is a health hazard. Avoid contact, ventilate, and have a plumber / remediation pro verify."),
    (["asbestos", "lead paint", "lead-based paint", "popcorn ceiling"],
     "hazmat", "Possible asbestos or lead-containing material. Do not sand, scrape or disturb it. Testing by a certified professional is required first."),
    (["water near electrical", "water by the outlet", "water in the panel"],
     "water_electrical", "Water near electrical components needs professional verification before any hands-on work."),
]


def _triage(text: str, category: Optional[str]) -> dict:
    """Deterministic safety triage. Runs BEFORE any AI. Cautious by design."""
    t = (text or "").lower()
    matched = []
    # hard stops (single-cue)
    for kws, code, msg in _HARD_STOP:
        if any(k in t for k in kws):
            matched.append(code)
            return {"risk_level": "emergency_review", "hard_stop": True, "soft_escalation": False,
                    "matched": matched, "code": code, "message": msg, "block_plan": True,
                    "guidance": "Do not continue DIY troubleshooting in this area."}
    # hard stops (combination)
    for a_kws, b_kws, code, msg in _HARD_STOP_COMBO:
        if any(k in t for k in a_kws) and any(k in t for k in b_kws):
            return {"risk_level": "emergency_review", "hard_stop": True, "soft_escalation": False,
                    "matched": [code], "code": code, "message": msg, "block_plan": True,
                    "guidance": "Do not continue DIY troubleshooting in this area."}
    # soft escalations
    for kws, code, msg in _SOFT:
        if any(k in t for k in kws):
            return {"risk_level": "elevated", "hard_stop": False, "soft_escalation": True,
                    "matched": [code], "code": code, "message": msg, "block_plan": False,
                    "guidance": "Safe observation only. Professional verification is required before invasive work."}
    # category-based caution defaults
    if category in ("electrical_concern", "plumbing", "hvac"):
        return {"risk_level": "caution", "hard_stop": False, "soft_escalation": False,
                "matched": [], "code": None,
                "message": "This system can carry hidden risk. We'll focus on safe observation first.",
                "block_plan": False, "guidance": "Proceed with safe, observation-first steps."}
    return {"risk_level": "normal", "hard_stop": False, "soft_escalation": False,
            "matched": [], "code": None, "message": None, "block_plan": False,
            "guidance": "No immediate hazard detected from your description."}


# ----------------------------------------------------------------- helpers
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


async def _get_property(user_id):
    p = await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
    if not p:
        p = await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0})
    return p


async def _owned_issue(iid, uid):
    issue = await _db.gr_issues.find_one({"id": iid, "user_id": uid}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found.")
    return issue


def _clean_evidence(e: dict) -> dict:
    """Never leak raw media bytes in list/detail responses."""
    e = dict(e)
    e.pop("base64", None)
    e["has_media"] = bool(e.get("_had_media"))
    e.pop("_had_media", None)
    return e


async def _evidence_summary(iid: str) -> str:
    rows = await _db.gr_evidence.find({"issue_id": iid}, {"_id": 0, "base64": 0}).sort("created_at", 1).to_list(200)
    bits = []
    for e in rows:
        if e["type"] == "measurement":
            bits.append(f"Measurement: {e.get('note') or ''} = {e.get('value')} {e.get('unit') or ''}".strip())
        elif e["type"] in ("photo", "video"):
            bits.append(f"{e['type'].title()} provided" + (f" — homeowner note: {e.get('note')}" if e.get("note") else ""))
        else:
            bits.append(f"{e['type'].title()}: {e.get('note') or ''}")
    return "\n".join(b for b in bits if b) or "No evidence uploaded yet."


async def _answered_questions(iid: str) -> str:
    rows = await _db.gr_questions.find({"issue_id": iid, "status": "answered"}, {"_id": 0}).sort("created_at", 1).to_list(50)
    return "\n".join(f"Q: {q['prompt']} A: {q.get('answer')}" for q in rows) or "None yet."


def _mk_assessment(data: dict, triage: dict, degraded: bool = False) -> dict:
    """Validate free-form AI output into the canonical assessment contract."""
    def _s(v, default=""):
        return str(v).strip() if v is not None else default

    def _list(v):
        if isinstance(v, list):
            return [str(x)[:400] for x in v if x][:8]
        if isinstance(v, str) and v.strip():
            return [v.strip()[:400]]
        return []

    causes = []
    raw_causes = data.get("possible_causes") or []
    if isinstance(raw_causes, list):
        for c in raw_causes[:6]:
            if isinstance(c, dict):
                causes.append({"cause": _s(c.get("cause") or c.get("label"))[:200],
                               "likelihood": (c.get("likelihood") if c.get("likelihood") in ("high", "medium", "low") else "medium"),
                               "why": _s(c.get("why"))[:300]})
            elif isinstance(c, str):
                causes.append({"cause": c[:200], "likelihood": "medium", "why": ""})
    conf = data.get("confidence_level")
    conf = conf if conf in CONFIDENCE_LEVELS else "uncertain"
    path = data.get("recommended_path")
    path = path if path in RECOMMENDED_PATHS else "inspect"
    # Safety triage always wins on risk_level.
    risk = triage["risk_level"]
    if triage["hard_stop"]:
        path, conf = "escalate", "conditional"
    return {
        "issue_summary": _s(data.get("issue_summary"))[:600] or "Repair issue reported.",
        "visible_evidence": _list(data.get("visible_evidence")),
        "possible_causes": causes,
        "excluded_or_less_likely": _list(data.get("excluded_or_less_likely")),
        "risk_level": risk,
        "confidence_level": conf,
        "missing_information": _list(data.get("missing_information")),
        "safe_next_action": _s(data.get("safe_next_action"))[:400] or "Gather one clear photo of the affected area before acting.",
        "DIY_boundary": _s(data.get("DIY_boundary"))[:400] or "Stop and consult a professional if the situation involves gas, major electrical, or structural elements.",
        "recommended_path": path,
        "source_references": _list(data.get("source_references")),
        "professional_verification_required": bool(triage["hard_stop"] or triage["soft_escalation"] or path == "escalate" or conf == "uncertain"),
        "degraded": degraded,
    }


async def _generate_assessment(issue: dict) -> dict:
    triage = issue.get("triage") or _triage(issue.get("description", ""), issue.get("category"))
    ev = await _evidence_summary(issue["id"])
    answers = await _answered_questions(issue["id"])
    system = (
        "You are Homie, a calm, evidence-aware master-contractor project leader. Produce a STRUCTURED "
        "repair ASSESSMENT — not generic advice, not a product pitch. Follow these rules strictly:\n"
        "- Evidence before certainty: only state what the evidence supports; rank hypotheses, never assert one cause as fact.\n"
        "- If evidence is thin, say so and lower confidence; list what is missing.\n"
        "- Safety before convenience: never give hazardous step detail; recommend a professional for gas, major "
        "electrical, structural, roofing-at-height or anything uncertain.\n"
        "- Never claim code/permit/warranty/insurance compliance or diagnose hidden conditions with certainty from a photo.\n"
        "Return STRICT JSON with keys: issue_summary (plain language), visible_evidence (array of what the evidence "
        "directly supports), possible_causes (array of {cause, likelihood in [high,medium,low], why}), "
        "excluded_or_less_likely (array), confidence_level (one of verified, high_confidence, conditional, uncertain), "
        "missing_information (array of what would raise confidence), safe_next_action (ONE safe immediate action), "
        "DIY_boundary (what is DIY-appropriate vs professional), recommended_path (one of observe, inspect, repair, "
        "pause, escalate), source_references (array, may be empty)."
    )
    user_text = (
        f"REPAIR CATEGORY: {issue.get('category')}\n"
        f"HOMEOWNER DESCRIPTION: {issue.get('description')}\n"
        f"URGENCY: {issue.get('urgency')}\n"
        f"SAFETY TRIAGE: risk={triage['risk_level']} hard_stop={triage['hard_stop']} soft_escalation={triage['soft_escalation']}"
        f"{(' — ' + triage['message']) if triage.get('message') else ''}\n"
        f"EVIDENCE ON FILE:\n{ev}\n"
        f"ANSWERED QUESTIONS:\n{answers}"
    )
    try:
        data = await _llm_json(system, user_text, max_tokens=1100, feature_area="guided_repair_assessment")
        if not isinstance(data, dict):
            raise ValueError("bad JSON")
        return _mk_assessment(data, triage, degraded=False)
    except Exception as e:
        if _logger:
            _logger.warning(f"repair assessment AI failed: {e}")
        # AI failure must never block the workflow — return a safe, honest placeholder.
        fallback = {
            "issue_summary": (issue.get("description") or "Repair issue reported.")[:600],
            "safe_next_action": "Take one wide photo and one close-up of the affected area so we can assess it.",
            "missing_information": ["Clear photos of the affected area", "When the problem started"],
        }
        a = _mk_assessment(fallback, triage, degraded=True)
        a["confidence_level"] = "uncertain"
        return a


def _default_questions(assessment: dict) -> List[str]:
    qs = list(assessment.get("missing_information") or [])
    if not qs:
        qs = ["When did you first notice this?", "Does it change with weather, water use, or time of day?"]
    return qs[:3]


async def _rebuild_position(issue: dict, assessment: dict, plan: Optional[dict] = None) -> dict:
    """Server-authoritative Project Position — the project's memory."""
    decisions = await _db.gr_decisions.find({"issue_id": issue["id"]}, {"_id": 0}).to_list(200)
    rejected = [d["decision"] for d in decisions if d["status"] == "rejected"]
    accepted = [d["decision"] for d in decisions if d["status"] == "accepted"]
    ev = await _evidence_summary(issue["id"])
    cur_task, next_action = None, assessment.get("safe_next_action")
    if plan:
        active = next((t for t in plan.get("tasks", []) if t.get("status") not in ("complete", "superseded")), None)
        if active:
            cur_task = active.get("title")
            next_action = active.get("title")
    pos = {
        "id": issue.get("position_id") or _nid(),
        "issue_id": issue["id"], "user_id": issue["user_id"],
        "objective": issue.get("description"),
        "existing_conditions": ev,
        "evidence_reviewed": assessment.get("visible_evidence", []),
        "known_facts": assessment.get("visible_evidence", []),
        "unverified_assumptions": [c["cause"] for c in assessment.get("possible_causes", [])],
        "safety_constraints": ([issue["triage"]["message"]] if issue.get("triage", {}).get("message") else []),
        "recommended_approach": assessment.get("recommended_path"),
        "alternatives_considered": [c["cause"] for c in assessment.get("possible_causes", [])[1:]],
        "rejected_approaches": rejected,
        "accepted_decisions": accepted,
        "current_phase": issue.get("phase"),
        "current_task": cur_task,
        "next_recommended_action": next_action,
        "professional_verification_requirements": (
            ["Professional verification recommended before invasive work."]
            if assessment.get("professional_verification_required") else []),
        "updated_at": _now(),
    }
    await _db.gr_positions.update_one({"issue_id": issue["id"]}, {"$set": pos}, upsert=True)
    if not issue.get("position_id"):
        await _db.gr_issues.update_one({"id": issue["id"]}, {"$set": {"position_id": pos["id"]}})
    return pos


async def _queue_quality(issue, reason, meta=None):
    try:
        await _db.gr_quality_queue.insert_one({
            "id": _nid(), "issue_id": issue["id"], "user_id": issue["user_id"],
            "category": issue.get("category"), "reason": reason, "meta": meta or {},
            "status": "open", "created_at": _now()})
    except Exception:
        pass


async def _log_event(issue_id, task_id, event, actor, meta=None):
    """Auditable execution event log — state transitions are events, not just UI flags."""
    try:
        await _db.gr_task_events.insert_one({
            "id": _nid(), "issue_id": issue_id, "task_id": task_id, "event": event,
            "actor": actor, "meta": meta or {}, "created_at": _now()})
    except Exception:
        pass


def _progress_summary(plan: Optional[dict]) -> dict:
    """Progress by task STATE (not an artificial percentage alone)."""
    if not plan or not plan.get("tasks"):
        return {"total": 0, "completed": 0, "in_progress": 0, "blocked": 0, "remaining": 0,
                "awaiting_verification": 0, "percent": 0, "label": "Not started", "current_task": None}
    tasks = plan["tasks"]
    total = len(tasks)
    completed = sum(1 for t in tasks if t["status"] in ("complete", "superseded"))
    in_progress = sum(1 for t in tasks if t["status"] == "in_progress")
    blocked = sum(1 for t in tasks if t["status"] == "blocked")
    awaiting = sum(1 for t in tasks if t["status"] == "awaiting_verification")
    remaining = total - completed
    current = next((t for t in tasks if t["status"] not in ("complete", "superseded")), None)
    percent = int(round((completed / total) * 100)) if total else 0
    if blocked:
        label = "Needs attention"
    elif completed == total:
        label = "All steps done"
    elif in_progress or awaiting:
        label = "In progress"
    elif completed:
        label = "Underway"
    else:
        label = "Ready to start"
    return {"total": total, "completed": completed, "in_progress": in_progress, "blocked": blocked,
            "awaiting_verification": awaiting, "remaining": remaining, "percent": percent, "label": label,
            "current_task": ({"id": current["id"], "title": current["title"], "status": current["status"]} if current else None)}



# ----------------------------------------------------------------- request models
class IssueReq(BaseModel):
    description: str = ""
    category: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    urgency: str = "soon"
    is_draft: bool = False


class IssueUpdateReq(BaseModel):
    description: Optional[str] = None
    category: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    urgency: Optional[str] = None
    status: Optional[str] = None  # draft | submitted


class EvidenceReq(BaseModel):
    type: str = "observation"
    note: Optional[str] = None
    base64: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None


class AnswerReq(BaseModel):
    answer: str


class ChatReq(BaseModel):
    text: str


class DecisionReq(BaseModel):
    decision: str
    status: str = "recommended"
    reason: Optional[str] = None
    evidence: Optional[str] = None
    confidence: Optional[str] = None
    made_by: str = "user"


class DecisionUpdateReq(BaseModel):
    status: str
    reason: Optional[str] = None


class TaskActionReq(BaseModel):
    action: str  # done | found_different | need_help | did_not_work | pause
    note: Optional[str] = None
    base64: Optional[str] = None


class CompleteReq(BaseModel):
    outcome_note: Optional[str] = None
    resolved: bool = True
    rating: Optional[int] = None
    outcome_status: Optional[str] = None  # resolved|improved|unresolved|professionally_completed|abandoned
    work_performed: Optional[str] = None
    follow_up: Optional[List[str]] = None
    pro_reference: Optional[str] = None
    base64: Optional[str] = None


class FeedbackReq(BaseModel):
    rating: int = 5
    comment: Optional[str] = None
    harmful: bool = False


class SessionActionReq(BaseModel):
    action: str  # pause | resume | archive | professional_handoff
    note: Optional[str] = None


class CoachReq(BaseModel):
    prompt: str


class CheckpointReq(BaseModel):
    confirmation: bool = False
    note: Optional[str] = None
    base64: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    observation: Optional[str] = None


class MaterialReq(BaseModel):
    name: str
    status: str  # available | unavailable | borrowed | substituted | unknown
    substitute_note: Optional[str] = None


OUTCOME_STATUSES = ["resolved", "improved", "unresolved", "professionally_completed", "abandoned"]
_RESOLVED_OUTCOMES = ("resolved", "improved", "professionally_completed")


# ----------------------------------------------------------------- user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/repair")

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"categories": CATEGORIES, "urgencies": URGENCIES, "risk_levels": RISK_LEVELS,
                "confidence_levels": CONFIDENCE_LEVELS, "recommended_paths": RECOMMENDED_PATHS,
                "phases": PHASES, "evidence_types": EVIDENCE_TYPES, "difficulties": DIFFICULTIES}

    # ---------------- Intake ----------------
    @r.post("/issues")
    async def create_issue(req: IssueReq, user: dict = Depends(get_current_user)):
        uid = user["id"]
        prop = await _get_property(uid)
        cat = req.category if req.category in CATEGORIES else "other_unsure"
        triage = _triage(req.description, cat)
        urgency = "emergency_review" if triage["hard_stop"] else (req.urgency if req.urgency in URGENCIES else "soon")
        phase = "BLOCKED_ESCALATED" if triage["hard_stop"] else "ISSUE_REPORTED"
        status = "draft" if req.is_draft else "submitted"
        issue = {
            "id": _nid(), "user_id": uid, "property_id": prop["id"] if prop else None,
            "room_id": req.room_id, "asset_id": req.asset_id,
            "description": req.description.strip()[:4000], "category": cat, "urgency": urgency,
            "status": status, "phase": phase, "triage": triage,
            "risk_flags": triage["matched"], "assessment_version": 0, "plan_version": 0,
            "position_id": None, "created_at": _now(), "updated_at": _now(),
        }
        await _db.gr_issues.insert_one(dict(issue)); issue.pop("_id", None)
        await _db.gr_triage.insert_one({"id": _nid(), "issue_id": issue["id"], "user_id": uid,
                                        "result": triage, "created_at": _now()})
        await _cap(uid, "issue.created", {"category": cat, "urgency": urgency})
        if triage["hard_stop"] or triage["soft_escalation"]:
            await _cap(uid, "issue.safety_interrupt_shown", {"code": triage["code"]})
        if triage["hard_stop"]:
            await _cap(uid, "issue.escalated", {"code": triage["code"]})
            await _queue_quality(issue, "emergency_safety_triage", {"code": triage["code"]})
        return {"issue": issue, "triage": triage,
                "no_plan": triage["hard_stop"],
                "message": ("A safety concern was detected — see the safety panel. We won't create a DIY plan for this."
                            if triage["hard_stop"] else None)}

    @r.get("/issues")
    async def list_issues(user: dict = Depends(get_current_user)):
        rows = await _db.gr_issues.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
        return {"issues": rows}

    @r.get("/issues/{iid}")
    async def get_issue(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        evidence = await _db.gr_evidence.find({"issue_id": iid}, {"_id": 0, "base64": 0}).sort("created_at", -1).to_list(200)
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        questions = await _db.gr_questions.find({"issue_id": iid}, {"_id": 0}).sort("created_at", 1).to_list(50)
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        position = await _db.gr_positions.find_one({"issue_id": iid}, {"_id": 0})
        decisions = await _db.gr_decisions.find({"issue_id": iid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        room = await _db.hi_rooms.find_one({"id": issue.get("room_id")}, {"_id": 0, "name": 1, "room_type": 1}) if issue.get("room_id") else None
        asset = await _db.hi_assets.find_one({"id": issue.get("asset_id")}, {"_id": 0, "name": 1, "category": 1}) if issue.get("asset_id") else None
        return {"issue": issue, "evidence": [_clean_evidence(e) for e in evidence], "assessment": assessment,
                "questions": questions, "plan": plan, "position": position, "decisions": decisions,
                "room": room, "asset": asset}

    @r.put("/issues/{iid}")
    async def update_issue(iid: str, req: IssueUpdateReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        upd = {}
        if req.description is not None:
            upd["description"] = req.description.strip()[:4000]
        if req.category is not None and req.category in CATEGORIES:
            upd["category"] = req.category
        if req.room_id is not None:
            upd["room_id"] = req.room_id
        if req.asset_id is not None:
            upd["asset_id"] = req.asset_id
        if req.urgency is not None and req.urgency in URGENCIES:
            upd["urgency"] = req.urgency
        if req.status in ("draft", "submitted"):
            upd["status"] = req.status
        # Re-run triage if the description changed.
        if "description" in upd or "category" in upd:
            triage = _triage(upd.get("description", issue["description"]), upd.get("category", issue["category"]))
            upd["triage"] = triage
            upd["risk_flags"] = triage["matched"]
            if triage["hard_stop"]:
                upd["urgency"] = "emergency_review"
                upd["phase"] = "BLOCKED_ESCALATED"
        if upd:
            upd["updated_at"] = _now()
            await _db.gr_issues.update_one({"id": iid}, {"$set": upd})
        return {"issue": {**issue, **upd}}

    @r.delete("/issues/{iid}")
    async def delete_issue(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        await _db.gr_issues.delete_one({"id": iid})
        for coll in (_db.gr_evidence, _db.gr_assessments, _db.gr_questions, _db.gr_plans,
                     _db.gr_positions, _db.gr_decisions, _db.gr_triage, _db.gr_messages):
            await coll.delete_many({"issue_id": iid})
        return {"ok": True}

    @r.post("/issues/{iid}/retriage")
    async def retriage(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        triage = _triage(issue["description"], issue["category"])
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"triage": triage, "risk_flags": triage["matched"], "updated_at": _now()}})
        return {"triage": triage}

    # ---------------- Evidence Workspace ----------------
    @r.post("/issues/{iid}/evidence")
    async def add_evidence(iid: str, req: EvidenceReq, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        if req.type not in EVIDENCE_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported evidence type. Accepted: photo, video, audio, document, measurement, observation.")
        doc = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "type": req.type,
               "note": (req.note or "").strip()[:1000] or None, "value": req.value, "unit": req.unit,
               "base64": req.base64, "_had_media": bool(req.base64), "created_at": _now()}
        await _db.gr_evidence.insert_one(dict(doc))
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"updated_at": _now()}})
        await _cap(user["id"], "issue.evidence_uploaded", {"type": req.type})
        return {"evidence": _clean_evidence({k: v for k, v in doc.items() if k != "_id"})}

    @r.get("/issues/{iid}/evidence")
    async def list_evidence(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_evidence.find({"issue_id": iid}, {"_id": 0, "base64": 0}).sort("created_at", -1).to_list(200)
        return {"evidence": [_clean_evidence(e) for e in rows]}

    @r.delete("/evidence/{eid}")
    async def delete_evidence(eid: str, user: dict = Depends(get_current_user)):
        e = await _db.gr_evidence.find_one({"id": eid, "user_id": user["id"]}, {"_id": 0, "base64": 0})
        if not e:
            raise HTTPException(status_code=404, detail="Evidence not found.")
        await _db.gr_evidence.delete_one({"id": eid})
        return {"ok": True}

    # ---------------- Assessment ----------------
    @r.post("/issues/{iid}/assess")
    async def assess(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        assessment = await _generate_assessment(issue)
        version = (issue.get("assessment_version") or 0) + 1
        doc = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "version": version,
               **assessment, "created_at": _now()}
        await _db.gr_assessments.insert_one(dict(doc)); doc.pop("_id", None)
        new_phase = issue.get("phase")
        if issue.get("phase") in ("ISSUE_REPORTED", "ASSESSMENT", "INFORMATION_NEEDED"):
            new_phase = "INFORMATION_NEEDED" if assessment["missing_information"] else "ASSESSMENT"
            if assessment["recommended_path"] == "escalate":
                new_phase = "BLOCKED_ESCALATED"
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"assessment_version": version, "phase": new_phase, "updated_at": _now()}})
        issue = {**issue, "assessment_version": version, "phase": new_phase}
        # Auto-generate up to 3 targeted questions from missing_information.
        existing_open = await _db.gr_questions.count_documents({"issue_id": iid, "status": "open"})
        created_q = []
        for prompt in _default_questions(assessment):
            if existing_open + len(created_q) >= 3:
                break
            q = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "prompt": prompt,
                 "kind": "text", "status": "open", "answer": None, "created_at": _now()}
            await _db.gr_questions.insert_one(dict(q)); q.pop("_id", None)
            created_q.append(q)
        if created_q:
            await _cap(user["id"], "issue.evidence_requested", {"count": len(created_q)})
        await _rebuild_position(issue, assessment)
        await _cap(user["id"], "issue.assessment_generated", {"version": version, "confidence": assessment["confidence_level"], "risk": assessment["risk_level"]})
        if assessment["confidence_level"] == "uncertain" or assessment["professional_verification_required"]:
            await _queue_quality(issue, "low_confidence_or_professional_review",
                                 {"confidence": assessment["confidence_level"], "path": assessment["recommended_path"]})
        return {"assessment": doc, "questions": created_q}

    @r.get("/issues/{iid}/assessments")
    async def assessment_history(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_assessments.find({"issue_id": iid}, {"_id": 0}).sort("version", -1).to_list(50)
        return {"assessments": rows}

    @r.post("/issues/{iid}/assessment/viewed")
    async def assessment_viewed(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        await _cap(user["id"], "issue.assessment_viewed", {})
        return {"ok": True}

    # ---------------- Progressive Questions ----------------
    @r.get("/issues/{iid}/questions")
    async def list_questions(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_questions.find({"issue_id": iid}, {"_id": 0}).sort("created_at", 1).to_list(50)
        return {"questions": rows, "open_count": len([q for q in rows if q["status"] == "open"])}

    @r.post("/questions/{qid}/answer")
    async def answer_question(qid: str, req: AnswerReq, user: dict = Depends(get_current_user)):
        q = await _db.gr_questions.find_one({"id": qid, "user_id": user["id"]}, {"_id": 0})
        if not q:
            raise HTTPException(status_code=404, detail="Question not found.")
        await _db.gr_questions.update_one({"id": qid}, {"$set": {"status": "answered", "answer": req.answer.strip()[:1000], "answered_at": _now()}})
        # Answers become evidence (observations) so the project remembers.
        await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": q["issue_id"], "user_id": user["id"],
                                          "type": "observation", "note": f"Q: {q['prompt']} — A: {req.answer.strip()[:800]}",
                                          "value": None, "unit": None, "base64": None, "_had_media": False, "created_at": _now()})
        await _cap(user["id"], "issue.evidence_uploaded", {"type": "answer"})
        return {"ok": True}

    # ---------------- Repair Conversation ----------------
    @r.get("/issues/{iid}/messages")
    async def list_messages(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_messages.find({"issue_id": iid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"messages": rows}

    @r.post("/issues/{iid}/chat")
    async def chat(iid: str, req: ChatReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        text = (req.text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Type your question first.")
        um = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "role": "user", "text": text[:2000], "created_at": _now()}
        await _db.gr_messages.insert_one(dict(um))
        # Emergency short-circuit re-check on the live message too.
        live = _triage(text, issue.get("category"))
        if live["hard_stop"]:
            reply = f"⚠️ {live['message']} I can't safely guide you through this one."
            am = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "role": "assistant",
                  "text": reply, "emergency": True, "created_at": _now()}
            await _db.gr_messages.insert_one(dict(am)); am.pop("_id", None)
            return {"assistant": am}
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        ev = await _evidence_summary(iid)
        hist = await _db.gr_messages.find({"issue_id": iid}, {"_id": 0, "role": 1, "text": 1}).sort("created_at", -1).to_list(9)
        hist = list(reversed(hist))[:-1]
        hist_text = "\n".join(f"{m['role']}: {m['text']}" for m in hist if m.get("text"))
        system = (
            "You are Homie, a calm project leader guiding a home repair. Lead with a concise assessment and the single "
            "best next action — no lectures, no filler. Use the homeowner's own words. Say plainly when there isn't "
            "enough evidence; never fake certainty. If the homeowner's proposed fix is premature, unsafe or inferior, "
            "say so kindly and explain what to verify first (e.g. 'I see why you'd seal that crack, but I wouldn't start "
            "there — let's find the water source first'). Never give hazardous step detail; recommend a professional for "
            "gas, major electrical, structural or roofing-at-height. Never claim code/permit/warranty compliance. "
            "Keep it to a short, direct answer."
        )
        ctx = (f"REPAIR CATEGORY: {issue.get('category')}\nHOMEOWNER ISSUE: {issue.get('description')}\n"
               f"CURRENT ASSESSMENT: {assessment.get('issue_summary') if assessment else '(not generated yet)'}\n"
               f"SAFE NEXT ACTION ON FILE: {assessment.get('safe_next_action') if assessment else '(none)'}\n"
               f"EVIDENCE:\n{ev}\n\nRECENT CONVERSATION:\n{hist_text or '(none)'}\n\nHOMEOWNER MESSAGE: {text}")
        try:
            data = await _llm_json(
                system + " Return STRICT JSON {\"reply\": string, \"suggested_next_action\": string or null}.",
                ctx, max_tokens=600, feature_area="guided_repair_chat")
            reply = (data.get("reply") if isinstance(data, dict) else None) or "Let's take one clear photo of the affected area so I can help precisely."
            nxt = data.get("suggested_next_action") if isinstance(data, dict) else None
        except Exception as e:
            if _logger:
                _logger.warning(f"repair chat failed: {e}")
            reply, nxt = "I'm having trouble responding right now — please try again in a moment.", None
        am = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "role": "assistant", "text": reply[:2000],
              "suggested_next_action": (str(nxt)[:300] if nxt else None), "emergency": False, "created_at": _now()}
        await _db.gr_messages.insert_one(dict(am)); am.pop("_id", None)
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"updated_at": _now()}})
        return {"assistant": am}

    # ---------------- Repair Plan ----------------
    @r.post("/issues/{iid}/plan")
    async def create_plan(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        if issue.get("triage", {}).get("hard_stop"):
            raise HTTPException(status_code=409, detail="This issue has an active safety hold — we can't create a DIY plan. Please follow the safety guidance and contact a professional.")
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if not assessment:
            raise HTTPException(status_code=400, detail="Generate an assessment first so the plan is grounded in evidence.")
        ev = await _evidence_summary(iid)
        system = (
            "You are Homie creating a safe, ordered REPAIR PLAN grounded ONLY in the assessment and evidence provided. "
            "Do NOT invent material quantities, prices, retailers or product recommendations. If a step is unsafe or "
            "needs a professional, mark it and stop there. Return STRICT JSON with keys: objective (string), "
            "safety_notes (array of short strings), difficulty (one of beginner, intermediate, advanced, "
            "professional_review), time_estimate (short human range like '1-2 hours'), stop_escalate_conditions "
            "(array), tools_materials (array of {name, kind in [tool, material], essential boolean}), tasks (ordered "
            "array, each {title, what_to_do, why_it_matters, preconditions (string), tools (array of names), "
            "verification_before_proceeding, safety_caution (string or null), expected_result (string), "
            "completion_criteria, if_result_differs, checkpoint {mode in [none, advisory, required, stop], needs "
            "(array subset of [confirmation, photo, measurement, observation]), description}}). Add a 'required' or "
            "'stop' checkpoint to any task with material risk, uncertainty, or a downstream dependency. Keep tasks "
            "small and sequential."
        )
        ctx = (f"OBJECTIVE: {issue.get('description')}\nCATEGORY: {issue.get('category')}\n"
               f"ASSESSMENT SUMMARY: {assessment.get('issue_summary')}\n"
               f"RECOMMENDED PATH: {assessment.get('recommended_path')}\n"
               f"DIY BOUNDARY: {assessment.get('DIY_boundary')}\n"
               f"POSSIBLE CAUSES: {[c['cause'] for c in assessment.get('possible_causes', [])]}\n"
               f"PROFESSIONAL VERIFICATION REQUIRED: {assessment.get('professional_verification_required')}\n"
               f"EVIDENCE:\n{ev}")
        try:
            data = await _llm_json(system, ctx, max_tokens=1600, feature_area="guided_repair_plan")
            if not isinstance(data, dict):
                raise ValueError("bad JSON")
        except Exception as e:
            if _logger:
                _logger.warning(f"repair plan AI failed: {e}")
            data = {"objective": issue.get("description"),
                    "safety_notes": ["If anything feels unsafe, stop and consult a professional."],
                    "difficulty": "intermediate", "time_estimate": "Varies",
                    "stop_escalate_conditions": ["The problem worsens or a hidden hazard appears."],
                    "tasks": [{"title": "Document the affected area", "what_to_do": "Take clear wide and close-up photos.",
                               "why_it_matters": "Creates a baseline before any change.",
                               "verification_before_proceeding": "Photos are clear and in focus.",
                               "safety_caution": None, "completion_criteria": "Photos saved to this issue.",
                               "if_result_differs": "Note anything unexpected and re-assess."}]}
        tasks = []
        for i, t in enumerate(data.get("tasks") or []):
            if not isinstance(t, dict):
                continue
            cp = t.get("checkpoint") if isinstance(t.get("checkpoint"), dict) else {}
            mode = cp.get("mode") if cp.get("mode") in ("none", "advisory", "required", "stop") else "none"
            needs = [n for n in (cp.get("needs") or []) if n in ("confirmation", "photo", "measurement", "observation")][:4]
            if mode in ("required", "stop") and not needs:
                needs = ["confirmation"]
            tasks.append({
                "id": _nid(), "order": i + 1, "title": str(t.get("title") or f"Step {i+1}")[:200],
                "what_to_do": str(t.get("what_to_do") or "")[:800],
                "why_it_matters": str(t.get("why_it_matters") or "")[:500],
                "preconditions": str(t.get("preconditions") or "")[:400] or None,
                "tools": [str(x)[:80] for x in (t.get("tools") or []) if x][:12],
                "verification_before_proceeding": str(t.get("verification_before_proceeding") or "")[:500],
                "safety_caution": (str(t.get("safety_caution"))[:400] if t.get("safety_caution") else None),
                "expected_result": str(t.get("expected_result") or "")[:400] or None,
                "completion_criteria": str(t.get("completion_criteria") or "")[:500],
                "if_result_differs": str(t.get("if_result_differs") or "")[:500],
                "checkpoint": {"mode": mode, "needs": needs, "description": str(cp.get("description") or "")[:400] or None},
                "checkpoint_satisfied": False,
                "status": "pending",
            })
        if tasks:
            tasks[0]["status"] = "available"
        # Consolidated tools & materials list (statuses tracked during execution).
        mats = []
        seen = set()
        for m in (data.get("tools_materials") or []):
            if not isinstance(m, dict):
                continue
            name = str(m.get("name") or "").strip()[:120]
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            mats.append({"name": name, "kind": (m.get("kind") if m.get("kind") in ("tool", "material") else "material"),
                         "essential": bool(m.get("essential")), "status": "unknown", "substitute_note": None})
        version = (issue.get("plan_version") or 0) + 1
        diff = data.get("difficulty") if data.get("difficulty") in DIFFICULTIES else "intermediate"
        plan = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "version": version,
                "objective": str(data.get("objective") or issue.get("description"))[:600],
                "safety_notes": [str(x)[:300] for x in (data.get("safety_notes") or [])][:8],
                "difficulty": diff, "time_estimate": str(data.get("time_estimate") or "Varies")[:80],
                "stop_escalate_conditions": [str(x)[:300] for x in (data.get("stop_escalate_conditions") or [])][:8],
                "tools_materials": mats[:30],
                "tasks": tasks, "status": "active", "created_at": _now()}
        await _db.gr_plans.insert_one(dict(plan)); plan.pop("_id", None)
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"plan_version": version, "phase": "PLAN_READY", "updated_at": _now()}})
        issue = {**issue, "plan_version": version, "phase": "PLAN_READY"}
        await _rebuild_position(issue, assessment, plan)
        await _cap(user["id"], "repair_plan.created", {"version": version, "difficulty": diff, "tasks": len(tasks)})
        return {"plan": plan}

    @r.get("/issues/{iid}/plan")
    async def get_plan(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if not plan:
            raise HTTPException(status_code=404, detail="No plan yet.")
        return {"plan": plan}

    @r.get("/issues/{iid}/plans")
    async def plan_history(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_plans.find({"issue_id": iid}, {"_id": 0}).sort("version", -1).to_list(50)
        return {"plans": rows}

    # ---------------- Reality-check / Replan loop ----------------
    @r.post("/plan-tasks/{task_id}/action")
    async def task_action(task_id: str, req: TaskActionReq, user: dict = Depends(get_current_user)):
        if req.action not in ("done", "found_different", "need_help", "did_not_work", "pause", "start", "resume"):
            raise HTTPException(status_code=400, detail="Invalid action.")
        plan = await _db.gr_plans.find_one({"tasks.id": task_id, "user_id": user["id"]}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=404, detail="Task not found.")
        issue = await _owned_issue(plan["issue_id"], user["id"])
        tasks = plan["tasks"]
        idx = next((i for i, t in enumerate(tasks) if t["id"] == task_id), None)
        cur = tasks[idx]
        # Cannot silently skip an unmet prerequisite.
        if req.action in ("start", "done") and cur["status"] == "pending":
            prior_open = [t for t in tasks[:idx] if t["status"] not in ("complete", "superseded")]
            if prior_open:
                raise HTTPException(status_code=409, detail=f"Finish the earlier step first: {prior_open[0]['title']}")

        def _save_evidence(kind_note):
            return _db.gr_evidence.insert_one({"id": _nid(), "issue_id": issue["id"], "user_id": user["id"],
                                               "type": ("photo" if req.base64 else "observation"),
                                               "note": kind_note, "value": None, "unit": None,
                                               "base64": req.base64, "_had_media": bool(req.base64), "created_at": _now()})

        if req.action in ("start", "resume"):
            cur["status"] = "in_progress"
            await _db.gr_plans.update_one({"id": plan["id"]}, {"$set": {"tasks": tasks}})
            await _cap(user["id"], "repair_task.started", {"task": cur["title"]})
            await _log_event(issue["id"], task_id, "repair_task.started", user["id"], {"title": cur["title"]})
            await _db.gr_issues.update_one({"id": issue["id"]}, {"$set": {"phase": "IN_PROGRESS", "status": "active", "updated_at": _now()}})
            await _db.gr_exec_sessions.update_one({"issue_id": issue["id"]}, {"$set": {"status": "active", "updated_at": _now()}})
            return {"ok": True, "task_status": "in_progress"}

        if req.action == "done":
            cp = cur.get("checkpoint") or {}
            # Evidence-backed checkpoint gating: required/stop checkpoints must be satisfied first.
            if cp.get("mode") in ("required", "stop") and not cur.get("checkpoint_satisfied"):
                cur["status"] = "awaiting_verification"
                await _db.gr_plans.update_one({"id": plan["id"]}, {"$set": {"tasks": tasks}})
                await _cap(user["id"], "repair_task.checkpoint_requested", {"task": cur["title"], "mode": cp["mode"]})
                await _log_event(issue["id"], task_id, "repair_task.checkpoint_requested", user["id"], {"mode": cp["mode"]})
                return {"ok": True, "task_status": "awaiting_verification", "needs_checkpoint": True, "checkpoint": cp,
                        "message": "This step needs a quick verification before we move on."}
            cur["status"] = "complete"
            nxt = next((t for t in tasks[idx + 1:] if t["status"] == "pending"), None)
            if nxt:
                nxt["status"] = "available"
            await _db.gr_plans.update_one({"id": plan["id"]}, {"$set": {"tasks": tasks}})
            if req.note or req.base64:
                await _save_evidence(f"Completed '{cur['title']}': {req.note or 'done'}")
            await _cap(user["id"], "repair_task.completed", {"task": cur["title"]})
            await _log_event(issue["id"], task_id, "repair_task.completed", user["id"], {"title": cur["title"]})
            all_done = all(t["status"] in ("complete", "superseded") for t in tasks)
            if all_done:
                await _db.gr_issues.update_one({"id": issue["id"]}, {"$set": {"phase": "VERIFICATION", "updated_at": _now()}})
            return {"ok": True, "task_status": "complete", "all_done": all_done}

        if req.action == "need_help":
            help_text = ("Re-read the step, confirm you have what it lists, and check the verification note before "
                         "proceeding. If anything involves gas, major electrical, structural work or feels unsafe, it's "
                         "okay to stop and call a professional.")
            if cur.get("safety_caution"):
                help_text = f"Safety first: {cur['safety_caution']} " + help_text
            await _cap(user["id"], "repair_task.help_requested", {"task": cur["title"]})
            await _log_event(issue["id"], task_id, "repair_task.help_requested", user["id"], {})
            return {"ok": True, "help": help_text,
                    "verification": cur.get("verification_before_proceeding"),
                    "safe_to_stop": True}

        if req.action == "pause":
            await _db.gr_issues.update_one({"id": issue["id"]}, {"$set": {"status": "paused", "updated_at": _now()}})
            await _db.gr_exec_sessions.update_one({"issue_id": issue["id"]}, {"$set": {"status": "paused", "paused_at": _now(), "updated_at": _now()}})
            await _cap(user["id"], "repair_task.paused", {"task": cur["title"]})
            await _log_event(issue["id"], task_id, "repair_task.paused", user["id"], {})
            return {"ok": True, "issue_status": "paused"}

        # found_different / did_not_work  -> record reality, revise, preserve history
        cur["status"] = "blocked" if req.action == "did_not_work" else "superseded"
        await _db.gr_plans.update_one({"id": plan["id"]}, {"$set": {"tasks": tasks, "status": "revised"}})
        note = req.note or ("The step didn't produce the expected result." if req.action == "did_not_work"
                            else "Found something different than expected.")
        await _save_evidence(f"Reality-check on '{cur['title']}': {note}")
        await _cap(user["id"], "repair_task.blocked", {"task": cur["title"], "action": req.action})
        await _cap(user["id"], "repair_plan.replan_requested", {"trigger": req.action})
        await _log_event(issue["id"], task_id, "repair_task.blocked", user["id"], {"action": req.action, "note": note})
        # Record the change as a decision (original recommendation preserved, now superseded).
        await _db.gr_decisions.insert_one({"id": _nid(), "issue_id": issue["id"], "user_id": user["id"],
                                           "decision": f"Original step: {cur['title']}", "status": "superseded",
                                           "reason": note, "evidence": None, "confidence": None,
                                           "made_by": "user", "created_at": _now()})
        # Re-assess with the new evidence and update phase + position.
        issue = {**issue, "phase": "ASSESSMENT"}
        new_assessment = await _generate_assessment(issue)
        version = (issue.get("assessment_version") or 0) + 1
        adoc = {"id": _nid(), "issue_id": issue["id"], "user_id": user["id"], "version": version,
                **new_assessment, "revised_from_reality_check": True, "created_at": _now()}
        await _db.gr_assessments.insert_one(dict(adoc)); adoc.pop("_id", None)
        new_phase = "BLOCKED_ESCALATED" if new_assessment["recommended_path"] == "escalate" else "PLAN_READY"
        await _db.gr_issues.update_one({"id": issue["id"]}, {"$set": {"assessment_version": version, "phase": new_phase, "updated_at": _now()}})
        issue = {**issue, "assessment_version": version, "phase": new_phase}
        await _rebuild_position(issue, new_assessment, plan)
        await _cap(user["id"], "repair_plan.revised", {"trigger": req.action})
        await _queue_quality(issue, "repair_reality_mismatch", {"action": req.action, "task": cur["title"]})
        return {"ok": True, "task_status": cur["status"], "revised": True,
                "message": "That changes the plan. I've recorded what you found, kept the original recommendation on record, and re-assessed the safer path.",
                "assessment": adoc}

    # ---------------- Guided Execution (Build Doc 3) ----------------
    @r.post("/issues/{iid}/start")
    async def start_project(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        if issue.get("triage", {}).get("hard_stop"):
            raise HTTPException(status_code=409, detail="This issue has an active safety hold — please follow the safety guidance and contact a professional.")
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if not plan:
            raise HTTPException(status_code=400, detail="Create a repair plan first.")
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        session = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "status": "active",
                   "plan_version": plan["version"], "started_at": _now(), "updated_at": _now()}
        await _db.gr_exec_sessions.update_one({"issue_id": iid}, {"$set": session}, upsert=True)
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"phase": "IN_PROGRESS", "status": "active", "updated_at": _now()}})
        await _cap(user["id"], "project.execution_started", {"plan_version": plan["version"]})
        await _log_event(iid, None, "project.execution_started", user["id"], {})
        first = next((t for t in plan["tasks"] if t["status"] not in ("complete", "superseded")), None)
        briefing = {
            "objective": plan["objective"],
            "known_condition": assessment.get("issue_summary") if assessment else issue.get("description"),
            "safety_boundary": (assessment.get("DIY_boundary") if assessment else None) or (plan["safety_notes"][0] if plan.get("safety_notes") else None),
            "effort": f"{plan.get('difficulty', '').replace('_', ' ')} · {plan.get('time_estimate', 'Varies')}",
            "first_task": ({"id": first["id"], "title": first["title"], "what_to_do": first["what_to_do"]} if first else None),
        }
        return {"session": session, "briefing": briefing, "progress": _progress_summary(plan)}

    @r.get("/issues/{iid}/session")
    async def get_session(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        session = await _db.gr_exec_sessions.find_one({"issue_id": iid}, {"_id": 0})
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        progress = _progress_summary(plan)
        resume = None
        if session and session.get("status") == "paused" and plan:
            blocked = [t["title"] for t in plan["tasks"] if t["status"] == "blocked"]
            resume = {"current_task": progress["current_task"],
                      "unfinished": progress["remaining"], "blocked": blocked,
                      "safety_reminder": (plan["safety_notes"][0] if plan.get("safety_notes") else None),
                      "note": "Welcome back — here's where you left off. Re-check anything that may have changed since you paused."}
        return {"session": session, "progress": progress, "resume_briefing": resume}

    @r.post("/issues/{iid}/session-action")
    async def session_action(iid: str, req: SessionActionReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        if req.action not in ("pause", "resume", "archive", "professional_handoff"):
            raise HTTPException(status_code=400, detail="Invalid session action.")
        smap = {"pause": ("paused", "paused"), "resume": ("active", "active"),
                "archive": ("archived", "archived"), "professional_handoff": ("professional_help", "pro_handoff")}
        sstatus, istatus = smap[req.action]
        await _db.gr_exec_sessions.update_one({"issue_id": iid}, {"$set": {"status": sstatus, "updated_at": _now(), **({"paused_at": _now()} if req.action == "pause" else {})}}, upsert=True)
        iupd = {"status": istatus, "updated_at": _now()}
        if req.action == "professional_handoff":
            iupd["phase"] = "BLOCKED_ESCALATED"
            await _cap(user["id"], "project.professional_handoff_selected", {})
            await _queue_quality(issue, "execution_professional_handoff", {"note": (req.note or "")[:300]})
        await _db.gr_issues.update_one({"id": iid}, {"$set": iupd})
        await _log_event(iid, None, f"session.{req.action}", user["id"], {})
        return {"ok": True, "session_status": sstatus, "issue_status": istatus}

    @r.get("/issues/{iid}/progress")
    async def get_progress(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        pos = await _db.gr_positions.find_one({"issue_id": iid}, {"_id": 0})
        prog = _progress_summary(plan)
        prog["next_recommended_action"] = pos.get("next_recommended_action") if pos else None
        return {"progress": prog}

    @r.get("/issues/{iid}/events")
    async def list_events(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_task_events.find({"issue_id": iid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"events": rows}

    @r.post("/plan-tasks/{task_id}/coach")
    async def task_coach(task_id: str, req: CoachReq, user: dict = Depends(get_current_user)):
        prompt = (req.prompt or "").strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="Ask a question first.")
        plan = await _db.gr_plans.find_one({"tasks.id": task_id, "user_id": user["id"]}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=404, detail="Task not found.")
        issue = await _owned_issue(plan["issue_id"], user["id"])
        cur = next((t for t in plan["tasks"] if t["id"] == task_id), None)
        await _cap(user["id"], "repair_task.help_requested", {"task": cur["title"]})
        live = _triage(prompt, issue.get("category"))
        if live["hard_stop"]:
            return {"reply": f"⚠️ {live['message']} Please stop this step and get the right help.", "emergency": True}
        assessment = await _db.gr_assessments.find_one({"issue_id": issue["id"]}, {"_id": 0}, sort=[("version", -1)])
        system = (
            "You are Homie, a calm adaptive project coach helping a homeowner DURING a specific repair task. Answer the "
            "immediate question FIRST, then a short sequential next step. Distinguish verified facts from assumptions. "
            "Restate the task's safety constraint at the point of use. NEVER push the user past an unmet prerequisite. "
            "If risk or uncertainty rises, recommend pausing or a professional. Keep it concise and practical. "
            "Return STRICT JSON {\"reply\": string, \"recommend_pause\": boolean}."
        )
        ctx = (f"TASK: {cur['title']}\nWHAT TO DO: {cur.get('what_to_do')}\nSAFETY CAUTION: {cur.get('safety_caution')}\n"
               f"COMPLETION CRITERIA: {cur.get('completion_criteria')}\nEXPECTED RESULT: {cur.get('expected_result')}\n"
               f"PROJECT: {issue.get('description')} (category {issue.get('category')})\n"
               f"ASSESSMENT: {assessment.get('issue_summary') if assessment else '(none)'}\n"
               f"HOMEOWNER ASKS: {prompt}")
        try:
            data = await _llm_json(system, ctx, max_tokens=500, feature_area="guided_repair_coach")
            reply = (data.get("reply") if isinstance(data, dict) else None) or "Let's take this one step at a time — tell me what you're seeing."
            pause = bool(data.get("recommend_pause")) if isinstance(data, dict) else False
        except Exception:
            reply, pause = "I'm having trouble right now — please try again in a moment.", False
        return {"reply": reply[:1500], "recommend_pause": pause, "emergency": False}

    @r.post("/plan-tasks/{task_id}/checkpoint")
    async def submit_checkpoint(task_id: str, req: CheckpointReq, user: dict = Depends(get_current_user)):
        plan = await _db.gr_plans.find_one({"tasks.id": task_id, "user_id": user["id"]}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=404, detail="Task not found.")
        issue = await _owned_issue(plan["issue_id"], user["id"])
        tasks = plan["tasks"]
        idx = next((i for i, t in enumerate(tasks) if t["id"] == task_id), None)
        cur = tasks[idx]
        cp = cur.get("checkpoint") or {"mode": "advisory", "needs": []}
        needs = cp.get("needs") or []
        # Never fabricate verification — require what the checkpoint asks for.
        missing = []
        if "photo" in needs and not req.base64:
            missing.append("a photo")
        if "measurement" in needs and req.value is None:
            missing.append("a measurement")
        if "observation" in needs and not (req.observation or "").strip():
            missing.append("an observation")
        if "confirmation" in needs and not req.confirmation:
            missing.append("your confirmation")
        satisfied = len(missing) == 0
        sub = {"id": _nid(), "task_id": task_id, "issue_id": issue["id"], "user_id": user["id"],
               "confirmation": req.confirmation, "note": (req.note or "")[:600] or None,
               "value": req.value, "unit": req.unit, "observation": (req.observation or "")[:600] or None,
               "has_media": bool(req.base64), "satisfied": satisfied, "created_at": _now()}
        await _db.gr_checkpoint_submissions.insert_one(dict(sub)); sub.pop("_id", None)
        # File the submission as evidence too.
        if req.base64 or req.value is not None or (req.observation or "").strip() or (req.note or "").strip():
            etype = "photo" if req.base64 else ("measurement" if req.value is not None else "observation")
            await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": issue["id"], "user_id": user["id"], "type": etype,
                                              "note": f"Checkpoint '{cur['title']}': {req.observation or req.note or 'submitted'}",
                                              "value": req.value, "unit": req.unit, "base64": req.base64,
                                              "_had_media": bool(req.base64), "created_at": _now()})
        await _cap(user["id"], "repair_task.checkpoint_submitted", {"task": cur["title"], "satisfied": satisfied})
        await _log_event(issue["id"], task_id, "repair_task.checkpoint_submitted", user["id"], {"satisfied": satisfied})
        result = {"ok": True, "satisfied": satisfied, "missing": missing}
        if not satisfied:
            return result
        cur["checkpoint_satisfied"] = True
        needs_review = cp.get("mode") == "stop"
        if cur["status"] in ("awaiting_verification", "in_progress", "available", "pending"):
            cur["status"] = "complete"
            nxt = next((t for t in tasks[idx + 1:] if t["status"] == "pending"), None)
            if nxt:
                nxt["status"] = "available"
        await _db.gr_plans.update_one({"id": plan["id"]}, {"$set": {"tasks": tasks}})
        all_done = all(t["status"] in ("complete", "superseded") for t in tasks)
        if all_done:
            await _db.gr_issues.update_one({"id": issue["id"]}, {"$set": {"phase": "VERIFICATION", "updated_at": _now()}})
        result.update({"task_status": cur["status"], "all_done": all_done, "needs_homie_review": needs_review})
        return result

    @r.post("/issues/{iid}/materials")
    async def mark_material(iid: str, req: MaterialReq, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        if req.status not in ("available", "unavailable", "borrowed", "substituted", "unknown"):
            raise HTTPException(status_code=400, detail="Invalid material status.")
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if not plan:
            raise HTTPException(status_code=404, detail="No plan yet.")
        mats = plan.get("tools_materials") or []
        found = False
        for m in mats:
            if m["name"].lower() == req.name.strip().lower():
                m["status"] = req.status
                m["substitute_note"] = (req.substitute_note or "").strip()[:300] or None
                found = True
                break
        if not found:
            mats.append({"name": req.name.strip()[:120], "kind": "material", "essential": False,
                         "status": req.status, "substitute_note": (req.substitute_note or "").strip()[:300] or None})
        await _db.gr_plans.update_one({"id": plan["id"]}, {"$set": {"tools_materials": mats}})
        return {"tools_materials": mats}

    @r.post("/issues/{iid}/verify-start")
    async def verify_start(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        blocking = []
        if plan:
            for t in plan["tasks"]:
                if t["status"] in ("blocked", "awaiting_verification"):
                    blocking.append(t["title"])
                elif t["status"] not in ("complete", "superseded"):
                    blocking.append(t["title"])
        ready = len(blocking) == 0
        if ready:
            await _db.gr_issues.update_one({"id": iid}, {"$set": {"phase": "VERIFICATION", "updated_at": _now()}})
            await _cap(user["id"], "project.verification_started", {})
        return {"ok": True, "ready": ready, "blocking": blocking[:10],
                "message": None if ready else "Finish or waive the remaining steps before verifying the outcome."}


    # ---------------- Decision Ledger ----------------
    @r.get("/issues/{iid}/decisions")
    async def list_decisions(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_decisions.find({"issue_id": iid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"decisions": rows}

    @r.post("/issues/{iid}/decisions")
    async def add_decision(iid: str, req: DecisionReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        if req.status not in DECISION_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid decision status.")
        d = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "decision": req.decision.strip()[:300],
             "status": req.status, "reason": (req.reason or "").strip()[:600] or None,
             "evidence": req.evidence, "confidence": req.confidence, "made_by": req.made_by, "created_at": _now()}
        await _db.gr_decisions.insert_one(dict(d)); d.pop("_id", None)
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if assessment:
            await _rebuild_position(issue, assessment)
        return {"decision": d}

    @r.put("/decisions/{did}")
    async def update_decision(did: str, req: DecisionUpdateReq, user: dict = Depends(get_current_user)):
        d = await _db.gr_decisions.find_one({"id": did, "user_id": user["id"]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Decision not found.")
        if req.status not in DECISION_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid decision status.")
        upd = {"status": req.status, "updated_at": _now()}
        if req.reason is not None:
            upd["reason"] = req.reason.strip()[:600]
        await _db.gr_decisions.update_one({"id": did}, {"$set": upd})
        return {"ok": True}

    # ---------------- Project Position ----------------
    @r.get("/issues/{iid}/position")
    async def get_position(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        pos = await _db.gr_positions.find_one({"issue_id": iid}, {"_id": 0})
        if not pos:
            raise HTTPException(status_code=404, detail="No project position yet — generate an assessment first.")
        return {"position": pos}

    # ---------------- Outcome / Closeout (Build Doc 3 + 4) ----------------
    @r.post("/issues/{iid}/complete")
    async def complete(iid: str, req: CompleteReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        # Resolve outcome status (backward compatible with the simple resolved flag).
        status = req.outcome_status if req.outcome_status in OUTCOME_STATUSES else ("resolved" if req.resolved else "unresolved")
        is_resolved = status in _RESOLVED_OUTCOMES
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        decisions = await _db.gr_decisions.find({"issue_id": iid}, {"_id": 0}).to_list(200)
        # "Completed" is not the same as "resolved": unresolved stays active; abandoned is documented.
        if status == "unresolved":
            issue_status, phase = "active", "VERIFICATION"
        elif status == "abandoned":
            issue_status, phase = "abandoned", "DOCUMENTED"
        else:
            issue_status, phase = "completed", "DOCUMENTED"
        if req.base64:
            await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"], "type": "photo",
                                              "note": "Final outcome photo", "value": None, "unit": None,
                                              "base64": req.base64, "_had_media": True, "created_at": _now()})
        await _db.gr_issues.update_one({"id": iid}, {"$set": {
            "phase": phase, "status": issue_status, "outcome_status": status,
            "outcome_note": (req.outcome_note or "").strip()[:1000] or None,
            "resolved": is_resolved, "outcome_rating": req.rating, "completed_at": _now(), "updated_at": _now()}})
        # Structured closeout record (durable, never overwrites history).
        materials_used = [m["name"] for m in (plan.get("tools_materials") if plan else []) if m.get("status") in ("available", "borrowed", "substituted")]
        outcome = {
            "id": _nid(), "issue_id": iid, "user_id": user["id"], "property_id": issue.get("property_id"),
            "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"), "category": issue.get("category"),
            "objective": (plan.get("objective") if plan else issue.get("description")),
            "outcome_status": status, "work_performed": (req.work_performed or "").strip()[:2000] or None,
            "materials_used": materials_used,
            "key_decisions": [{"decision": d["decision"], "status": d["status"]} for d in decisions][:20],
            "remaining_risks": (assessment.get("missing_information") if assessment else []) or [],
            "confidence_rating": req.rating, "completion_date": _now(),
            "plan_version": (plan.get("version") if plan else None), "created_at": _now(),
        }
        await _db.gr_outcomes.insert_one(dict(outcome)); outcome.pop("_id", None)
        # Follow-up / monitoring actions.
        created_followups = []
        for f in (req.follow_up or [])[:10]:
            if not str(f).strip():
                continue
            fu = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "property_id": issue.get("property_id"),
                  "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"),
                  "what": str(f).strip()[:300], "type": "recheck", "status": "open",
                  "due_at": None, "created_at": _now()}
            await _db.gr_followups.insert_one(dict(fu)); fu.pop("_id", None)
            created_followups.append(fu)
            await _cap(user["id"], "project.follow_up_created", {})
        if req.pro_reference:
            await _db.gr_outcomes.update_one({"id": outcome["id"]}, {"$set": {"pro_reference": req.pro_reference[:500]}})
        # Property timeline entry (metadata only, no media).
        try:
            await _db.gr_timeline.insert_one({
                "id": _nid(), "user_id": user["id"], "property_id": issue.get("property_id"),
                "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"),
                "type": "project_outcome", "provenance": "user_reported",
                "title": (issue.get("description") or "Home repair")[:120],
                "description": f"Outcome: {status.replace('_', ' ')}." + (f" {req.outcome_note[:200]}" if req.outcome_note else ""),
                "category": issue.get("category"), "issue_id": iid, "outcome_id": outcome["id"],
                "outcome_status": status, "created_at": _now()})
        except Exception:
            pass
        await _cap(user["id"], "project.outcome_recorded", {"outcome_status": status, "category": issue.get("category")})
        await _cap(user["id"], "repair_outcome.recorded", {"resolved": is_resolved})
        if is_resolved:
            await _cap(user["id"], "project.completed", {"outcome_status": status, "category": issue.get("category")})
        if status in ("unresolved", "abandoned"):
            await _queue_quality(issue, "execution_low_outcome", {"outcome_status": status, "rating": req.rating})
        return {"ok": True, "phase": phase, "outcome": outcome, "follow_ups": created_followups, "resolved": is_resolved}

    @r.post("/issues/{iid}/feedback")
    async def feedback(iid: str, req: FeedbackReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        rating = max(1, min(5, req.rating))
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"assessment_feedback": {"rating": rating, "comment": (req.comment or "")[:600], "at": _now()}, "updated_at": _now()}})
        await _cap(user["id"], "assessment.feedback_submitted", {"rating": rating, "harmful": req.harmful})
        if req.harmful or rating <= 2:
            await _queue_quality(issue, "user_reported_harmful_or_inaccurate", {"rating": rating, "comment": (req.comment or "")[:300]})
        return {"ok": True}

    return r


# ----------------------------------------------------------------- admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/repair", dependencies=[Depends(require_admin)])

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        total_issues = await _db.gr_issues.count_documents({})
        emergencies = await _db.gr_issues.count_documents({"urgency": "emergency_review"})
        plans = await _db.gr_plans.count_documents({})
        open_quality = await _db.gr_quality_queue.count_documents({"status": "open"})
        by_reason = {}
        for reason in ("emergency_safety_triage", "low_confidence_or_professional_review",
                       "repair_reality_mismatch", "user_reported_harmful_or_inaccurate"):
            by_reason[reason] = await _db.gr_quality_queue.count_documents({"reason": reason, "status": "open"})
        by_cat = {}
        for c in CATEGORIES:
            n = await _db.gr_issues.count_documents({"category": c})
            if n:
                by_cat[c] = n
        return {"total_issues": total_issues, "emergency_reviews": emergencies, "repair_plans": plans,
                "open_quality_items": open_quality, "quality_by_reason": by_reason, "issues_by_category": by_cat}

    @r.get("/quality")
    async def quality_queue(status: str = "open", admin: dict = Depends(require_admin)):
        q = {} if status == "all" else {"status": status}
        rows = await _db.gr_quality_queue.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"items": rows}

    @r.patch("/quality/{qid}")
    async def resolve_quality(qid: str, admin: dict = Depends(require_admin)):
        res = await _db.gr_quality_queue.update_one({"id": qid}, {"$set": {"status": "resolved", "resolved_at": _now(), "resolved_by": admin.get("id")}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Queue item not found.")
        return {"ok": True}

    return r


# ----------------------------------------------------------------- seed / indexes
async def seed_repair():
    if _db is None:
        return
    try:
        await _db.gr_issues.create_index("user_id")
        await _db.gr_evidence.create_index("issue_id")
        await _db.gr_assessments.create_index("issue_id")
        await _db.gr_questions.create_index("issue_id")
        await _db.gr_plans.create_index("issue_id")
        await _db.gr_plans.create_index("tasks.id")
        await _db.gr_positions.create_index("issue_id")
        await _db.gr_decisions.create_index("issue_id")
        await _db.gr_messages.create_index("issue_id")
        await _db.gr_quality_queue.create_index("status")
        await _db.gr_exec_sessions.create_index("issue_id")
        await _db.gr_task_events.create_index("issue_id")
        await _db.gr_checkpoint_submissions.create_index("task_id")
        await _db.gr_outcomes.create_index("user_id")
        await _db.gr_outcomes.create_index("issue_id")
        await _db.gr_followups.create_index("user_id")
        await _db.gr_followups.create_index("status")
        await _db.gr_timeline.create_index("user_id")
        await _db.gr_timeline.create_index([("room_id", 1)])
        await _db.gr_timeline.create_index([("asset_id", 1)])
        await _db.gr_shares.create_index("token")
        if _logger:
            _logger.info("guided repair engine (Build Doc 2/3/4) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"guided repair seed failed: {e}")
