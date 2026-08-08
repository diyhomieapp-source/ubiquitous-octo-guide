"""
DIYhomie — Professional Escalation & Shareable Job Summary (Build Blueprint 12).

Turns an unresolved issue / risky project into a clean, privacy-safe job summary
the homeowner fully controls and can share with a professional via a secure,
expiring, revocable link. NOT a contractor marketplace: no payments, bidding,
scheduling, licensing verification or referrals.

Collections: hi_professional_jobs, hi_job_items, hi_job_share_links,
hi_job_activities, hi_job_contacts, hi_property_history.
"""
import secrets
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

JOB_STATUSES = ["draft", "seeking_professional", "contacted", "scheduled", "in_progress", "completed", "closed"]
ITEM_TYPES = ["photo", "document", "asset_detail", "project_history", "maintenance_history", "issue_note", "user_note"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user, event, props=None, **kw):
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {}, **kw)
    except Exception:
        pass


async def _owned(job_id: str, user_id: str) -> dict:
    j = await _db.hi_professional_jobs.find_one({"id": job_id, "user_id": user_id}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Job not found.")
    return j


async def _activity(job_id: str, activity_type: str, note: Optional[str] = None, by: str = "user"):
    await _db.hi_job_activities.insert_one({
        "id": _nid(), "professional_job_id": job_id, "activity_type": activity_type,
        "note": note, "created_by": by, "created_at": _now()})


# ------------------------------------------------------------- models
class CreateJobReq(BaseModel):
    title: str
    description: Optional[str] = ""
    safety_status: Optional[str] = None
    source: Optional[str] = "manual"
    property_id: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    issue_id: Optional[str] = None
    project_id: Optional[str] = None
    maintenance_task_id: Optional[str] = None


class UpdateJobReq(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    safety_status: Optional[str] = None


class ItemReq(BaseModel):
    item_type: str
    item_reference_id: Optional[str] = None
    note: Optional[str] = None


class ItemToggleReq(BaseModel):
    included_in_summary: bool


class StatusReq(BaseModel):
    status: str
    note: Optional[str] = None
    had_professional: Optional[bool] = True


class ContactReq(BaseModel):
    preferred_contact_method: str  # phone|email|text|other
    contact_value: Optional[str] = None
    availability_notes: Optional[str] = None


class ShareReq(BaseModel):
    expires_in_days: int = 14
    allow_download: bool = True
    include_address: bool = False
    include_documents: bool = True
    include_photos: bool = True


# ------------------------------------------------------------- prepopulate
async def _add_item(job_id: str, item_type: str, ref: Optional[str], included=True, note: Optional[str] = None):
    await _db.hi_job_items.insert_one({
        "id": _nid(), "professional_job_id": job_id, "item_type": item_type,
        "item_reference_id": ref, "included_in_summary": included, "note": note, "created_at": _now()})


async def _prepopulate(job: dict):
    jid = job["id"]
    uid = job["user_id"]
    if job.get("asset_id"):
        await _add_item(jid, "asset_detail", job["asset_id"])
    if job.get("project_id"):
        await _add_item(jid, "project_history", job["project_id"])
        # attempted actions from project outcomes
        outs = await _db.hi_project_outcomes.find({"project_id": job["project_id"]}, {"_id": 0}).to_list(20)
        for o in outs:
            summary = (o.get("summary") or o.get("note") or "")[:200]
            if summary:
                await _add_item(jid, "user_note", None, note=f"Attempted: {summary}")
        # photos from project media
        media = await _db.hi_project_media.find({"project_id": job["project_id"]}, {"_id": 0}).to_list(20)
        for m in media:
            await _add_item(jid, "photo", m.get("id"))
    if job.get("maintenance_task_id"):
        await _add_item(jid, "maintenance_history", job["maintenance_task_id"])
    # linked documents (asset or project)
    q = {"user_id": uid}
    ids = [x for x in [job.get("asset_id"), job.get("project_id")] if x]
    if ids:
        docs = await _db.hi_documents.find({"user_id": uid, "$or": [{"asset_id": {"$in": ids}}, {"project_id": {"$in": ids}}]}, {"_id": 0}).to_list(20)
        for d in docs:
            await _add_item(jid, "document", d.get("id"))


# ------------------------------------------------------------- summary
async def _resolve_summary(job: dict, settings: Optional[dict] = None) -> dict:
    """Compose a neutral, privacy-safe report from items approved for the summary."""
    jid = job["id"]
    settings = settings or {"include_photos": True, "include_documents": True, "include_address": False}
    items = await _db.hi_job_items.find({"professional_job_id": jid, "included_in_summary": True}, {"_id": 0}).to_list(200)

    area = None
    if job.get("room_id"):
        room = await _db.hi_rooms.find_one({"id": job["room_id"]}, {"_id": 0})
        if room:
            area = room.get("name") or room.get("room_type")
    if not area and job.get("property_id"):
        prop = await _db.hi_properties.find_one({"id": job["property_id"]}, {"_id": 0})
        if prop:
            area = prop.get("name")
            if settings.get("include_address") and prop.get("address"):
                area = f"{area} — {prop.get('address')}"

    asset_details = None
    attempted, photos, documents = [], [], []
    for it in items:
        t = it["item_type"]
        if t == "asset_detail" and it.get("item_reference_id"):
            a = await _db.hi_assets.find_one({"id": it["item_reference_id"]}, {"_id": 0})
            if a:
                asset_details = {"name": a.get("name"), "category": a.get("category"),
                                 "brand": a.get("brand"), "model": a.get("model")}
        elif t == "user_note" and it.get("note"):
            attempted.append(it["note"])
        elif t == "photo" and settings.get("include_photos") and it.get("item_reference_id"):
            m = await _db.hi_project_media.find_one({"id": it["item_reference_id"]}, {"_id": 0})
            if m and m.get("image_base64"):
                photos.append(m["image_base64"])
            elif m and m.get("url"):
                photos.append(m["url"])
        elif t == "document" and settings.get("include_documents") and it.get("item_reference_id"):
            d = await _db.hi_documents.find_one({"id": it["item_reference_id"]}, {"_id": 0})
            if d:
                documents.append({"title": d.get("title") or d.get("filename") or "Document",
                                  "category": d.get("category") or d.get("document_category")})

    activities = await _db.hi_job_activities.find({"professional_job_id": jid}, {"_id": 0}).sort("created_at", 1).to_list(100)
    timeline = [{"at": a["created_at"], "event": a["activity_type"], "note": a.get("note")} for a in activities]

    return {
        "title": job["title"],
        "area": area or "Not specified",
        "issue_description": job.get("description") or "",
        "asset_details": asset_details,
        "photos": photos,
        "documents": documents,
        "attempted_actions": attempted,
        "current_status": job["status"],
        "safety_notes": job.get("safety_status"),
        "timeline": timeline,
        "disclaimer": "This summary was prepared by a homeowner using DIYhomie from their own records. It is not a professional inspection, permit, engineering report, or insurance document.",
    }


# ------------------------------------------------------------- completion history
async def _write_history(job: dict, note: str):
    await _db.hi_property_history.insert_one({
        "id": _nid(), "user_id": job["user_id"], "property_id": job.get("property_id"),
        "kind": "professional_work", "job_id": job["id"], "room_id": job.get("room_id"),
        "asset_id": job.get("asset_id"), "project_id": job.get("project_id"),
        "maintenance_task_id": job.get("maintenance_task_id"), "note": note, "at": _now()})
    if job.get("project_id"):
        try:
            await _db.hi_project_notes.insert_one({
                "id": _nid(), "project_id": job["project_id"], "user_id": job["user_id"],
                "note": note, "source": "professional_job", "created_at": _now()})
        except Exception:
            pass


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/jobs", dependencies=[Depends(get_current_user)])

    @r.post("")
    async def create_job(req: CreateJobReq, user: dict = Depends(get_current_user)):
        if not req.title.strip():
            raise HTTPException(status_code=400, detail="Give this job a title.")
        # resolve a property if not supplied
        prop_id = req.property_id
        if not prop_id:
            p = await _db.hi_properties.find_one({"user_id": user["id"], "is_active": True}, {"_id": 0, "id": 1}) \
                or await _db.hi_properties.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
            prop_id = p["id"] if p else None
        job = {"id": _nid(), "user_id": user["id"], "property_id": prop_id,
               "room_id": req.room_id, "asset_id": req.asset_id, "issue_id": req.issue_id,
               "project_id": req.project_id, "maintenance_task_id": req.maintenance_task_id,
               "title": req.title.strip()[:120], "description": (req.description or "")[:2000],
               "safety_status": req.safety_status, "status": "draft",
               "created_at": _now(), "updated_at": _now(), "completed_at": None}
        await _db.hi_professional_jobs.insert_one(dict(job))
        await _prepopulate(job)
        await _activity(job["id"], "created")
        await _cap(user, "job_summary_started", {"source": req.source or "manual"})
        item_count = await _db.hi_job_items.count_documents({"professional_job_id": job["id"]})
        await _cap(user, "job_summary_created", {"has_asset": bool(req.asset_id), "item_count": item_count})
        job.pop("_id", None)
        return job

    @r.get("")
    async def list_jobs(user: dict = Depends(get_current_user)):
        jobs = await _db.hi_professional_jobs.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"jobs": jobs}

    @r.get("/{job_id}")
    async def get_job(job_id: str, user: dict = Depends(get_current_user)):
        job = await _owned(job_id, user["id"])
        items = await _db.hi_job_items.find({"professional_job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
        contact = await _db.hi_job_contacts.find_one({"professional_job_id": job_id}, {"_id": 0})
        activities = await _db.hi_job_activities.find({"professional_job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        shares = await _db.hi_job_share_links.find({"professional_job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
        return {"job": job, "items": items, "contact": contact, "activities": activities, "shares": shares}

    @r.put("/{job_id}")
    async def update_job(job_id: str, req: UpdateJobReq, user: dict = Depends(get_current_user)):
        await _owned(job_id, user["id"])
        upd = {"updated_at": _now()}
        for f in ("title", "description", "safety_status"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        await _db.hi_professional_jobs.update_one({"id": job_id}, {"$set": upd})
        return await _db.hi_professional_jobs.find_one({"id": job_id}, {"_id": 0})

    @r.post("/{job_id}/items")
    async def add_item(job_id: str, req: ItemReq, user: dict = Depends(get_current_user)):
        await _owned(job_id, user["id"])
        if req.item_type not in ITEM_TYPES:
            raise HTTPException(status_code=400, detail="Invalid item type.")
        await _add_item(job_id, req.item_type, req.item_reference_id, note=req.note)
        return {"ok": True}

    @r.put("/{job_id}/items/{item_id}")
    async def toggle_item(job_id: str, item_id: str, req: ItemToggleReq, user: dict = Depends(get_current_user)):
        await _owned(job_id, user["id"])
        res = await _db.hi_job_items.update_one({"id": item_id, "professional_job_id": job_id},
                                                {"$set": {"included_in_summary": req.included_in_summary}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Item not found.")
        return {"ok": True}

    @r.delete("/{job_id}/items/{item_id}")
    async def delete_item(job_id: str, item_id: str, user: dict = Depends(get_current_user)):
        await _owned(job_id, user["id"])
        await _db.hi_job_items.delete_one({"id": item_id, "professional_job_id": job_id})
        return {"ok": True}

    @r.put("/{job_id}/contact")
    async def set_contact(job_id: str, req: ContactReq, user: dict = Depends(get_current_user)):
        await _owned(job_id, user["id"])
        await _db.hi_job_contacts.update_one(
            {"professional_job_id": job_id},
            {"$set": {"preferred_contact_method": req.preferred_contact_method,
                      "contact_value": req.contact_value, "availability_notes": req.availability_notes,
                      "updated_at": _now()},
             "$setOnInsert": {"id": _nid(), "professional_job_id": job_id, "created_at": _now()}},
            upsert=True)
        return {"ok": True}

    @r.get("/{job_id}/summary")
    async def summary(job_id: str, user: dict = Depends(get_current_user)):
        job = await _owned(job_id, user["id"])
        return await _resolve_summary(job, {"include_photos": True, "include_documents": True, "include_address": True})

    @r.put("/{job_id}/status")
    async def set_status(job_id: str, req: StatusReq, user: dict = Depends(get_current_user)):
        job = await _owned(job_id, user["id"])
        if req.status not in JOB_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status.")
        upd = {"status": req.status, "updated_at": _now()}
        if req.status == "completed":
            upd["completed_at"] = _now()
        await _db.hi_professional_jobs.update_one({"id": job_id}, {"$set": upd})
        await _activity(job_id, "status_changed", note=f"{req.status}" + (f" — {req.note}" if req.note else ""))
        await _cap(user, "professional_job_status_changed", {"status": req.status})
        if req.status == "completed":
            job["property_id"] = job.get("property_id")
            await _write_history(job, f"Professional work completed for: {job['title']}." + (f" {req.note}" if req.note else ""))
            await _cap(user, "professional_job_completed", {"had_professional": bool(req.had_professional)})
        return await _db.hi_professional_jobs.find_one({"id": job_id}, {"_id": 0})

    # ---- share links
    @r.post("/{job_id}/share")
    async def create_share(job_id: str, req: ShareReq, user: dict = Depends(get_current_user)):
        await _owned(job_id, user["id"])
        from datetime import timedelta
        token = secrets.token_urlsafe(24)
        exp = (datetime.now(timezone.utc) + timedelta(days=max(1, min(90, req.expires_in_days)))).isoformat()
        doc = {"id": _nid(), "professional_job_id": job_id, "share_token": token, "expires_at": exp,
               "allow_download": req.allow_download, "include_address": req.include_address,
               "include_documents": req.include_documents, "include_photos": req.include_photos,
               "status": "active", "created_at": _now(), "revoked_at": None, "open_count": 0}
        await _db.hi_job_share_links.insert_one(dict(doc))
        await _activity(job_id, "shared", note="Secure link created")
        await _cap(user, "secure_share_link_created", {"include_photos": req.include_photos,
                                                       "include_documents": req.include_documents,
                                                       "include_address": req.include_address})
        doc.pop("_id", None)
        return doc

    @r.post("/{job_id}/share/{share_id}/revoke")
    async def revoke_share(job_id: str, share_id: str, user: dict = Depends(get_current_user)):
        await _owned(job_id, user["id"])
        res = await _db.hi_job_share_links.update_one(
            {"id": share_id, "professional_job_id": job_id},
            {"$set": {"status": "revoked", "revoked_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Link not found.")
        await _activity(job_id, "status_changed", note="Share link revoked")
        await _cap(user, "secure_share_link_revoked", {})
        return {"ok": True}

    return r


# ============================================================= public router (no auth)
def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api/hi/shared")

    @r.get("/{token}")
    async def shared_view(token: str):
        link = await _db.hi_job_share_links.find_one({"share_token": token}, {"_id": 0})
        if not link:
            raise HTTPException(status_code=404, detail="This link is not valid.")
        if link["status"] == "revoked":
            raise HTTPException(status_code=410, detail="This link has been revoked by the owner.")
        try:
            expired = datetime.fromisoformat(link["expires_at"]) < datetime.now(timezone.utc)
        except Exception:
            expired = False
        if expired:
            if link["status"] != "expired":
                await _db.hi_job_share_links.update_one({"id": link["id"]}, {"$set": {"status": "expired"}})
            raise HTTPException(status_code=410, detail="This link has expired.")
        job = await _db.hi_professional_jobs.find_one({"id": link["professional_job_id"]}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="This link is not valid.")
        await _db.hi_job_share_links.update_one({"id": link["id"]}, {"$inc": {"open_count": 1}})
        await _activity(job["id"], "shared", note="Link opened", by="system")
        try:
            import analytics_engine
            await analytics_engine.capture({"id": job["user_id"]}, "secure_share_link_opened", {})
        except Exception:
            pass
        report = await _resolve_summary(job, {
            "include_photos": link["include_photos"],
            "include_documents": link["include_documents"],
            "include_address": link["include_address"]})
        contact = await _db.hi_job_contacts.find_one({"professional_job_id": job["id"]}, {"_id": 0})
        return {
            "shared_by": "a DIYhomie user",
            "expires_at": link["expires_at"],
            "allow_download": link["allow_download"],
            "report": report,
            "contact": {"preferred_contact_method": contact.get("preferred_contact_method"),
                        "contact_value": contact.get("contact_value"),
                        "availability_notes": contact.get("availability_notes")} if contact else None,
        }

    return r
