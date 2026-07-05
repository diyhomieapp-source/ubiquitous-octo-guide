"""
DIYhomie User/Partner Data, Analytics & Project Reporting Export Engine (Info Sheet #64).

Separate module. Lets users select any subset of their own data (projects, timeline,
events, skills, campaigns, certificates, notifications), export as JSON or CSV, or
create an audit-trailed, expiring share link with a printable visual summary.
Admin can pull platform-wide KPI exports. All exports are logged via audit_engine.
"""
import csv
import io
import uuid
import html
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

import audit_engine

_db = None
_logger = None
DATA_TYPES = ["projects", "timeline", "events", "skills", "campaigns", "certificates", "notifications"]


def configure(db, logger):
    global _db, _logger
    _db = db
    _logger = logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


def _in_range(iso: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> bool:
    if not iso:
        return True
    if date_from and iso < date_from:
        return False
    if date_to and iso > date_to + "\uffff":
        return False
    return True


# ----------------------------------------------------------- data assembly
async def _collect(user_id: str, types: List[str], date_from, date_to) -> dict:
    out = {}
    if "projects" in types:
        rows = await _db.projects.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
        out["projects"] = [r for r in rows if _in_range(r.get("created_at"), date_from, date_to)]
    if "timeline" in types:
        rows = await _db.timeline.find({"user_id": user_id}, {"_id": 0}).to_list(5000)
        out["timeline"] = [r for r in rows if _in_range(r.get("created_at"), date_from, date_to)]
    if "events" in types:
        rows = await _db.audit_events.find({"actor_id": user_id}, {"_id": 0}).sort("at", -1).to_list(5000)
        out["events"] = [r for r in rows if _in_range(r.get("at"), date_from, date_to)]
    if "skills" in types:
        out["skills"] = await _db.edu_progress.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
    if "campaigns" in types:
        out["campaigns"] = await _db.campaign_participation.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
    if "certificates" in types:
        out["certificates"] = await _db.certificates.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
    if "notifications" in types:
        rows = await _db.notifications.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        out["notifications"] = [r for r in rows if _in_range(r.get("created_at"), date_from, date_to)]
    return out


def _summary(data: dict) -> dict:
    tl = data.get("timeline", [])
    saved = sum(int(t.get("money_saved_cents", 0)) for t in tl)
    spent = sum(int(t.get("cost_cents", 0)) for t in tl)
    hours = sum(float(t.get("hours", 0) or 0) for t in tl)
    return {
        "projects": len(data.get("projects", [])),
        "completed_logged": len(tl),
        "money_saved_usd": round(saved / 100, 2),
        "money_spent_usd": round(spent / 100, 2),
        "total_hours": round(hours, 1),
        "certificates": len(data.get("certificates", [])),
        "lessons_completed": len([s for s in data.get("skills", []) if s.get("status") == "completed"]),
        "events_logged": len(data.get("events", [])),
    }


def _to_csv(data: dict) -> str:
    """Report-friendly CSV built from the timeline (the most analysis-worthy rows)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "project", "room", "skill", "cost_usd", "saved_usd", "hours"])
    for t in data.get("timeline", []):
        w.writerow([(t.get("created_at") or "")[:10], t.get("story_title") or t.get("title") or "",
                    t.get("room", ""), t.get("skill_tag", ""),
                    round(int(t.get("cost_cents", 0)) / 100, 2),
                    round(int(t.get("money_saved_cents", 0)) / 100, 2), t.get("hours", 0)])
    if not data.get("timeline"):
        for p in data.get("projects", []):
            w.writerow([(p.get("created_at") or "")[:10], p.get("title", ""), p.get("room", ""), "", "", "", ""])
    return buf.getvalue()


# ----------------------------------------------------------- visual report html
def _report_html(user_name: str, summary: dict, generated_at: str) -> str:
    e = html.escape
    cards = [
        ("Projects", str(summary["projects"])),
        ("Completed & logged", str(summary["completed_logged"])),
        ("Saved vs. pro", f"${summary['money_saved_usd']:,.0f}"),
        ("Hours invested", f"{summary['total_hours']:g}"),
        ("Certificates", str(summary["certificates"])),
        ("Lessons done", str(summary["lessons_completed"])),
    ]
    card_html = "".join(f"<div class='card'><b>{e(v)}</b><span>{e(k)}</span></div>" for k, v in cards)
    return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>DIYhomie Report — {e(user_name)}</title><style>
body{{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f2ede4;color:#1c1c1e;margin:0}}
.wrap{{max-width:720px;margin:0 auto;padding:26px 18px}}
.head{{background:#fff;border-radius:16px;padding:26px;border:2px solid #ff6a00}}
.brand{{color:#ff6a00;font-weight:900;font-size:22px}} h1{{margin:8px 0 2px;font-size:26px}}
.sub{{color:#8a8a90;font-size:13px}}
.grid{{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}}
.card{{flex:1;min-width:140px;background:#faf7f2;border:1px solid #eee;border-radius:12px;padding:16px}}
.card b{{display:block;font-size:24px;color:#ff6a00}} .card span{{color:#8a8a90;font-size:12px}}
.foot{{color:#9a9aa0;font-size:12px;text-align:center;margin-top:18px}}
.btn{{display:inline-block;background:#ff6a00;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:800;margin-top:14px}}
@media print{{body{{background:#fff}} .noprint{{display:none}}}}
</style></head><body><div class='wrap'>
<div class='head'><div class='brand'>DIYhomie</div><h1>Home Project Report</h1>
<div class='sub'>{e(user_name)} · generated {e(generated_at[:10])}</div>
<div class='grid'>{card_html}</div></div>
<p class='noprint' style='text-align:center'><a class='btn' href='javascript:window.print()'>Save as PDF</a></p>
<div class='foot'>Exported from DIYhomie · your data, portable & verifiable.</div>
</div></body></html>"""


# ----------------------------------------------------------- user router
class GenerateReq(BaseModel):
    types: List[str] = DATA_TYPES
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    format: str = "json"  # json | csv
    share: bool = False
    expires_days: int = 7
    max_downloads: int = 10


def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api")

    @r.get("/export/options")
    async def options(user: dict = Depends(get_current_user)):
        uid = user["id"]
        counts = {
            "projects": await _db.projects.count_documents({"user_id": uid}),
            "timeline": await _db.timeline.count_documents({"user_id": uid}),
            "events": await _db.audit_events.count_documents({"actor_id": uid}),
            "skills": await _db.edu_progress.count_documents({"user_id": uid}),
            "campaigns": await _db.campaign_participation.count_documents({"user_id": uid}),
            "certificates": await _db.certificates.count_documents({"user_id": uid}),
            "notifications": await _db.notifications.count_documents({"user_id": uid}),
        }
        return {"types": DATA_TYPES, "counts": counts, "formats": ["json", "csv"]}

    @r.post("/export/generate")
    async def generate(req: GenerateReq, user: dict = Depends(get_current_user)):
        types = [t for t in req.types if t in DATA_TYPES] or DATA_TYPES
        data = await _collect(user["id"], types, req.date_from, req.date_to)
        summary = _summary(data)
        await audit_engine.log_event("user", user["id"], "data_export", "data_rights",
                                     actor_email=user.get("email"), risk_level="medium",
                                     meta={"types": types, "format": req.format, "shared": req.share})
        result = {"generated_at": _now(), "user": {"id": user["id"], "name": user.get("name"), "email": user.get("email")},
                  "types": types, "summary": summary}
        if req.format == "csv":
            result["csv"] = _to_csv(data)
        else:
            result["data"] = data
        if req.share:
            token = "exp_" + uuid.uuid4().hex[:18]
            expires = (datetime.now(timezone.utc) + timedelta(days=max(1, req.expires_days))).isoformat()
            await _db.export_jobs.insert_one({
                "id": _new_id(), "token": token, "user_id": user["id"], "user_name": user.get("name") or "DIYhomie user",
                "types": types, "format": req.format, "summary": summary,
                "bundle": {"csv": result.get("csv"), "data": result.get("data")},
                "created_at": _now(), "expires_at": expires,
                "max_downloads": max(1, req.max_downloads), "download_count": 0})
            result["share"] = {"token": token, "expires_at": expires,
                               "download_url": f"/api/export/download/{token}",
                               "report_url": f"/api/export/report/{token}"}
        return result

    return r


# ----------------------------------------------------------- public (token) router
def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api")

    async def _valid_job(token: str):
        job = await _db.export_jobs.find_one({"token": token}, {"_id": 0})
        if not job:
            return None, "not_found"
        if job.get("expires_at") and job["expires_at"] < _now():
            return None, "expired"
        if job.get("download_count", 0) >= job.get("max_downloads", 10):
            return None, "limit_reached"
        return job, None

    @r.get("/export/download/{token}")
    async def download(token: str):
        job, err = await _valid_job(token)
        if err:
            return JSONResponse({"valid": False, "reason": err}, status_code=404 if err == "not_found" else 410)
        await _db.export_jobs.update_one({"token": token}, {"$inc": {"download_count": 1}})
        await audit_engine.log_event("user", job["user_id"], "data_export_download", "data_rights",
                                     risk_level="medium", meta={"token": token})
        return {"generated_at": job["created_at"], "user_name": job["user_name"], "types": job["types"],
                "summary": job["summary"], **job["bundle"]}

    @r.get("/export/report/{token}")
    async def report(token: str):
        job, err = await _valid_job(token)
        if err:
            return HTMLResponse(f"<h1>Report unavailable ({err}).</h1>", status_code=410)
        return HTMLResponse(_report_html(job["user_name"], job["summary"], job["created_at"]))

    return r


# ----------------------------------------------------------- admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/export", dependencies=[Depends(require_admin)])

    @r.get("/kpis")
    async def kpis():
        users = await _db.users.count_documents({})
        projects = await _db.projects.count_documents({})
        completions = await _db.timeline.count_documents({})
        certs = await _db.certificates.count_documents({"status": "active"})
        lessons = await _db.edu_progress.count_documents({"status": "completed"})
        campaigns = await _db.campaigns.count_documents({})
        campaign_completions = await _db.campaign_participation.count_documents({"status": "completed"})
        exports = await _db.export_jobs.count_documents({})
        events = await _db.audit_events.count_documents({})
        saved_agg = await _db.timeline.aggregate(
            [{"$group": {"_id": None, "saved": {"$sum": "$money_saved_cents"}}}]).to_list(1)
        total_saved = round((saved_agg[0]["saved"] if saved_agg else 0) / 100, 2)
        return {"generated_at": _now(), "kpis": {
            "users": users, "projects": projects, "project_completions": completions,
            "active_certificates": certs, "lessons_completed": lessons,
            "campaigns": campaigns, "campaign_completions": campaign_completions,
            "exports_generated": exports, "audit_events": events,
            "total_member_savings_usd": total_saved}}

    @r.get("/jobs")
    async def jobs(limit: int = 100):
        rows = await _db.export_jobs.find({}, {"_id": 0, "bundle": 0}).sort("created_at", -1).limit(min(limit, 300)).to_list(300)
        return {"jobs": rows, "total": await _db.export_jobs.count_documents({})}

    return r
