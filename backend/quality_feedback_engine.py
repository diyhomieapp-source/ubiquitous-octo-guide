"""
Build Doc 26 (delta) — Lightweight quality feedback + project funnel.
Namespace /api/hi/feedback (user) + /api/hi/admin/quality (admin).

- "Did this help?" (yes / somewhat / no) after Homie answers and project plans,
  linked to the exact context (conversation, plan, assessment) — qf_feedback.
- Admin project funnel: created → assessed → planned → in progress → completed,
  with abandonment by category, plus feedback rating breakdown.
"""
from datetime import datetime, timezone
from typing import Callable, Optional
import uuid

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

_db = None
_logger = None

RATINGS = ("yes", "somewhat", "no")
CONTEXT_TYPES = ("homie_answer", "project_plan", "repair_assessment", "readiness_list",
                 "handoff_brief", "tool_advice", "market_options", "other")


def _now():
    return datetime.now(timezone.utc).isoformat()


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


class FeedbackReq(BaseModel):
    context_type: str
    context_id: Optional[str] = None
    issue_id: Optional[str] = None
    rating: str
    note: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/feedback", tags=["quality-feedback"])

    @r.post("/submit")
    async def submit(req: FeedbackReq, user: dict = Depends(get_current_user)):
        if req.rating not in RATINGS:
            raise HTTPException(status_code=400, detail="Invalid rating.")
        ctype = req.context_type if req.context_type in CONTEXT_TYPES else "other"
        doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "context_type": ctype,
               "context_id": (req.context_id or "")[:80] or None,
               "issue_id": (req.issue_id or "")[:80] or None,
               "rating": req.rating, "note": (req.note or "")[:400] or None,
               "created_at": _now()}
        await _db.qf_feedback.insert_one(dict(doc)); doc.pop("_id", None)
        try:
            from analytics_engine import capture
            await capture(user["id"], "HOMIE_RESPONSE_RATED", {"context_type": ctype, "rating": req.rating})
        except Exception:
            pass
        return {"ok": True}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/quality", tags=["quality-admin"])

    @r.get("/funnel")
    async def funnel(admin: dict = Depends(require_admin)):
        issues = await _db.gr_issues.find({}, {"_id": 0, "id": 1, "category": 1, "phase": 1, "status": 1}).to_list(5000)
        assessed_ids = {a["issue_id"] for a in await _db.gr_assessments.find({}, {"_id": 0, "issue_id": 1}).to_list(5000)}
        planned_ids = {p["issue_id"] for p in await _db.gr_plans.find({}, {"_id": 0, "issue_id": 1}).to_list(5000)}
        by_cat: dict = {}
        totals = {"created": 0, "assessed": 0, "planned": 0, "in_progress": 0, "completed": 0}
        for i in issues:
            cat = i.get("category") or "other"
            c = by_cat.setdefault(cat, {"created": 0, "assessed": 0, "planned": 0, "in_progress": 0, "completed": 0})
            c["created"] += 1
            if i["id"] in assessed_ids:
                c["assessed"] += 1
            if i["id"] in planned_ids:
                c["planned"] += 1
            if i.get("phase") in ("IN_PROGRESS", "VERIFICATION") or i.get("status") in ("active", "monitoring"):
                c["in_progress"] += 1
            if i.get("phase") in ("DOCUMENTED", "COMPLETED") or i.get("status") == "completed":
                c["completed"] += 1
        for c in by_cat.values():
            for k in totals:
                totals[k] += c[k]
        for cat, c in by_cat.items():
            c["completion_rate"] = round(c["completed"] / c["created"] * 100) if c["created"] else 0
            c["abandonment_stage"] = ("before_assessment" if c["assessed"] < c["created"] * 0.5 else
                                      "before_plan" if c["planned"] < c["assessed"] * 0.5 else
                                      "during_execution" if c["completed"] < c["planned"] * 0.5 else "healthy")
        # Feedback breakdown.
        fb: dict = {}
        async for f in _db.qf_feedback.find({}, {"_id": 0, "context_type": 1, "rating": 1}):
            b = fb.setdefault(f["context_type"], {"yes": 0, "somewhat": 0, "no": 0})
            b[f["rating"]] = b.get(f["rating"], 0) + 1
        return {"totals": totals, "by_category": by_cat, "feedback": fb,
                "overall_completion_rate": round(totals["completed"] / totals["created"] * 100) if totals["created"] else 0}

    return r
