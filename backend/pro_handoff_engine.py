"""
Build Doc 8 — Professional Handoff, Scope & Service Coordination Engine.
Namespace /api/hi/handoff-pro/* (+ public /shared/{token}, admin /api/hi/admin/handoff-pro/*).

Turns a stuck or unsafe project into a clear, evidence-backed brief a homeowner can hand
to the right tradesperson: escalation decision framework (4 states), provenance-tagged
handoff brief, trade-category guidance (categories, never specific providers), visit
prep, professional findings capture, scope comparison, and post-handoff continuation.

Collections: ph_briefs, ph_findings, ph_shares. Reuses gr_* (issues/plans/evidence/
assessments/decisions/timeline/outcomes/followups).
"""
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional, List
import uuid
import secrets

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

ESCALATION_STATES = ("diy_appropriate", "diy_with_caution", "professional_recommended", "professional_required")

TRADE_MAP = {
    "plumbing": ["Licensed plumber"],
    "water_moisture": ["Licensed plumber", "Water damage / mitigation specialist"],
    "electrical_concern": ["Licensed electrician"],
    "hvac": ["HVAC technician"],
    "appliance": ["Appliance repair technician"],
    "drywall_interior_surface": ["Drywall / finishing contractor", "General handyman"],
    "doors_windows": ["Door & window installer", "General handyman"],
    "flooring": ["Flooring contractor"],
    "exterior": ["Roofer / exterior contractor", "General contractor"],
    "pest_unknown_condition": ["Pest control professional", "Home inspector"],
    "other_unsure": ["General handyman", "Home inspector"],
}

VISIT_PREP = [
    "Clear access to the affected area (move furniture/stored items).",
    "Have your DIYhomie handoff brief open or printed.",
    "Know where your main water shut-off and electrical panel are.",
    "Ask for a written scope and cost before work begins.",
    "Ask whether a permit is required for the proposed work.",
]

CONTINUE_ACTIONS = ("professionally_completed", "reopen_diy", "monitoring")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


async def _cap(user_id, event, props=None):
    try:
        from analytics_engine import capture
        await capture(user_id, event, props or {})
    except Exception:
        pass


async def _owned_issue(iid, uid):
    issue = await _db.gr_issues.find_one({"id": iid, "user_id": uid}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Project not found.")
    return issue


async def _escalation(issue: dict) -> dict:
    """Deterministic escalation decision framework — never AI-decided."""
    reasons: List[str] = []
    state = "diy_appropriate"
    triage = issue.get("triage") or {}
    assessment = await _db.gr_assessments.find_one({"issue_id": issue["id"]}, {"_id": 0}, sort=[("version", -1)])
    plan = await _db.gr_plans.find_one({"issue_id": issue["id"]}, {"_id": 0, "tasks": 1, "difficulty": 1}, sort=[("version", -1)])

    if triage.get("hard_stop"):
        state = "professional_required"
        reasons.append("An active safety hold is on this issue" + (f": {triage.get('message')}" if triage.get("message") else "."))
    if assessment and assessment.get("professional_verification_required"):
        if state != "professional_required":
            state = "professional_recommended"
        reasons.append("The assessment flags professional verification before invasive work.")
    if plan and plan.get("difficulty") == "professional_review":
        if state != "professional_required":
            state = "professional_recommended"
        reasons.append("The repair plan itself is rated as needing professional review.")
    stuck = 0
    if plan:
        for t in plan.get("tasks") or []:
            if t.get("status") == "blocked":
                stuck += 1
    if stuck:
        if state == "diy_appropriate":
            state = "diy_with_caution"
        reasons.append(f"{stuck} plan step(s) are blocked.")
    if issue.get("phase") == "BLOCKED_ESCALATED" or issue.get("status") == "escalated":
        if state in ("diy_appropriate", "diy_with_caution"):
            state = "professional_recommended"
        reasons.append("You previously chose to hand this off to a professional.")
    if triage.get("matched") and not triage.get("hard_stop"):
        if state == "diy_appropriate":
            state = "diy_with_caution"
        reasons.append("Some caution flags were noticed during triage: " + ", ".join(triage["matched"][:4]) + ".")
    if not reasons:
        reasons.append("Nothing in the evidence requires a professional — proceed carefully and re-check if anything changes.")
    trades = TRADE_MAP.get(issue.get("category") or "other_unsure", TRADE_MAP["other_unsure"])
    return {"state": state, "reasons": reasons, "trade_categories": trades,
            "note": "DIYhomie recommends service categories, never specific companies."}


class BriefReq(BaseModel):
    include_evidence_ids: Optional[List[str]] = None
    homeowner_note: Optional[str] = None


class FindingsReq(BaseModel):
    professional_type: Optional[str] = None
    summary: str
    diagnosis: Optional[str] = None
    work_performed: Optional[str] = None
    recommendations: Optional[str] = None
    estimated_cost: Optional[float] = None
    followup_needed: Optional[bool] = False
    document_base64: Optional[str] = None


class ScopeReq(BaseModel):
    pro_scope_text: str


class ContinueReq(BaseModel):
    action: str
    note: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/handoff-pro", tags=["handoff-pro"])

    @r.get("/issues/{iid}/escalation")
    async def get_escalation(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        esc = await _escalation(issue)
        brief = await _db.ph_briefs.find_one({"issue_id": iid}, {"_id": 0, "sections": 0}, sort=[("version", -1)])
        findings = await _db.ph_findings.count_documents({"issue_id": iid})
        await _cap(user["id"], "handoff_pro.escalation_viewed", {"state": esc["state"]})
        return {"escalation": esc, "has_brief": bool(brief), "brief_version": brief.get("version") if brief else None,
                "findings_count": findings, "issue": {"id": issue["id"], "description": issue.get("description"),
                                                      "phase": issue.get("phase"), "category": issue.get("category")}}

    @r.post("/issues/{iid}/brief")
    async def create_brief(iid: str, req: BriefReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        esc = await _escalation(issue)
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        ev_q = {"issue_id": iid}
        if req.include_evidence_ids:
            ev_q["id"] = {"$in": req.include_evidence_ids[:50]}
        evidence = await _db.gr_evidence.find(ev_q, {"_id": 0, "base64": 0}).sort("created_at", 1).to_list(100)
        tried = []
        if plan:
            for t in plan.get("tasks") or []:
                if t.get("status") in ("complete", "superseded"):
                    tried.append(f"{t['title']} — {'done' if t['status'] == 'complete' else 'superseded after replan'}")
        system = (
            "You are Homie writing a concise, factual HANDOFF BRIEF a homeowner will show a professional tradesperson. "
            "Use ONLY the provided facts — never invent findings, measurements or history. Plain language, no fluff. "
            "Return STRICT JSON {summary_for_professional: string (3-5 sentences), current_status: string, "
            "questions_to_ask: [4-6 short specific questions the homeowner should ask the professional]}"
        )
        ctx = (f"ISSUE: {issue.get('description')} (category {issue.get('category')})\n"
               f"ESCALATION: {esc['state']} — {esc['reasons']}\n"
               f"ASSESSMENT: {assessment.get('issue_summary') if assessment else '(none)'}\n"
               f"POSSIBLE CAUSES: {[c['cause'] for c in (assessment.get('possible_causes') or [])] if assessment else []}\n"
               f"WHAT WAS TRIED: {tried[:12]}\n"
               f"EVIDENCE NOTES: {[e.get('note') for e in evidence if e.get('note')][:15]}\n"
               f"HOMEOWNER NOTE: {req.homeowner_note or '(none)'}")
        try:
            data = await _llm_json(system, ctx, max_tokens=800, feature_area="handoff_brief")
            summary = str(data.get("summary_for_professional") or "")[:1500]
            status_line = str(data.get("current_status") or "")[:500]
            questions = [str(q)[:250] for q in (data.get("questions_to_ask") or [])][:6]
        except Exception as e:
            if _logger:
                _logger.warning(f"handoff brief AI failed, deterministic fallback: {e}")
            summary = f"Homeowner reports: {issue.get('description')}. " + (assessment.get("issue_summary", "") if assessment else "")
            status_line = f"Project phase: {issue.get('phase')}."
            questions = ["What is the root cause?", "What work do you propose and why?",
                         "What will it cost (range) and how long will it take?", "Is a permit required?"]
        sections = {
            "issue_summary": {"text": issue.get("description"), "provenance": "Reported by homeowner"},
            "assessment": ({"text": assessment.get("issue_summary"), "confidence": assessment.get("confidence_level"),
                            "provenance": "DIYhomie AI assessment (grounded in homeowner evidence)"} if assessment else None),
            "what_was_tried": {"items": tried[:15], "provenance": "Logged plan steps"},
            "evidence": {"items": [{"id": e["id"], "type": e.get("type"), "note": e.get("note"),
                                    "value": e.get("value"), "unit": e.get("unit"),
                                    "has_media": bool(e.get("_had_media")), "created_at": e.get("created_at"),
                                    "provenance": "Captured by homeowner"} for e in evidence[:30]]},
            "safety_flags": {"items": esc["reasons"], "state": esc["state"], "provenance": "DIYhomie safety triage (deterministic)"},
            "homeowner_note": ({"text": req.homeowner_note[:800], "provenance": "Added by homeowner"} if req.homeowner_note else None),
        }
        version = ((await _db.ph_briefs.find_one({"issue_id": iid}, {"version": 1}, sort=[("version", -1)])) or {}).get("version", 0) + 1
        brief = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "version": version,
                 "escalation_state": esc["state"], "trade_categories": esc["trade_categories"],
                 "summary_for_professional": summary, "current_status": status_line,
                 "questions_to_ask": questions, "visit_prep": VISIT_PREP,
                 "sections": sections, "created_at": _now()}
        await _db.ph_briefs.insert_one(dict(brief)); brief.pop("_id", None)
        await _db.gr_timeline.insert_one({"id": _nid(), "user_id": user["id"], "issue_id": iid,
                                          "property_id": issue.get("property_id"), "type": "handoff_brief_created",
                                          "title": "Professional handoff brief created",
                                          "provenance": "system", "created_at": _now()})
        await _cap(user["id"], "handoff_pro.brief_created", {"version": version, "state": esc["state"]})
        return {"brief": brief}

    @r.get("/issues/{iid}/brief")
    async def get_brief(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        brief = await _db.ph_briefs.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if not brief:
            raise HTTPException(status_code=404, detail="No brief yet.")
        share = await _db.ph_shares.find_one({"brief_id": brief["id"], "revoked": False}, {"_id": 0})
        return {"brief": brief, "share": share}

    @r.post("/briefs/{bid}/share")
    async def share_brief(bid: str, user: dict = Depends(get_current_user)):
        brief = await _db.ph_briefs.find_one({"id": bid, "user_id": user["id"]}, {"_id": 0, "sections": 0})
        if not brief:
            raise HTTPException(status_code=404, detail="Brief not found.")
        existing = await _db.ph_shares.find_one({"brief_id": bid, "revoked": False}, {"_id": 0})
        if existing:
            return {"share": existing}
        share = {"id": _nid(), "brief_id": bid, "issue_id": brief["issue_id"], "user_id": user["id"],
                 "token": secrets.token_urlsafe(24), "revoked": False,
                 "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
                 "created_at": _now()}
        await _db.ph_shares.insert_one(dict(share)); share.pop("_id", None)
        await _cap(user["id"], "handoff_pro.brief_shared", {})
        return {"share": share}

    @r.delete("/briefs/{bid}/share")
    async def revoke_share(bid: str, user: dict = Depends(get_current_user)):
        res = await _db.ph_shares.update_many({"brief_id": bid, "user_id": user["id"], "revoked": False},
                                              {"$set": {"revoked": True, "revoked_at": _now()}})
        return {"ok": True, "revoked": res.modified_count}

    @r.post("/issues/{iid}/findings")
    async def add_findings(iid: str, req: FindingsReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        if not (req.summary or "").strip():
            raise HTTPException(status_code=400, detail="A short summary of what the professional found is required.")
        doc = {"id": _nid(), "issue_id": iid, "user_id": user["id"],
               "professional_type": (req.professional_type or "")[:100] or None,
               "summary": req.summary.strip()[:1200], "diagnosis": (req.diagnosis or "")[:1200] or None,
               "work_performed": (req.work_performed or "")[:1200] or None,
               "recommendations": (req.recommendations or "")[:1200] or None,
               "estimated_cost": req.estimated_cost, "followup_needed": bool(req.followup_needed),
               "document_base64": req.document_base64, "created_at": _now()}
        await _db.ph_findings.insert_one(dict(doc))
        doc.pop("_id", None); doc.pop("document_base64", None)
        await _db.gr_timeline.insert_one({"id": _nid(), "user_id": user["id"], "issue_id": iid,
                                          "property_id": issue.get("property_id"), "type": "professional_finding",
                                          "title": f"Professional finding: {doc['summary'][:120]}",
                                          "provenance": "professional (entered by homeowner)", "created_at": _now()})
        if doc["followup_needed"]:
            await _db.gr_followups.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"],
                                               "property_id": issue.get("property_id"),
                                               "room_id": issue.get("room_id"), "asset_id": issue.get("asset_id"),
                                               "title": f"Follow up on professional recommendation: {doc['summary'][:100]}",
                                               "kind": "verification", "status": "open", "due_at": None,
                                               "created_at": _now()})
        await _cap(user["id"], "handoff_pro.findings_added", {"followup": doc["followup_needed"]})
        return {"finding": doc}

    @r.get("/issues/{iid}/findings")
    async def list_findings(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.ph_findings.find({"issue_id": iid}, {"_id": 0, "document_base64": 0}).sort("created_at", -1).to_list(50)
        return {"findings": rows}

    @r.post("/issues/{iid}/scope-compare")
    async def scope_compare(iid: str, req: ScopeReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        text = (req.pro_scope_text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Paste or type the professional's proposed scope first.")
        assessment = await _db.gr_assessments.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0, "tasks": 0}, sort=[("version", -1)])
        system = (
            "You are Homie helping a homeowner UNDERSTAND a professional's proposed scope of work — never to "
            "second-guess a licensed professional's judgment. Compare the proposal with what DIYhomie's evidence "
            "shows. Be factual and humble: unexplained differences become QUESTIONS, not accusations. "
            "Return STRICT JSON {alignment in [aligned, partially_aligned, unclear], notes: string, "
            "differences: [short strings], questions: [3-5 respectful clarifying questions]}"
        )
        ctx = (f"ISSUE: {issue.get('description')}\nDIYHOMIE ASSESSMENT: {assessment.get('issue_summary') if assessment else '(none)'}\n"
               f"DIY PLAN OBJECTIVE: {plan.get('objective') if plan else '(none)'}\n"
               f"PROFESSIONAL'S PROPOSED SCOPE:\n{text[:2500]}")
        try:
            data = await _llm_json(system, ctx, max_tokens=700, feature_area="handoff_scope_compare")
            alignment = data.get("alignment") if data.get("alignment") in ("aligned", "partially_aligned", "unclear") else "unclear"
            notes = str(data.get("notes") or "")[:1200]
            differences = [str(d)[:250] for d in (data.get("differences") or [])][:6]
            questions = [str(q)[:250] for q in (data.get("questions") or [])][:5]
        except Exception:
            alignment, notes, differences, questions = "unclear", "I couldn't compare right now — try again shortly.", [], []
        await _db.gr_decisions.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"],
                                           "type": "scope_comparison",
                                           "summary": f"Compared professional scope ({alignment})",
                                           "detail": notes[:400], "created_at": _now()})
        await _cap(user["id"], "handoff_pro.scope_compared", {"alignment": alignment})
        return {"alignment": alignment, "notes": notes, "differences": differences, "questions": questions}

    @r.post("/issues/{iid}/continue")
    async def post_handoff_continue(iid: str, req: ContinueReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        if req.action not in CONTINUE_ACTIONS:
            raise HTTPException(status_code=400, detail="Invalid action.")
        note = (req.note or "")[:600] or None
        now = _now()
        if req.action == "professionally_completed":
            await _db.gr_issues.update_one({"id": iid}, {"$set": {"phase": "DOCUMENTED", "status": "completed", "updated_at": now}})
            await _db.gr_outcomes.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"],
                                              "property_id": issue.get("property_id"), "room_id": issue.get("room_id"),
                                              "asset_id": issue.get("asset_id"), "outcome": "professionally_completed",
                                              "summary": note or "Completed by a professional.",
                                              "provenance": "homeowner", "created_at": now})
            title = "Project completed by a professional"
        elif req.action == "reopen_diy":
            await _db.gr_issues.update_one({"id": iid}, {"$set": {"phase": "IN_PROGRESS", "status": "active", "updated_at": now}})
            title = "Homeowner resumed DIY work after professional input"
        else:  # monitoring
            await _db.gr_issues.update_one({"id": iid}, {"$set": {"phase": "VERIFICATION", "status": "monitoring", "updated_at": now}})
            await _db.gr_followups.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"],
                                               "property_id": issue.get("property_id"), "room_id": issue.get("room_id"),
                                               "asset_id": issue.get("asset_id"),
                                               "title": f"Monitor after professional visit: {issue.get('description', '')[:100]}",
                                               "kind": "monitoring", "status": "open", "due_at": None, "created_at": now})
            title = "Monitoring the result after professional work"
        await _db.gr_timeline.insert_one({"id": _nid(), "user_id": user["id"], "issue_id": iid,
                                          "property_id": issue.get("property_id"), "type": f"handoff_{req.action}",
                                          "title": title, "note": note, "provenance": "homeowner", "created_at": now})
        await _cap(user["id"], "handoff_pro.continued", {"action": req.action})
        return {"ok": True, "action": req.action}

    return r


def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api/hi/handoff-pro", tags=["handoff-pro-public"])

    @r.get("/shared/{token}")
    async def shared_brief(token: str):
        share = await _db.ph_shares.find_one({"token": token, "revoked": False}, {"_id": 0})
        if not share:
            raise HTTPException(status_code=404, detail="This link is no longer available.")
        if share.get("expires_at") and share["expires_at"] < _now():
            raise HTTPException(status_code=410, detail="This link has expired.")
        brief = await _db.ph_briefs.find_one({"id": share["brief_id"]}, {"_id": 0, "user_id": 0})
        if not brief:
            raise HTTPException(status_code=404, detail="Brief not found.")
        return {"brief": brief, "shared": True,
                "disclaimer": "Prepared by the homeowner with DIYhomie. AI-assisted summary of homeowner-provided evidence — verify on site."}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/handoff-pro", tags=["handoff-pro-admin"])

    @r.get("/signals")
    async def signals(admin: dict = Depends(require_admin)):
        briefs = await _db.ph_briefs.count_documents({})
        findings = await _db.ph_findings.count_documents({})
        shares = await _db.ph_shares.count_documents({"revoked": False})
        states: dict = {}
        async for b in _db.ph_briefs.find({}, {"_id": 0, "escalation_state": 1}):
            states[b.get("escalation_state") or "unknown"] = states.get(b.get("escalation_state") or "unknown", 0) + 1
        return {"briefs": briefs, "findings": findings, "active_shares": shares, "escalation_states": states}

    return r
