"""
DIYhomie — Project Memory, Outcome Intelligence & Property Record Engine (Build Document 4).

The durable memory layer that turns completed / paused / escalated / ongoing repair projects
into a continuously improving, homeowner-controlled property record. Built on the Guided Repair
(Doc 2) and Guided Execution (Doc 3) gr_* collections.

Principles:
  - Every project leaves a useful record.
  - History is preserved, not overwritten (reopen creates continuations).
  - "Completed" is not always "resolved".
  - Privacy is foundational (records are user-scoped; sharing is explicit & opt-in).
  - Every outcome can inform the next decision (context retrieval before intake questions).

Namespace: /api/hi/record/*  (+ public /api/hi/record/shared/{token}, admin /api/hi/admin/record/*)
Reuses gr_* collections; adds gr_followups, gr_timeline, gr_outcomes (written by Doc 3), gr_shares.
"""
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

TERMINAL_STATES = ["resolved", "improved", "unresolved", "professionally_completed", "escalated", "abandoned"]
FOLLOWUP_TYPES = ["recheck", "observe_after_event", "seasonal", "professional_inspection", "warranty_doc"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


async def _owned_issue(iid, uid):
    issue = await _db.gr_issues.find_one({"id": iid, "user_id": uid}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Project not found.")
    return issue


async def _issue_events(issue: dict) -> List[dict]:
    """Compose timeline events for a single issue from its records (provenance-tagged)."""
    iid = issue["id"]
    events = [{
        "id": f"{iid}-reported", "issue_id": iid, "type": "issue_reported", "provenance": "user_reported",
        "title": (issue.get("description") or "Issue reported")[:120], "category": issue.get("category"),
        "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"), "at": issue.get("created_at"),
    }]
    a = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0, "created_at": 1, "confidence_level": 1, "risk_level": 1}, sort=[("version", -1)])
    if a:
        events.append({"id": f"{iid}-assessed", "issue_id": iid, "type": "assessment_created", "provenance": "system_assessment",
                       "title": "Homie assessed the issue", "category": issue.get("category"),
                       "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"),
                       "meta": {"confidence": a.get("confidence_level"), "risk": a.get("risk_level")}, "at": a.get("created_at")})
    p = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0, "created_at": 1}, sort=[("version", 1)])
    if p:
        events.append({"id": f"{iid}-started", "issue_id": iid, "type": "repair_started", "provenance": "ai_recommendation",
                       "title": "Repair plan created", "category": issue.get("category"),
                       "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"), "at": p.get("created_at")})
    for o in await _db.gr_outcomes.find({"issue_id": iid}, {"_id": 0}).sort("created_at", 1).to_list(20):
        events.append({"id": f"outcome-{o['id']}", "issue_id": iid, "type": "project_outcome", "provenance": "user_reported",
                       "title": f"Outcome: {(o.get('outcome_status') or '').replace('_', ' ')}", "category": issue.get("category"),
                       "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"),
                       "meta": {"outcome_status": o.get("outcome_status")}, "outcome_id": o["id"], "at": o.get("created_at")})
    return events


def _is_open(issue: dict) -> bool:
    return issue.get("status") not in ("completed", "abandoned", "archived") and issue.get("phase") != "DOCUMENTED"


# ----------------------------------------------------------------- request models
class LinkReq(BaseModel):
    room_id: Optional[str] = None
    asset_id: Optional[str] = None


class FollowupReq(BaseModel):
    issue_id: str
    what: str
    why: Optional[str] = None
    type: str = "recheck"
    due_days: Optional[int] = None
    success_criteria: Optional[str] = None
    reopen_when: Optional[str] = None


class FollowupActionReq(BaseModel):
    action: str  # complete | snooze | dismiss | convert
    snooze_days: Optional[int] = 7
    note: Optional[str] = None
    base64: Optional[str] = None


class ContextReq(BaseModel):
    category: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    description: Optional[str] = None


class ReopenReq(BaseModel):
    reason: str
    base64: Optional[str] = None


class ShareReq(BaseModel):
    include_evidence: bool = False
    expires_days: int = 14


# ----------------------------------------------------------------- user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/record")

    @r.get("/dashboard")
    async def dashboard(user: dict = Depends(get_current_user)):
        uid = user["id"]
        issues = await _db.gr_issues.find({"user_id": uid}, {"_id": 0}).sort("updated_at", -1).to_list(300)
        open_issues = [i for i in issues if _is_open(i)]
        in_progress = [i for i in issues if i.get("phase") == "IN_PROGRESS"]
        completed = [i for i in issues if i.get("status") in ("completed",) or i.get("phase") == "DOCUMENTED"]
        followups = await _db.gr_followups.find({"user_id": uid, "status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(100)
        now = datetime.now(timezone.utc)
        due = [f for f in followups if not f.get("due_at") or f["due_at"] <= _now()]
        recent = await _db.gr_timeline.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(8)
        return {
            "counts": {"open_issues": len(open_issues), "in_progress": len(in_progress),
                       "completed": len(completed), "followups_due": len(due)},
            "open_issues": [{"id": i["id"], "description": i.get("description"), "phase": i.get("phase"),
                             "category": i.get("category"), "status": i.get("status")} for i in open_issues[:10]],
            "followups_due": due[:10],
            "recent_activity": recent,
            "empty": len(issues) == 0,
        }

    @r.get("/timeline")
    async def timeline(room_id: Optional[str] = None, asset_id: Optional[str] = None,
                       category: Optional[str] = None, status: Optional[str] = None,
                       since: Optional[str] = None, user: dict = Depends(get_current_user)):
        uid = user["id"]
        q = {"user_id": uid}
        if room_id:
            q["room_id"] = room_id
        if asset_id:
            q["asset_id"] = asset_id
        if category:
            q["category"] = category
        if status:
            q["status"] = status
        issues = await _db.gr_issues.find(q, {"_id": 0}).sort("updated_at", -1).to_list(120)
        events: List[dict] = []
        for i in issues:
            events.extend(await _issue_events(i))
        for f in await _db.gr_followups.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(100):
            if room_id and f.get("room_id") != room_id:
                continue
            if asset_id and f.get("asset_id") != asset_id:
                continue
            events.append({"id": f"fu-{f['id']}", "issue_id": f.get("issue_id"), "type": "follow_up",
                           "provenance": "ai_recommendation", "title": f.get("what"), "room_id": f.get("room_id"),
                           "asset_id": f.get("asset_id"), "meta": {"status": f.get("status"), "type": f.get("type")},
                           "at": f.get("created_at")})
        if since:
            events = [e for e in events if (e.get("at") or "") >= since]
        events.sort(key=lambda e: e.get("at") or "", reverse=True)
        await _cap(uid, "property_timeline.filtered" if (room_id or asset_id or category or status) else "property_timeline.viewed", {})
        return {"events": events[:200]}

    @r.get("/issues/{iid}/closeout")
    async def closeout(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        outcome = await _db.gr_outcomes.find_one({"issue_id": iid}, {"_id": 0}, sort=[("created_at", -1)])
        plans = await _db.gr_plans.count_documents({"issue_id": iid})
        assessments = await _db.gr_assessments.count_documents({"issue_id": iid})
        evidence = await _db.gr_evidence.count_documents({"issue_id": iid})
        decisions = await _db.gr_decisions.find({"issue_id": iid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        followups = await _db.gr_followups.find({"issue_id": iid}, {"_id": 0}).to_list(50)
        return {"issue": issue, "outcome": outcome, "decisions": decisions, "follow_ups": followups,
                "stats": {"plan_versions": plans, "assessments": assessments, "evidence": evidence}}

    # ---------------- Room / Asset history ----------------
    @r.get("/rooms/{room_id}/history")
    async def room_history(room_id: str, user: dict = Depends(get_current_user)):
        uid = user["id"]
        issues = await _db.gr_issues.find({"user_id": uid, "room_id": room_id}, {"_id": 0}).sort("updated_at", -1).to_list(100)
        outcomes = await _db.gr_outcomes.find({"user_id": uid, "room_id": room_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        followups = await _db.gr_followups.find({"user_id": uid, "room_id": room_id, "status": "open"}, {"_id": 0}).to_list(50)
        room = await _db.hi_rooms.find_one({"id": room_id}, {"_id": 0, "name": 1, "room_type": 1})
        await _cap(uid, "room.history_viewed", {})
        return {"room": room, "issues": issues, "outcomes": outcomes, "open_followups": followups,
                "open_issues": [i for i in issues if _is_open(i)]}

    @r.get("/assets/{asset_id}/history")
    async def asset_history(asset_id: str, user: dict = Depends(get_current_user)):
        uid = user["id"]
        issues = await _db.gr_issues.find({"user_id": uid, "asset_id": asset_id}, {"_id": 0}).sort("updated_at", -1).to_list(100)
        outcomes = await _db.gr_outcomes.find({"user_id": uid, "asset_id": asset_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        followups = await _db.gr_followups.find({"user_id": uid, "asset_id": asset_id, "status": "open"}, {"_id": 0}).to_list(50)
        asset = await _db.hi_assets.find_one({"id": asset_id}, {"_id": 0, "name": 1, "category": 1})
        await _cap(uid, "asset.history_viewed", {})
        return {"asset": asset, "issues": issues, "outcomes": outcomes, "open_followups": followups,
                "open_issues": [i for i in issues if _is_open(i)]}

    @r.put("/issues/{iid}/links")
    async def correct_links(iid: str, req: LinkReq, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        upd = {"updated_at": _now()}
        if req.room_id is not None:
            upd["room_id"] = req.room_id or None
        if req.asset_id is not None:
            upd["asset_id"] = req.asset_id or None
        await _db.gr_issues.update_one({"id": iid}, {"$set": upd})
        # Keep outcomes/follow-ups/timeline links in sync.
        for coll in (_db.gr_outcomes, _db.gr_followups, _db.gr_timeline):
            await coll.update_many({"issue_id": iid}, {"$set": {k: v for k, v in upd.items() if k != "updated_at"}})
        return {"ok": True, **{k: v for k, v in upd.items() if k != "updated_at"}}

    # ---------------- Follow-ups / monitoring ----------------
    @r.get("/followups")
    async def list_followups(status: str = "open", user: dict = Depends(get_current_user)):
        q = {"user_id": user["id"]} if status == "all" else {"user_id": user["id"], "status": status}
        rows = await _db.gr_followups.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"follow_ups": rows}

    @r.post("/followups")
    async def create_followup(req: FollowupReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(req.issue_id, user["id"])
        due_at = None
        if req.due_days and req.due_days > 0:
            due_at = (datetime.now(timezone.utc) + timedelta(days=req.due_days)).isoformat()
        fu = {"id": _nid(), "issue_id": req.issue_id, "user_id": user["id"], "property_id": issue.get("property_id"),
              "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"),
              "what": req.what.strip()[:300], "why": (req.why or "").strip()[:400] or None,
              "type": req.type if req.type in FOLLOWUP_TYPES else "recheck",
              "success_criteria": (req.success_criteria or "").strip()[:400] or None,
              "reopen_when": (req.reopen_when or "").strip()[:400] or None,
              "due_at": due_at, "status": "open", "created_at": _now()}
        await _db.gr_followups.insert_one(dict(fu)); fu.pop("_id", None)
        await _cap(user["id"], "project.follow_up_created", {"type": fu["type"]})
        return {"follow_up": fu}

    @r.post("/followups/{fid}/action")
    async def followup_action(fid: str, req: FollowupActionReq, user: dict = Depends(get_current_user)):
        fu = await _db.gr_followups.find_one({"id": fid, "user_id": user["id"]}, {"_id": 0})
        if not fu:
            raise HTTPException(status_code=404, detail="Follow-up not found.")
        if req.action == "complete":
            await _db.gr_followups.update_one({"id": fid}, {"$set": {"status": "completed", "completed_at": _now(), "completion_note": (req.note or "")[:400] or None}})
            if req.base64 or req.note:
                await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": fu["issue_id"], "user_id": user["id"],
                                                  "type": ("photo" if req.base64 else "observation"),
                                                  "note": f"Follow-up '{fu['what']}': {req.note or 'completed'}",
                                                  "value": None, "unit": None, "base64": req.base64,
                                                  "_had_media": bool(req.base64), "created_at": _now()})
            try:
                await _db.gr_timeline.insert_one({"id": _nid(), "user_id": user["id"], "property_id": fu.get("property_id"),
                                                  "room_id": fu.get("room_id"), "asset_id": fu.get("asset_id"),
                                                  "type": "follow_up_completed", "provenance": "user_reported",
                                                  "title": f"Follow-up done: {fu['what']}", "issue_id": fu["issue_id"], "created_at": _now()})
            except Exception:
                pass
            await _cap(user["id"], "project.follow_up_completed", {})
            return {"ok": True, "status": "completed"}
        if req.action == "snooze":
            days = req.snooze_days or 7
            due_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
            await _db.gr_followups.update_one({"id": fid}, {"$set": {"due_at": due_at, "status": "open"}})
            await _cap(user["id"], "project.follow_up_snoozed", {"days": days})
            return {"ok": True, "status": "open", "due_at": due_at}
        if req.action == "dismiss":
            await _db.gr_followups.update_one({"id": fid}, {"$set": {"status": "dismissed", "dismissed_at": _now()}})
            return {"ok": True, "status": "dismissed"}
        if req.action == "convert":
            # Convert follow-up into a NEW linked issue (continuation) — original record preserved.
            src = await _owned_issue(fu["issue_id"], user["id"])
            new_id = _nid()
            new_issue = {"id": new_id, "user_id": user["id"], "property_id": src.get("property_id"),
                         "room_id": fu.get("room_id"), "asset_id": fu.get("asset_id"),
                         "description": f"Follow-up: {fu['what']}", "category": src.get("category"),
                         "urgency": "soon", "status": "submitted", "phase": "ISSUE_REPORTED",
                         "triage": src.get("triage"), "risk_flags": [], "assessment_version": 0, "plan_version": 0,
                         "position_id": None, "continuation_of": fu["issue_id"], "created_at": _now(), "updated_at": _now()}
            await _db.gr_issues.insert_one(dict(new_issue)); new_issue.pop("_id", None)
            await _db.gr_followups.update_one({"id": fid}, {"$set": {"status": "converted", "converted_issue_id": new_id}})
            await _cap(user["id"], "project.reopened", {"via": "followup_convert"})
            return {"ok": True, "status": "converted", "new_issue_id": new_id}
        raise HTTPException(status_code=400, detail="Invalid follow-up action.")

    # ---------------- Future project context retrieval ----------------
    @r.post("/context")
    async def context(req: ContextReq, user: dict = Depends(get_current_user)):
        uid = user["id"]
        or_terms = []
        if req.room_id:
            or_terms.append({"room_id": req.room_id})
        if req.asset_id:
            or_terms.append({"asset_id": req.asset_id})
        if req.category:
            or_terms.append({"category": req.category})
        if not or_terms:
            return {"has_context": False, "prior_projects": [], "unresolved": [], "measurements": [],
                    "rejected_approaches": [], "homie_note": None}
        q = {"user_id": uid, "$or": or_terms}
        prior = await _db.gr_issues.find(q, {"_id": 0}).sort("updated_at", -1).to_list(30)
        prior_ids = [p["id"] for p in prior]
        outcomes = await _db.gr_outcomes.find({"user_id": uid, "issue_id": {"$in": prior_ids}}, {"_id": 0}).sort("created_at", -1).to_list(30)
        outcome_by_issue = {}
        for o in outcomes:
            outcome_by_issue.setdefault(o["issue_id"], o)
        unresolved = [o for o in outcomes if o.get("outcome_status") in ("unresolved", "improved")]
        measurements = await _db.gr_evidence.find({"user_id": uid, "issue_id": {"$in": prior_ids}, "type": "measurement"}, {"_id": 0, "base64": 0}).to_list(30)
        rejected = await _db.gr_decisions.find({"user_id": uid, "issue_id": {"$in": prior_ids}, "status": {"$in": ["rejected", "superseded"]}}, {"_id": 0}).to_list(30)
        prior_summary = [{"id": p["id"], "description": p.get("description"), "category": p.get("category"),
                          "outcome_status": outcome_by_issue.get(p["id"], {}).get("outcome_status"),
                          "at": p.get("created_at")} for p in prior[:10]]
        note = None
        if prior:
            same = "this area" if req.room_id else ("this item" if req.asset_id else "this kind of issue")
            if unresolved:
                note = (f"You have prior work on {same}, and a recent outcome was not fully resolved. "
                        "We should verify whether this is the same cause before assuming a fix.")
            else:
                note = f"You've worked on {same} before — I'll use that history so we don't repeat old steps."
        await _cap(uid, "project.context_surfaced", {"count": len(prior)})
        return {"has_context": bool(prior), "prior_projects": prior_summary,
                "unresolved": [{"issue_id": o["issue_id"], "objective": o.get("objective"), "outcome_status": o.get("outcome_status")} for o in unresolved][:5],
                "measurements": [{"note": m.get("note"), "value": m.get("value"), "unit": m.get("unit")} for m in measurements][:10],
                "rejected_approaches": [{"decision": d["decision"], "reason": d.get("reason")} for d in rejected][:10],
                "homie_note": note}

    @r.post("/issues/{iid}/context-applied")
    async def context_applied(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        await _cap(user["id"], "project.context_applied", {})
        return {"ok": True}

    # ---------------- Reopen / continuation ----------------
    @r.post("/issues/{iid}/reopen")
    async def reopen(iid: str, req: ReopenReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        reason = (req.reason or "").strip()[:600] or "Symptom returned."
        # Preserve outcome; create a continuation phase on the same issue.
        await _db.gr_issues.update_one({"id": iid}, {"$set": {"status": "active", "phase": "ASSESSMENT",
                                                              "reopened_at": _now(), "updated_at": _now()},
                                                      "$inc": {"reopen_count": 1}})
        await _db.gr_decisions.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"],
                                           "decision": "Project reopened", "status": "recommended",
                                           "reason": reason, "evidence": None, "confidence": None,
                                           "made_by": "user", "created_at": _now()})
        if req.base64 or reason:
            await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"],
                                              "type": ("photo" if req.base64 else "observation"),
                                              "note": f"Reopened: {reason}", "value": None, "unit": None,
                                              "base64": req.base64, "_had_media": bool(req.base64), "created_at": _now()})
        try:
            await _db.gr_timeline.insert_one({"id": _nid(), "user_id": user["id"], "property_id": issue.get("property_id"),
                                              "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"),
                                              "type": "project_reopened", "provenance": "user_reported",
                                              "title": "Project reopened", "description": reason,
                                              "issue_id": iid, "created_at": _now()})
        except Exception:
            pass
        await _cap(user["id"], "project.reopened", {})
        return {"ok": True, "phase": "ASSESSMENT"}

    # ---------------- Sharing / export (P1) ----------------
    @r.get("/issues/{iid}/export")
    async def export_record(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        outcome = await _db.gr_outcomes.find_one({"issue_id": iid}, {"_id": 0}, sort=[("created_at", -1)])
        decisions = await _db.gr_decisions.find({"issue_id": iid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        await _cap(user["id"], "project.record_exported", {})
        return {"disclaimer": "This DIYhomie record is a homeowner history aid, not a licensed inspection, appraisal, warranty or code-compliance certificate.",
                "objective": issue.get("description"), "category": issue.get("category"),
                "outcome": outcome, "decisions": decisions,
                "plan": ({"objective": plan["objective"], "tasks": [t["title"] for t in plan["tasks"]]} if plan else None),
                "exported_at": _now()}

    @r.post("/issues/{iid}/share")
    async def share_record(iid: str, req: ShareReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        token = secrets.token_urlsafe(16)
        expires = (datetime.now(timezone.utc) + timedelta(days=max(1, min(90, req.expires_days)))).isoformat()
        await _db.gr_shares.insert_one({"id": _nid(), "token": token, "issue_id": iid, "user_id": user["id"],
                                        "include_evidence": bool(req.include_evidence), "expires_at": expires,
                                        "created_at": _now()})
        await _cap(user["id"], "project.record_shared", {})
        return {"token": token, "path": f"/record/shared/{token}", "expires_at": expires}

    return r


# ----------------------------------------------------------------- public share router (no auth)
def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api/hi/record")

    @r.get("/shared/{token}")
    async def shared(token: str):
        share = await _db.gr_shares.find_one({"token": token}, {"_id": 0})
        if not share:
            raise HTTPException(status_code=404, detail="Share link not found.")
        if share.get("expires_at") and share["expires_at"] < _now():
            raise HTTPException(status_code=410, detail="This share link has expired.")
        iid = share["issue_id"]
        issue = await _db.gr_issues.find_one({"id": iid}, {"_id": 0})
        if not issue:
            raise HTTPException(status_code=404, detail="Record not found.")
        outcome = await _db.gr_outcomes.find_one({"issue_id": iid}, {"_id": 0}, sort=[("created_at", -1)])
        decisions = await _db.gr_decisions.find({"issue_id": iid}, {"_id": 0, "user_id": 0}).sort("created_at", 1).to_list(200)
        evidence = []
        if share.get("include_evidence"):
            evidence = await _db.gr_evidence.find({"issue_id": iid}, {"_id": 0, "base64": 0, "user_id": 0}).sort("created_at", 1).to_list(50)
        return {"disclaimer": "Shared via DIYhomie. This is a homeowner history aid, not a licensed inspection or code-compliance certificate.",
                "objective": issue.get("description"), "category": issue.get("category"),
                "outcome": outcome, "decisions": decisions, "evidence": evidence}

    return r


# ----------------------------------------------------------------- admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/record", dependencies=[Depends(require_admin)])

    @r.get("/signals")
    async def signals(admin: dict = Depends(require_admin)):
        outcomes = await _db.gr_outcomes.find({}, {"_id": 0}).to_list(2000)
        total = len(outcomes)
        by_status = {}
        conf_sum = conf_n = 0
        for o in outcomes:
            s = o.get("outcome_status") or "unknown"
            by_status[s] = by_status.get(s, 0) + 1
            if isinstance(o.get("confidence_rating"), (int, float)):
                conf_sum += o["confidence_rating"]; conf_n += 1
        # Replans (revised plans) & pro handoffs from the quality queue.
        replans = await _db.gr_task_events.count_documents({"event": "repair_task.blocked"})
        pro_handoffs = await _db.gr_quality_queue.count_documents({"reason": "execution_professional_handoff"})
        low_outcomes = await _db.gr_quality_queue.count_documents({"reason": "execution_low_outcome"})
        # Repeat issues by category (rough recurrence signal).
        by_cat = {}
        async for i in _db.gr_issues.find({}, {"_id": 0, "category": 1}):
            by_cat[i.get("category")] = by_cat.get(i.get("category"), 0) + 1
        return {"total_outcomes": total, "by_status": by_status,
                "avg_confidence": round(conf_sum / conf_n, 2) if conf_n else None,
                "replan_events": replans, "professional_handoffs": pro_handoffs,
                "low_outcomes": low_outcomes, "issues_by_category": by_cat}

    return r


async def seed_records():
    if _db is None:
        return
    try:
        await _db.gr_followups.create_index("due_at")
        await _db.gr_shares.create_index("expires_at")
        if _logger:
            _logger.info("property record engine (Build Doc 4) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"property record seed failed: {e}")
