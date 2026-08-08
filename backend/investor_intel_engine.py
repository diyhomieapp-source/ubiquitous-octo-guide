"""
DIYhomie — Investor Intelligence Center & Acquisition Readiness (Build Blueprint 38).

Admin-only. Continuously organizes business metrics, vendors, operational documents, readiness
assessments, transfer tasks, and an invite-only investor data room + due-diligence Q&A — so
diligence is easier later while improving operations today. NOT a prospectus, valuation, or
securities system. Readiness scores are explainable improvement signals, never a valuation.
Customer private data and credentials are excluded by design.

Namespace /api/hi/admin/invintel/* (distinct from the existing investor reporting module).
Collections: ii_metrics, ii_vendors, ii_docs, ii_readiness, ii_transfer, ii_invites, ii_questions.
"""
import uuid
import secrets
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

READINESS_CATEGORIES = ["financial", "revenue_quality", "product_maturity", "technical_documentation", "security_privacy",
                        "vendor_management", "operational_documentation", "customer_stability", "knowledge_transfer", "ownership_transfer"]
VENDOR_CRITICALITY = ["low", "medium", "high", "critical"]
VENDOR_TRANSFER = ["not_documented", "documented", "transferable", "restricted"]
DOC_CATEGORIES = ["corporate", "financial", "legal", "technical", "security", "vendor", "product", "procedure", "brand", "hr_future"]
TRANSFER_CATEGORIES = ["domain", "hosting", "cloud", "database", "payments", "analytics", "source_code", "vendor", "documentation", "team", "legal"]
TRANSFER_STATUS = ["not_started", "in_progress", "blocked", "verified", "completed"]
INVITE_STATUS = ["pending", "active", "expired", "revoked"]
QUESTION_STATUS = ["open", "draft_response", "answered", "closed"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[invintel:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _count(coll, flt=None):
    try:
        return await _db[coll].count_documents(flt or {})
    except Exception:
        return 0


# ============================================================= models
class MetricReq(BaseModel):
    metric_key: str
    category: str
    value: float
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    source_system: Optional[str] = "manual"
    confidence_level: Optional[str] = "medium"


class VendorReq(BaseModel):
    vendor_name: str
    category: str
    service_description: Optional[str] = None
    contract_reference: Optional[str] = None
    renewal_date: Optional[str] = None
    criticality: str = "medium"
    transfer_status: str = "not_documented"


class DocReq(BaseModel):
    category: str
    title: str
    storage_reference: Optional[str] = None
    confidentiality_level: str = "internal"
    review_status: str = "draft"


class ReadinessReq(BaseModel):
    category: str
    score: int
    evidence_references: Optional[list] = None
    risks: Optional[str] = None
    recommendations: Optional[str] = None
    confidence_level: Optional[str] = "medium"
    override_reason: Optional[str] = None


class TransferReq(BaseModel):
    category: str
    title: str
    owner: Optional[str] = None
    transfer_instructions: Optional[str] = None


class TransferStatusReq(BaseModel):
    status: str


class InviteReq(BaseModel):
    investor_contact_reference: str
    access_scope: list
    expiration_date: Optional[str] = None
    nda_status: Optional[str] = None


class QuestionReq(BaseModel):
    data_room_invite_id: Optional[str] = None
    question: str
    category: Optional[str] = "general"


class QuestionAnswerReq(BaseModel):
    status: str
    response: Optional[str] = None
    evidence_references: Optional[list] = None


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/invintel", dependencies=[Depends(require_admin)])

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        # Growth (aggregate, no private data)
        growth = {"registered_users": await _count("users"),
                  "properties": await _count("hi_properties"),
                  "projects_created": await _count("hi_projects"),
                  "projects_completed": await _count("hi_projects", {"status": "completed"})}
        # Revenue (best-effort aggregate)
        revenue = {"subscription_transactions": await _count("payment_transactions", {"payment_status": "paid"}),
                   "paying_subscribers": await _count("users", {"subscription_tier": {"$nin": [None, "free"]}})}
        # Operating health
        operating = {"open_incidents": await _count("rel_incidents", {"status": {"$in": ["detected", "investigating", "mitigated"]}}),
                     "vendors": await _count("ii_vendors"),
                     "operational_documents": await _count("ii_docs")}
        # Readiness (avg of latest per category)
        readiness = {}
        for cat in READINESS_CATEGORIES:
            latest = await _db.ii_readiness.find({"category": cat}, {"_id": 0}).sort("created_at", -1).to_list(1)
            readiness[cat] = latest[0]["score"] if latest else None
        scored = [v for v in readiness.values() if v is not None]
        return {"growth": growth, "revenue": revenue, "operating": operating,
                "readiness_by_category": readiness,
                "overall_readiness": round(sum(scored) / len(scored)) if scored else None,
                "data_room_invites": await _count("ii_invites", {"status": "active"}),
                "open_questions": await _count("ii_questions", {"status": {"$in": ["open", "draft_response"]}}),
                "transfer_tasks": {"total": await _count("ii_transfer"), "completed": await _count("ii_transfer", {"status": "completed"})},
                "note": "Readiness scores are explainable improvement signals — not a valuation. Customer private data & credentials are excluded."}

    # ---- metrics ----
    @r.get("/metrics")
    async def metrics(admin: dict = Depends(require_admin)):
        return {"metrics": await _db.ii_metrics.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)}

    @r.post("/metrics")
    async def add_metric(req: MetricReq, admin: dict = Depends(require_admin)):
        doc = {"id": _nid(), "metric_key": req.metric_key[:60], "category": req.category[:40], "value": req.value,
               "period_start": req.period_start, "period_end": req.period_end, "source_system": req.source_system,
               "confidence_level": req.confidence_level, "created_at": _now()}
        await _db.ii_metrics.insert_one(dict(doc)); doc.pop("_id", None)
        return {"metric": doc}

    @r.post("/metrics/refresh")
    async def refresh_metrics(admin: dict = Depends(require_admin)):
        snaps = [
            ("registered_users", "growth", await _count("users")),
            ("projects_created", "product", await _count("hi_projects")),
            ("projects_completed", "product", await _count("hi_projects", {"status": "completed"})),
            ("paying_subscribers", "revenue", await _count("users", {"subscription_tier": {"$nin": [None, "free"]}})),
        ]
        created = []
        for key, cat, val in snaps:
            doc = {"id": _nid(), "metric_key": key, "category": cat, "value": float(val), "source_system": "auto_aggregate",
                   "confidence_level": "high", "period_end": _now()[:10], "created_at": _now()}
            await _db.ii_metrics.insert_one(dict(doc))
            created.append(key)
        return {"ok": True, "refreshed": created}

    # ---- vendors ----
    @r.get("/vendors")
    async def vendors(admin: dict = Depends(require_admin)):
        return {"vendors": await _db.ii_vendors.find({}, {"_id": 0}).sort("created_at", -1).to_list(200),
                "criticality": VENDOR_CRITICALITY, "transfer_status": VENDOR_TRANSFER}

    @r.post("/vendors")
    async def add_vendor(req: VendorReq, admin: dict = Depends(require_admin)):
        if req.criticality not in VENDOR_CRITICALITY or req.transfer_status not in VENDOR_TRANSFER:
            raise HTTPException(status_code=400, detail="Invalid criticality or transfer status.")
        doc = {"id": _nid(), "vendor_name": req.vendor_name[:120], "category": req.category[:60],
               "service_description": (req.service_description or "")[:500] or None, "contract_reference": req.contract_reference,
               "owner_user_id": admin["id"], "renewal_date": req.renewal_date, "criticality": req.criticality,
               "transfer_status": req.transfer_status, "created_at": _now()}
        await _db.ii_vendors.insert_one(dict(doc)); doc.pop("_id", None)
        return {"vendor": doc}

    @r.put("/vendors/{vid}")
    async def update_vendor(vid: str, req: VendorReq, admin: dict = Depends(require_admin)):
        res = await _db.ii_vendors.update_one({"id": vid}, {"$set": {"criticality": req.criticality, "transfer_status": req.transfer_status,
            "service_description": req.service_description, "renewal_date": req.renewal_date}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Vendor not found.")
        return {"ok": True}

    @r.delete("/vendors/{vid}")
    async def del_vendor(vid: str, admin: dict = Depends(require_admin)):
        res = await _db.ii_vendors.delete_one({"id": vid})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Vendor not found.")
        return {"ok": True}

    # ---- operational documents (metadata only) ----
    @r.get("/documents")
    async def documents(admin: dict = Depends(require_admin)):
        return {"documents": await _db.ii_docs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200), "categories": DOC_CATEGORIES}

    @r.post("/documents")
    async def add_document(req: DocReq, admin: dict = Depends(require_admin)):
        if req.category not in DOC_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category.")
        doc = {"id": _nid(), "category": req.category, "title": req.title[:200], "storage_reference": req.storage_reference,
               "confidentiality_level": req.confidentiality_level, "review_status": req.review_status,
               "owner_user_id": admin["id"], "last_reviewed_at": None, "created_at": _now()}
        await _db.ii_docs.insert_one(dict(doc)); doc.pop("_id", None)
        return {"document": doc}

    @r.delete("/documents/{did}")
    async def del_document(did: str, admin: dict = Depends(require_admin)):
        res = await _db.ii_docs.delete_one({"id": did})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Document not found.")
        return {"ok": True}

    # ---- readiness ----
    @r.get("/readiness")
    async def readiness(admin: dict = Depends(require_admin)):
        latest = {}
        for cat in READINESS_CATEGORIES:
            rows = await _db.ii_readiness.find({"category": cat}, {"_id": 0}).sort("created_at", -1).to_list(1)
            latest[cat] = rows[0] if rows else None
        return {"assessments": latest, "categories": READINESS_CATEGORIES}

    @r.post("/readiness")
    async def add_readiness(req: ReadinessReq, admin: dict = Depends(require_admin)):
        if req.category not in READINESS_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category.")
        if not (0 <= req.score <= 100):
            raise HTTPException(status_code=400, detail="Score must be 0–100.")
        evidence = req.evidence_references or []
        confidence = req.confidence_level or "medium"
        if not evidence and not req.override_reason:
            confidence = "low"  # missing data reduces confidence, not business quality
        doc = {"id": _nid(), "category": req.category, "score": req.score, "evidence_references": evidence,
               "risks": (req.risks or "")[:1000] or None, "recommendations": (req.recommendations or "")[:1000] or None,
               "confidence_level": confidence, "override_reason": (req.override_reason or "")[:500] or None,
               "assessed_by": admin["id"], "created_at": _now()}
        await _db.ii_readiness.insert_one(dict(doc)); doc.pop("_id", None)
        return {"assessment": doc}

    # ---- transfer tasks ----
    @r.get("/transfer")
    async def transfer(admin: dict = Depends(require_admin)):
        return {"tasks": await _db.ii_transfer.find({}, {"_id": 0}).sort("created_at", -1).to_list(200),
                "categories": TRANSFER_CATEGORIES, "statuses": TRANSFER_STATUS}

    @r.post("/transfer")
    async def add_transfer(req: TransferReq, admin: dict = Depends(require_admin)):
        if req.category not in TRANSFER_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category.")
        doc = {"id": _nid(), "category": req.category, "title": req.title[:200], "owner": req.owner or admin.get("email"),
               "transfer_instructions": (req.transfer_instructions or "")[:2000] or None, "status": "not_started", "created_at": _now()}
        await _db.ii_transfer.insert_one(dict(doc)); doc.pop("_id", None)
        return {"task": doc}

    @r.put("/transfer/{tid}")
    async def update_transfer(tid: str, req: TransferStatusReq, admin: dict = Depends(require_admin)):
        if req.status not in TRANSFER_STATUS:
            raise HTTPException(status_code=400, detail="Invalid status.")
        res = await _db.ii_transfer.update_one({"id": tid}, {"$set": {"status": req.status, "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Task not found.")
        return {"ok": True, "status": req.status}

    # ---- data room invites ----
    @r.get("/invites")
    async def invites(admin: dict = Depends(require_admin)):
        return {"invites": await _db.ii_invites.find({}, {"_id": 0, "access_token": 0}).sort("created_at", -1).to_list(200)}

    @r.post("/invites")
    async def create_invite(req: InviteReq, admin: dict = Depends(require_admin)):
        token = secrets.token_urlsafe(24)
        doc = {"id": _nid(), "investor_contact_reference": req.investor_contact_reference[:200],
               "access_scope": req.access_scope, "expiration_date": req.expiration_date, "nda_status": req.nda_status,
               "status": "pending", "access_token": token, "created_by": admin["id"], "created_at": _now()}
        await _db.ii_invites.insert_one(dict(doc))
        return {"invite": {k: v for k, v in doc.items() if k != "access_token"}, "invite_link_token": token,
                "note": "Invite is invitation-only, scoped, time-limited and revocable. No credentials or customer private data are ever in the data room."}

    @r.put("/invites/{iid}/revoke")
    async def revoke_invite(iid: str, admin: dict = Depends(require_admin)):
        res = await _db.ii_invites.update_one({"id": iid}, {"$set": {"status": "revoked", "revoked_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Invite not found.")
        return {"ok": True}

    @r.put("/invites/{iid}/activate")
    async def activate_invite(iid: str, admin: dict = Depends(require_admin)):
        res = await _db.ii_invites.update_one({"id": iid, "status": "pending"}, {"$set": {"status": "active", "activated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=409, detail="Only pending invites can be activated.")
        return {"ok": True}

    # ---- due-diligence Q&A ----
    @r.get("/questions")
    async def questions(admin: dict = Depends(require_admin)):
        return {"questions": await _db.ii_questions.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)}

    @r.post("/questions")
    async def add_question(req: QuestionReq, admin: dict = Depends(require_admin)):
        doc = {"id": _nid(), "data_room_invite_id": req.data_room_invite_id, "question": req.question[:1000],
               "category": req.category, "status": "open", "response": None, "created_at": _now()}
        await _db.ii_questions.insert_one(dict(doc)); doc.pop("_id", None)
        return {"question": doc}

    @r.put("/questions/{qid}")
    async def answer_question(qid: str, req: QuestionAnswerReq, admin: dict = Depends(require_admin)):
        if req.status not in QUESTION_STATUS:
            raise HTTPException(status_code=400, detail="Invalid status.")
        upd = {"status": req.status}
        if req.response is not None:
            upd["response"] = req.response[:4000]
        if req.evidence_references is not None:
            upd["evidence_references"] = req.evidence_references
        if req.status == "answered":
            upd["answered_at"] = _now()
        res = await _db.ii_questions.update_one({"id": qid}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Question not found.")
        return {"ok": True, "status": req.status}

    return r


async def seed_invintel():
    if _db is None:
        return
    try:
        await _db.ii_metrics.create_index("metric_key")
        if _logger:
            _logger.info("investor intelligence (B38) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"investor intel seed failed: {e}")
