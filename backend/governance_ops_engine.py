"""
DIYhomie — Data Governance completion deltas (Build Document 32):
Backup, Restore, Deletion Execution & Retention Enforcement.

Audit result: privacy controls, consents, AI controls, user export (tokened,
TTL), account deletion w/ grace window, property deletion, retention policies,
incidents and the full audit log already exist (data_governance_engine,
export_engine, audit_engine) and are preserved untouched. This engine adds the
missing operational pieces only:

1. Admin database backups: gzip JSON snapshots per collection, list/verify/
   restore-one-collection (explicit confirm), delete. Files in backend/backups/.
2. Deletion job execution: runs queued dg_deletion_jobs whose grace window has
   elapsed — purges class-C data per DATA_MAP, anonymizes the user record,
   marks the account state deleted. Dry-run by default.
3. Retention enforcement: applies seeded dg_retention_policies (prune old error
   telemetry, expire stale share links, drop expired export payloads).
   Dry-run by default.

Collections: dg_backups (metadata). Everything is admin-only and audited via
hi_admin_audit + the request audit middleware.
"""
import asyncio
import gzip
import json
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "backups")
# never include these in backups (secrets, ephemeral, or backup metadata itself)
BACKUP_EXCLUDE_PREFIXES = ("system.",)
BACKUP_EXCLUDE = {"dg_backups", "ig_secrets", "dg_reauth_grants"}
ERROR_TELEMETRY_COLLECTIONS = ["error_events", "error_incidents"]
ERROR_TELEMETRY_DAYS = 90


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger
    os.makedirs(BACKUP_DIR, exist_ok=True)


def _now():
    return datetime.now(timezone.utc)


def _iso():
    return _now().isoformat()


def _nid():
    return str(uuid.uuid4())


async def _audit(admin_id: str, action: str, meta=None):
    try:
        from admin_ops_engine import append_audit_raw
        await append_audit_raw({"admin_id": admin_id, "action": action, "meta": meta or {}})
    except Exception:
        pass


def _backup_path(bid: str) -> str:
    return os.path.join(BACKUP_DIR, f"{bid}.json.gz")


async def _run_backup(bid: str, collections: List[str]):
    """Background job: dump each collection (without _id) into one gzip JSON archive."""
    manifest = {}
    try:
        archive = {}
        for name in collections:
            docs = await _db[name].find({}, {"_id": 0}).to_list(200000)
            archive[name] = docs
            manifest[name] = len(docs)
        raw = json.dumps({"backup_id": bid, "created_at": _iso(), "collections": archive},
                         default=str).encode("utf-8")
        with gzip.open(_backup_path(bid), "wb") as f:
            f.write(raw)
        await _db.dg_backups.update_one({"id": bid}, {"$set": {
            "status": "completed", "manifest": manifest,
            "size_bytes": os.path.getsize(_backup_path(bid)),
            "document_count": sum(manifest.values()), "completed_at": _iso()}})
        if _logger:
            _logger.info(f"backup {bid} completed: {len(collections)} collections, {sum(manifest.values())} docs")
    except Exception as e:
        if _logger:
            _logger.error(f"backup {bid} failed: {e}")
        await _db.dg_backups.update_one({"id": bid}, {"$set": {"status": "failed", "error": str(e)[:300]}})


def _read_backup(bid: str) -> dict:
    path = _backup_path(bid)
    if not os.path.exists(path):
        raise HTTPException(status_code=410, detail="Backup file is missing from disk.")
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


class BackupReq(BaseModel):
    collections: Optional[List[str]] = None   # default: all app collections
    note: Optional[str] = None


class RestoreReq(BaseModel):
    collection: str
    mode: str = "merge"        # merge (upsert by id) | replace (wipe + insert)
    confirm: bool = False


class ExecuteDeletionsReq(BaseModel):
    dry_run: bool = True
    user_id: Optional[str] = None      # limit to one user
    ignore_schedule: bool = False      # admin override of the grace window (audited)


class EnforceRetentionReq(BaseModel):
    dry_run: bool = True


def build_admin_router(require_admin: Callable, data_map: list) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/govops", dependencies=[Depends(require_admin)])

    # ------------------------------------------------------------- backups
    @r.post("/backups")
    async def create_backup(req: BackupReq, admin: dict = Depends(require_admin)):
        all_names = [n for n in await _db.list_collection_names()
                     if not n.startswith(BACKUP_EXCLUDE_PREFIXES) and n not in BACKUP_EXCLUDE]
        if req.collections:
            unknown = [c for c in req.collections if c not in all_names]
            if unknown:
                raise HTTPException(status_code=400, detail=f"Unknown collections: {', '.join(unknown[:5])}")
            targets = req.collections
        else:
            targets = sorted(all_names)
        doc = {"id": _nid(), "status": "running", "collections": targets, "note": (req.note or "")[:300] or None,
               "manifest": {}, "size_bytes": 0, "document_count": 0,
               "created_by": admin["id"], "created_at": _iso(), "completed_at": None}
        await _db.dg_backups.insert_one(dict(doc))
        doc.pop("_id", None)
        asyncio.create_task(_run_backup(doc["id"], targets))
        await _audit(admin["id"], "backup_created", {"backup_id": doc["id"], "collections": len(targets)})
        return {"backup": doc, "note": "Backup is running in the background — check its status in the list."}

    @r.get("/backups")
    async def list_backups(admin: dict = Depends(require_admin)):
        rows = await _db.dg_backups.find({}, {"_id": 0, "manifest": 0}).sort("created_at", -1).to_list(50)
        for row in rows:
            row["file_present"] = os.path.exists(_backup_path(row["id"]))
        return {"backups": rows}

    @r.get("/backups/{bid}")
    async def backup_detail(bid: str, admin: dict = Depends(require_admin)):
        row = await _db.dg_backups.find_one({"id": bid}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Backup not found.")
        row["file_present"] = os.path.exists(_backup_path(bid))
        return {"backup": row}

    @r.post("/backups/{bid}/verify")
    async def verify_backup(bid: str, admin: dict = Depends(require_admin)):
        row = await _db.dg_backups.find_one({"id": bid}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Backup not found.")
        if row["status"] != "completed":
            raise HTTPException(status_code=409, detail=f"Backup is {row['status']} — nothing to verify yet.")
        try:
            data = _read_backup(bid)
        except HTTPException:
            raise
        except Exception as e:
            return {"verified": False, "reason": f"Archive unreadable: {str(e)[:150]}"}
        mismatches = []
        for name, expected in (row.get("manifest") or {}).items():
            actual = len(data.get("collections", {}).get(name, []))
            if actual != expected:
                mismatches.append({"collection": name, "expected": expected, "found": actual})
        verified = not mismatches
        await _db.dg_backups.update_one({"id": bid}, {"$set": {"last_verified_at": _iso(), "verified": verified}})
        await _audit(admin["id"], "backup_verified", {"backup_id": bid, "verified": verified})
        return {"verified": verified, "collections_checked": len(row.get("manifest") or {}), "mismatches": mismatches}

    @r.post("/backups/{bid}/restore")
    async def restore_backup(bid: str, req: RestoreReq, admin: dict = Depends(require_admin)):
        row = await _db.dg_backups.find_one({"id": bid}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Backup not found.")
        if row["status"] != "completed":
            raise HTTPException(status_code=409, detail="Backup isn't completed.")
        if req.mode not in ("merge", "replace"):
            raise HTTPException(status_code=400, detail="Mode must be merge or replace.")
        if not req.confirm:
            raise HTTPException(status_code=400, detail="Set confirm=true to restore — this changes live data.")
        data = _read_backup(bid)
        docs = data.get("collections", {}).get(req.collection)
        if docs is None:
            raise HTTPException(status_code=404, detail=f"Collection '{req.collection}' is not in this backup.")
        coll = _db[req.collection]
        replaced = 0
        if req.mode == "replace":
            await coll.delete_many({})
            if docs:
                await coll.insert_many([dict(d) for d in docs])
            replaced = len(docs)
        else:  # merge — upsert by id where available
            for d in docs:
                if d.get("id"):
                    await coll.update_one({"id": d["id"]}, {"$set": d}, upsert=True)
                else:
                    await coll.insert_one(dict(d))
                replaced += 1
        await _audit(admin["id"], "backup_restored", {"backup_id": bid, "collection": req.collection,
                                                      "mode": req.mode, "documents": replaced})
        return {"ok": True, "collection": req.collection, "mode": req.mode, "documents_restored": replaced}

    @r.delete("/backups/{bid}")
    async def delete_backup(bid: str, admin: dict = Depends(require_admin)):
        row = await _db.dg_backups.find_one({"id": bid}, {"_id": 0, "id": 1})
        if not row:
            raise HTTPException(status_code=404, detail="Backup not found.")
        try:
            if os.path.exists(_backup_path(bid)):
                os.remove(_backup_path(bid))
        except Exception:
            pass
        await _db.dg_backups.delete_one({"id": bid})
        await _audit(admin["id"], "backup_deleted", {"backup_id": bid})
        return {"ok": True}

    # ------------------------------------------------ deletion job execution
    @r.post("/deletions/execute")
    async def execute_deletions(req: ExecuteDeletionsReq, admin: dict = Depends(require_admin)):
        """Run queued dg_deletion_jobs whose recovery window has elapsed."""
        q = {"status": "queued"}
        if req.user_id:
            q["user_id"] = req.user_id
        if not req.ignore_schedule:
            q["scheduled_for"] = {"$lte": _iso()}
        jobs = await _db.dg_deletion_jobs.find(q, {"_id": 0}).to_list(500)
        cat_map = {d["category"]: d.get("collections", []) for d in data_map}
        by_user: dict = {}
        for j in jobs:
            by_user.setdefault(j["user_id"], []).append(j)
        results = []
        for uid, ujobs in by_user.items():
            st = await _db.dg_account_state.find_one({"user_id": uid}, {"_id": 0, "state": 1})
            if not st or st.get("state") != "deletion_pending":
                results.append({"user_id": uid, "skipped": True, "reason": "account no longer pending deletion"})
                continue
            purge_counts = {}
            prop_ids = [p["id"] for p in await _db.hi_properties.find({"user_id": uid}, {"_id": 0, "id": 1}).to_list(50)]
            for j in ujobs:
                for coll_name in cat_map.get(j["data_category"], []):
                    if coll_name == "users":
                        continue  # anonymized, not deleted (login integrity + audit references)
                    coll = _db[coll_name]
                    flt = {"user_id": uid}
                    if coll_name in ("hi_rooms",):
                        flt = {"property_id": {"$in": prop_ids}}
                    n = await coll.count_documents(flt)
                    purge_counts[coll_name] = purge_counts.get(coll_name, 0) + n
                    if not req.dry_run and n:
                        await coll.delete_many(flt)
            if not req.dry_run:
                await _db.users.update_one({"id": uid}, {"$set": {
                    "email": f"deleted-{uid[:8]}@deleted.invalid", "name": "Deleted User",
                    "password_hash": _nid(), "status": "deleted", "deleted_at": _iso()},
                    "$inc": {"token_version": 1}})
                await _db.dg_deletion_jobs.update_many({"user_id": uid, "status": "queued"},
                                                       {"$set": {"status": "done", "executed_at": _iso()}})
                await _db.dg_account_state.update_one({"user_id": uid}, {"$set": {
                    "state": "deleted", "deleted_at": _iso(), "updated_at": _iso()}})
            results.append({"user_id": uid, "skipped": False, "jobs": len(ujobs),
                            "documents_purged": sum(purge_counts.values()), "by_collection": purge_counts})
        await _audit(admin["id"], "deletion_jobs_executed",
                     {"dry_run": req.dry_run, "users": len(by_user), "jobs": len(jobs),
                      "ignore_schedule": req.ignore_schedule})
        return {"dry_run": req.dry_run, "jobs_found": len(jobs), "users_processed": len(by_user), "results": results}

    # ------------------------------------------------ retention enforcement
    @r.post("/retention/enforce")
    async def enforce_retention(req: EnforceRetentionReq, admin: dict = Depends(require_admin)):
        """Apply the seeded retention policies to live data."""
        actions = []
        # 1. error telemetry older than 90 days → prune
        cutoff = (_now() - timedelta(days=ERROR_TELEMETRY_DAYS)).isoformat()
        for name in ERROR_TELEMETRY_COLLECTIONS:
            flt = {"created_at": {"$lt": cutoff}}
            n = await _db[name].count_documents(flt)
            if not req.dry_run and n:
                await _db[name].delete_many(flt)
            actions.append({"policy": "error_telemetry", "collection": name, "affected": n,
                            "action": "prune_older_than_90d"})
        # 2. expired share links → invalidate
        flt = {"status": "active", "expires_at": {"$lt": _iso()}}
        n = await _db.pro_share_links.count_documents(flt)
        if not req.dry_run and n:
            await _db.pro_share_links.update_many(flt, {"$set": {"status": "expired", "expired_at": _iso()}})
        actions.append({"policy": "expired_share_links", "collection": "pro_share_links", "affected": n,
                        "action": "invalidate"})
        # 3. expired export payloads → drop the payload, keep metadata
        flt = {"expires_at": {"$lt": _iso()}, "payload": {"$exists": True, "$ne": None}}
        n = await _db.dg_exports.count_documents(flt)
        if not req.dry_run and n:
            await _db.dg_exports.update_many(flt, {"$set": {"status": "expired"}, "$unset": {"payload": ""}})
        actions.append({"policy": "deleted_user_content", "collection": "dg_exports", "affected": n,
                        "action": "drop_expired_payloads"})
        # 4. expired re-auth grants → cleanup
        flt = {"expires_at": {"$lt": _iso()}}
        n = await _db.dg_reauth_grants.count_documents(flt)
        if not req.dry_run and n:
            await _db.dg_reauth_grants.delete_many(flt)
        actions.append({"policy": "expired_share_links", "collection": "dg_reauth_grants", "affected": n,
                        "action": "delete_expired_grants"})
        await _audit(admin["id"], "retention_enforced", {"dry_run": req.dry_run,
                                                         "total_affected": sum(a["affected"] for a in actions)})
        return {"dry_run": req.dry_run, "actions": actions,
                "total_affected": sum(a["affected"] for a in actions)}

    return r
