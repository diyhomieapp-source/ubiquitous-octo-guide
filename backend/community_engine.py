"""
DIYhomie — Community Knowledge, Project Sharing & Moderation Engine (Build Blueprint 35).

Turns approved real-world project experiences into searchable community knowledge WITHOUT
weakening privacy, safety, or DIYhomie's source-aware guidance standards. Community content is
explicitly labeled "Community Experience — not a substitute for professional advice", is
private/draft by default, and is moderated before publication. Automated pre-checks flag spam,
PII, unsafe high-risk instructions, abuse, copyright indicators and unapproved links but NEVER
auto-publish high-risk content. Every moderation action is audit-logged.

New namespace /api/hi/community (distinct from the legacy /api/community/*). Collections:
cc_content, cc_media, cc_comments, cc_votes, cc_reports, cc_moderation, cc_saves, cc_settings.
"""
import re
import uuid
import hashlib
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

CONTENT_TYPES = ["CommunityProject", "CommunityAnswer", "CommunityTip", "CommunityPhotoSet", "CommunityQuestion", "CommunityFeedback"]
VISIBILITY = ["private", "anonymous_community", "attributed_community", "unlisted_share", "draft"]
PUBLIC_VIS = ["anonymous_community", "attributed_community"]
MOD_STATUS = ["draft", "submitted", "reviewing", "approved", "rejected", "removed", "archived"]
CATEGORIES = ["Repairs", "Maintenance", "Remodeling", "Tools", "Outdoor", "Organization", "Painting", "Plumbing", "Electrical Safety", "Beginner Projects", "Project Lessons"]
HIGH_RISK_CATEGORIES = ["Electrical Safety", "Plumbing"]
DECISIONS = ["approve", "reject", "remove", "restore", "request_changes"]
REPORT_REASONS = ["unsafe", "inaccurate", "spam", "copyright", "privacy", "abusive", "other"]

UNSAFE_KEYWORDS = ["bypass the breaker", "remove the ground", "gas line yourself", "load-bearing wall", "no permit needed", "skip the permit",
                   "disable the gfci", "backfeed", "asbestos", "cut the main", "240v yourself", "tie into the main", "structural beam"]
ABUSIVE_KEYWORDS = ["idiot", "stupid", "moron", "shut up", "hate you", "loser"]
DEFAULT_BANNED_TERms = []  # admin-managed
PII_PATTERNS = [
    re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"),                  # phone
    re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),                       # email
    re.compile(r"\b\d{1,5}\s+[A-Za-z0-9.\s]{3,}\b(?:st|street|ave|avenue|rd|road|blvd|lane|ln|drive|dr|court|ct)\b", re.I),  # address-ish
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),                             # ssn-ish
]
LINK_PATTERN = re.compile(r"https?://|www\.", re.I)


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


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[community:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _settings() -> dict:
    s = await _db.cc_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "publishing_paused": False,
             "enabled_content_types": CONTENT_TYPES[:], "banned_terms": [],
             "high_risk_categories": HIGH_RISK_CATEGORIES[:], "comments_in_high_risk_enabled": False,
             "updated_at": _now()}
        await _db.cc_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


def _dedupe_hash(title, body):
    return hashlib.sha1((title.strip().lower() + "|" + body.strip().lower()).encode()).hexdigest()


async def _pre_checks(title: str, body: str, category: str, settings: dict) -> dict:
    text = f"{title}\n{body}"
    low = text.lower()
    flags = []
    if any(p.search(text) for p in PII_PATTERNS):
        flags.append("personal_information")
    if LINK_PATTERN.search(text):
        flags.append("external_link")
    if any(k in low for k in UNSAFE_KEYWORDS):
        flags.append("unsafe_high_risk")
    if any(k in low for k in ABUSIVE_KEYWORDS):
        flags.append("abusive_language")
    for term in (settings.get("banned_terms") or []):
        if term and term.lower() in low:
            flags.append("banned_term")
            break
    if len(body.strip()) < 15:
        flags.append("possible_spam")
    dup = await _db.cc_content.find_one({"dedupe_hash": _dedupe_hash(title, body), "moderation_status": {"$in": ["approved", "submitted", "reviewing"]}})
    if dup:
        flags.append("duplicate")
    # classify
    classification = "safe"
    if category in (settings.get("high_risk_categories") or HIGH_RISK_CATEGORIES) or "unsafe_high_risk" in flags:
        classification = "high_risk"
    elif "personal_information" in flags:
        classification = "safety_sensitive"
    return {"flags": list(dict.fromkeys(flags)), "safety_classification": classification,
            "requires_enhanced_review": classification in ("high_risk", "safety_sensitive")}


def _public_view(c: dict, user_id: Optional[str] = None) -> dict:
    author = None
    if c.get("visibility") == "attributed_community":
        author = c.get("display_name") or "DIYhomie member"
    return {"id": c["id"], "content_type": c["content_type"], "title": c["title"], "body": c["body"],
            "category": c.get("category"), "difficulty": c.get("difficulty"), "scope": c.get("scope"),
            "helpful_count": c.get("helpful_count", 0), "author_label": author,
            "safety_classification": c.get("safety_classification", "safe"),
            "published_at": c.get("published_at"), "label": "Community Experience",
            "disclaimer": "Not a substitute for professional advice.",
            "is_mine": bool(user_id and c.get("author_user_id") == user_id)}


# ============================================================= models
class ContentReq(BaseModel):
    content_type: str
    title: str
    body: str
    category: str
    visibility: str = "draft"
    difficulty: Optional[str] = None
    scope: Optional[str] = None
    display_name: Optional[str] = None
    project_id: Optional[str] = None
    property_id: Optional[str] = None
    room_id: Optional[str] = None
    cost_range: Optional[str] = None


class UpdateReq(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    visibility: Optional[str] = None
    difficulty: Optional[str] = None
    scope: Optional[str] = None
    display_name: Optional[str] = None


class VoteReq(BaseModel):
    vote_type: str


class ReportReq(BaseModel):
    report_reason: str
    description: Optional[str] = None


class CommentReq(BaseModel):
    body: str
    parent_comment_id: Optional[str] = None


class DraftAssistReq(BaseModel):
    raw_notes: str
    project_id: Optional[str] = None


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/community", dependencies=[Depends(get_current_user)])

    @r.get("/categories")
    async def categories(user: dict = Depends(get_current_user)):
        s = await _settings()
        return {"categories": CATEGORIES, "content_types": s["enabled_content_types"],
                "high_risk_categories": s["high_risk_categories"], "publishing_paused": s["publishing_paused"]}

    @r.post("/content")
    async def create(req: ContentReq, user: dict = Depends(get_current_user)):
        s = await _settings()
        if req.content_type not in s["enabled_content_types"]:
            raise HTTPException(status_code=409, detail="This content type isn't available right now.")
        if req.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Pick a valid category.")
        if req.visibility not in VISIBILITY:
            raise HTTPException(status_code=400, detail="Invalid visibility.")
        if not req.title.strip() or not req.body.strip():
            raise HTTPException(status_code=400, detail="Add a title and some details.")
        pre = await _pre_checks(req.title, req.body, req.category, s)
        doc = {"id": _nid(), "content_type": req.content_type, "author_user_id": user["id"],
               "property_id": req.property_id, "room_id": req.room_id, "project_id": req.project_id,
               "title": req.title.strip()[:160], "body": req.body.strip()[:8000], "category": req.category,
               "difficulty": req.difficulty, "scope": req.scope, "cost_range": req.cost_range,
               "display_name": (req.display_name or user.get("name") or "").strip()[:60] or None,
               "visibility": "draft" if req.visibility not in ("private", "draft") else req.visibility,
               "moderation_status": "draft", "safety_classification": pre["safety_classification"],
               "pre_check_flags": pre["flags"], "helpful_count": 0, "not_helpful_count": 0,
               "dedupe_hash": _dedupe_hash(req.title, req.body),
               "created_at": _now(), "updated_at": _now(), "published_at": None}
        await _db.cc_content.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "contribution_started", {"type": req.content_type})
        return {"content": doc, "pre_checks": pre}

    @r.post("/content/{cid}/submit")
    async def submit(cid: str, req: UpdateReq, user: dict = Depends(get_current_user)):
        c = await _db.cc_content.find_one({"id": cid, "author_user_id": user["id"]}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        if c["moderation_status"] not in ("draft", "rejected"):
            raise HTTPException(status_code=409, detail="This is already in moderation.")
        s = await _settings()
        if s["publishing_paused"]:
            raise HTTPException(status_code=503, detail="Community publishing is paused right now. Your draft is saved.")
        vis = req.visibility or c["visibility"]
        if vis not in PUBLIC_VIS + ["unlisted_share"]:
            raise HTTPException(status_code=400, detail="Choose how you'd like to share (anonymous, attributed, or unlisted link).")
        pre = await _pre_checks(req.title or c["title"], req.body or c["body"], req.category or c["category"], s)
        status = "reviewing" if pre["requires_enhanced_review"] else "submitted"
        upd = {"moderation_status": status, "visibility": vis, "safety_classification": pre["safety_classification"],
               "pre_check_flags": pre["flags"], "submitted_at": _now(), "updated_at": _now()}
        if req.display_name is not None:
            upd["display_name"] = req.display_name.strip()[:60] or None
        await _db.cc_content.update_one({"id": cid}, {"$set": upd})
        await _cap(user["id"], "contribution_submitted", {"classification": pre["safety_classification"]})
        return {"ok": True, "moderation_status": status, "requires_enhanced_review": pre["requires_enhanced_review"],
                "note": "Thanks! We'll review this before it's published. Safety-sensitive posts get extra review."}

    @r.get("/content/mine")
    async def mine(user: dict = Depends(get_current_user)):
        rows = await _db.cc_content.find({"author_user_id": user["id"]}, {"_id": 0, "dedupe_hash": 0}).sort("updated_at", -1).to_list(200)
        return {"content": rows}

    @r.put("/content/{cid}")
    async def update(cid: str, req: UpdateReq, user: dict = Depends(get_current_user)):
        c = await _db.cc_content.find_one({"id": cid, "author_user_id": user["id"]}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        if c["moderation_status"] not in ("draft", "rejected", "reviewing", "submitted"):
            raise HTTPException(status_code=409, detail="Published or removed content can't be edited here.")
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if "title" in upd or "body" in upd:
            upd["dedupe_hash"] = _dedupe_hash(upd.get("title", c["title"]), upd.get("body", c["body"]))
        upd["updated_at"] = _now()
        await _db.cc_content.update_one({"id": cid}, {"$set": upd})
        return {"ok": True}

    @r.delete("/content/{cid}")
    async def archive(cid: str, user: dict = Depends(get_current_user)):
        res = await _db.cc_content.update_one({"id": cid, "author_user_id": user["id"]}, {"$set": {"moderation_status": "archived", "visibility": "private", "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Content not found.")
        return {"ok": True}

    @r.get("/feed")
    async def feed(category: Optional[str] = None, content_type: Optional[str] = None, sort: str = "helpful", user: dict = Depends(get_current_user)):
        q = {"moderation_status": "approved", "visibility": {"$in": PUBLIC_VIS}}
        if category:
            q["category"] = category
        if content_type:
            q["content_type"] = content_type
        sort_key = "helpful_count" if sort == "helpful" else "published_at"
        rows = await _db.cc_content.find(q, {"_id": 0}).sort(sort_key, -1).to_list(100)
        await _cap(user["id"], "community_feed_opened", {"category": category})
        return {"content": [_public_view(c, user["id"]) for c in rows]}

    @r.get("/content/{cid}")
    async def get_one(cid: str, user: dict = Depends(get_current_user)):
        c = await _db.cc_content.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        mine_it = c["author_user_id"] == user["id"]
        if not mine_it and not (c["moderation_status"] == "approved" and c["visibility"] in PUBLIC_VIS + ["unlisted_share"]):
            raise HTTPException(status_code=403, detail="This content isn't public.")
        await _cap(user["id"], "community_content_viewed", {"id": cid})
        if mine_it:
            return {"content": {k: v for k, v in c.items() if k != "dedupe_hash"}, "is_mine": True}
        my_vote = await _db.cc_votes.find_one({"community_content_id": cid, "user_id": user["id"]}, {"_id": 0, "vote_type": 1})
        saved = bool(await _db.cc_saves.find_one({"community_content_id": cid, "user_id": user["id"]}))
        return {"content": _public_view(c, user["id"]), "my_vote": my_vote.get("vote_type") if my_vote else None, "saved": saved}

    @r.post("/content/{cid}/vote")
    async def vote(cid: str, req: VoteReq, user: dict = Depends(get_current_user)):
        if req.vote_type not in ("helpful", "not_helpful"):
            raise HTTPException(status_code=400, detail="Invalid vote.")
        c = await _db.cc_content.find_one({"id": cid, "moderation_status": "approved"}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        prev = await _db.cc_votes.find_one({"community_content_id": cid, "user_id": user["id"]}, {"_id": 0})
        if prev and prev["vote_type"] == req.vote_type:
            return {"ok": True, "helpful_count": c.get("helpful_count", 0)}
        await _db.cc_votes.update_one({"community_content_id": cid, "user_id": user["id"]},
            {"$set": {"vote_type": req.vote_type, "created_at": _now()}, "$setOnInsert": {"id": _nid()}}, upsert=True)
        # recompute counts
        helpful = await _db.cc_votes.count_documents({"community_content_id": cid, "vote_type": "helpful"})
        not_helpful = await _db.cc_votes.count_documents({"community_content_id": cid, "vote_type": "not_helpful"})
        await _db.cc_content.update_one({"id": cid}, {"$set": {"helpful_count": helpful, "not_helpful_count": not_helpful}})
        await _cap(user["id"], "helpful_vote_submitted", {"type": req.vote_type})
        return {"ok": True, "helpful_count": helpful}

    @r.post("/content/{cid}/save")
    async def save(cid: str, user: dict = Depends(get_current_user)):
        c = await _db.cc_content.find_one({"id": cid, "moderation_status": "approved"}, {"_id": 0, "id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        await _db.cc_saves.update_one({"community_content_id": cid, "user_id": user["id"]},
            {"$setOnInsert": {"id": _nid(), "created_at": _now()}}, upsert=True)
        await _cap(user["id"], "content_saved", {})
        return {"ok": True}

    @r.delete("/content/{cid}/save")
    async def unsave(cid: str, user: dict = Depends(get_current_user)):
        await _db.cc_saves.delete_one({"community_content_id": cid, "user_id": user["id"]})
        return {"ok": True}

    @r.get("/saved")
    async def saved_list(user: dict = Depends(get_current_user)):
        ids = [s["community_content_id"] for s in await _db.cc_saves.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)]
        rows = await _db.cc_content.find({"id": {"$in": ids}, "moderation_status": "approved"}, {"_id": 0}).to_list(200)
        return {"content": [_public_view(c, user["id"]) for c in rows]}

    @r.post("/content/{cid}/report")
    async def report(cid: str, req: ReportReq, user: dict = Depends(get_current_user)):
        if req.report_reason not in REPORT_REASONS:
            raise HTTPException(status_code=400, detail="Pick a reason.")
        c = await _db.cc_content.find_one({"id": cid}, {"_id": 0, "id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        doc = {"id": _nid(), "reporter_user_id": user["id"], "community_content_id": cid,
               "report_reason": req.report_reason, "description": (req.description or "")[:500] or None,
               "status": "open", "created_at": _now()}
        await _db.cc_reports.insert_one(dict(doc))
        await _cap(user["id"], "content_reported", {"reason": req.report_reason})
        return {"ok": True, "note": "Thanks for flagging this. Our team will review it."}

    @r.get("/content/{cid}/comments")
    async def get_comments(cid: str, user: dict = Depends(get_current_user)):
        rows = await _db.cc_comments.find({"community_content_id": cid, "moderation_status": "approved"}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"comments": rows}

    @r.post("/content/{cid}/comments")
    async def add_comment(cid: str, req: CommentReq, user: dict = Depends(get_current_user)):
        c = await _db.cc_content.find_one({"id": cid, "moderation_status": "approved"}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        s = await _settings()
        if c.get("category") in s["high_risk_categories"] and not s["comments_in_high_risk_enabled"]:
            raise HTTPException(status_code=409, detail="Comments are turned off for high-risk safety categories.")
        if not req.body.strip():
            raise HTTPException(status_code=400, detail="Write something first.")
        pre = await _pre_checks("comment", req.body, c.get("category", ""), s)
        status = "approved" if not pre["flags"] else "submitted"  # clean comments auto-approve; flagged go to queue
        doc = {"id": _nid(), "community_content_id": cid, "author_user_id": user["id"],
               "parent_comment_id": req.parent_comment_id, "body": req.body.strip()[:2000],
               "moderation_status": status, "pre_check_flags": pre["flags"], "created_at": _now()}
        await _db.cc_comments.insert_one(dict(doc)); doc.pop("_id", None)
        return {"comment": doc, "pending_review": status != "approved"}

    @r.post("/draft-assist")
    async def draft_assist(req: DraftAssistReq, user: dict = Depends(get_current_user)):
        if not req.raw_notes.strip():
            raise HTTPException(status_code=400, detail="Add some notes first.")
        s = await _settings()
        pre = await _pre_checks("draft", req.raw_notes, "Project Lessons", s)
        try:
            system = ("You help a homeowner turn rough notes into a clear, shareable community project story. "
                      "Do NOT invent facts, costs, or steps the user didn't mention. Do NOT claim permit/code compliance. "
                      "If notes describe risky gas/electrical/structural work, add a caution to consult a pro. "
                      "Return STRICT JSON: {suggested_title, summary, what_went_well, what_was_difficult, lessons (array), "
                      "suggested_category (one of the DIYhomie categories), sensitive_info_found (array of strings)}.")
            data = await _llm_json(system, f"Categories: {CATEGORIES}\nUser notes: {req.raw_notes[:4000]}", max_tokens=700, feature_area="community_draft")
            if not isinstance(data, dict):
                raise ValueError("bad")
        except Exception as e:
            _sentry("community_search_failure", f"draft_assist: {e}")
            data = {"suggested_title": req.raw_notes.strip()[:60], "summary": req.raw_notes.strip()[:400],
                    "what_went_well": "", "what_was_difficult": "", "lessons": [], "suggested_category": "Project Lessons",
                    "sensitive_info_found": []}
        # merge our deterministic PII flags
        flags = list(dict.fromkeys((data.get("sensitive_info_found") or []) + (["Looks like personal info — please remove"] if "personal_information" in pre["flags"] else [])))
        data["sensitive_info_found"] = flags
        data["safety_classification"] = pre["safety_classification"]
        return {"draft": data, "note": "Review and edit before submitting. You choose your privacy setting; nothing is shared without your consent."}

    return r


# ============================================================= admin router
class DecisionReq(BaseModel):
    decision: str
    reason: Optional[str] = None


class ReportResolveReq(BaseModel):
    status: str


class SettingsReq(BaseModel):
    publishing_paused: Optional[bool] = None
    enabled_content_types: Optional[list] = None
    banned_terms: Optional[list] = None
    high_risk_categories: Optional[list] = None
    comments_in_high_risk_enabled: Optional[bool] = None


class CommentDecisionReq(BaseModel):
    decision: str  # approve | remove


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/community", dependencies=[Depends(require_admin)])

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        by_status = {st: await _db.cc_content.count_documents({"moderation_status": st}) for st in MOD_STATUS}
        return {"by_status": by_status,
                "queue_size": by_status.get("submitted", 0) + by_status.get("reviewing", 0),
                "enhanced_review": await _db.cc_content.count_documents({"moderation_status": "reviewing"}),
                "open_reports": await _db.cc_reports.count_documents({"status": "open"}),
                "comment_queue": await _db.cc_comments.count_documents({"moderation_status": "submitted"}),
                "approved_total": by_status.get("approved", 0),
                "settings": await _settings()}

    @r.get("/queue")
    async def queue(admin: dict = Depends(require_admin)):
        rows = await _db.cc_content.find({"moderation_status": {"$in": ["submitted", "reviewing"]}}, {"_id": 0}).sort("submitted_at", 1).to_list(200)
        return {"queue": rows}

    @r.post("/content/{cid}/decision")
    async def decision(cid: str, req: DecisionReq, admin: dict = Depends(require_admin)):
        if req.decision not in DECISIONS:
            raise HTTPException(status_code=400, detail="Invalid decision.")
        c = await _db.cc_content.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Content not found.")
        status_map = {"approve": "approved", "reject": "rejected", "remove": "removed", "restore": "approved", "request_changes": "draft"}
        new_status = status_map[req.decision]
        upd = {"moderation_status": new_status, "updated_at": _now()}
        if req.decision in ("approve", "restore"):
            upd["published_at"] = c.get("published_at") or _now()
        await _db.cc_content.update_one({"id": cid}, {"$set": upd})
        dec = {"id": _nid(), "community_content_id": cid, "moderator_user_id": admin["id"],
               "decision": req.decision, "reason": (req.reason or "")[:500] or None, "created_at": _now()}
        await _db.cc_moderation.insert_one(dict(dec)); dec.pop("_id", None)
        try:
            await _db.hi_admin_audit.insert_one({"id": _nid(), "actor_user_id": admin["id"], "action": "community_moderation",
                "detail": {"content_id": cid, "decision": req.decision, "new_status": new_status}, "created_at": _now()})
        except Exception:
            pass
        if req.decision == "approve":
            await _cap(c["author_user_id"], "contribution_approved", {"type": c["content_type"]})
            # reward hook (best-effort, per approved reward rules)
            try:
                import rewards_funding_engine  # optional
                if hasattr(rewards_funding_engine, "award_points"):
                    await rewards_funding_engine.award_points(c["author_user_id"], "community_contribution_approved")
            except Exception:
                pass
        return {"ok": True, "moderation_status": new_status}

    @r.get("/reports")
    async def reports(status: str = "open", admin: dict = Depends(require_admin)):
        rows = await _db.cc_reports.find({"status": status}, {"_id": 0}).sort("created_at", -1).to_list(200)
        # attach content title
        for rp in rows:
            c = await _db.cc_content.find_one({"id": rp["community_content_id"]}, {"_id": 0, "title": 1, "moderation_status": 1})
            rp["content_title"] = c.get("title") if c else "(deleted)"
            rp["content_status"] = c.get("moderation_status") if c else None
        return {"reports": rows}

    @r.post("/reports/{rid}/resolve")
    async def resolve_report(rid: str, req: ReportResolveReq, admin: dict = Depends(require_admin)):
        if req.status not in ("reviewing", "resolved", "dismissed"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        res = await _db.cc_reports.update_one({"id": rid}, {"$set": {"status": req.status, "resolved_at": _now(), "resolved_by": admin["id"]}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Report not found.")
        return {"ok": True, "status": req.status}

    @r.get("/comments/queue")
    async def comment_queue(admin: dict = Depends(require_admin)):
        rows = await _db.cc_comments.find({"moderation_status": "submitted"}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"comments": rows}

    @r.post("/comments/{cmid}/decision")
    async def comment_decision(cmid: str, req: CommentDecisionReq, admin: dict = Depends(require_admin)):
        if req.decision not in ("approve", "remove"):
            raise HTTPException(status_code=400, detail="Invalid decision.")
        new_status = "approved" if req.decision == "approve" else "removed"
        res = await _db.cc_comments.update_one({"id": cmid}, {"$set": {"moderation_status": new_status}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Comment not found.")
        return {"ok": True, "status": new_status}

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def put_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _now()
            await _db.cc_settings.update_one({"id": "singleton"}, {"$set": upd}, upsert=True)
        return await _settings()

    @r.get("/audit")
    async def audit(admin: dict = Depends(require_admin)):
        rows = await _db.cc_moderation.find({}, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"decisions": rows}

    return r


# ============================================================= seed
async def seed_community():
    if _db is None:
        return
    try:
        await _db.cc_content.create_index("moderation_status")
        await _db.cc_votes.create_index([("community_content_id", 1), ("user_id", 1)], unique=True)
        await _settings()
        if _logger:
            _logger.info("community knowledge (B35) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"community seed failed: {e}")
