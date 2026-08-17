"""
Build Doc 11 — Property Onboarding, Room Mapping & Asset Discovery ("Property Brain").
Namespace /api/hi/brain/* (+ admin /api/hi/admin/brain/*).

The app already has property setup (onboarding_engine), rooms (room_intelligence_engine),
assets (home_intelligence_engine) and a document vault (document_vault_engine). This engine
adds the genuinely NEW layers on top — no duplication:

- Occupancy role (owner / renter / household_member) + renter mode boundaries + report
- "What DIYhomie knows" context summary with provenance (confirmed / user-entered /
  inferred / unknown) and correction workflow — Unknown is a valid state
- Contextual context-requests during projects (only what improves the current decision)
- Completeness signal + single next-best-detail suggestion (never a gamified score)

Collections: pb_facts, pb_context_requests.
"""
from datetime import datetime, timezone
from typing import Callable, Optional
import uuid

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

_db = None
_logger = None

FACT_SOURCES = ("user_entered", "user_confirmed", "inferred", "document")
FACT_STATUSES = ("active", "outdated", "removed")
OCCUPANCY_ROLES = ("owner", "renter", "household_member")

# High-value details, in priority order — each with why it helps.
KEY_DETAILS = [
    {"key": "occupancy_role", "label": "Are you the owner, a renter, or a household member?",
     "why": "Sets safe boundaries — renters get landlord-escalation guidance instead of invasive-work steps."},
    {"key": "property_type", "label": "What type of home is it (house, condo, apartment, townhome)?",
     "why": "Changes which systems you own and which repairs apply."},
    {"key": "region", "label": "General region or postal area",
     "why": "Unlocks seasonal maintenance timing and weather-aware guidance."},
    {"key": "foundation_type", "label": "Is the home on a slab, crawlspace, or basement?",
     "why": "Critical for moisture, plumbing and flooring decisions."},
    {"key": "home_age", "label": "Roughly when was the home built?",
     "why": "Flags era-specific materials and wiring/plumbing types to watch for."},
    {"key": "heating_type", "label": "How is the home heated (furnace, heat pump, boiler, baseboard)?",
     "why": "Makes HVAC maintenance and repair guidance specific to your equipment."},
]

# Issue-category → the single most valuable context question (deterministic).
CONTEXT_REQUEST_MAP = {
    "water_moisture": {"key": "foundation_type", "question": "Is this home on a slab, crawlspace, or basement?",
                       "why": "Where water can travel depends on the foundation."},
    "plumbing": {"key": "foundation_type", "question": "Is this home on a slab, crawlspace, or basement?",
                 "why": "Pipe access and leak paths depend on the foundation."},
    "hvac": {"key": "heating_type", "question": "How is the home heated (furnace, heat pump, boiler, baseboard)?",
             "why": "The right checks depend on your equipment type."},
    "electrical_concern": {"key": "home_age", "question": "Roughly when was the home built?",
                           "why": "Older homes can have wiring types that change the safe approach."},
    "exterior": {"key": "region", "question": "What's your general region or postal area?",
                 "why": "Weather exposure changes exterior repair recommendations."},
    "appliance": {"key": "home_age", "question": "Roughly when was the home built?",
                  "why": "Helps judge supply lines and hookups behind the appliance."},
}

RENTER_BOUNDARY = ("As a renter you can document issues, do approved light maintenance, and hand a clear report "
                   "to your landlord or property manager — DIYhomie won't guide you into altering building systems "
                   "that aren't yours to modify.")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user_id, event, props=None):
    try:
        from analytics_engine import capture
        await capture(user_id, event, props or {})
    except Exception:
        pass


async def _active_property(uid: str) -> dict:
    prop = await _db.hi_properties.find_one({"user_id": uid, "is_active": True}, {"_id": 0})
    if not prop:
        prop = await _db.hi_properties.find_one({"user_id": uid}, {"_id": 0})
    if not prop:
        prop = {"id": _nid(), "user_id": uid, "name": "My Home", "address": None, "home_type": None,
                "is_active": True, "created_at": _now(), "updated_at": _now()}
        await _db.hi_properties.insert_one(dict(prop)); prop.pop("_id", None)
    return prop


async def _facts(uid: str, pid: str):
    return await _db.pb_facts.find({"user_id": uid, "property_id": pid, "status": {"$ne": "removed"}},
                                   {"_id": 0}).sort("updated_at", -1).to_list(200)


async def _summary_payload(uid: str, prop: dict) -> dict:
    pid = prop["id"]
    facts = await _facts(uid, pid)
    active_facts = [f for f in facts if f["status"] == "active"]
    fact_keys = {f["key"] for f in active_facts}

    rooms = await _db.hi_rooms.count_documents({"user_id": uid, "property_id": pid, "status": {"$ne": "archived"}})
    assets = await _db.hi_assets.find({"user_id": uid, "property_id": pid}, {"_id": 0, "name": 1, "category": 1}).to_list(300)
    docs = await _db.hi_documents.count_documents({"user_id": uid})
    open_issues = await _db.gr_issues.count_documents({"user_id": uid, "status": {"$nin": ["completed", "archived"]}})
    outcomes = await _db.gr_outcomes.count_documents({"user_id": uid})

    confirmed_records = [
        {"label": "Rooms mapped", "value": rooms},
        {"label": "Assets on record", "value": len(assets)},
        {"label": "Documents in the vault", "value": docs},
        {"label": "Open issues", "value": open_issues},
        {"label": "Completed project records", "value": outcomes},
    ]

    # Known vs unknown key details.
    known_details, unknowns = [], []
    role = prop.get("occupancy_role")
    for kd in KEY_DETAILS:
        if kd["key"] == "occupancy_role" and role:
            known_details.append({"key": kd["key"], "label": "Occupancy", "value": role, "source": "user_entered"})
            continue
        if kd["key"] == "property_type" and prop.get("home_type"):
            known_details.append({"key": kd["key"], "label": "Property type", "value": prop["home_type"], "source": "user_entered"})
            continue
        if kd["key"] == "region" and prop.get("address"):
            known_details.append({"key": kd["key"], "label": "Region", "value": prop["address"], "source": "user_entered"})
            continue
        fact = next((f for f in active_facts if f["key"] == kd["key"]), None)
        if fact:
            known_details.append({"key": kd["key"], "label": fact.get("label") or kd["key"], "value": fact["value"], "source": fact["source"]})
        else:
            unknowns.append({"key": kd["key"], "label": kd["label"], "why": kd["why"]})

    # Completeness = useful details, not volume.
    weight_hits = len(known_details) + (1 if rooms else 0) + (1 if assets else 0) + (1 if docs else 0)
    weight_total = len(KEY_DETAILS) + 3
    completeness = round(weight_hits / weight_total * 100)
    next_best = unknowns[0] if unknowns else (
        {"key": "rooms", "label": "Add your most-used rooms", "why": "Lets projects and history attach to the right place."} if not rooms else
        {"key": "assets", "label": "Photograph your water heater or HVAC label", "why": "Model-aware maintenance and repair guidance."} if not assets else None)

    return {
        "property": {"id": pid, "name": prop.get("name"), "type": prop.get("home_type"),
                     "occupancy_role": role, "region": prop.get("address")},
        "confirmed_records": confirmed_records,
        "known_details": known_details,
        "facts": active_facts,
        "outdated_facts": [f for f in facts if f["status"] == "outdated"],
        "unknowns": unknowns,
        "completeness": completeness,
        "next_best_detail": next_best,
        "renter_mode": role == "renter",
        "renter_boundary": RENTER_BOUNDARY if role == "renter" else None,
        "note": "Unknown is a valid state — add details only when they'd help. Everything here is correctable.",
    }


class ProfileReq(BaseModel):
    occupancy_role: Optional[str] = None
    property_type: Optional[str] = None
    region: Optional[str] = None


class FactReq(BaseModel):
    key: Optional[str] = None
    label: str
    value: str
    source: str = "user_entered"


class FactActionReq(BaseModel):
    action: str  # mark_outdated | remove | restore
    corrected_value: Optional[str] = None


class ContextAnswerReq(BaseModel):
    request_id: str
    value: str


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/brain", tags=["property-brain"])

    @r.get("/summary")
    async def summary(user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        payload = await _summary_payload(user["id"], prop)
        await _cap(user["id"], "property_context.viewed", {"completeness": payload["completeness"]})
        return payload

    @r.put("/profile")
    async def update_profile(req: ProfileReq, user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        upd = {"updated_at": _now()}
        if req.occupancy_role is not None:
            if req.occupancy_role not in OCCUPANCY_ROLES:
                raise HTTPException(status_code=400, detail="Invalid occupancy role.")
            upd["occupancy_role"] = req.occupancy_role
        if req.property_type is not None:
            upd["home_type"] = req.property_type.strip()[:60] or None
        if req.region is not None:
            upd["address"] = req.region.strip()[:120] or None
        await _db.hi_properties.update_one({"id": prop["id"]}, {"$set": upd})
        prop = {**prop, **upd}
        await _cap(user["id"], "property_context.corrected", {"fields": list(upd.keys())})
        return await _summary_payload(user["id"], prop)

    @r.post("/facts")
    async def add_fact(req: FactReq, user: dict = Depends(get_current_user)):
        if not req.label.strip() or not req.value.strip():
            raise HTTPException(status_code=400, detail="Label and value are required.")
        source = req.source if req.source in FACT_SOURCES else "user_entered"
        prop = await _active_property(user["id"])
        fact = {"id": _nid(), "user_id": user["id"], "property_id": prop["id"],
                "key": (req.key or req.label.lower().replace(" ", "_"))[:60],
                "label": req.label.strip()[:120], "value": req.value.strip()[:400],
                "source": source, "status": "active", "created_at": _now(), "updated_at": _now()}
        await _db.pb_facts.insert_one(dict(fact)); fact.pop("_id", None)
        await _cap(user["id"], "property_context.fact_added", {"source": source})
        return {"fact": fact}

    @r.post("/facts/{fid}/action")
    async def fact_action(fid: str, req: FactActionReq, user: dict = Depends(get_current_user)):
        fact = await _db.pb_facts.find_one({"id": fid, "user_id": user["id"]}, {"_id": 0})
        if not fact:
            raise HTTPException(status_code=404, detail="Detail not found.")
        if req.action == "mark_outdated":
            await _db.pb_facts.update_one({"id": fid}, {"$set": {"status": "outdated", "updated_at": _now()}})
        elif req.action == "remove":
            await _db.pb_facts.update_one({"id": fid}, {"$set": {"status": "removed", "updated_at": _now()}})
        elif req.action == "restore":
            await _db.pb_facts.update_one({"id": fid}, {"$set": {"status": "active", "updated_at": _now()}})
        elif req.action == "correct":
            if not (req.corrected_value or "").strip():
                raise HTTPException(status_code=400, detail="Provide the corrected value.")
            # Preserve history: outdate the old record, insert the correction.
            await _db.pb_facts.update_one({"id": fid}, {"$set": {"status": "outdated", "updated_at": _now()}})
            new_fact = {**fact, "id": _nid(), "value": req.corrected_value.strip()[:400],
                        "source": "user_confirmed", "status": "active",
                        "created_at": _now(), "updated_at": _now(), "corrects_fact_id": fid}
            await _db.pb_facts.insert_one(dict(new_fact))
        else:
            raise HTTPException(status_code=400, detail="Invalid action.")
        await _cap(user["id"], "property_context.corrected", {"action": req.action})
        return {"ok": True}

    # ------- contextual context-requests during projects -------
    @r.get("/context-request")
    async def context_request(issue_id: str, user: dict = Depends(get_current_user)):
        issue = await _db.gr_issues.find_one({"id": issue_id, "user_id": user["id"]}, {"_id": 0})
        if not issue:
            raise HTTPException(status_code=404, detail="Project not found.")
        spec = CONTEXT_REQUEST_MAP.get(issue.get("category") or "")
        if not spec:
            return {"request": None}
        prop = await _active_property(user["id"])
        # Already known? (fact or property field)
        if spec["key"] == "region" and prop.get("address"):
            return {"request": None}
        known = await _db.pb_facts.find_one({"user_id": user["id"], "property_id": prop["id"],
                                             "key": spec["key"], "status": "active"}, {"_id": 1})
        if known:
            return {"request": None}
        # Dismissed for this issue already?
        existing = await _db.pb_context_requests.find_one(
            {"user_id": user["id"], "issue_id": issue_id, "key": spec["key"]}, {"_id": 0})
        if existing and existing.get("status") in ("answered", "dismissed"):
            return {"request": None}
        if not existing:
            existing = {"id": _nid(), "user_id": user["id"], "issue_id": issue_id,
                        "property_id": prop["id"], "key": spec["key"], "question": spec["question"],
                        "why": spec["why"], "status": "shown", "created_at": _now()}
            await _db.pb_context_requests.insert_one(dict(existing)); existing.pop("_id", None)
            await _cap(user["id"], "project.context_request_shown", {"key": spec["key"]})
        return {"request": existing, "optional": True}

    @r.post("/context-request/answer")
    async def answer_context_request(req: ContextAnswerReq, user: dict = Depends(get_current_user)):
        creq = await _db.pb_context_requests.find_one({"id": req.request_id, "user_id": user["id"]}, {"_id": 0})
        if not creq:
            raise HTTPException(status_code=404, detail="Request not found.")
        if not (req.value or "").strip():
            # Treat empty submit as dismissal — requests are optional.
            await _db.pb_context_requests.update_one({"id": creq["id"]}, {"$set": {"status": "dismissed", "updated_at": _now()}})
            return {"ok": True, "dismissed": True}
        kd = next((k for k in KEY_DETAILS if k["key"] == creq["key"]), None)
        fact = {"id": _nid(), "user_id": user["id"], "property_id": creq["property_id"],
                "key": creq["key"], "label": (kd["label"] if kd else creq["question"])[:120],
                "value": req.value.strip()[:400], "source": "user_entered", "status": "active",
                "origin_issue_id": creq["issue_id"], "created_at": _now(), "updated_at": _now()}
        await _db.pb_facts.insert_one(dict(fact)); fact.pop("_id", None)
        await _db.pb_context_requests.update_one({"id": creq["id"]}, {"$set": {"status": "answered", "updated_at": _now()}})
        # File as issue evidence too, so the current assessment can use it.
        await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": creq["issue_id"], "user_id": user["id"],
                                          "type": "observation", "note": f"{fact['label']}: {fact['value']}",
                                          "created_at": _now()})
        await _cap(user["id"], "project.context_request_completed", {"key": creq["key"]})
        return {"ok": True, "fact": fact}

    # ------- renter mode report -------
    @r.get("/renter-report")
    async def renter_report(user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        issues = await _db.gr_issues.find({"user_id": user["id"], "status": {"$nin": ["archived"]}},
                                          {"_id": 0, "description": 1, "category": 1, "phase": 1, "status": 1,
                                           "created_at": 1}).sort("created_at", -1).to_list(50)
        followups = await _db.gr_followups.find({"user_id": user["id"], "status": "open"},
                                                {"_id": 0, "title": 1, "kind": 1}).to_list(30)
        lines = [f"MAINTENANCE REPORT — {prop.get('name') or 'Unit'}",
                 f"Prepared with DIYhomie on {_now()[:10]}", ""]
        if issues:
            lines.append("REPORTED ISSUES:")
            for i in issues:
                lines.append(f"• [{(i.get('status') or 'open').upper()}] {i.get('description')} (reported {str(i.get('created_at'))[:10]})")
        else:
            lines.append("No reported issues on record.")
        if followups:
            lines.append("")
            lines.append("OPEN FOLLOW-UPS:")
            for f in followups:
                lines.append(f"• {f.get('title')}")
        lines += ["", "This report documents resident-observed conditions. It is not a professional inspection."]
        await _cap(user["id"], "renter_report_exported", {"issues": len(issues)})
        return {"report_text": "\n".join(lines), "issue_count": len(issues)}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/brain", tags=["property-brain-admin"])

    @r.get("/signals")
    async def signals(admin: dict = Depends(require_admin)):
        facts = await _db.pb_facts.count_documents({})
        corrections = await _db.pb_facts.count_documents({"status": "outdated"})
        requests_shown = await _db.pb_context_requests.count_documents({})
        answered = await _db.pb_context_requests.count_documents({"status": "answered"})
        return {"facts": facts, "corrections": corrections,
                "context_requests_shown": requests_shown, "context_requests_answered": answered,
                "answer_rate": round(answered / requests_shown * 100) if requests_shown else 0}

    return r
