"""
DIYhomie Verified — Homeowner/Builder Certification & Lifetime Credentialing (Info Sheet #60).

Separate module to keep server.py lean. Provides:
  - Auto-issued certificates on project completion (issue_for_completion()).
  - Manual certificate generation for completed projects.
  - "DIYhomie Verified" status tiers (verified / advanced / master).
  - Branded, printable web certificate + JSON verification (public share link).
  - Admin revoke / reinstate / analytics.
  - All credential activity logged via audit_engine.
"""
import os
import uuid
import html
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

import audit_engine

_db = None
_logger = None
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "https://step-by-step-diy.preview.emergentagent.com").strip().rstrip("/")
BACKEND_PUBLIC_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", APP_PUBLIC_URL).strip().rstrip("/")


def configure(db, logger):
    global _db, _logger
    _db = db
    _logger = logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


# ----------------------------------------------------------- verified status
def verified_level(active_count: int, pro_validated: int = 0) -> str:
    if active_count >= 5 or pro_validated >= 3:
        return "master"
    if active_count >= 3:
        return "advanced"
    if active_count >= 1:
        return "verified"
    return "unverified"


LEVEL_LABEL = {"unverified": "Not yet verified", "verified": "DIYhomie Verified",
               "advanced": "DIYhomie Verified · Advanced", "master": "DIYhomie Verified · Master Builder"}


async def _status_for(user_id: str) -> dict:
    active = await _db.certificates.count_documents({"user_id": user_id, "status": "active"})
    total = await _db.certificates.count_documents({"user_id": user_id})
    pro_validated = await _db.certificates.count_documents({"user_id": user_id, "status": "active", "pro_validated": True})
    lvl = verified_level(active, pro_validated)
    to_next = None
    if lvl == "unverified":
        to_next = {"next": "verified", "need": 1 - active}
    elif lvl == "verified":
        to_next = {"next": "advanced", "need": 3 - active}
    elif lvl == "advanced":
        to_next = {"next": "master", "need": 5 - active}
    return {"level": lvl, "label": LEVEL_LABEL[lvl], "active": active, "total": total,
            "pro_validated": pro_validated, "to_next": to_next, "is_verified": lvl != "unverified"}


# ----------------------------------------------------------- issuance
async def _build_cert(user: dict, kind: str, title: str, *, project_id: Optional[str] = None,
                      room: str = "", skill: str = "", cost_cents: int = 0, money_saved_cents: int = 0,
                      hours: float = 0, milestones: List[str] = None, safety_flags: List[str] = None,
                      code_compliant: bool = True, outcome: str = "") -> dict:
    st = await _status_for(user["id"])
    return {
        "id": _new_id(), "user_id": user["id"],
        "user_name": user.get("name") or (user.get("email", "").split("@")[0]),
        "kind": kind, "title": title, "project_id": project_id, "room": room, "skill": skill,
        "cost_cents": cost_cents, "money_saved_cents": money_saved_cents, "hours": hours,
        "milestones": milestones or [], "safety_flags": safety_flags or [],
        "code_compliant": code_compliant, "pro_validated": False, "outcome": outcome,
        "status": "active", "issued_at": _now(), "expires_at": None,
        "revoked_at": None, "revoked_reason": None,
        "share_token": None, "shared_at": None,
        "level_at_issue": st["level"], "meta": {},
    }


async def issue_for_completion(user: dict, project: dict, entry: dict):
    """Called from server.py right after a project is logged to the timeline."""
    try:
        if await _db.certificates.find_one({"project_id": project["id"], "kind": "project_completion"}):
            return None
        guide = project.get("guide") or {}
        milestones = [s.get("title") for s in (project.get("steps") or []) if s.get("title")][:6]
        safety = (guide.get("safety_warnings") or [])[:4]
        cert = await _build_cert(
            user, "project_completion",
            entry.get("story_title") or entry.get("title") or project.get("title") or "Home Project",
            project_id=project["id"], room=entry.get("room", ""), skill=entry.get("skill_tag", ""),
            cost_cents=entry.get("cost_cents", 0), money_saved_cents=entry.get("money_saved_cents", 0),
            hours=entry.get("hours", 0), milestones=milestones, safety_flags=safety,
            code_compliant=not bool(guide.get("code_alert")),
            outcome=entry.get("story") or "Completed and documented in the homeowner record.",
        )
        await _db.certificates.insert_one(cert)
        await audit_engine.log_event("user", user["id"], "certificate_issued", "certification",
                                     actor_email=user.get("email"), target_type="certificate",
                                     target_id=cert["id"], meta={"title": cert["title"], "auto": True})
        return cert
    except Exception as e:
        if _logger:
            _logger.warning(f"issue_for_completion failed: {e}")
        return None


# ----------------------------------------------------------- HTML certificate
def _cert_html(cert: dict, status: dict) -> str:
    e = html.escape
    issued = (cert.get("issued_at") or "")[:10]
    saved = f"${int((cert.get('money_saved_cents') or 0)/100):,}" if cert.get("money_saved_cents") else "—"
    hrs = f"{cert.get('hours') or 0:g} hrs" if cert.get("hours") else "—"
    badges = []
    if cert.get("code_compliant"):
        badges.append("Code & Safety Compliant")
    if cert.get("pro_validated"):
        badges.append("Pro-Validated")
    badges.append(LEVEL_LABEL.get(cert.get("level_at_issue", "verified"), "DIYhomie Verified"))
    badge_html = "".join(f"<span class='badge'>{e(b)}</span>" for b in badges)
    ms = "".join(f"<li>{e(m)}</li>" for m in (cert.get("milestones") or [])) or "<li>Project completed and documented.</li>"
    revoked = cert.get("status") == "revoked"
    banner = "<div class='revoked'>⚠ This certificate has been revoked and is no longer valid.</div>" if revoked else ""
    return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>DIYhomie Verified Certificate — {e(cert.get('title',''))}</title>
<style>
body{{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1c1e;margin:0;background:#f2ede4}}
.wrap{{max-width:760px;margin:0 auto;padding:28px 18px}}
.cert{{background:#fff;border:2px solid #ff6a00;border-radius:18px;padding:34px 30px;box-shadow:0 12px 40px rgba(0,0,0,.08);position:relative}}
.ribbon{{position:absolute;top:-1px;right:24px;background:#ff6a00;color:#fff;font-weight:800;padding:8px 14px;border-radius:0 0 10px 10px;font-size:12px;letter-spacing:.5px}}
.brand{{color:#ff6a00;font-weight:900;font-size:22px;letter-spacing:.5px}}
.k{{color:#8a8a90;text-transform:uppercase;font-size:11px;letter-spacing:1.5px;margin-top:22px}}
h1{{margin:6px 0 2px;font-size:30px;line-height:1.15}}
.who{{font-size:17px;color:#3a3a3e;margin:16px 0 4px}}
.who b{{color:#ff6a00}}
.badges{{margin:16px 0}}
.badge{{display:inline-block;background:#fff3e9;color:#c85200;border:1px solid #ffd3b0;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;margin:3px 6px 3px 0}}
.grid{{display:flex;flex-wrap:wrap;gap:14px;margin:18px 0}}
.stat{{background:#faf7f2;border:1px solid #eee;border-radius:12px;padding:12px 16px;min-width:120px}}
.stat b{{display:block;font-size:20px;color:#1c1c1e}} .stat span{{color:#8a8a90;font-size:11px}}
ul{{margin:8px 0 0;padding-left:18px}} li{{font-size:14px;margin:4px 0;color:#3a3a3e}}
.sig{{display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;border-top:1px dashed #e0dccf;padding-top:16px}}
.sig .name{{font-family:'Snell Roundhand',cursive;font-size:24px;color:#ff6a00}}
.foot{{color:#9a9aa0;font-size:12px;margin-top:18px;text-align:center}}
.verify{{font-size:12px;color:#8a8a90;word-break:break-all}}
.revoked{{background:#fdecec;color:#c0392b;border:1px solid #f3b4b4;border-radius:10px;padding:12px;font-weight:700;margin-bottom:16px;text-align:center}}
.btn{{display:inline-block;background:#ff6a00;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:800;margin-top:14px}}
@media print{{body{{background:#fff}} .noprint{{display:none}} .cert{{box-shadow:none}}}}
</style></head><body><div class='wrap'>{banner}
<div class='cert'>
<div class='ribbon'>DIYhomie VERIFIED</div>
<div class='brand'>DIYhomie</div>
<div class='k'>Certificate of Project Completion</div>
<h1>{e(cert.get('title',''))}</h1>
<div class='who'>Awarded to <b>{e(cert.get('user_name',''))}</b> for the successful, documented completion of this home improvement project.</div>
<div class='badges'>{badge_html}</div>
<div class='grid'>
  <div class='stat'><b>{e((cert.get('room') or '—').title())}</b><span>Area</span></div>
  <div class='stat'><b>{e(cert.get('skill') or '—')}</b><span>Skill demonstrated</span></div>
  <div class='stat'><b>{hrs}</b><span>Time invested</span></div>
  <div class='stat'><b>{saved}</b><span>Saved vs. pro</span></div>
</div>
<div class='k'>Milestones</div><ul>{ms}</ul>
<div class='sig'>
  <div><div class='name'>DIYhomie</div><div class='verify'>Issued {issued}</div></div>
  <div style='text-align:right'><div class='verify'>Certificate ID<br>{e(cert.get('id',''))}</div></div>
</div>
</div>
<p class='noprint' style='text-align:center'><a class='btn' href='javascript:window.print()'>Save as PDF</a></p>
<div class='foot'>Verifiable at {e(BACKEND_PUBLIC_URL)}/api/certifications/verify/{e(cert.get('share_token') or '')}</div>
</div></body></html>"""


# ----------------------------------------------------------- user router
class GenerateReq(BaseModel):
    project_id: str


def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api")

    @r.get("/certifications")
    async def my_certs(user: dict = Depends(get_current_user)):
        certs = await _db.certificates.find({"user_id": user["id"]}, {"_id": 0}).sort("issued_at", -1).to_list(500)
        return {"status": await _status_for(user["id"]), "certificates": certs}

    @r.get("/certifications/status")
    async def my_status(user: dict = Depends(get_current_user)):
        return await _status_for(user["id"])

    @r.get("/certifications/eligible")
    async def eligible(user: dict = Depends(get_current_user)):
        entries = await _db.timeline.find({"user_id": user["id"], "project_id": {"$exists": True, "$ne": None}},
                                          {"_id": 0}).sort("created_at", -1).to_list(500)
        certed = {c["project_id"] async for c in _db.certificates.find(
            {"user_id": user["id"], "project_id": {"$ne": None}}, {"project_id": 1})}
        out = [{"project_id": e["project_id"], "title": e.get("story_title") or e.get("title"),
                "room": e.get("room"), "at": e.get("created_at")}
               for e in entries if e.get("project_id") not in certed]
        return {"eligible": out}

    @r.post("/certifications/generate")
    async def generate(req: GenerateReq, user: dict = Depends(get_current_user)):
        entry = await _db.timeline.find_one({"project_id": req.project_id, "user_id": user["id"]}, {"_id": 0})
        if not entry:
            raise HTTPException(status_code=404, detail="Complete this project first to certify it.")
        existing = await _db.certificates.find_one({"project_id": req.project_id, "kind": "project_completion"}, {"_id": 0})
        if existing:
            return {"certificate": existing, "existing": True}
        project = await db_project(user["id"], req.project_id)
        cert = await issue_for_completion(user, project or {"id": req.project_id, "guide": {}, "steps": [], "title": entry.get("title", "")}, entry)
        if not cert:
            raise HTTPException(status_code=500, detail="Could not issue certificate.")
        fresh = await _db.certificates.find_one({"id": cert["id"]}, {"_id": 0})
        return {"certificate": fresh, "existing": False}

    @r.post("/certifications/{cert_id}/share")
    async def share(cert_id: str, user: dict = Depends(get_current_user)):
        cert = await _db.certificates.find_one({"id": cert_id, "user_id": user["id"]}, {"_id": 0})
        if not cert:
            raise HTTPException(status_code=404, detail="Certificate not found")
        token = cert.get("share_token") or ("cert_" + uuid.uuid4().hex[:16])
        await _db.certificates.update_one({"id": cert_id}, {"$set": {"share_token": token, "shared_at": _now()}})
        await audit_engine.log_event("user", user["id"], "certificate_shared", "certification",
                                     actor_email=user.get("email"), risk_level="medium",
                                     target_type="certificate", target_id=cert_id)
        return {"token": token, "url": f"{BACKEND_PUBLIC_URL}/api/certifications/verify/{token}"}

    return r


async def db_project(user_id: str, project_id: str):
    return await _db.projects.find_one({"id": project_id, "user_id": user_id}, {"_id": 0})


# ----------------------------------------------------------- public router
def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api")

    @r.get("/certifications/verify/{token}")
    async def verify(token: str, format: Optional[str] = None):
        cert = await _db.certificates.find_one({"share_token": token}, {"_id": 0})
        if not cert:
            if format == "json":
                return JSONResponse({"valid": False, "reason": "not_found"}, status_code=404)
            return HTMLResponse("<h1>Certificate not found.</h1>", status_code=404)
        status = await _status_for(cert["user_id"])
        if format == "json":
            return JSONResponse({
                "valid": cert["status"] == "active", "status": cert["status"],
                "title": cert["title"], "holder": cert["user_name"], "issued_at": cert["issued_at"],
                "kind": cert["kind"], "room": cert.get("room"), "skill": cert.get("skill"),
                "code_compliant": cert.get("code_compliant"), "pro_validated": cert.get("pro_validated"),
                "certificate_id": cert["id"],
            })
        return HTMLResponse(_cert_html(cert, status))

    return r


# ----------------------------------------------------------- admin router
class RevokeReq(BaseModel):
    reason: str


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/certifications", dependencies=[Depends(require_admin)])

    @r.get("")
    async def list_all(status: Optional[str] = None, q: Optional[str] = None, limit: int = 200):
        flt = {}
        if status:
            flt["status"] = status
        if q:
            flt["$or"] = [{"title": {"$regex": q, "$options": "i"}}, {"user_name": {"$regex": q, "$options": "i"}}]
        certs = await _db.certificates.find(flt, {"_id": 0}).sort("issued_at", -1).limit(min(limit, 500)).to_list(500)
        return {"certificates": certs, "total": await _db.certificates.count_documents(flt)}

    @r.get("/analytics")
    async def analytics():
        total = await _db.certificates.count_documents({})
        active = await _db.certificates.count_documents({"status": "active"})
        revoked = await _db.certificates.count_documents({"status": "revoked"})
        shared = await _db.certificates.count_documents({"share_token": {"$ne": None}})
        pro_validated = await _db.certificates.count_documents({"pro_validated": True})
        # verified users by tier
        pipeline = [{"$match": {"status": "active"}},
                    {"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]
        rows = await _db.certificates.aggregate(pipeline).to_list(20000)
        tiers = {"verified": 0, "advanced": 0, "master": 0}
        for row in rows:
            lvl = verified_level(row["n"])
            if lvl in tiers:
                tiers[lvl] += 1
        by_room_agg = await _db.certificates.aggregate(
            [{"$group": {"_id": "$room", "count": {"$sum": 1}}}, {"$sort": {"count": -1}}]).to_list(50)
        by_room = [{"room": (a["_id"] or "other"), "count": a["count"]} for a in by_room_agg]
        return {"total": total, "active": active, "revoked": revoked, "shared": shared,
                "pro_validated": pro_validated, "verified_users": len(rows), "tiers": tiers, "by_room": by_room}

    @r.post("/{cert_id}/revoke")
    async def revoke(cert_id: str, req: RevokeReq, admin: dict = Depends(require_admin)):
        res = await _db.certificates.update_one(
            {"id": cert_id, "status": "active"},
            {"$set": {"status": "revoked", "revoked_at": _now(), "revoked_reason": req.reason}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Active certificate not found")
        await audit_engine.log_event("admin", admin["id"], "certificate_revoked", "certification",
                                     actor_email=admin.get("email"), risk_level="high",
                                     target_type="certificate", target_id=cert_id,
                                     new_value="revoked", meta={"reason": req.reason})
        return {"ok": True}

    @r.post("/{cert_id}/reinstate")
    async def reinstate(cert_id: str, admin: dict = Depends(require_admin)):
        res = await _db.certificates.update_one(
            {"id": cert_id, "status": "revoked"},
            {"$set": {"status": "active", "revoked_at": None, "revoked_reason": None}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Revoked certificate not found")
        await audit_engine.log_event("admin", admin["id"], "certificate_reinstated", "certification",
                                     actor_email=admin.get("email"), target_type="certificate", target_id=cert_id)
        return {"ok": True}

    @r.post("/{cert_id}/validate")
    async def validate(cert_id: str, admin: dict = Depends(require_admin)):
        res = await _db.certificates.update_one({"id": cert_id, "status": "active"},
                                                {"$set": {"pro_validated": True}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Active certificate not found")
        return {"ok": True}

    return r
