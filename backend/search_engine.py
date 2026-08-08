"""
DIYhomie — Universal Search, Discovery & Contextual Navigation (Build Blueprint 41).

A federated, authorization-first search across a user's private home records
(rooms, assets, documents, projects, maintenance, measurements) plus approved
global knowledge (content templates, expert guides) and approved community content.

Authorization is applied BEFORE ranking: private records are resolved from the
caller's own property/user id, so inaccessible records are never revealed.

User namespace   /api/hi/search
Admin namespace  /api/hi/admin/search/*
Collections: search_query_logs, search_config, search_synonyms, search_index_health
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

_db = None
_logger = None

# entity_type -> (group label, base score, deep-link template)
GROUPS = {
    "room": ("My Home", 22, "/home-intel/rooms/{id}"),
    "asset": ("My Home", 24, "/home-intel/asset/{id}"),
    "document": ("My Home", 22, "/home-intel/documents/{id}"),
    "measurement": ("My Home", 18, "/home-intel/rooms/index"),
    "project": ("My Projects", 24, "/home-intel/projects/{id}"),
    "maintenance": ("Home Care", 22, "/home-intel/maintenance/{id}"),
    "template": ("Guides", 4, "/home-intel/knowledge"),
    "guide": ("Guides", 4, "/home-intel/knowledge"),
    "community": ("Community Experiences", 0, "/home-intel/community-hub/{id}"),
}
GROUP_ORDER = ["My Home", "My Projects", "Home Care", "Guides", "Community Experiences"]
GLOBAL_TYPES = {"template", "guide", "community"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _sanitize(q: str) -> str:
    # Strip anything that looks like a secret/token before logging.
    q = re.sub(r"[A-Za-z0-9_\-]{24,}", "[redacted]", q or "")
    return q.strip()[:200]


async def _get_config() -> dict:
    cfg = await _db.search_config.find_one({"id": "global"}, {"_id": 0})
    if not cfg:
        cfg = {"id": "global", "excluded_types": [], "community_in_search": True, "log_retention_days": 90}
        await _db.search_config.insert_one(dict(cfg))
    return cfg


async def _synonyms() -> dict:
    rows = await _db.search_synonyms.find({}, {"_id": 0}).to_list(500)
    m = {}
    for r in rows:
        for term in [r["term"].lower()] + [t.lower() for t in r.get("synonyms", [])]:
            m.setdefault(term, set()).add(r["term"].lower())
            for t in r.get("synonyms", []):
                m[term].add(t.lower())
    return m


def _expand(q: str, syn: dict) -> list:
    tokens = [t for t in re.split(r"\s+", q.lower().strip()) if t]
    extra = set()
    if q.lower().strip() in syn:
        extra |= syn[q.lower().strip()]
    for t in tokens:
        if t in syn:
            extra |= syn[t]
    return list({q.lower().strip(), *tokens, *extra})


def _score(query: str, title: str, extra: str, base: int, terms: list) -> int:
    q = query.lower().strip()
    t = (title or "").lower()
    ex = (extra or "").lower()
    s = 0
    if q and q == t:
        s = 100
    elif q and t.startswith(q):
        s = 70
    elif q and q in t:
        s = 50
    else:
        qt = set(q.split())
        tt = set(t.split())
        overlap = qt & tt
        if overlap:
            s = 25 + 5 * len(overlap)
    if s < 40 and q and q in ex:
        s = max(s, 32)
    if s == 0:
        hit_title = any(len(tk) > 2 and tk in t for tk in terms)
        hit_extra = any(len(tk) > 2 and tk in ex for tk in terms)
        if hit_title:
            s = 20
        elif hit_extra:
            s = 12
    return s + base if s > 0 else 0


async def _active_property(user_id: str) -> Optional[dict]:
    p = await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
    if not p:
        p = await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0})
    return p


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/search")

    @r.get("")
    async def search(
        q: str = Query(..., min_length=1),
        context_type: Optional[str] = None,
        context_id: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        uid = user["id"]
        cfg = await _get_config()
        excluded = set(cfg.get("excluded_types", []))
        syn = await _synonyms()
        terms = _expand(q, syn)
        prop = await _active_property(uid)
        pid = prop["id"] if prop else None

        results = []

        def add(entity_type, entity_id, title, summary, extra, source_type, updated_at, related=None, confidence=None):
            if entity_type in excluded:
                return
            base = GROUPS[entity_type][1]
            sc = _score(q, title, extra, base, terms)
            if sc <= 0:
                return
            tmpl = GROUPS[entity_type][2]
            deep = tmpl.format(id=entity_id) if "{id}" in tmpl else tmpl
            results.append({
                "entity_type": entity_type, "entity_id": entity_id, "title": title,
                "summary": summary, "relevance_score": sc, "source_type": source_type,
                "confidence_level": confidence, "deep_link": deep,
                "permission_scope": "global" if entity_type in GLOBAL_TYPES else "owner",
                "related": related, "group": GROUPS[entity_type][0], "updated_at": updated_at or "",
            })

        ctx_room = context_id if context_type == "room" else None
        ctx_project = context_id if context_type == "project" else None

        # ---- Private, authorized records (resolved from caller's own property) ----
        if pid:
            rooms = await _db.hi_rooms.find({"property_id": pid, "status": {"$ne": "archived"}}, {"_id": 0}).to_list(300)
            room_names = {rm["id"]: rm.get("name") for rm in rooms}
            if not ctx_room and not ctx_project:
                for rm in rooms:
                    add("room", rm["id"], rm.get("name") or "Room", f"{rm.get('room_type') or 'Room'}",
                        f"{rm.get('room_type')} {rm.get('notes') or ''}", "private", rm.get("updated_at"))

            aq = {"property_id": pid}
            if ctx_room:
                aq["room_id"] = ctx_room
            for a in await _db.hi_assets.find(aq, {"_id": 0, "photo_base64": 0}).to_list(500):
                extra = f"{a.get('category')} {a.get('brand') or ''} {a.get('model_number') or ''}"
                add("asset", a["id"], a.get("name") or "Asset",
                    f"{a.get('category') or 'Asset'}" + (f" · {a.get('brand')}" if a.get("brand") else ""),
                    extra, "private", a.get("created_at"), related=room_names.get(a.get("room_id")))

            dq = {"user_id": uid}
            if ctx_room:
                dq["room_id"] = ctx_room
            if ctx_project:
                dq["project_id"] = ctx_project
            for d in await _db.hi_documents.find(dq, {"_id": 0, "file_base64": 0}).to_list(500):
                add("document", d["id"], d.get("title") or "Document", f"{(d.get('category') or 'document').replace('_', ' ').title()}",
                    f"{d.get('category')} {(d.get('extracted_text') or '')[:2000]} {d.get('notes') or ''}",
                    "private", d.get("updated_at"), related=room_names.get(d.get("room_id")))

            pq = {"user_id": uid}
            if ctx_project:
                pq["id"] = ctx_project
            for p in await _db.hi_projects.find(pq, {"_id": 0}).to_list(400):
                add("project", p["id"], p.get("title") or "Project",
                    f"{p.get('project_category') or 'Project'} · {p.get('status') or 'draft'}",
                    f"{p.get('project_category')} {p.get('project_goal') or ''} {p.get('description') or ''}",
                    "private", p.get("created_at"), related=room_names.get(p.get("room_id")))

            mq = {"user_id": uid}
            if ctx_room:
                mq["room_id"] = ctx_room
            if ctx_project:
                mq["project_id"] = ctx_project
            for m in await _db.hi_maintenance_tasks.find(mq, {"_id": 0}).to_list(400):
                add("maintenance", m["id"], m.get("title") or "Task",
                    f"{m.get('category') or 'Maintenance'} · due {m.get('due_date') or 'n/a'}",
                    f"{m.get('category')} {m.get('description') or ''}", "private", m.get("updated_at"))

            for ms in await _db.hi_measurements.find(mq, {"_id": 0}).to_list(400):
                add("measurement", ms["id"], ms.get("name") or "Measurement",
                    f"{ms.get('measurement_type') or 'Measurement'} · {ms.get('unit') or ''}",
                    f"{ms.get('measurement_type')} {ms.get('notes') or ''}", "private", ms.get("updated_at"),
                    confidence=ms.get("confidence_level"))

        # ---- Approved global knowledge (only when not in a private context) ----
        if not ctx_room and not ctx_project:
            for tpl in await _db.hi_content_templates.find(
                    {"status": {"$in": ["published", "approved", "active"]}}, {"_id": 0}).to_list(300):
                add("template", tpl["id"], tpl.get("title") or "Guide", f"{tpl.get('category') or 'Guide'}",
                    f"{tpl.get('category')} {(tpl.get('content') or '')[:1500]}", "verified", tpl.get("updated_at"),
                    confidence="high")
            for g in await _db.expert_guides.find({"status": "published"}, {"_id": 0}).to_list(300):
                add("guide", g["id"], g.get("title") or "Guide", f"{g.get('category') or 'Guide'} · {g.get('author_name') or ''}",
                    f"{g.get('category')} {g.get('summary') or ''} {(g.get('body') or '')[:1500]}", "verified",
                    g.get("updated_at"), confidence="medium")
            if cfg.get("community_in_search", True):
                for c in await _db.cc_content.find(
                        {"moderation_status": "approved", "visibility": {"$in": ["public", "unlisted_share"]}},
                        {"_id": 0}).to_list(300):
                    add("community", c["id"], c.get("title") or "Community post", f"{c.get('category') or 'Community'} · {c.get('difficulty') or ''}",
                        f"{c.get('category')} {(c.get('body') or '')[:1500]}", "community", c.get("updated_at"))

        results.sort(key=lambda x: (x["relevance_score"], x["updated_at"]), reverse=True)
        results = results[:60]

        grouped = {}
        for res in results:
            grouped.setdefault(res["group"], []).append(res)
        ordered = [{"group": g, "results": grouped[g]} for g in GROUP_ORDER if g in grouped]

        # Sanitized query log (observability).
        try:
            await _db.search_query_logs.insert_one({
                "id": _nid(), "user_id": uid, "query_text_sanitized": _sanitize(q),
                "context_type": context_type, "result_count": len(results),
                "selected_result_type": None, "created_at": _now(),
            })
        except Exception:
            pass

        return {"query": q, "result_count": len(results), "groups": ordered, "results": results}

    @r.post("/select")
    async def log_select(entity_type: str = Query(...), user: dict = Depends(get_current_user)):
        # Records which result type a user opened (feeds ranking analytics).
        try:
            last = await _db.search_query_logs.find_one({"user_id": user["id"]}, sort=[("created_at", -1)])
            if last:
                await _db.search_query_logs.update_one({"id": last["id"]}, {"$set": {"selected_result_type": entity_type}})
        except Exception:
            pass
        return {"ok": True}

    return r


class ConfigReq(BaseModel):
    excluded_types: Optional[list] = None
    community_in_search: Optional[bool] = None
    log_retention_days: Optional[int] = None


class SynonymReq(BaseModel):
    term: str
    synonyms: list


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/search", dependencies=[Depends(require_admin)])

    async def _reindex_snapshot():
        colls = {"room": "hi_rooms", "asset": "hi_assets", "document": "hi_documents", "project": "hi_projects",
                 "maintenance": "hi_maintenance_tasks", "measurement": "hi_measurements"}
        counts = {}
        for et, coll in colls.items():
            counts[et] = await _db[coll].count_documents({})
        counts["template"] = await _db.hi_content_templates.count_documents({"status": {"$in": ["published", "approved", "active"]}})
        counts["guide"] = await _db.expert_guides.count_documents({"status": "published"})
        counts["community"] = await _db.cc_content.count_documents({"moderation_status": "approved"})
        snap = {"id": _nid(), "counts": counts, "total": sum(counts.values()), "failed": 0,
                "index_status": "indexed", "reindexed_at": _now()}
        await _db.search_index_health.insert_one(dict(snap)); snap.pop("_id", None)
        return snap

    @r.get("/health")
    async def health(admin: dict = Depends(require_admin)):
        last = await _db.search_index_health.find_one({}, {"_id": 0}, sort=[("reindexed_at", -1)])
        if not last:
            last = await _reindex_snapshot()
        return {"health": last}

    @r.post("/reindex")
    async def reindex(admin: dict = Depends(require_admin)):
        return {"health": await _reindex_snapshot()}

    @r.get("/config")
    async def get_config(admin: dict = Depends(require_admin)):
        return {"config": await _get_config(), "entity_types": list(GROUPS.keys())}

    @r.put("/config")
    async def put_config(req: ConfigReq, admin: dict = Depends(require_admin)):
        cfg = await _get_config()
        upd = {}
        if req.excluded_types is not None:
            upd["excluded_types"] = [t for t in req.excluded_types if t in GROUPS]
        if req.community_in_search is not None:
            upd["community_in_search"] = req.community_in_search
        if req.log_retention_days is not None:
            upd["log_retention_days"] = max(1, min(3650, req.log_retention_days))
        if upd:
            await _db.search_config.update_one({"id": "global"}, {"$set": upd})
        return {"config": {**cfg, **upd}}

    @r.get("/synonyms")
    async def list_synonyms(admin: dict = Depends(require_admin)):
        rows = await _db.search_synonyms.find({}, {"_id": 0}).sort("term", 1).to_list(500)
        return {"synonyms": rows}

    @r.post("/synonyms")
    async def add_synonym(req: SynonymReq, admin: dict = Depends(require_admin)):
        doc = {"id": _nid(), "term": req.term.strip().lower()[:60],
               "synonyms": [s.strip().lower()[:60] for s in req.synonyms if s.strip()][:20], "created_at": _now()}
        await _db.search_synonyms.insert_one(dict(doc)); doc.pop("_id", None)
        return {"synonym": doc}

    @r.delete("/synonyms/{sid}")
    async def del_synonym(sid: str, admin: dict = Depends(require_admin)):
        await _db.search_synonyms.delete_one({"id": sid})
        return {"ok": True}

    @r.get("/logs")
    async def logs(admin: dict = Depends(require_admin)):
        rows = await _db.search_query_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        no_results = [x for x in rows if x.get("result_count", 0) == 0][:50]
        return {"logs": rows, "no_results": no_results, "total": await _db.search_query_logs.count_documents({})}

    return r


async def seed_search():
    if _db is None:
        return
    try:
        await _db.search_query_logs.create_index("created_at")
        await _db.search_synonyms.create_index("term")
        await _get_config()
        if await _db.search_synonyms.count_documents({}) == 0:
            defaults = [
                {"term": "manual", "synonyms": ["guide", "instructions", "documentation"]},
                {"term": "faucet", "synonyms": ["tap", "spigot"]},
                {"term": "water heater", "synonyms": ["boiler", "hot water tank"]},
                {"term": "hvac", "synonyms": ["furnace", "air conditioner", "ac", "heating"]},
            ]
            for d in defaults:
                await _db.search_synonyms.insert_one({"id": _nid(), **d, "created_at": _now()})
        if _logger:
            _logger.info("universal search (B41) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"search seed failed: {e}")
