"""
DIYhomie — Customer Support Intelligence & Support Operations (Build Blueprint 42).

A scoped, approved-knowledge support system distinct from Homie. The Support
Assistant answers DIYhomie account/product/billing/troubleshooting questions using
ONLY approved support-knowledge articles, routes to the right category, estimates
priority, spots likely duplicates/known incidents, and always leaves a friction-free
path to a human. It never changes billing, promises refunds, or accesses private
data outside the caller's own scope.

The assistant is deterministic KB-retrieval today and is architected so an external
support-automation layer (e.g. Dify) can be plugged in later behind the same contract.

User namespace   /api/hi/support/*
Admin namespace  /api/hi/admin/support/*
Collections: sup_tickets, sup_messages, sup_resolutions, sup_feedback, sup_kb, sup_access_log
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

CATEGORIES = [
    "account_access", "subscription_billing", "project_maintenance", "document_upload",
    "ai_response", "technical_bug", "rewards", "collaboration", "privacy_data", "safety_concern", "other",
]
CATEGORY_LABELS = {
    "account_access": "Account access", "subscription_billing": "Subscription & billing",
    "project_maintenance": "Project or maintenance issue", "document_upload": "Document upload issue",
    "ai_response": "AI response issue", "technical_bug": "Technical bug", "rewards": "Rewards issue",
    "collaboration": "Collaboration access", "privacy_data": "Privacy or data request",
    "safety_concern": "Safety concern", "other": "Other",
}
PRIORITIES = ["critical", "high", "normal", "low"]
STATUSES = ["open", "in_progress", "waiting_user", "resolved", "closed"]
RESOLUTION_TYPES = ["self_service", "ai_resolved", "human_resolved", "refund_future", "bug_confirmed", "duplicate", "unable_to_resolve"]

# Category -> default priority. Keyword escalation can raise it.
CATEGORY_PRIORITY = {
    "account_access": "high", "subscription_billing": "high", "rewards": "high",
    "project_maintenance": "normal", "document_upload": "normal", "ai_response": "normal",
    "collaboration": "normal", "privacy_data": "critical", "safety_concern": "critical", "technical_bug": "normal", "other": "low",
}
CRITICAL_KEYWORDS = ["hacked", "compromis", "breach", "unauthorized", "fraud", "data loss", "lost my data",
                     "privacy", "leak", "safety", "can't pay", "double charged", "charged twice"]
HIGH_KEYWORDS = ["locked out", "can't log in", "cannot log in", "reset password", "refund", "billing",
                 "subscription", "entitlement", "redeem", "inaccessible", "not working"]
LOW_KEYWORDS = ["feature request", "suggestion", "idea", "would be nice", "cosmetic", "typo"]


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


def _classify_priority(category: str, text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in CRITICAL_KEYWORDS):
        return "critical"
    base = CATEGORY_PRIORITY.get(category, "normal")
    if base == "critical":
        return "critical"
    if any(k in t for k in LOW_KEYWORDS):
        return "low"
    if any(k in t for k in HIGH_KEYWORDS):
        return "high"
    return base


def _guess_category(text: str) -> str:
    t = (text or "").lower()
    rules = [
        ("subscription_billing", ["bill", "charge", "refund", "subscription", "plan", "payment", "invoice"]),
        ("account_access", ["log in", "login", "password", "locked", "sign in", "access my account"]),
        ("rewards", ["reward", "points", "redeem", "redemption"]),
        ("privacy_data", ["delete my", "privacy", "export", "my data", "gdpr"]),
        ("document_upload", ["upload", "document", "receipt", "manual", "pdf"]),
        ("ai_response", ["homie said", "wrong answer", "ai response", "incorrect advice"]),
        ("collaboration", ["invite", "collaborator", "share access", "shared with"]),
        ("project_maintenance", ["project", "maintenance", "task", "reminder"]),
        ("technical_bug", ["crash", "error", "bug", "broken", "won't load", "not working"]),
    ]
    for cat, kws in rules:
        if any(k in t for k in kws):
            return cat
    return "other"


def _score_article(query: str, art: dict) -> int:
    q = (query or "").lower()
    title = (art.get("title") or "").lower()
    content = (art.get("content") or "").lower()
    cat = (art.get("category") or "").lower()
    s = 0
    if q and q in title:
        s += 60
    tokens = [w for w in re.split(r"\W+", q) if len(w) > 2]
    s += sum(8 for w in tokens if w in title)
    s += sum(3 for w in tokens if w in content)
    if art.get("category") and art["category"] == _guess_category(query):
        s += 10
    return s


async def _approved_kb() -> list:
    return await _db.sup_kb.find({"status": {"$in": ["approved", "published"]}}, {"_id": 0}).to_list(300)


class AssistReq(BaseModel):
    message: str
    category: Optional[str] = None


class TicketReq(BaseModel):
    subject: str
    description: str
    category: Optional[str] = None
    context: Optional[dict] = None
    attachment_reference: Optional[str] = None


class MessageReq(BaseModel):
    body: str
    attachment_reference: Optional[str] = None


class FeedbackReq(BaseModel):
    rating: Optional[int] = None
    feedback: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/help")

    @r.get("/categories")
    async def categories(user: dict = Depends(get_current_user)):
        await _cap(user, "support_opened", {"surface": "categories"})
        return {"categories": [{"key": k, "label": CATEGORY_LABELS[k]} for k in CATEGORIES]}

    @r.get("/kb")
    async def kb(user: dict = Depends(get_current_user)):
        arts = await _approved_kb()
        return {"articles": [{k: a[k] for k in ("id", "title", "category", "content", "version", "last_reviewed_at") if k in a} for a in arts]}

    @r.get("/kb/{aid}")
    async def kb_one(aid: str, user: dict = Depends(get_current_user)):
        a = await _db.sup_kb.find_one({"id": aid, "status": {"$in": ["approved", "published"]}}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Article not found.")
        return {"article": a}

    @r.post("/assist")
    async def assist(req: AssistReq, user: dict = Depends(get_current_user)):
        category = req.category if req.category in CATEGORIES else _guess_category(req.message)
        await _cap(user, "support_category_selected", {"category": category})
        priority = _classify_priority(category, req.message)

        # Known-incident awareness (from B37 release incidents).
        try:
            open_incident = await _db.rel_incidents.find_one(
                {"status": {"$nin": ["resolved"]}}, {"_id": 0, "title": 1})
        except Exception:
            open_incident = None

        # Approved-KB self-service (scoped; never fabricates outside KB).
        kb = await _approved_kb()
        scored = sorted(((a, _score_article(req.message, a)) for a in kb), key=lambda x: x[1], reverse=True)
        matches = [a for a, s in scored if s > 0][:3]
        matched = len(matches) > 0
        await _cap(user, "support_ai_response_shown", {"matched": matched})

        if matched:
            top = matches[0]
            answer = (f"Here's what should help with {CATEGORY_LABELS[category].lower()}:\n\n"
                      f"{(top.get('content') or '')[:600]}")
        else:
            answer = ("I couldn't find an approved help article for this yet. You can create a ticket and a "
                      "person from our team will help. I won't guess on account, billing, or safety matters.")

        # Likely duplicate: an existing open ticket in same category.
        dup = await _db.sup_tickets.find_one(
            {"user_id": user["id"], "category": category, "status": {"$in": ["open", "in_progress", "waiting_user"]}},
            {"_id": 0, "id": 1, "subject": 1})

        return {
            "category": category, "category_label": CATEGORY_LABELS[category], "priority": priority,
            "answer": answer, "matched": matched,
            "articles": [{"id": a["id"], "title": a["title"], "category": a["category"]} for a in matches],
            "escalation_recommended": priority in ("critical", "high") or not matched,
            "possible_duplicate": dup,
            "known_incident": {"title": open_incident.get("title")} if open_incident else None,
            "disclaimer": "Support AI uses only approved help content and can't change billing, issue refunds, or give legal/financial advice.",
        }

    @r.post("/tickets")
    async def create_ticket(req: TicketReq, user: dict = Depends(get_current_user)):
        if not req.subject.strip() or not req.description.strip():
            raise HTTPException(status_code=400, detail="Add a subject and a short description.")
        category = req.category if req.category in CATEGORIES else "other"
        priority = _classify_priority(category, f"{req.subject} {req.description}")
        # Contextual metadata only — never raw docs/photos/payment/address.
        ctx = {k: v for k, v in (req.context or {}).items()
               if k in ("screen", "feature_area", "app_version", "device_type", "error_code",
                        "correlation_id", "recent_action", "related_entity_type", "related_entity_id")}
        # Doc 33 context-first support: auto-attach a Homie handoff summary for project tickets
        # so the homeowner never has to repeat their whole story.
        if ctx.get("related_entity_type") == "gr_issue" and ctx.get("related_entity_id"):
            issue = await _db.gr_issues.find_one({"id": ctx["related_entity_id"], "user_id": user["id"]}, {"_id": 0})
            if issue:
                ev_n = await _db.gr_evidence.count_documents({"issue_id": issue["id"]})
                plan = await _db.gr_plans.find_one({"issue_id": issue["id"]}, {"_id": 0, "version": 1})
                ctx["homie_summary"] = {
                    "project": (issue.get("description") or "")[:180],
                    "category": issue.get("category"), "phase": issue.get("phase"),
                    "urgency": issue.get("urgency"), "evidence_items": ev_n,
                    "plan_version": (plan or {}).get("version", 0),
                    "risk_flags": (issue.get("risk_flags") or [])[:5],
                }
        tid = _nid()
        doc = {"id": tid, "user_id": user["id"], "category": category, "priority": priority,
               "subject": req.subject.strip()[:160], "description": req.description.strip()[:4000],
               "status": "open", "related_entity_type": ctx.get("related_entity_type"),
               "related_entity_id": ctx.get("related_entity_id"), "assigned_team": None,
               "assigned_admin_id": None, "linked_incident_id": None, "context": ctx,
               "created_at": _now(), "updated_at": _now()}
        await _db.sup_tickets.insert_one(dict(doc)); doc.pop("_id", None)
        await _db.sup_messages.insert_one({"id": _nid(), "support_ticket_id": tid, "sender_type": "user",
                                           "sender_id": user["id"], "body": req.description.strip()[:4000],
                                           "attachment_reference": req.attachment_reference, "created_at": _now()})
        await _cap(user, "ticket_created", {"category": category, "priority": priority})
        # Doc 33 safety incident handling: elevated path, never automated reassurance.
        if category == "safety_concern" or (priority == "critical" and "safety" in f"{req.subject} {req.description}".lower()):
            try:
                import admin_ops_engine
                await admin_ops_engine.record_safety_escalation(
                    user["id"], risk_level="high", trigger_type="support_safety_ticket",
                    ai_response_reference=f"ticket:{tid} {req.subject.strip()[:120]}")
            except Exception:
                pass
            doc["safety_note"] = ("If anyone is in danger or you smell gas or see fire, leave the area and call "
                                  "emergency services now. A team member will review this report with priority.")
            await _db.sup_tickets.update_one({"id": tid}, {"$set": {"safety_note": doc["safety_note"]}})
        return {"ticket": doc}

    @r.get("/tickets")
    async def list_tickets(user: dict = Depends(get_current_user)):
        rows = await _db.sup_tickets.find({"user_id": user["id"]}, {"_id": 0, "context": 0}).sort("created_at", -1).to_list(200)
        return {"tickets": rows}

    @r.get("/tickets/{tid}")
    async def get_ticket(tid: str, user: dict = Depends(get_current_user)):
        t = await _db.sup_tickets.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        msgs = await _db.sup_messages.find({"support_ticket_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(500)
        # Users don't see internal notes.
        msgs = [m for m in msgs if m["sender_type"] != "internal_note"]
        res = await _db.sup_resolutions.find({"support_ticket_id": tid}, {"_id": 0}).to_list(20)
        return {"ticket": t, "messages": msgs, "resolutions": res}

    @r.post("/tickets/{tid}/messages")
    async def add_message(tid: str, req: MessageReq, user: dict = Depends(get_current_user)):
        t = await _db.sup_tickets.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        m = {"id": _nid(), "support_ticket_id": tid, "sender_type": "user", "sender_id": user["id"],
             "body": req.body.strip()[:4000], "attachment_reference": req.attachment_reference, "created_at": _now()}
        await _db.sup_messages.insert_one(dict(m)); m.pop("_id", None)
        await _db.sup_tickets.update_one({"id": tid}, {"$set": {"status": "open", "updated_at": _now()}})
        return {"message": m}

    @r.post("/tickets/{tid}/feedback")
    async def feedback(tid: str, req: FeedbackReq, user: dict = Depends(get_current_user)):
        t = await _db.sup_tickets.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        doc = {"id": _nid(), "support_ticket_id": tid, "user_rating": req.rating,
               "user_feedback": (req.feedback or "")[:1000] or None, "created_at": _now()}
        await _db.sup_feedback.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user, "support_feedback_submitted", {"rating": req.rating})
        return {"feedback": doc}

    @r.post("/tickets/{tid}/reopen")
    async def reopen(tid: str, user: dict = Depends(get_current_user)):
        t = await _db.sup_tickets.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        if t["status"] not in ("resolved", "closed"):
            raise HTTPException(status_code=400, detail="This ticket is already open.")
        await _db.sup_tickets.update_one({"id": tid}, {"$set": {"status": "open", "updated_at": _now()}})
        return {"ok": True}

    return r


class AdminTicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_team: Optional[str] = None
    assigned_admin_id: Optional[str] = None
    linked_incident_id: Optional[str] = None


class AdminReplyReq(BaseModel):
    body: str


class ResolveReq(BaseModel):
    resolution_type: str
    summary: str


class KbReq(BaseModel):
    title: str
    category: str
    content: str
    status: str = "draft"


class KbUpdateReq(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/help", dependencies=[Depends(require_admin)])

    async def _log_access(admin_id, tid, action):
        try:
            await _db.sup_access_log.insert_one({"id": _nid(), "admin_id": admin_id, "ticket_id": tid,
                                                 "action": action, "at": _now()})
        except Exception:
            pass

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        all_t = await _db.sup_tickets.find({}, {"_id": 0}).to_list(2000)
        by_status = {}
        by_cat = {}
        by_prio = {}
        for t in all_t:
            by_status[t["status"]] = by_status.get(t["status"], 0) + 1
            by_cat[t["category"]] = by_cat.get(t["category"], 0) + 1
            by_prio[t["priority"]] = by_prio.get(t["priority"], 0) + 1
        resolutions = await _db.sup_resolutions.find({}, {"_id": 0}).to_list(2000)
        ai_resolved = len([x for x in resolutions if x["resolution_type"] in ("ai_resolved", "self_service")])
        escalated = len([t for t in all_t if t["priority"] in ("critical", "high") and t["status"] in ("open", "in_progress")])
        kb_count = await _db.sup_kb.count_documents({"status": {"$in": ["approved", "published"]}})
        top_cats = sorted(by_cat.items(), key=lambda x: x[1], reverse=True)[:5]
        return {"total": len(all_t), "open": by_status.get("open", 0), "in_progress": by_status.get("in_progress", 0),
                "waiting_user": by_status.get("waiting_user", 0), "resolved": by_status.get("resolved", 0),
                "by_priority": by_prio, "by_category": by_cat, "top_categories": top_cats,
                "ai_resolved": ai_resolved, "escalated_open": escalated, "kb_published": kb_count}

    @r.get("/tickets")
    async def list_tickets(status: Optional[str] = None, priority: Optional[str] = None, category: Optional[str] = None,
                           admin: dict = Depends(require_admin)):
        q = {}
        if status:
            q["status"] = status
        if priority:
            q["priority"] = priority
        if category:
            q["category"] = category
        rows = await _db.sup_tickets.find(q, {"_id": 0}).sort([("priority", 1), ("created_at", -1)]).to_list(500)
        prio_rank = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        rows.sort(key=lambda t: (prio_rank.get(t["priority"], 9), t["created_at"]))
        return {"tickets": rows}

    @r.get("/tickets/{tid}")
    async def get_ticket(tid: str, admin: dict = Depends(require_admin)):
        t = await _db.sup_tickets.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        await _log_access(admin["id"], tid, "view")
        msgs = await _db.sup_messages.find({"support_ticket_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(500)
        res = await _db.sup_resolutions.find({"support_ticket_id": tid}, {"_id": 0}).to_list(20)
        fb = await _db.sup_feedback.find({"support_ticket_id": tid}, {"_id": 0}).to_list(20)
        return {"ticket": t, "messages": msgs, "resolutions": res, "feedback": fb}

    @r.put("/tickets/{tid}")
    async def update_ticket(tid: str, req: AdminTicketUpdate, admin: dict = Depends(require_admin)):
        t = await _db.sup_tickets.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        upd = {"updated_at": _now()}
        if req.status is not None:
            if req.status not in STATUSES:
                raise HTTPException(status_code=400, detail="Invalid status.")
            upd["status"] = req.status
        if req.priority is not None:
            if req.priority not in PRIORITIES:
                raise HTTPException(status_code=400, detail="Invalid priority.")
            upd["priority"] = req.priority
        if req.assigned_team is not None:
            upd["assigned_team"] = req.assigned_team[:60]
        if req.assigned_admin_id is not None:
            upd["assigned_admin_id"] = req.assigned_admin_id
        if req.linked_incident_id is not None:
            upd["linked_incident_id"] = req.linked_incident_id
        await _db.sup_tickets.update_one({"id": tid}, {"$set": upd})
        await _log_access(admin["id"], tid, "update")
        return {"ticket": {**t, **upd}}

    @r.post("/tickets/{tid}/notes")
    async def add_note(tid: str, req: AdminReplyReq, admin: dict = Depends(require_admin)):
        if not await _db.sup_tickets.find_one({"id": tid}):
            raise HTTPException(status_code=404, detail="Ticket not found.")
        m = {"id": _nid(), "support_ticket_id": tid, "sender_type": "internal_note", "sender_id": admin["id"],
             "body": req.body.strip()[:4000], "attachment_reference": None, "created_at": _now()}
        await _db.sup_messages.insert_one(dict(m)); m.pop("_id", None)
        return {"note": m}

    @r.post("/tickets/{tid}/reply")
    async def reply(tid: str, req: AdminReplyReq, admin: dict = Depends(require_admin)):
        if not await _db.sup_tickets.find_one({"id": tid}):
            raise HTTPException(status_code=404, detail="Ticket not found.")
        m = {"id": _nid(), "support_ticket_id": tid, "sender_type": "admin", "sender_id": admin["id"],
             "body": req.body.strip()[:4000], "attachment_reference": None, "created_at": _now()}
        await _db.sup_messages.insert_one(dict(m)); m.pop("_id", None)
        await _db.sup_tickets.update_one({"id": tid}, {"$set": {"status": "waiting_user", "updated_at": _now()}})
        return {"message": m}

    @r.post("/tickets/{tid}/resolve")
    async def resolve(tid: str, req: ResolveReq, admin: dict = Depends(require_admin)):
        if req.resolution_type not in RESOLUTION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid resolution type.")
        t = await _db.sup_tickets.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        doc = {"id": _nid(), "support_ticket_id": tid, "resolution_type": req.resolution_type,
               "summary": req.summary.strip()[:2000], "created_at": _now()}
        await _db.sup_resolutions.insert_one(dict(doc)); doc.pop("_id", None)
        await _db.sup_tickets.update_one({"id": tid}, {"$set": {"status": "resolved", "updated_at": _now()}})
        return {"resolution": doc}

    @r.get("/kb")
    async def list_kb(admin: dict = Depends(require_admin)):
        rows = await _db.sup_kb.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
        return {"articles": rows}

    @r.post("/kb")
    async def create_kb(req: KbReq, admin: dict = Depends(require_admin)):
        if req.status not in ("draft", "approved", "published", "archived"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        doc = {"id": _nid(), "title": req.title.strip()[:160], "category": req.category[:60],
               "content": req.content[:8000], "status": req.status, "version": 1,
               "last_reviewed_at": None, "created_at": _now(), "updated_at": _now()}
        await _db.sup_kb.insert_one(dict(doc)); doc.pop("_id", None)
        return {"article": doc}

    @r.put("/kb/{aid}")
    async def update_kb(aid: str, req: KbUpdateReq, admin: dict = Depends(require_admin)):
        a = await _db.sup_kb.find_one({"id": aid}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Article not found.")
        upd = {"updated_at": _now(), "version": a.get("version", 1) + 1}
        if req.title is not None:
            upd["title"] = req.title.strip()[:160]
        if req.content is not None:
            upd["content"] = req.content[:8000]
        if req.status is not None:
            if req.status not in ("draft", "approved", "published", "archived"):
                raise HTTPException(status_code=400, detail="Invalid status.")
            upd["status"] = req.status
            if req.status in ("approved", "published"):
                upd["last_reviewed_at"] = _now()
        await _db.sup_kb.update_one({"id": aid}, {"$set": upd})
        return {"article": {**a, **upd}}

    @r.get("/access-log")
    async def access_log(admin: dict = Depends(require_admin)):
        rows = await _db.sup_access_log.find({}, {"_id": 0}).sort("at", -1).to_list(200)
        return {"log": rows}

    return r


_SEED_KB = [
    ("Create your account", "account_access", "Tap Sign up on the welcome screen, enter your email and a password, and verify your email. You can also continue with Google."),
    ("Reset your password", "account_access", "On the login screen tap 'Forgot password', enter your email, and follow the reset link we send. Links expire after a short time for security."),
    ("Manage your subscription", "subscription_billing", "Open Profile > Manage plan to view your plan, change tiers, or cancel. Changes take effect at the end of your billing period. We never charge without your action."),
    ("Upload documents", "document_upload", "In My Home > Documents tap Add, choose a photo or file, pick a category, and save. Images are scanned to pull out useful details you can confirm."),
    ("Use projects", "project_maintenance", "Start a project from Home by telling Homie what you want to do. Track steps, materials, and costs, and mark steps complete as you go."),
    ("Use maintenance reminders", "project_maintenance", "In My Home > Maintenance add a task with a due date and how often it repeats. We'll remind you and track completion."),
    ("Map a room", "project_maintenance", "In My Home > Rooms tap Add, name the room, and optionally add a photo. You can attach assets, documents, and measurements to each room."),
    ("Manage your privacy", "privacy_data", "Open Profile > Privacy to see what data we hold, export a copy, or control sharing. Your property data stays private to you and people you invite."),
    ("Delete your account", "privacy_data", "Profile > Privacy > Delete account starts a review-and-delete process. We remove your data per our retention policy. This can't be undone once complete."),
    ("Manage rewards", "rewards", "Open Rewards to see your points, how you earned them, and available redemptions. Points are approved before they can be redeemed."),
    ("Contact support", "other", "You can reach a person any time from Profile > Support or the Support button. Choose a category, try the quick help, and create a ticket if you still need help."),
    ("Known service-status issues", "technical_bug", "If something platform-wide is affecting many users, we'll show a status note here and on affected screens so you don't have to troubleshoot on your own."),
]


async def seed_support():
    if _db is None:
        return
    try:
        await _db.sup_tickets.create_index("user_id")
        await _db.sup_messages.create_index("support_ticket_id")
        await _db.sup_kb.create_index("status")
        if await _db.sup_kb.count_documents({}) == 0:
            for title, cat, content in _SEED_KB:
                await _db.sup_kb.insert_one({"id": _nid(), "title": title, "category": cat, "content": content,
                                             "status": "published", "version": 1, "last_reviewed_at": _now(),
                                             "created_at": _now(), "updated_at": _now()})
        if _logger:
            _logger.info("support intelligence (B42) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"support seed failed: {e}")
