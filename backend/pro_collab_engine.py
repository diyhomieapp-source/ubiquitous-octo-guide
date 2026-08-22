"""
DIYhomie — Bring in a Pro, Expert Review & Hybrid Project Collaboration
(Build Document 57).

Project-scoped professional handoff packages with an explicit user sharing
review (minimum-share default, private data never included), a manual status
pipeline, professional responses stored verbatim on the project, recommendation
accept/reject that records a plan change, and hybrid DIY/professional task
labels so safe DIY work continues while professional work is pending.

Complements: pro_connect_engine (Doc 48 — creators/briefs/requests for guides)
and pro_handoff_engine (Doc 8 — issue-scoped trade briefs).

Collections: pcx_handoffs. Shares: hi_projects, hi_project_steps,
hi_project_media, hi_project_materials, hi_project_notes, hi_measurements,
pi_change_events, hi_analytics.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

HELP_TYPES = {
    "quick_question": "Ask a Quick Question",
    "remote_review": "Request a Project Review",
    "plan_review": "Project-Plan Review",
    "estimate": "Get an Estimate",
    "onsite": "Find Local Help",
    "permit_consult": "Permit / Code Consultation",
    "manufacturer": "Manufacturer Support",
    "emergency_guidance": "Emergency Service Guidance",
}
STATUSES = ["draft", "submitted", "under_review", "professional_matched", "professional_responded",
            "appointment_requested", "appointment_confirmed", "completed", "cancelled", "expired"]
TERMINAL = {"completed", "cancelled", "expired"}
URGENCIES = ["low", "normal", "high", "urgent"]
# only these can be toggled by the user; project_title is always shared,
# address / other rooms / unrelated projects / account info are NEVER shared.
SHAREABLE = ["photos", "measurements", "products", "notes", "project_history"]
NEVER_SHARED = ["Full home address", "Other room data", "Unrelated projects", "Private account information"]
OWNERSHIPS = ["diy", "professional"]


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


async def _track(user_id, event, meta=None):
    try:
        await _db.hi_analytics.insert_one({"id": _nid(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _project(pid: str, user_id: str) -> dict:
    p = await _db.hi_projects.find_one({"id": pid, "user_id": user_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


async def _owned_handoff(hid: str, user_id: str) -> dict:
    h = await _db.pcx_handoffs.find_one({"id": hid, "user_id": user_id}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Help request not found.")
    return h


async def _assemble_snapshot(p: dict, user_id: str) -> dict:
    """Structured project snapshot — counts + short lists, never raw private data."""
    pid = p["id"]
    photos = await _db.hi_project_media.count_documents({"project_id": pid})
    meas = await _db.hi_measurements.find({"user_id": user_id, "project_id": pid},
                                          {"_id": 0, "label": 1, "name": 1, "value": 1, "unit": 1,
                                           "verification_status": 1}).to_list(50)
    mats = await _db.hi_project_materials.find({"project_id": pid},
                                               {"_id": 0, "name": 1, "category": 1, "user_status": 1}).to_list(100)
    steps = await _db.hi_project_steps.find({"project_id": pid}, {"_id": 0, "instruction": 1, "status": 1,
                                                                  "completed_at": 1}).sort("sequence_number", 1).to_list(200)
    done = [s for s in steps if s["status"] in ("completed", "skipped")]
    notes = await _db.hi_project_notes.count_documents({"project_id": pid})
    safety_flags = []
    if p.get("risk_level"):
        safety_flags.append(f"Risk level: {p['risk_level']}")
    if p.get("safety_status"):
        safety_flags.append(f"Safety status: {p['safety_status']}")
    for c in (p.get("stop_conditions") or [])[:3]:
        safety_flags.append(f"Stop condition: {c}")
    return {
        "project_title": p.get("title"),
        "project_summary": p.get("description"),
        "project_status": p.get("status"),
        "photos_count": photos,
        "measurements": [{"label": m.get("label") or m.get("name"), "value": m.get("value"),
                          "unit": m.get("unit"), "verification": m.get("verification_status")} for m in meas],
        "materials": [{"name": m["name"], "category": m.get("category"), "status": m.get("user_status")} for m in mats],
        "safety_flags": safety_flags,
        "history": {"steps_completed": len(done), "steps_total": len(steps),
                    "recent_steps": [s["instruction"][:120] for s in done[-5:]]},
        "notes_count": notes,
    }


def _sharing_view(h: dict) -> dict:
    perms = h.get("sharing_permissions") or {}
    labels = {"photos": f"Photos ({h['snapshot'].get('photos_count', 0)})",
              "measurements": f"Measurements ({len(h['snapshot'].get('measurements') or [])})",
              "products": f"Product & material information ({len(h['snapshot'].get('materials') or [])})",
              "notes": f"Project notes ({h['snapshot'].get('notes_count', 0)})",
              "project_history": "Task history"}
    included = ["Project title", "Your question"] + [labels[k] for k in SHAREABLE if perms.get(k)]
    excluded = [labels[k] for k in SHAREABLE if not perms.get(k)] + NEVER_SHARED
    return {"included": included, "not_included": excluded, "permissions": perms}


# ================================================================ models
class HandoffReq(BaseModel):
    project_id: str
    help_type: str
    user_question: str
    requested_trade: Optional[str] = None
    urgency: str = "normal"


class SharingReq(BaseModel):
    photos: Optional[bool] = None
    measurements: Optional[bool] = None
    products: Optional[bool] = None
    notes: Optional[bool] = None
    project_history: Optional[bool] = None


class OwnershipReq(BaseModel):
    ownership: str


class AdminStatusReq(BaseModel):
    status: str


class AdminResponseReq(BaseModel):
    provider_name: str
    trade: Optional[str] = None
    credentials_verified: bool = False
    message: str
    summary: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/procollab", dependencies=[Depends(get_current_user)])

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"help_types": [{"code": k, "label": v} for k, v in HELP_TYPES.items()],
                "statuses": STATUSES, "urgencies": URGENCIES,
                "never_shared": NEVER_SHARED}

    # ---------------------------------------------------------- create draft handoff
    @r.post("/handoffs")
    async def create_handoff(req: HandoffReq, user: dict = Depends(get_current_user)):
        if req.help_type not in HELP_TYPES:
            raise HTTPException(status_code=400, detail="Unknown help type.")
        if not req.user_question.strip():
            raise HTTPException(status_code=400, detail="Tell us what you need help with.")
        p = await _project(req.project_id, user["id"])
        snapshot = await _assemble_snapshot(p, user["id"])
        doc = {"id": _nid(), "user_id": user["id"], "project_id": req.project_id,
               "help_type": req.help_type, "requested_trade": (req.requested_trade or "").strip()[:80] or None,
               "urgency": req.urgency if req.urgency in URGENCIES else "normal",
               "user_question": req.user_question.strip()[:1000],
               "snapshot": snapshot,
               # minimum-share default: only what's needed for a review
               "sharing_permissions": {"photos": True, "measurements": True, "products": True,
                                       "notes": False, "project_history": True},
               "sharing_reviewed": False,
               "status": "draft", "status_history": [{"status": "draft", "at": _now()}],
               "response": None, "recommendation_decision": None,
               "created_at": _now(), "updated_at": _now()}
        await _db.pcx_handoffs.insert_one(dict(doc))
        doc.pop("_id", None)
        await _track(user["id"], "professional_handoff_created", {"project_id": req.project_id, "help_type": req.help_type})
        return {"handoff": doc, "sharing_review": _sharing_view(doc)}

    @r.get("/handoffs")
    async def list_handoffs(project_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        q = {"user_id": user["id"]}
        if project_id:
            q["project_id"] = project_id
        rows = await _db.pcx_handoffs.find(q, {"_id": 0, "snapshot": 0}).sort("created_at", -1).to_list(50)
        return {"handoffs": rows, "statuses": STATUSES}

    @r.get("/handoffs/{hid}")
    async def handoff_detail(hid: str, user: dict = Depends(get_current_user)):
        h = await _owned_handoff(hid, user["id"])
        return {"handoff": h, "sharing_review": _sharing_view(h)}

    @r.put("/handoffs/{hid}/sharing")
    async def edit_sharing(hid: str, req: SharingReq, user: dict = Depends(get_current_user)):
        h = await _owned_handoff(hid, user["id"])
        if h["status"] != "draft":
            raise HTTPException(status_code=409, detail="Sharing can only be edited before sending.")
        perms = dict(h.get("sharing_permissions") or {})
        for k in SHAREABLE:
            v = getattr(req, k)
            if v is not None:
                perms[k] = bool(v)
        await _db.pcx_handoffs.update_one({"id": hid}, {"$set": {"sharing_permissions": perms, "updated_at": _now()}})
        h["sharing_permissions"] = perms
        return {"ok": True, "sharing_review": _sharing_view(h)}

    @r.post("/handoffs/{hid}/submit")
    async def submit_handoff(hid: str, user: dict = Depends(get_current_user)):
        h = await _owned_handoff(hid, user["id"])
        if h["status"] != "draft":
            raise HTTPException(status_code=409, detail="This request was already sent.")
        await _db.pcx_handoffs.update_one({"id": hid}, {
            "$set": {"status": "submitted", "sharing_reviewed": True, "updated_at": _now()},
            "$push": {"status_history": {"status": "submitted", "at": _now()}}})
        await _track(user["id"], "professional_sharing_reviewed", {"handoff_id": hid})
        await _track(user["id"], "professional_handoff_submitted", {"handoff_id": hid, "help_type": h["help_type"]})
        return {"ok": True, "status": "submitted",
                "message": "Your request is packaged with the project details a professional needs — no re-explaining."}

    @r.post("/handoffs/{hid}/cancel")
    async def cancel_handoff(hid: str, user: dict = Depends(get_current_user)):
        h = await _owned_handoff(hid, user["id"])
        if h["status"] in TERMINAL:
            raise HTTPException(status_code=409, detail="This request is already closed.")
        await _db.pcx_handoffs.update_one({"id": hid}, {
            "$set": {"status": "cancelled", "updated_at": _now()},
            "$push": {"status_history": {"status": "cancelled", "at": _now()}}})
        await _track(user["id"], "professional_request_cancelled", {"handoff_id": hid})
        return {"ok": True}

    # ---------------------------------------------------------- professional response decision
    @r.post("/handoffs/{hid}/response/accept")
    async def accept_response(hid: str, user: dict = Depends(get_current_user)):
        h = await _owned_handoff(hid, user["id"])
        if not h.get("response"):
            raise HTTPException(status_code=409, detail="No professional response yet.")
        await _db.pcx_handoffs.update_one({"id": hid}, {"$set": {
            "recommendation_decision": "accepted", "updated_at": _now()}})
        resp = h["response"]
        # record a plan change on the project (Doc 57: history records the change)
        await _db.pi_change_events.insert_one({
            "id": _nid(), "project_id": h["project_id"], "user_id": user["id"],
            "change_type": "professional_recommendation",
            "description": f"Professional recommendation accepted from {resp.get('provider_name')}: "
                           f"{(resp.get('summary') or resp.get('message'))[:300]}",
            "source": "pro_handoff", "handoff_id": hid, "created_at": _now()})
        await _db.hi_project_notes.insert_one({
            "id": _nid(), "project_id": h["project_id"], "user_id": user["id"],
            "text": f"Professional review ({resp.get('provider_name')}"
                    f"{' · ' + resp['trade'] if resp.get('trade') else ''}): {resp.get('message')[:600]}",
            "source": "professional_response", "created_at": _now()})
        await _track(user["id"], "professional_recommendation_accepted", {"handoff_id": hid})
        return {"ok": True, "message": "The recommendation was saved to your project history."}

    @r.post("/handoffs/{hid}/response/reject")
    async def reject_response(hid: str, user: dict = Depends(get_current_user)):
        h = await _owned_handoff(hid, user["id"])
        if not h.get("response"):
            raise HTTPException(status_code=409, detail="No professional response yet.")
        await _db.pcx_handoffs.update_one({"id": hid}, {"$set": {
            "recommendation_decision": "rejected", "updated_at": _now()}})
        await _track(user["id"], "professional_recommendation_rejected", {"handoff_id": hid})
        return {"ok": True}

    # ---------------------------------------------------------- hybrid DIY / professional tasks
    @r.get("/projects/{pid}/hybrid")
    async def hybrid(pid: str, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        steps = await _db.hi_project_steps.find({"project_id": pid}, {"_id": 0}).sort("sequence_number", 1).to_list(200)
        diy = [s for s in steps if s.get("ownership") != "professional"]
        pro = [s for s in steps if s.get("ownership") == "professional"]
        next_diy = next((s for s in diy if s["status"] in ("active", "not_started")), None)
        open_handoffs = await _db.pcx_handoffs.count_documents(
            {"project_id": pid, "status": {"$nin": list(TERMINAL) + ["draft"]}})
        return {"diy_tasks": diy, "professional_tasks": pro, "next_diy_task": next_diy,
                "professional_work_pending": bool(pro and any(s["status"] not in ("completed", "skipped") for s in pro)),
                "open_help_requests": open_handoffs}

    @r.post("/projects/{pid}/steps/{sid}/ownership")
    async def set_ownership(pid: str, sid: str, req: OwnershipReq, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        if req.ownership not in OWNERSHIPS:
            raise HTTPException(status_code=400, detail="Ownership must be diy or professional.")
        st = await _db.hi_project_steps.find_one({"id": sid, "project_id": pid}, {"_id": 0, "id": 1, "status": 1})
        if not st:
            raise HTTPException(status_code=404, detail="Step not found.")
        upd = {"ownership": req.ownership}
        if req.ownership == "professional" and st["status"] in ("active", "not_started"):
            upd["status"] = "waiting"
        elif req.ownership == "diy" and st["status"] == "waiting":
            upd["status"] = "not_started"
        await _db.hi_project_steps.update_one({"id": sid}, {"$set": upd})
        await _track(user["id"], "professional_task_created" if req.ownership == "professional" else "professional_task_returned_to_diy",
                     {"project_id": pid, "step_id": sid})
        return {"ok": True, "ownership": req.ownership, "status": upd.get("status", st["status"])}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/procollab", dependencies=[Depends(require_admin)])

    @r.get("/handoffs")
    async def list_all(status: Optional[str] = None, admin: dict = Depends(require_admin)):
        q = {}
        if status:
            q["status"] = status
        rows = await _db.pcx_handoffs.find(q, {"_id": 0, "snapshot": 0}).sort("created_at", -1).to_list(200)
        return {"handoffs": rows, "statuses": STATUSES}

    @r.put("/handoffs/{hid}/status")
    async def set_status(hid: str, req: AdminStatusReq, admin: dict = Depends(require_admin)):
        if req.status not in STATUSES:
            raise HTTPException(status_code=400, detail="Unknown status.")
        h = await _db.pcx_handoffs.find_one({"id": hid}, {"_id": 0, "id": 1, "user_id": 1})
        if not h:
            raise HTTPException(status_code=404, detail="Handoff not found.")
        await _db.pcx_handoffs.update_one({"id": hid}, {
            "$set": {"status": req.status, "updated_at": _now()},
            "$push": {"status_history": {"status": req.status, "at": _now()}}})
        await _track(h["user_id"], "professional_request_status_changed", {"handoff_id": hid, "status": req.status})
        return {"ok": True, "status": req.status}

    @r.post("/handoffs/{hid}/response")
    async def post_response(hid: str, req: AdminResponseReq, admin: dict = Depends(require_admin)):
        h = await _db.pcx_handoffs.find_one({"id": hid}, {"_id": 0, "id": 1, "user_id": 1})
        if not h:
            raise HTTPException(status_code=404, detail="Handoff not found.")
        if not req.message.strip():
            raise HTTPException(status_code=400, detail="A response message is required.")
        # stored verbatim — the AI never alters a professional's statement
        response = {"provider_name": req.provider_name.strip()[:120],
                    "trade": (req.trade or "").strip()[:80] or None,
                    "credentials_verified": bool(req.credentials_verified),
                    "message": req.message.strip()[:2000],
                    "summary": (req.summary or "").strip()[:400] or None,
                    "received_at": _now()}
        await _db.pcx_handoffs.update_one({"id": hid}, {
            "$set": {"response": response, "status": "professional_responded", "updated_at": _now()},
            "$push": {"status_history": {"status": "professional_responded", "at": _now()}}})
        await _track(h["user_id"], "professional_response_received", {"handoff_id": hid})
        return {"ok": True, "response": response}

    return r
