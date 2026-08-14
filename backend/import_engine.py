"""
DIYhomie — Property Data Import, External Records & Evidence Reconciliation (Build Blueprint 43).

Lets owners gradually enrich their property profile from uploads, photos, and manual
entry (with approved external providers as a future, modular source). Every imported
fact keeps its source, date, confidence, and verification status. Imported data NEVER
silently overwrites user-confirmed records — conflicts surface as reconciliation issues
the user resolves explicitly. Confirmed facts land in hi_property_facts (evidence history
preserved), scoped strictly to the caller's own property.

User namespace   /api/hi/import/*
Admin namespace  /api/hi/admin/import/*
Collections: prop_import_jobs, prop_evidence, prop_reconcile_issues, prop_data_sources, hi_property_facts
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

IMPORT_TYPES = ["upload", "photo", "manual", "external_provider_future"]
EVIDENCE_TYPES = ["property_fact", "room", "asset", "measurement", "material", "permit_reference", "maintenance_record", "other"]
CONFIDENCE = ["low", "medium", "high"]
ISSUE_TYPES = ["new_information", "duplicate", "conflict", "stale_data", "incomplete_data"]

# Source reliability (higher wins). User-confirmed data is never auto-overwritten.
RELIABILITY = {
    "user_confirmed": 6, "user_document": 5, "professional_document": 4,
    "external_provider": 3, "ai_extracted": 2, "estimate": 1,
}
DISCLAIMER = ("Records may be incomplete or outdated. Verify important details with the original "
              "source or a qualified professional. DIYhomie does not certify permits, boundaries, "
              "ownership, code compliance, square footage, or structural condition.")

# Property facts we can currently reconcile in plain language.
FACT_LABELS = {
    "address": "Address", "home_type": "Home type", "year_built": "Year built",
    "square_footage": "Square footage", "bedrooms": "Bedrooms", "bathrooms": "Bathrooms",
    "roof_year": "Roof replaced", "water_heater_year": "Water heater installed",
    "hvac_year": "HVAC installed", "lot_size": "Lot size", "stories": "Stories",
}


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


async def _get_property(user_id: str) -> dict:
    p = await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
    if not p:
        p = await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0})
    if not p:
        p = {"id": _nid(), "user_id": user_id, "address": None, "home_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(p)); p.pop("_id", None)
    return p


async def _current_fact(property_id: str, field_key: str, prop: dict):
    """Return (value, source_type, verification_status) for a field, or (None, None, None)."""
    f = await _db.hi_property_facts.find_one({"property_id": property_id, "field_key": field_key}, {"_id": 0})
    if f:
        return f.get("value"), f.get("source_type"), f.get("verification_status")
    # Fall back to base property columns for a couple of native keys.
    if field_key in ("address", "home_type") and prop.get(field_key):
        return prop.get(field_key), "user_confirmed", "user_confirmed"
    return None, None, None


class EvidenceIn(BaseModel):
    evidence_type: str = "property_fact"
    field_key: str
    observed_value: str
    source_type: str = "ai_extracted"     # user_confirmed|user_document|professional_document|external_provider|ai_extracted|estimate
    confidence_level: str = "medium"


class JobReq(BaseModel):
    import_type: str
    source_reference: Optional[str] = None
    evidence: list[EvidenceIn] = []
    note: Optional[str] = None


class ResolveReq(BaseModel):
    action: str                            # accept | keep | edit | ignore | defer
    edited_value: Optional[str] = None


class SourceReq(BaseModel):
    source_name: str
    source_type: str
    reliability_level: str = "external_provider"


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/import")

    @r.get("/config")
    async def config(user: dict = Depends(get_current_user)):
        return {"import_types": IMPORT_TYPES, "evidence_types": EVIDENCE_TYPES, "confidence": CONFIDENCE,
                "fact_labels": FACT_LABELS, "disclaimer": DISCLAIMER}

    @r.get("/facts")
    async def facts(user: dict = Depends(get_current_user)):
        prop = await _get_property(user["id"])
        rows = await _db.hi_property_facts.find({"property_id": prop["id"]}, {"_id": 0}).to_list(300)
        return {"property_id": prop["id"], "facts": rows}

    @r.post("/jobs")
    async def create_job(req: JobReq, user: dict = Depends(get_current_user)):
        if req.import_type not in IMPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid import type.")
        prop = await _get_property(user["id"])
        await _cap(user, "property_import_started", {"import_type": req.import_type})
        jid = _nid()
        job = {"id": jid, "property_id": prop["id"], "user_id": user["id"], "import_type": req.import_type,
               "source_reference": (req.source_reference or "")[:300] or None, "note": (req.note or "")[:500] or None,
               "status": "processing", "created_at": _now(), "completed_at": None}
        await _db.prop_import_jobs.insert_one(dict(job)); job.pop("_id", None)

        issues = []
        evidence_count = 0
        for ev in req.evidence:
            if ev.evidence_type not in EVIDENCE_TYPES or not ev.field_key.strip() or not str(ev.observed_value).strip():
                continue
            src = ev.source_type if ev.source_type in RELIABILITY else "ai_extracted"
            conf = ev.confidence_level if ev.confidence_level in CONFIDENCE else "medium"
            rec = {"id": _nid(), "property_id": prop["id"], "import_job_id": jid, "evidence_type": ev.evidence_type,
                   "field_key": ev.field_key.strip()[:60], "observed_value": str(ev.observed_value).strip()[:500],
                   "source_type": src, "source_reference": job["source_reference"], "confidence_level": conf,
                   "verification_status": "unverified", "created_at": _now()}
            await _db.prop_evidence.insert_one(dict(rec)); rec.pop("_id", None)
            evidence_count += 1

            # Reconcile against current record.
            cur_val, cur_src, cur_verif = await _current_fact(prop["id"], rec["field_key"], prop) \
                if ev.evidence_type == "property_fact" else (None, None, None)
            if ev.evidence_type != "property_fact":
                issue_type = "new_information"
            elif cur_val is None:
                issue_type = "new_information"
            elif str(cur_val).strip().lower() == rec["observed_value"].strip().lower():
                issue_type = "duplicate"
            else:
                issue_type = "conflict"
            issue = {"id": _nid(), "property_id": prop["id"], "import_job_id": jid, "evidence_id": rec["id"],
                     "field_key": rec["field_key"], "evidence_type": ev.evidence_type,
                     "current_value": cur_val, "proposed_value": rec["observed_value"],
                     "current_source": cur_src, "proposed_source": src, "confidence_level": conf,
                     "issue_type": issue_type, "status": "pending_review",
                     "protected": cur_verif == "user_confirmed", "created_at": _now()}
            await _db.prop_reconcile_issues.insert_one(dict(issue)); issue.pop("_id", None)
            await _cap(user, "reconciliation_issue_shown", {"issue_type": issue_type})
            issues.append(issue)

        await _db.prop_import_jobs.update_one({"id": jid}, {"$set": {"status": "ready_for_review"}})
        job["status"] = "ready_for_review"
        await _cap(user, "property_import_completed", {"import_type": req.import_type, "evidence_count": evidence_count})
        return {"job": job, "issues": issues, "disclaimer": DISCLAIMER}

    @r.get("/jobs")
    async def list_jobs(user: dict = Depends(get_current_user)):
        rows = await _db.prop_import_jobs.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"jobs": rows}

    @r.get("/jobs/{jid}")
    async def get_job(jid: str, user: dict = Depends(get_current_user)):
        job = await _db.prop_import_jobs.find_one({"id": jid, "user_id": user["id"]}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Import not found.")
        await _cap(user, "property_import_reviewed", {})
        ev = await _db.prop_evidence.find({"import_job_id": jid}, {"_id": 0}).to_list(300)
        issues = await _db.prop_reconcile_issues.find({"import_job_id": jid}, {"_id": 0}).sort("created_at", 1).to_list(300)
        return {"job": job, "evidence": ev, "issues": issues, "disclaimer": DISCLAIMER}

    @r.post("/issues/{iid}/resolve")
    async def resolve_issue(iid: str, req: ResolveReq, user: dict = Depends(get_current_user)):
        issue = await _db.prop_reconcile_issues.find_one({"id": iid}, {"_id": 0})
        if not issue:
            raise HTTPException(status_code=404, detail="Item not found.")
        prop = await _get_property(user["id"])
        if issue["property_id"] != prop["id"]:
            raise HTTPException(status_code=403, detail="Not authorized for this property.")
        if req.action not in ("accept", "keep", "edit", "ignore", "defer"):
            raise HTTPException(status_code=400, detail="Invalid action.")

        status_map = {"accept": "accepted", "keep": "rejected", "edit": "merged", "ignore": "rejected", "defer": "deferred"}
        new_status = status_map[req.action]

        if req.action in ("accept", "edit"):
            value = req.edited_value.strip()[:500] if (req.action == "edit" and req.edited_value) else issue["proposed_value"]
            if issue["evidence_type"] == "property_fact":
                await _db.hi_property_facts.update_one(
                    {"property_id": prop["id"], "field_key": issue["field_key"]},
                    {"$set": {"property_id": prop["id"], "field_key": issue["field_key"], "value": value,
                              "source_type": "user_confirmed", "verification_status": "user_confirmed",
                              "updated_at": _now()}, "$setOnInsert": {"id": _nid(), "created_at": _now()}},
                    upsert=True)
                # Keep the two native property columns in sync for downstream features.
                if issue["field_key"] in ("address", "home_type"):
                    await _db.hi_properties.update_one({"id": prop["id"]}, {"$set": {issue["field_key"]: value}})
            await _db.prop_evidence.update_one({"id": issue["evidence_id"]}, {"$set": {"verification_status": "user_confirmed"}})
        elif req.action in ("keep", "ignore"):
            await _db.prop_evidence.update_one({"id": issue["evidence_id"]}, {"$set": {"verification_status": "rejected"}})

        await _db.prop_reconcile_issues.update_one({"id": iid}, {"$set": {"status": new_status, "resolved_at": _now()}})
        await _cap(user, "reconciliation_issue_resolved", {"status": new_status})
        return {"ok": True, "status": new_status}

    @r.get("/sources")
    async def sources(user: dict = Depends(get_current_user)):
        rows = await _db.prop_data_sources.find({"$or": [{"user_id": user["id"]}, {"user_id": None}]}, {"_id": 0}).to_list(100)
        return {"sources": rows}

    @r.post("/sources/connect")
    async def connect_source(req: SourceReq, user: dict = Depends(get_current_user)):
        # External providers are a future capability; connecting registers intent + is logged.
        doc = {"id": _nid(), "user_id": user["id"], "source_name": req.source_name.strip()[:80],
               "source_type": req.source_type[:40], "reliability_level": req.reliability_level,
               "status": "active", "last_updated_at": None, "created_at": _now()}
        await _db.prop_data_sources.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user, "external_property_source_connected", {"source_type": req.source_type})
        return {"source": doc, "note": "External property providers are coming soon. We'll request only the data you approve."}

    @r.post("/sources/{sid}/disconnect")
    async def disconnect_source(sid: str, user: dict = Depends(get_current_user)):
        res = await _db.prop_data_sources.update_one({"id": sid, "user_id": user["id"]}, {"$set": {"status": "paused"}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Source not found.")
        return {"ok": True}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/import", dependencies=[Depends(require_admin)])

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        jobs = await _db.prop_import_jobs.find({}, {"_id": 0}).to_list(3000)
        by_status, by_type = {}, {}
        for j in jobs:
            by_status[j["status"]] = by_status.get(j["status"], 0) + 1
            by_type[j["import_type"]] = by_type.get(j["import_type"], 0) + 1
        issues = await _db.prop_reconcile_issues.find({}, {"_id": 0}).to_list(5000)
        by_issue, by_issue_status = {}, {}
        for i in issues:
            by_issue[i["issue_type"]] = by_issue.get(i["issue_type"], 0) + 1
            by_issue_status[i["status"]] = by_issue_status.get(i["status"], 0) + 1
        return {"total_jobs": len(jobs), "jobs_by_status": by_status, "jobs_by_type": by_type,
                "total_issues": len(issues), "issues_by_type": by_issue, "issues_by_status": by_issue_status,
                "pending_review": by_issue_status.get("pending_review", 0),
                "sources": await _db.prop_data_sources.count_documents({})}

    @r.get("/sources")
    async def sources(admin: dict = Depends(require_admin)):
        rows = await _db.prop_data_sources.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"sources": rows}

    @r.post("/sources")
    async def add_source(req: SourceReq, admin: dict = Depends(require_admin)):
        doc = {"id": _nid(), "user_id": None, "source_name": req.source_name.strip()[:80],
               "source_type": req.source_type[:40], "reliability_level": req.reliability_level,
               "status": "active", "last_updated_at": None, "created_at": _now()}
        await _db.prop_data_sources.insert_one(dict(doc)); doc.pop("_id", None)
        return {"source": doc}

    @r.put("/sources/{sid}")
    async def update_source(sid: str, status: str, admin: dict = Depends(require_admin)):
        if status not in ("active", "paused", "deprecated"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        res = await _db.prop_data_sources.update_one({"id": sid}, {"$set": {"status": status}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Source not found.")
        return {"ok": True}

    return r


async def seed_import():
    if _db is None:
        return
    try:
        await _db.prop_import_jobs.create_index("user_id")
        await _db.prop_evidence.create_index("import_job_id")
        await _db.prop_reconcile_issues.create_index("import_job_id")
        await _db.hi_property_facts.create_index([("property_id", 1), ("field_key", 1)])
        if await _db.prop_data_sources.count_documents({}) == 0:
            for name, stype in [("Public parcel records", "parcel"), ("Permit history", "permit"),
                                ("Property facts provider", "property_facts")]:
                await _db.prop_data_sources.insert_one({"id": _nid(), "user_id": None, "source_name": name,
                                                        "source_type": stype, "reliability_level": "external_provider",
                                                        "status": "paused", "last_updated_at": None, "created_at": _now()})
        if _logger:
            _logger.info("property import (B43) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"import seed failed: {e}")
