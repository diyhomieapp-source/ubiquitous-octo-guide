"""
DIYhomie — Home Document Vault & Asset Knowledge Capture (Build Blueprint 06).

Private per-user vault for manuals, receipts, warranties, estimates, permits,
photos and project files. Stores the file (base64), runs AI field extraction
(gpt-4o vision) that the user must REVIEW before it's trusted, and links each
document to a property / room / asset / project / maintenance task.

Collections:
  hi_documents, hi_document_extractions, hi_document_relationships, hi_document_access
Shares: hi_properties, hi_rooms, hi_assets, hi_projects, hi_analytics
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_key = ""

CATEGORIES = ["manual", "receipt", "warranty", "estimate", "invoice", "permit",
              "inspection_report", "product_label", "project_photo", "other"]
ENTITY_TYPES = ["property", "room", "asset", "project", "maintenance_task"]
REL_TYPES = ["manual_for", "receipt_for", "warranty_for", "estimate_for", "permit_for", "photo_of", "other"]
EXTRACT_FIELDS = ["brand", "model_number", "serial_number", "purchase_date",
                  "installation_date", "warranty_period", "vendor", "product_category"]


def configure(db, logger, llm_key: str):
    global _db, _logger, _llm_key
    _db, _logger, _llm_key = db, logger, (llm_key or "")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


async def _track(user_id, event, meta=None):
    try:
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _log(document_id, user_id, action):
    try:
        await _db.hi_document_access.insert_one(
            {"id": _new_id(), "document_id": document_id, "user_id": user_id, "action": action, "created_at": _now()})
    except Exception:
        pass


async def _get_or_create_property(user_id):
    prop = await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0})
    if not prop:
        prop = {"id": _new_id(), "user_id": user_id, "name": "My Home", "address": None,
                "property_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
    return prop


async def _extract_fields(image_base64: str) -> dict:
    """gpt-4o vision → {extracted_text, fields:[{field_name,value,confidence,source_excerpt}]}."""
    import json as _json
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        system = (
            "You read a photographed home document (manual, receipt, warranty, estimate, invoice, "
            "permit, inspection report, product label). Return STRICT JSON: {\"extracted_text\": string "
            "(all readable text, <=4000 chars), \"fields\": [{\"field_name\": one of "
            f"{EXTRACT_FIELDS}, \"value\": string, \"confidence\": one of [Likely, Needs Review], "
            "\"source_excerpt\": short quote}}]}. Only include a field if you actually see evidence for "
            "it. Never guess a model/serial number without a visible label — omit it instead.")
        chat = LlmChat(api_key=_llm_key, session_id=_new_id(), system_message=system).with_model("openai", "gpt-4o")
        out = await chat.send_message(UserMessage(
            text="Extract the text and key fields from this document.", file_contents=[ImageContent(image_base64)]))
        raw = (out or "").strip().lstrip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip("`").strip()
        data = _json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        if isinstance(data, dict):
            return data
    except Exception as e:
        if _logger:
            _logger.warning(f"doc extract failed: {e}")
    return {"extracted_text": "", "fields": []}


# =============================================================== models
class DocumentReq(BaseModel):
    title: Optional[str] = None
    category: str = "other"
    file_base64: str
    file_type: str = "image"          # image | pdf | file
    is_image: bool = True
    notes: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    project_id: Optional[str] = None
    maintenance_task_id: Optional[str] = None


class DocEditReq(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None


class LinkReq(BaseModel):
    related_entity_type: str
    related_entity_id: str
    relationship_type: str = "other"


class ExtractionReviewReq(BaseModel):
    status: str                        # confirmed | rejected
    extracted_value: Optional[str] = None


class AskReq(BaseModel):
    question: str


def build_router(get_current_user: Callable, llm_json: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/documents", dependencies=[Depends(get_current_user)])

    async def _owned(doc_id, user_id):
        d = await _db.hi_documents.find_one({"id": doc_id, "user_id": user_id}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Document not found.")
        return d

    # ------------------------------------------------- upload
    @r.post("")
    async def upload(req: DocumentReq, user: dict = Depends(get_current_user)):
        if not req.file_base64:
            raise HTTPException(status_code=400, detail="A file is required.")
        prop = await _get_or_create_property(user["id"])
        cat = req.category if req.category in CATEGORIES else "other"
        did = _new_id()
        doc = {
            "id": did, "user_id": user["id"], "property_id": prop["id"],
            "room_id": req.room_id, "asset_id": req.asset_id, "project_id": req.project_id,
            "maintenance_task_id": req.maintenance_task_id,
            "title": (req.title or "").strip()[:120] or f"{cat.replace('_', ' ').title()} {_now()[:10]}",
            "category": cat, "file_base64": req.file_base64, "file_type": req.file_type,
            "extracted_text": "", "notes": req.notes, "processing_status": "processing", "created_at": _now(), "updated_at": _now(),
        }
        await _db.hi_documents.insert_one(dict(doc))
        await _track(user["id"], "document_upload_completed", {"document_id": did, "category": cat})
        # AI extraction (images only for now)
        fields = []
        if req.is_image and req.file_type == "image":
            data = await _extract_fields(req.file_base64)
            text = (data.get("extracted_text") or "")[:6000]
            for f in data.get("fields", []):
                fn = f.get("field_name")
                if fn in EXTRACT_FIELDS and f.get("value"):
                    fields.append(fn)
                    await _db.hi_document_extractions.insert_one({
                        "id": _new_id(), "document_id": did, "field_name": fn,
                        "extracted_value": str(f.get("value"))[:200],
                        "confidence_level": f.get("confidence") if f.get("confidence") in ("Likely", "Needs Review") else "Needs Review",
                        "status": "pending_review", "source_excerpt": (f.get("source_excerpt") or "")[:300],
                        "created_at": _now(), "reviewed_at": None})
            await _db.hi_documents.update_one({"id": did}, {"$set": {"extracted_text": text, "processing_status": "ready" if text or fields else "ready"}})
            await _track(user["id"], "document_processing_completed", {"document_id": did, "fields": len(fields)})
        else:
            await _db.hi_documents.update_one({"id": did}, {"$set": {"processing_status": "ready"}})
        # relationship shortcut for provided links
        for et, eid, rt in [("room", req.room_id, "other"), ("asset", req.asset_id, "manual_for"),
                            ("project", req.project_id, "other"), ("maintenance_task", req.maintenance_task_id, "other")]:
            if eid:
                await _db.hi_document_relationships.insert_one({
                    "id": _new_id(), "document_id": did, "related_entity_type": et,
                    "related_entity_id": eid, "relationship_type": rt, "created_at": _now()})
        return {"id": did, "processing_status": "ready", "extracted_fields": len(fields), "title": doc["title"]}

    # ------------------------------------------------- list / vault home
    @r.get("")
    async def list_documents(category: Optional[str] = None, needs_review: bool = False,
                             unlinked: bool = False, user: dict = Depends(get_current_user)):
        await _track(user["id"], "document_vault_opened", {})
        q = {"user_id": user["id"]}
        if category:
            q["category"] = category
        rows = await _db.hi_documents.find(q, {"_id": 0, "file_base64": 0, "extracted_text": 0}).sort("created_at", -1).to_list(500)
        # counts by category
        counts = {c: 0 for c in CATEGORIES}
        for d in rows:
            counts[d["category"]] = counts.get(d["category"], 0) + 1
        # needs-review + unlinked
        pend = await _db.hi_document_extractions.distinct("document_id", {"status": "pending_review"})
        pend = set(pend)
        for d in rows:
            d["needs_review"] = d["id"] in pend
            d["is_linked"] = bool(d.get("asset_id") or d.get("room_id") or d.get("project_id") or d.get("maintenance_task_id"))
        if needs_review:
            rows = [d for d in rows if d["needs_review"]]
        if unlinked:
            rows = [d for d in rows if not d["is_linked"]]
        return {"documents": rows, "counts": counts, "total": len(rows),
                "review_count": len([d for d in rows if d.get("needs_review")])}

    # ------------------------------------------------- review queue
    @r.get("/review-queue")
    async def review_queue(user: dict = Depends(get_current_user)):
        dids = await _db.hi_document_extractions.distinct("document_id", {"status": "pending_review"})
        docs = await _db.hi_documents.find(
            {"id": {"$in": dids}, "user_id": user["id"]}, {"_id": 0, "file_base64": 0}).sort("created_at", -1).to_list(200)
        for d in docs:
            d["pending"] = await _db.hi_document_extractions.count_documents({"document_id": d["id"], "status": "pending_review"})
        return {"documents": docs}

    # ------------------------------------------------- search
    @r.get("/search")
    async def search(q: str = "", user: dict = Depends(get_current_user)):
        await _track(user["id"], "document_search_used", {"q": q[:80]})
        term = (q or "").strip()
        if not term:
            return {"documents": []}
        # map plain-language category words
        cat = None
        for c in CATEGORIES:
            if c.replace("_", " ") in term.lower():
                cat = c
                break
        rx = {"$regex": re.escape(term), "$options": "i"}
        # match against extraction values too
        ext_dids = await _db.hi_document_extractions.distinct("document_id", {"extracted_value": rx})
        mongo_q = {"user_id": user["id"], "$or": [
            {"title": rx}, {"extracted_text": rx}, {"id": {"$in": ext_dids}}]}
        if cat:
            mongo_q = {"user_id": user["id"], "category": cat}
        rows = await _db.hi_documents.find(mongo_q, {"_id": 0, "file_base64": 0, "extracted_text": 0}).sort("created_at", -1).to_list(100)
        return {"documents": rows}

    # ------------------------------------------------- detail
    @r.get("/{doc_id}")
    async def detail(doc_id: str, include_file: bool = True, user: dict = Depends(get_current_user)):
        d = await _owned(doc_id, user["id"])
        await _log(doc_id, user["id"], "viewed")
        await _track(user["id"], "document_opened", {"document_id": doc_id})
        exts = await _db.hi_document_extractions.find({"document_id": doc_id}, {"_id": 0}).sort("field_name", 1).to_list(50)
        rels = await _db.hi_document_relationships.find({"document_id": doc_id}, {"_id": 0}).to_list(50)
        # resolve linked names
        for rel in rels:
            coll = {"room": "hi_rooms", "asset": "hi_assets", "project": "hi_projects", "property": "hi_properties"}.get(rel["related_entity_type"])
            if coll:
                ent = await _db[coll].find_one({"id": rel["related_entity_id"]}, {"_id": 0, "name": 1, "title": 1})
                rel["name"] = (ent or {}).get("name") or (ent or {}).get("title") or "Linked"
        if not include_file:
            d.pop("file_base64", None)
        return {"document": d, "extractions": exts, "relationships": rels}

    @r.put("/{doc_id}")
    async def edit(doc_id: str, req: DocEditReq, user: dict = Depends(get_current_user)):
        await _owned(doc_id, user["id"])
        upd = {"updated_at": _now()}
        if req.title is not None:
            upd["title"] = req.title[:120]
        if req.category and req.category in CATEGORIES:
            upd["category"] = req.category
        if req.notes is not None:
            upd["notes"] = req.notes
        await _db.hi_documents.update_one({"id": doc_id}, {"$set": upd})
        await _log(doc_id, user["id"], "edited")
        return await _db.hi_documents.find_one({"id": doc_id}, {"_id": 0, "file_base64": 0})

    @r.delete("/{doc_id}")
    async def delete(doc_id: str, user: dict = Depends(get_current_user)):
        await _owned(doc_id, user["id"])
        await _db.hi_documents.delete_one({"id": doc_id})
        await _db.hi_document_extractions.delete_many({"document_id": doc_id})
        await _db.hi_document_relationships.delete_many({"document_id": doc_id})
        await _log(doc_id, user["id"], "deleted")
        await _track(user["id"], "document_deleted", {"document_id": doc_id})
        return {"ok": True}

    # ------------------------------------------------- link
    @r.post("/{doc_id}/link")
    async def link(doc_id: str, req: LinkReq, user: dict = Depends(get_current_user)):
        await _owned(doc_id, user["id"])
        if req.related_entity_type not in ENTITY_TYPES:
            raise HTTPException(status_code=400, detail="Invalid link type.")
        rt = req.relationship_type if req.relationship_type in REL_TYPES else "other"
        await _db.hi_document_relationships.insert_one({
            "id": _new_id(), "document_id": doc_id, "related_entity_type": req.related_entity_type,
            "related_entity_id": req.related_entity_id, "relationship_type": rt, "created_at": _now()})
        # set shortcut id on document
        field = {"room": "room_id", "asset": "asset_id", "project": "project_id", "maintenance_task": "maintenance_task_id"}.get(req.related_entity_type)
        if field:
            await _db.hi_documents.update_one({"id": doc_id}, {"$set": {field: req.related_entity_id, "updated_at": _now()}})
        # if linked to an asset, also mirror into that asset's B01 document list for guidance grounding
        if req.related_entity_type == "asset":
            d = await _db.hi_documents.find_one({"id": doc_id}, {"_id": 0})
            if d and d.get("extracted_text"):
                exists = await _db.hi_asset_documents.find_one({"vault_document_id": doc_id})
                if not exists:
                    await _db.hi_asset_documents.insert_one({
                        "id": _new_id(), "asset_id": req.related_entity_id, "vault_document_id": doc_id,
                        "document_type": d["category"] if d["category"] in ("manual", "receipt", "warranty") else "other",
                        "file_base64": d.get("file_base64"), "extracted_text": d.get("extracted_text", ""),
                        "processing_status": "done", "uploaded_at": _now()})
        await _track(user["id"], "document_linked", {"document_id": doc_id, "entity": req.related_entity_type})
        return {"ok": True}

    # ------------------------------------------------- extraction review
    @r.put("/{doc_id}/extractions/{ext_id}")
    async def review_extraction(doc_id: str, ext_id: str, req: ExtractionReviewReq, user: dict = Depends(get_current_user)):
        await _owned(doc_id, user["id"])
        status = req.status if req.status in ("confirmed", "rejected") else "confirmed"
        upd = {"status": status, "reviewed_at": _now()}
        if req.extracted_value is not None:
            upd["extracted_value"] = req.extracted_value[:200]
        if status == "confirmed":
            upd["confidence_level"] = "Confirmed by User"
        await _db.hi_document_extractions.update_one({"id": ext_id, "document_id": doc_id}, {"$set": upd})
        await _track(user["id"], "document_extraction_reviewed", {"document_id": doc_id, "status": status})
        return {"ok": True, "status": status}

    # ------------------------------------------------- ask homie about doc
    @r.post("/{doc_id}/ask")
    async def ask(doc_id: str, req: AskReq, user: dict = Depends(get_current_user)):
        d = await _owned(doc_id, user["id"])
        qs = (req.question or "").strip()
        if not qs:
            raise HTTPException(status_code=400, detail="Ask a question.")
        exts = await _db.hi_document_extractions.find({"document_id": doc_id, "status": {"$ne": "rejected"}}, {"_id": 0}).to_list(50)
        fields = "; ".join(f"{e['field_name']}={e['extracted_value']} ({e['confidence_level']})" for e in exts)
        system = ("You answer questions about a homeowner's document using ONLY its extracted content. "
                  "Do not infer warranty coverage/eligibility, permit approval, product authenticity or "
                  "legal validity. If the answer isn't in the document, say so. Return STRICT JSON: {\"answer\": string}.")
        ut = f"Document category: {d['category']}\nExtracted fields: {fields or 'none'}\n\nDocument text:\n{(d.get('extracted_text') or '')[:4000]}\n\nQuestion: {qs}"
        await _track(user["id"], "homie_asked_about_document", {"document_id": doc_id})
        try:
            data = await llm_json(system, ut, max_tokens=500)
        except Exception:
            raise HTTPException(status_code=502, detail="Couldn't answer right now.")
        return {"answer": data.get("answer", "") if isinstance(data, dict) else str(data)}

    return r
