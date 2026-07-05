"""
DIYhomie Integration App Store (Info Sheet #65).

Complements the existing developer/partner API layer (api_keys, /api/v1, plans,
metering, /admin/partners, /admin/api-billing) by adding a browsable, permissioned
catalog of add-on integrations that users/partners can install with explicit consent
and revoke instantly. Admin can publish/version/QA add-ons with zero-code deploy.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import audit_engine

_db = None
_logger = None


def configure(db, logger):
    global _db, _logger
    _db = db
    _logger = logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


SEED = [
    {"slug": "nws-weather-alerts", "name": "NWS Weather & Storm Alerts", "category": "safety",
     "publisher": "DIYhomie", "pricing": "free", "price_label": "Free",
     "description": "Severe-weather and storm warnings tuned to your property to time projects & protect your home.",
     "capabilities": ["Local severe-weather alerts", "Project timing suggestions", "Storm-prep checklists"],
     "scopes": ["property:read", "notifications:write"], "icon": "weather-lightning-rainy"},
    {"slug": "energy-tracker", "name": "Home Energy Tracker", "category": "energy",
     "publisher": "VoltWise", "pricing": "free", "price_label": "Free",
     "description": "Track energy upgrades and estimate savings from insulation, lighting & HVAC work.",
     "capabilities": ["Energy savings estimates", "Upgrade ROI overlay", "Rebate finder"],
     "scopes": ["projects:read", "property:read"], "icon": "flash-outline"},
    {"slug": "advanced-analytics", "name": "Advanced Analytics Dashboard", "category": "analytics",
     "publisher": "DIYhomie", "pricing": "paid", "price_label": "$9/mo",
     "description": "Deep project, cost & ROI analytics with exportable charts for power users and pros.",
     "capabilities": ["Cost & ROI charts", "Trend analysis", "BI-ready exports"],
     "scopes": ["projects:read", "analytics:read"], "icon": "chart-box-outline"},
    {"slug": "pro-scheduling", "name": "Pro Scheduling & Bids", "category": "pro",
     "publisher": "BuildConnect", "pricing": "paid", "price_label": "$19/mo",
     "description": "Route project details to vetted local pros and manage bids & appointments in-app.",
     "capabilities": ["Get pro bids", "Appointment scheduling", "Message contractors"],
     "scopes": ["projects:read", "contact:write"], "icon": "calendar-check-outline"},
    {"slug": "insurance-sync", "name": "Insurance Documentation Sync", "category": "insurance",
     "publisher": "AssureHome", "pricing": "free", "price_label": "Free",
     "description": "Securely share project & maintenance proof with your insurer for claims and discounts.",
     "capabilities": ["Claim documentation", "Maintenance proof", "Discount eligibility"],
     "scopes": ["projects:read", "certificates:read", "property:read"], "icon": "shield-home-outline"},
]


async def seed_appstore():
    if await _db.integrations.count_documents({}) == 0:
        for s in SEED:
            await _db.integrations.insert_one({**s, "id": _new_id(), "status": "published",
                                               "version": 1, "created_at": _now(), "updated_at": _now()})
        if _logger:
            _logger.info("appstore seeded")


async def _install_status(user_id: str, integration_id: str) -> Optional[dict]:
    return await _db.integration_installs.find_one(
        {"user_id": user_id, "integration_id": integration_id, "status": "active"}, {"_id": 0})


# ----------------------------------------------------------- user router
def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api")

    @r.get("/appstore")
    async def browse(category: Optional[str] = None, user: dict = Depends(get_current_user)):
        flt = {"status": "published"}
        if category:
            flt["category"] = category
        rows = await _db.integrations.find(flt, {"_id": 0}).sort("name", 1).to_list(200)
        installed = {i["integration_id"] async for i in _db.integration_installs.find(
            {"user_id": user["id"], "status": "active"}, {"integration_id": 1})}
        for x in rows:
            x["installed"] = x["id"] in installed
        cats = sorted({x["category"] for x in rows})
        return {"integrations": rows, "categories": cats}

    @r.get("/appstore/installed")
    async def installed(user: dict = Depends(get_current_user)):
        installs = await _db.integration_installs.find(
            {"user_id": user["id"], "status": "active"}, {"_id": 0}).to_list(200)
        out = []
        for ins in installs:
            integ = await _db.integrations.find_one({"id": ins["integration_id"]}, {"_id": 0})
            if integ:
                out.append({"integration": integ, "install": ins})
        return {"installed": out}

    @r.get("/appstore/{slug}")
    async def detail(slug: str, user: dict = Depends(get_current_user)):
        integ = await _db.integrations.find_one({"slug": slug, "status": "published"}, {"_id": 0})
        if not integ:
            raise HTTPException(status_code=404, detail="Integration not found")
        integ["installed"] = bool(await _install_status(user["id"], integ["id"]))
        return integ

    @r.post("/appstore/{slug}/install")
    async def install(slug: str, user: dict = Depends(get_current_user)):
        integ = await _db.integrations.find_one({"slug": slug, "status": "published"}, {"_id": 0})
        if not integ:
            raise HTTPException(status_code=404, detail="Integration not found")
        if await _install_status(user["id"], integ["id"]):
            return {"ok": True, "existing": True}
        await _db.integration_installs.insert_one({
            "id": _new_id(), "integration_id": integ["id"], "slug": slug, "user_id": user["id"],
            "status": "active", "consent_scopes": integ.get("scopes", []),
            "installed_at": _now(), "disabled_at": None})
        await audit_engine.log_event("user", user["id"], "integration_installed", "api",
                                     actor_email=user.get("email"), risk_level="medium",
                                     target_type="integration", target_id=integ["id"],
                                     meta={"slug": slug, "scopes": integ.get("scopes", [])})
        return {"ok": True, "existing": False}

    @r.post("/appstore/{slug}/uninstall")
    async def uninstall(slug: str, user: dict = Depends(get_current_user)):
        integ = await _db.integrations.find_one({"slug": slug}, {"_id": 0})
        if not integ:
            raise HTTPException(status_code=404, detail="Integration not found")
        res = await _db.integration_installs.update_one(
            {"user_id": user["id"], "integration_id": integ["id"], "status": "active"},
            {"$set": {"status": "disabled", "disabled_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Not installed")
        await audit_engine.log_event("user", user["id"], "integration_uninstalled", "api",
                                     actor_email=user.get("email"), risk_level="medium",
                                     target_type="integration", target_id=integ["id"], meta={"slug": slug})
        return {"ok": True}

    return r


# ----------------------------------------------------------- admin router
class IntegrationReq(BaseModel):
    slug: str
    name: str
    category: str = "other"
    publisher: str = "DIYhomie"
    pricing: str = "free"
    price_label: str = "Free"
    description: str = ""
    capabilities: List[str] = []
    scopes: List[str] = []
    icon: str = "puzzle-outline"
    status: str = "draft"


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/appstore", dependencies=[Depends(require_admin)])

    @r.get("")
    async def list_all():
        rows = await _db.integrations.find({}, {"_id": 0}).sort("created_at", -1).to_list(300)
        for x in rows:
            x["installs"] = await _db.integration_installs.count_documents({"integration_id": x["id"], "status": "active"})
        return {"integrations": rows}

    @r.get("/analytics")
    async def analytics():
        total = await _db.integrations.count_documents({})
        published = await _db.integrations.count_documents({"status": "published"})
        active_installs = await _db.integration_installs.count_documents({"status": "active"})
        paid_installs = 0
        agg = await _db.integration_installs.aggregate(
            [{"$match": {"status": "active"}},
             {"$group": {"_id": "$integration_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}]).to_list(300)
        by_integration = []
        for a in agg:
            integ = await _db.integrations.find_one({"id": a["_id"]}, {"_id": 0, "name": 1, "pricing": 1})
            if integ:
                by_integration.append({"name": integ["name"], "installs": a["n"], "pricing": integ.get("pricing")})
                if integ.get("pricing") == "paid":
                    paid_installs += a["n"]
        return {"total": total, "published": published, "active_installs": active_installs,
                "paid_installs": paid_installs, "by_integration": by_integration}

    @r.post("")
    async def create(req: IntegrationReq):
        if await _db.integrations.find_one({"slug": req.slug}):
            raise HTTPException(status_code=400, detail="An integration with that slug already exists")
        await _db.integrations.insert_one({**req.model_dump(), "id": _new_id(), "version": 1,
                                           "created_at": _now(), "updated_at": _now()})
        return {"ok": True}

    @r.put("/{integration_id}")
    async def update(integration_id: str, req: IntegrationReq):
        existing = await _db.integrations.find_one({"id": integration_id}, {"version": 1})
        if not existing:
            raise HTTPException(status_code=404, detail="Integration not found")
        await _db.integrations.update_one({"id": integration_id}, {"$set": {
            **req.model_dump(), "version": existing.get("version", 1) + 1, "updated_at": _now()}})
        return {"ok": True}

    @r.post("/{integration_id}/toggle")
    async def toggle(integration_id: str):
        integ = await _db.integrations.find_one({"id": integration_id}, {"status": 1})
        if not integ:
            raise HTTPException(status_code=404, detail="Integration not found")
        new_status = "draft" if integ.get("status") == "published" else "published"
        await _db.integrations.update_one({"id": integration_id}, {"$set": {"status": new_status, "updated_at": _now()}})
        return {"ok": True, "status": new_status}

    @r.delete("/{integration_id}")
    async def delete(integration_id: str):
        await _db.integrations.delete_one({"id": integration_id})
        await _db.integration_installs.delete_many({"integration_id": integration_id})
        return {"ok": True}

    return r
