"""
DIYhomie — Home Knowledge Graph & Document Intelligence Platform (Build Blueprint 20).

Turns approved procedures, manuals, materials, tools, safety guidance AND user-approved
documents/assets into connected, SOURCE-AWARE knowledge. This is the source + relationship
layer that AI Orchestration retrieves from — not a static document library.

Two knowledge planes, strictly separated:
  • GLOBAL knowledge  — approved DIYhomie procedures/templates/manuals (published after review)
  • PRIVATE knowledge — a user's own assets/documents/measurements/projects (never public
                        without explicit consent + admin review)

Every meaningful claim keeps SOURCE LINEAGE (source → excerpt → assertion) + confidence +
verification status. No global knowledge is published solely because an AI extracted it.

Collections: kg_entities, kg_entity_versions, kg_relationships, kg_sources, kg_excerpts,
kg_assertions.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

ENTITY_TYPES = ["asset_category", "product", "product_model", "manufacturer", "part", "tool",
                "material", "procedure", "procedure_step", "safety_warning", "maintenance_task",
                "symptom", "possible_cause", "project_type", "room_type", "building_component",
                "document", "warranty", "recall_future", "code_reference_future"]
RELATIONSHIP_TYPES = ["requires_tool", "requires_material", "has_part", "has_manual", "has_warranty",
                      "has_maintenance_task", "has_common_symptom", "may_be_caused_by",
                      "may_require_professional", "installed_in", "compatible_with", "incompatible_with",
                      "related_to_project", "governed_by_warning", "supersedes"]
VISIBILITY = ["global", "private_property", "private_user"]
STATUS = ["draft", "review", "published", "archived"]
VERIF = ["unverified", "reviewed", "confirmed", "rejected"]

# Source reliability priority (higher wins). Matches the spec ordering.
RELIABILITY_RANK = {
    "manufacturer_document": 90, "approved_standard": 85, "approved_template": 80,
    "admin_research": 70, "user_project_contribution": 40, "user_document": 35, "ai_generated": 10,
}
# Predicates whose claims MUST be admin-reviewed before publishing (never auto-published).
SAFETY_SENSITIVE = {"safety", "repair", "code", "legal", "warranty", "electrical", "gas", "structural"}


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


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[kg:{event_type}] {message}", level="error")
    except Exception:
        pass


def _tokens(text: str) -> set:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


# ------------------------------------------------------------- seeding
SEED = {
    "source": {"source_type": "approved_template", "title": "DIYhomie Wall Painting Procedure",
               "reliability_rank": 80},
    "entities": [
        {"key": "proc_paint_wall", "entity_type": "procedure", "canonical_name": "Paint an interior wall",
         "description": "Prep, prime and paint an interior wall with even coats."},
        {"key": "mat_latex_paint", "entity_type": "material", "canonical_name": "Interior latex paint",
         "description": "Water-based wall paint for interior surfaces."},
        {"key": "tool_roller", "entity_type": "tool", "canonical_name": "Paint roller",
         "description": "Roller frame and nap cover for applying paint to large flat areas."},
        {"key": "warn_ventilate", "entity_type": "safety_warning", "canonical_name": "Ventilate the area",
         "description": "Keep the room ventilated and avoid prolonged fume exposure while painting."},
    ],
    "relationships": [
        ("proc_paint_wall", "requires_material", "mat_latex_paint"),
        ("proc_paint_wall", "requires_tool", "tool_roller"),
        ("proc_paint_wall", "governed_by_warning", "warn_ventilate"),
    ],
    "assertions": [
        ("proc_paint_wall", "recommended_coats", "Apply two thin coats, letting the first dry fully."),
        ("warn_ventilate", "safety", "Open windows and take breaks; some paints release fumes."),
    ],
}


async def seed_knowledge():
    if _db is None:
        return
    try:
        if await _db.kg_sources.find_one({"title": SEED["source"]["title"]}):
            return
        src = {"id": _nid(), "source_type": SEED["source"]["source_type"], "owner_type": "platform",
               "owner_id": None, "title": SEED["source"]["title"], "publication_date": _now(),
               "revision_date": _now(), "source_url": None, "storage_reference": None,
               "visibility": "global", "status": "published",
               "reliability_rank": SEED["source"]["reliability_rank"], "created_at": _now()}
        await _db.kg_sources.insert_one(dict(src))
        ex = {"id": _nid(), "source_id": src["id"], "excerpt_text": "Two thin coats give an even finish.",
              "section_title": "Application", "page_reference": None, "extraction_confidence": "high",
              "created_at": _now()}
        await _db.kg_excerpts.insert_one(dict(ex))
        keymap = {}
        for e in SEED["entities"]:
            eid = _nid()
            keymap[e["key"]] = eid
            await _db.kg_entities.insert_one({
                "id": eid, "entity_type": e["entity_type"], "canonical_name": e["canonical_name"],
                "description": e["description"], "status": "published", "visibility": "global",
                "confidence_level": "high", "owner_id": None, "property_id": None,
                "tags": list(_tokens(e["canonical_name"] + " " + e["description"])),
                "version_number": 1, "source_id": src["id"], "created_at": _now(), "updated_at": _now()})
        for s, rel, t in SEED["relationships"]:
            await _db.kg_relationships.insert_one({
                "id": _nid(), "source_entity_id": keymap[s], "relationship_type": rel,
                "target_entity_id": keymap[t], "confidence_level": "high",
                "source_reference_id": src["id"], "status": "active", "created_at": _now()})
        for subj, pred, val in SEED["assertions"]:
            await _db.kg_assertions.insert_one({
                "id": _nid(), "subject_entity_id": keymap[subj], "predicate": pred,
                "object_value": val, "object_entity_id": None, "source_excerpt_id": ex["id"],
                "confidence_level": "high", "verification_status": "confirmed", "visibility": "global",
                "status": "published", "reviewed_by": "seed", "reviewed_at": _now(), "created_at": _now()})
    except Exception as e:
        if _logger:
            _logger.error(f"knowledge seed failed: {e}")


# ------------------------------------------------------------- retrieval (used by AI Orchestration)
async def retrieve(user_id: str, query: str, feature_area: str = "general",
                   visibility_scope: str = "all", entity_types: Optional[list] = None,
                   max_results: int = 8) -> dict:
    """Source-aware retrieval. Private knowledge is returned ONLY for its owner. Global
    knowledge must be PUBLISHED. Prefers structured entities; attaches source references."""
    qtokens = _tokens(query)
    # visibility filter
    vis_or = []
    if visibility_scope in ("all", "global"):
        vis_or.append({"visibility": "global", "status": "published"})
    if visibility_scope in ("all", "private"):
        vis_or.append({"visibility": {"$in": ["private_user", "private_property"]}, "owner_id": user_id})
    q = {"$or": vis_or} if vis_or else {"visibility": "global", "status": "published"}
    if entity_types:
        q["entity_type"] = {"$in": entity_types}
    ents = await _db.kg_entities.find(q, {"_id": 0}).to_list(500)
    scored = []
    for e in ents:
        etoks = set(e.get("tags") or []) | _tokens(e["canonical_name"]) | _tokens(e.get("description", ""))
        overlap = len(qtokens & etoks)
        if overlap == 0 and qtokens:
            continue
        rel = overlap / max(len(qtokens), 1) if qtokens else 0.1
        scored.append((rel, e))
    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for rel, e in scored[:max_results]:
        src = await _db.kg_sources.find_one({"id": e.get("source_id")}, {"_id": 0}) if e.get("source_id") else None
        assertions = await _db.kg_assertions.find(
            {"subject_entity_id": e["id"], "status": "published"}, {"_id": 0}).to_list(20)
        results.append({
            "entity_id": e["id"], "entity_type": e["entity_type"], "canonical_name": e["canonical_name"],
            "description": e.get("description"), "relevance_score": round(rel, 3),
            "confidence_level": e.get("confidence_level"), "visibility": e["visibility"],
            "source_references": [{"id": src["id"], "title": src["title"], "type": src["source_type"],
                                   "reliability_rank": src.get("reliability_rank")}] if src else [],
            "assertions": [{"predicate": a["predicate"], "value": a.get("object_value"),
                            "verification_status": a["verification_status"]} for a in assertions],
            "retrieved_at": _now()})
    await _cap({"id": user_id}, "knowledge_search_used", {"feature_area": feature_area})
    return {"query": query, "feature_area": feature_area, "results": results, "count": len(results)}


# ============================================================= models
class RetrieveReq(BaseModel):
    query: str
    feature_area: str = "general"
    visibility_scope: str = "all"
    entity_types: Optional[list] = None
    max_results: int = 8


class ContributeReq(BaseModel):
    title: str
    entity_type: str = "procedure"
    description: str
    project_id: Optional[str] = None
    share_public: bool = False  # if true → submitted for admin review


class EntityReq(BaseModel):
    entity_type: str
    canonical_name: str
    description: Optional[str] = None
    visibility: str = "global"
    confidence_level: str = "medium"
    source_id: Optional[str] = None


class SourceReq(BaseModel):
    source_type: str = "approved_template"
    title: str
    source_url: Optional[str] = None
    reliability_rank: Optional[int] = None
    visibility: str = "global"


class ReviewReq(BaseModel):
    action: str  # approve | reject | archive | publish
    note: Optional[str] = None


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/knowledge", dependencies=[Depends(get_current_user)])

    @r.post("/retrieve")
    async def do_retrieve(req: RetrieveReq, user: dict = Depends(get_current_user)):
        return await retrieve(user["id"], req.query, req.feature_area, req.visibility_scope,
                              req.entity_types, min(20, max(1, req.max_results)))

    @r.get("/entity/{eid}")
    async def get_entity(eid: str, user: dict = Depends(get_current_user)):
        e = await _db.kg_entities.find_one({"id": eid}, {"_id": 0})
        if not e:
            raise HTTPException(status_code=404, detail="Not found.")
        # visibility enforcement
        if e["visibility"] != "global" and e.get("owner_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized.")
        if e["visibility"] == "global" and e["status"] != "published":
            raise HTTPException(status_code=404, detail="Not found.")
        rels = await _db.kg_relationships.find({"source_entity_id": eid, "status": "active"}, {"_id": 0}).to_list(50)
        # resolve related names
        related = []
        for rl in rels:
            tgt = await _db.kg_entities.find_one({"id": rl["target_entity_id"]}, {"_id": 0})
            related.append({"relationship_type": rl["relationship_type"], "target_name": tgt["canonical_name"] if tgt else None,
                            "target_id": rl["target_entity_id"], "target_type": tgt["entity_type"] if tgt else None})
        assertions = await _db.kg_assertions.find({"subject_entity_id": eid, "status": "published"}, {"_id": 0}).to_list(50)
        src = await _db.kg_sources.find_one({"id": e.get("source_id")}, {"_id": 0}) if e.get("source_id") else None
        return {"entity": e, "relationships": related, "assertions": assertions,
                "source": {"id": src["id"], "title": src["title"], "type": src["source_type"]} if src else None}

    @r.post("/contribute")
    async def contribute(req: ContributeReq, user: dict = Depends(get_current_user)):
        """Create a PRIVATE knowledge entity. If share_public=true, it enters admin REVIEW —
        it never becomes global knowledge until an admin approves + publishes it."""
        visibility = "private_user"
        status = "draft"
        src = {"id": _nid(), "source_type": "user_project_contribution", "owner_type": "user",
               "owner_id": user["id"], "title": req.title.strip()[:160], "publication_date": None,
               "revision_date": None, "source_url": None, "storage_reference": req.project_id,
               "visibility": "global" if req.share_public else "private_user",
               "status": "review" if req.share_public else "uploaded",
               "reliability_rank": RELIABILITY_RANK["user_project_contribution"], "created_at": _now()}
        await _db.kg_sources.insert_one(dict(src))
        e = {"id": _nid(), "entity_type": req.entity_type if req.entity_type in ENTITY_TYPES else "procedure",
             "canonical_name": req.title.strip()[:160], "description": req.description.strip()[:2000],
             "status": "review" if req.share_public else "draft",
             "visibility": "global" if req.share_public else visibility,
             "confidence_level": "low", "owner_id": user["id"], "property_id": None,
             "tags": list(_tokens(req.title + " " + req.description)), "version_number": 1,
             "source_id": src["id"], "created_at": _now(), "updated_at": _now()}
        await _db.kg_entities.insert_one(dict(e))
        await _cap(user, "knowledge_contribution_submitted", {"share_public": req.share_public})
        e.pop("_id", None)
        return {"entity": e, "submitted_for_review": req.share_public}

    return r


# ============================================================= admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/knowledge", dependencies=[Depends(require_admin)])

    async def _snapshot(entity: dict, reason: str, admin_id: str):
        await _db.kg_entity_versions.insert_one({
            "id": _nid(), "entity_id": entity["id"], "version_number": entity.get("version_number", 1),
            "snapshot": {k: entity.get(k) for k in ("canonical_name", "description", "status", "visibility", "confidence_level")},
            "reason": reason, "admin_id": admin_id, "created_at": _now()})

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        return {
            "entities": await _db.kg_entities.count_documents({}),
            "published": await _db.kg_entities.count_documents({"visibility": "global", "status": "published"}),
            "in_review": await _db.kg_entities.count_documents({"status": "review"}),
            "private": await _db.kg_entities.count_documents({"visibility": {"$in": ["private_user", "private_property"]}}),
            "sources": await _db.kg_sources.count_documents({}),
            "relationships": await _db.kg_relationships.count_documents({"status": "active"}),
            "assertions": await _db.kg_assertions.count_documents({}),
        }

    @r.get("/review-queue")
    async def review_queue(admin: dict = Depends(require_admin)):
        ents = await _db.kg_entities.find({"status": "review"}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"entities": ents}

    @r.get("/entities")
    async def list_entities(status: Optional[str] = None, visibility: Optional[str] = None, admin: dict = Depends(require_admin)):
        q = {}
        if status:
            q["status"] = status
        if visibility:
            q["visibility"] = visibility
        rows = await _db.kg_entities.find(q, {"_id": 0}).sort("updated_at", -1).to_list(300)
        return {"entities": rows}

    @r.post("/entities")
    async def create_entity(req: EntityReq, admin: dict = Depends(require_admin)):
        if req.entity_type not in ENTITY_TYPES:
            raise HTTPException(status_code=400, detail="Invalid entity type.")
        e = {"id": _nid(), "entity_type": req.entity_type, "canonical_name": req.canonical_name.strip()[:160],
             "description": (req.description or "")[:2000], "status": "draft",
             "visibility": req.visibility if req.visibility in VISIBILITY else "global",
             "confidence_level": req.confidence_level, "owner_id": None, "property_id": None,
             "tags": list(_tokens(req.canonical_name + " " + (req.description or ""))),
             "version_number": 1, "source_id": req.source_id, "created_at": _now(), "updated_at": _now()}
        await _db.kg_entities.insert_one(dict(e))
        e.pop("_id", None)
        return e

    @r.post("/entities/{eid}/review")
    async def review_entity(eid: str, req: ReviewReq, admin: dict = Depends(require_admin)):
        e = await _db.kg_entities.find_one({"id": eid}, {"_id": 0})
        if not e:
            raise HTTPException(status_code=404, detail="Entity not found.")
        await _snapshot(e, f"review:{req.action}", admin["id"])
        if req.action == "approve":
            upd = {"status": "review", "confidence_level": "medium"}
        elif req.action == "publish":
            # global publish → bump version + publish source too
            upd = {"status": "published", "visibility": "global", "version_number": e.get("version_number", 1) + 1,
                   "reviewed_by": admin["id"], "reviewed_at": _now()}
            if e.get("source_id"):
                await _db.kg_sources.update_one({"id": e["source_id"]}, {"$set": {"status": "published", "publication_date": _now()}})
        elif req.action == "archive":
            upd = {"status": "archived"}
        elif req.action == "reject":
            upd = {"status": "draft", "visibility": "private_user"}
        else:
            raise HTTPException(status_code=400, detail="Invalid action.")
        upd["updated_at"] = _now()
        await _db.kg_entities.update_one({"id": eid}, {"$set": upd})
        return await _db.kg_entities.find_one({"id": eid}, {"_id": 0})

    @r.get("/entities/{eid}/versions")
    async def entity_versions(eid: str, admin: dict = Depends(require_admin)):
        rows = await _db.kg_entity_versions.find({"entity_id": eid}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"versions": rows}

    @r.post("/entities/{eid}/rollback/{version_number}")
    async def rollback(eid: str, version_number: int, admin: dict = Depends(require_admin)):
        v = await _db.kg_entity_versions.find_one({"entity_id": eid, "version_number": version_number}, {"_id": 0}, sort=[("created_at", -1)])
        if not v:
            raise HTTPException(status_code=404, detail="Version not found.")
        e = await _db.kg_entities.find_one({"id": eid}, {"_id": 0})
        await _snapshot(e, f"rollback_to_v{version_number}", admin["id"])
        snap = v["snapshot"]
        await _db.kg_entities.update_one({"id": eid}, {"$set": {**snap, "version_number": e.get("version_number", 1) + 1, "updated_at": _now()}})
        return await _db.kg_entities.find_one({"id": eid}, {"_id": 0})

    @r.post("/sources")
    async def create_source(req: SourceReq, admin: dict = Depends(require_admin)):
        s = {"id": _nid(), "source_type": req.source_type, "owner_type": "platform", "owner_id": None,
             "title": req.title.strip()[:200], "publication_date": None, "revision_date": None,
             "source_url": req.source_url, "storage_reference": None,
             "visibility": req.visibility if req.visibility in VISIBILITY else "global", "status": "uploaded",
             "reliability_rank": req.reliability_rank if req.reliability_rank is not None else RELIABILITY_RANK.get(req.source_type, 50),
             "created_at": _now()}
        await _db.kg_sources.insert_one(dict(s))
        await _cap(admin, "knowledge_source_uploaded", {"source_type": req.source_type})
        s.pop("_id", None)
        return s

    @r.get("/sources")
    async def list_sources(admin: dict = Depends(require_admin)):
        rows = await _db.kg_sources.find({}, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"sources": rows}

    @r.get("/entities/{eid}/lineage")
    async def lineage(eid: str, admin: dict = Depends(require_admin)):
        e = await _db.kg_entities.find_one({"id": eid}, {"_id": 0})
        if not e:
            raise HTTPException(status_code=404, detail="Entity not found.")
        src = await _db.kg_sources.find_one({"id": e.get("source_id")}, {"_id": 0}) if e.get("source_id") else None
        assertions = await _db.kg_assertions.find({"subject_entity_id": eid}, {"_id": 0}).to_list(100)
        excerpts = []
        for a in assertions:
            if a.get("source_excerpt_id"):
                ex = await _db.kg_excerpts.find_one({"id": a["source_excerpt_id"]}, {"_id": 0})
                if ex:
                    excerpts.append(ex)
        return {"entity": e, "source": src, "assertions": assertions, "excerpts": excerpts}

    return r
