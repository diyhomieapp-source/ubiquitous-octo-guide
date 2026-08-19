"""
Build Doc 43 — Safety, Risk, Escalation & Professional Boundary Foundation.
Central reusable Safety & Risk Engine. Namespace: /api/hi/safety

Extends (does NOT replace): guided_repair _triage hard stops, escalation_engine pro workflow,
admin_ops record_safety_escalation ledger.

- evaluate_action(text, context): deterministic verdict for any task/action:
  allow | allow_with_warning | require_verification | require_additional_evidence |
  block_action | escalate_to_professional
- Risk levels 0-5, action-relevant PPE (never generic disclaimers), stop conditions,
  and a practical next step (never abandon the user).
- sf_events collection stores every non-allow evaluation.
"""
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

_db = None
_logger = None

VERDICTS = ["allow", "allow_with_warning", "require_verification",
            "require_additional_evidence", "block_action", "escalate_to_professional"]

RISK_LEVELS = [
    {"level": 0, "label": "General information", "example": "Choosing paint color"},
    {"level": 1, "label": "Low-risk DIY", "example": "Hanging a picture"},
    {"level": 2, "label": "Standard DIY", "example": "Painting a wall"},
    {"level": 3, "label": "Moderate risk", "example": "Replacing a toilet"},
    {"level": 4, "label": "Elevated risk", "example": "Electrical device replacement"},
    {"level": 5, "label": "Professional boundary", "example": "Gas piping, structural alteration"},
]

# Action-relevant PPE (Doc 43 §6) — only what applies to the current action.
PPE_RULES = [
    (["sand", "sanding", "drywall dust"], ["Safety glasses", "Dust mask or respirator"]),
    (["cut wood", "saw", "circular saw", "jigsaw", "miter"], ["Safety glasses", "Hearing protection"]),
    (["tile", "grout", "cut tile"], ["Safety glasses", "Hearing protection", "Dust control"]),
    (["demolition", "demo ", "tear out", "remove wall"], ["Safety glasses", "Work gloves", "Sturdy footwear", "Respirator"]),
    (["paint", "primer", "stain", "sealant"], ["Ventilation", "Gloves as needed"]),
    (["plumbing", "toilet", "drain", "supply line", "faucet"], ["Work gloves", "Safety glasses"]),
    (["drill", "drive screw", "hammer", "nail"], ["Safety glasses"]),
    (["insulation", "attic", "crawl space"], ["Respirator", "Gloves", "Long sleeves", "Eye protection"]),
    (["chemical", "solvent", "stripper", "epoxy"], ["Chemical-resistant gloves", "Ventilation", "Eye protection"]),
    (["electrical", "outlet", "switch", "wiring", "breaker"], ["Non-contact voltage tester", "Insulated tools", "Safety glasses"]),
    (["ladder", "roof", "gutter", "ceiling"], ["Ladder stabilizer / spotter", "Sturdy footwear"]),
    (["concrete", "masonry", "mortar"], ["Safety glasses", "Gloves", "Dust mask (silica)"]),
    (["caulk", "adhesive"], ["Ventilation"]),
    (["mold", "mildew"], ["N95+ respirator", "Gloves", "Eye protection"]),
]

# Level-5 professional boundaries → block + escalate.
_BLOCK = [
    (["gas line", "gas pipe", "gas leak", "smell gas", "gas fitting", "gas valve replacement"], "gas",
     "Gas work is a licensed-professional boundary. A leak or bad fitting can be catastrophic."),
    (["main panel", "service panel", "meter base", "service entrance", "panel upgrade", "bypass the meter"], "electrical_panel",
     "Main electrical panel and service work must be done by a licensed electrician."),
    (["load bearing", "load-bearing", "remove a wall", "removing the wall", "cut a joist", "notch a joist", "cut the beam", "modify the beam", "remove a beam"], "structural",
     "This may alter a load-bearing element. It needs a qualified professional's verification first."),
    (["fire rated", "fire-rated", "firewall penetration"], "fire_rating",
     "Penetrating a fire-rated assembly requires code-compliant methods verified by a professional."),
    (["asbestos"], "hazmat", "Suspected asbestos requires professional testing and handling — do not disturb it."),
    (["sewage backup", "sewer line collapse"], "sewer", "Raw sewage exposure and main sewer repairs need professional handling."),
]

# Elevated-risk contexts → verification required before proceeding.
_VERIFY = [
    (["drill into wall", "drill into the wall", "cut into wall", "cut into the wall", "cut open the wall", "behind the wall", "behind this wall"], "hidden_utility",
     "Confirm what's behind the surface (stud finder / inspection opening) before drilling or cutting."),
    (["outlet", "switch", "light fixture", "ceiling fan", "wire", "wiring"], "electrical_verify",
     "Turn off the breaker AND verify the circuit is dead with a non-contact tester before touching any wire."),
    (["lead paint", "old paint", "peeling paint"], "lead",
     "Homes built before 1978 may have lead paint. Confirm home age and test before sanding or scraping."),
    (["mold", "black spots", "mildew"], "mold",
     "Confirm the extent of growth. Areas larger than about 10 sq ft need professional remediation."),
    (["roof", "second story ladder", "two story ladder"], "height",
     "Confirm safe access, ladder angle and a spotter before working at height."),
    (["water heater", "furnace", "boiler"], "appliance_fuel",
     "Confirm the fuel type first — gas-fired equipment changes what you can safely do yourself."),
    (["subfloor", "soft floor", "water damage"], "moisture",
     "Verify the extent of moisture damage before covering it — the plan may change."),
    (["breaker off", "turned off the breaker", "power is off"], "deenergize",
     "A breaker being off is only step one. Verify de-energization with a tester before touching wiring."),
]

_WARN = [
    (["ladder"], "Keep three points of contact and set the ladder on firm, level ground."),
    (["power tool", "circular saw", "table saw", "angle grinder"], "Keep guards in place and clamp your work."),
    (["heavy", "lift the toilet", "lift the vanity", "appliance"], "Lift with your legs or get a second person."),
    (["hot water", "steam"], "Let hot systems cool and relieve pressure before opening them."),
]


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def ppe_for(text: str) -> list:
    t = (text or "").lower()
    out = []
    for kws, items in PPE_RULES:
        if any(k in t for k in kws):
            for i in items:
                if i not in out:
                    out.append(i)
    return out[:6]


def evaluate_action(text: str, skill_level: Optional[str] = None) -> dict:
    """Doc 43 §2 — deterministic safety verdict for any task/action text."""
    t = (text or "").lower()
    ppe = ppe_for(t)
    # 1. Hard emergency triage first (reuses guided repair's deterministic rules).
    try:
        from guided_repair_engine import _triage
        triage = _triage(text, None)
    except Exception:
        triage = {"hard_stop": False, "risk_level": "normal", "message": None, "guidance": None}
    if triage.get("hard_stop"):
        return {"verdict": "block_action", "risk_level": 5, "reasons": [triage.get("message") or "Emergency condition detected."],
                "ppe": ppe, "stop_conditions": [], "message": "Stop there. I do not want you proceeding until we resolve the safety concern.",
                "guidance": triage.get("guidance"), "next_action": "Follow the emergency guidance, then let me help you document the condition for a professional.",
                "escalate": True}
    # 2. Professional boundaries → block + escalate.
    for kws, code, why in _BLOCK:
        if any(k in t for k in kws):
            return {"verdict": "escalate_to_professional", "risk_level": 5, "reasons": [why], "ppe": ppe,
                    "stop_conditions": [code],
                    "message": "Stop here. This crosses a professional boundary — I can't guide you through it as DIY work.",
                    "guidance": why,
                    "next_action": "I'll help you photograph and document the condition and prepare a clear summary for a qualified professional.",
                    "escalate": True}
    # 3. Verification-required contexts.
    hits = [(code, why) for kws, code, why in _VERIFY if any(k in t for k in kws)]
    if hits:
        beginner = (skill_level or "").lower() in ("beginner", "novice", "first_timer")
        return {"verdict": "require_verification", "risk_level": 4 if (beginner and len(hits) > 1) else 3,
                "reasons": [w for _, w in hits[:3]], "ppe": ppe,
                "stop_conditions": [c for c, _ in hits],
                "message": "Before we move forward, I want to verify one thing." if len(hits) == 1
                else "Before we move forward, a few conditions need verification.",
                "guidance": hits[0][1],
                "next_action": hits[0][1], "escalate": False}
    # 4. Planning/selection intents are informational — no physical action yet (risk level 0).
    _planning = any(p in t for p in ("choose", "pick ", "select", "decide", "which color", "what color",
                                     "color for", "colour for", "ideas for", "compare", "what kind of",
                                     "which type", "recommend a", "help me plan"))
    _physical = any(p in t for p in ("sand", "cut", "drill", "install", "remove", "apply", "demolish",
                                     "paint the", "painting", "prime", "scrape", "replace", "repair"))
    if _planning and not _physical:
        return {"verdict": "allow", "risk_level": 0, "reasons": [], "ppe": [], "stop_conditions": [],
                "message": None, "guidance": None, "next_action": None, "escalate": False}
    # 5. Warnings.
    warns = [w for kws, w in _WARN if any(k in t for k in kws)]
    if warns or ppe:
        return {"verdict": "allow_with_warning", "risk_level": 2, "reasons": warns[:2], "ppe": ppe,
                "stop_conditions": [], "message": warns[0] if warns else "Gear up first — see the PPE list.",
                "guidance": None, "next_action": "Put on the listed protection, then continue with the step.",
                "escalate": False}
    return {"verdict": "allow", "risk_level": 1 if any(w in t for w in ("install", "replace", "repair", "build")) else 0,
            "reasons": [], "ppe": [], "stop_conditions": [], "message": None, "guidance": None,
            "next_action": None, "escalate": False}


async def record_event(user_id: Optional[str], text: str, result: dict, source: str = "evaluate"):
    """Doc 43 §15 — safety event ledger (sf_events)."""
    if _db is None or result.get("verdict") == "allow":
        return
    try:
        await _db.sf_events.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id, "source": source,
            "text_hash": hashlib.sha256((text or "").encode()).hexdigest()[:16],
            "text_excerpt": (text or "")[:160],
            "verdict": result["verdict"], "risk_level": result["risk_level"],
            "stop_conditions": result.get("stop_conditions", []), "created_at": _now()})
        if result.get("escalate") and user_id:
            import admin_ops_engine
            await admin_ops_engine.record_safety_escalation(
                user_id, risk_level="high", trigger_type=f"safety_engine_{source}",
                ai_response_reference=(text or "")[:120])
    except Exception:
        pass


class EvaluateReq(BaseModel):
    text: str
    skill_level: Optional[str] = None
    source: Optional[str] = "manual_check"


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/safety", tags=["safety"])

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"verdicts": VERDICTS, "risk_levels": RISK_LEVELS,
                "ppe_catalog": sorted({i for _, items in PPE_RULES for i in items})}

    @r.post("/evaluate")
    async def evaluate(req: EvaluateReq, user: dict = Depends(get_current_user)):
        result = evaluate_action(req.text, req.skill_level)
        await record_event(user["id"], req.text, result, req.source or "manual_check")
        return result

    @r.get("/events")
    async def my_events(user: dict = Depends(get_current_user)):
        rows = await _db.sf_events.find({"user_id": user["id"]}, {"_id": 0, "text_hash": 0}) \
            .sort("created_at", -1).to_list(20)
        return {"events": rows}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/safety", tags=["safety-admin"])

    @r.get("/events")
    async def all_events(admin: dict = Depends(require_admin), limit: int = 50):
        rows = await _db.sf_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 200))
        by_verdict: dict = {}
        for e in rows:
            by_verdict[e["verdict"]] = by_verdict.get(e["verdict"], 0) + 1
        return {"events": rows, "by_verdict": by_verdict}

    return r
