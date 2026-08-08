"""
DIYhomie — Property Risk, Emergency Readiness & Protection Planning (Build Blueprint 36).

Helps users organize property-risk info, emergency contacts, shutoff/exit locations,
preparedness checklists, and recovery documentation. DIYhomie does NOT replace emergency
services, insurers, inspectors, engineers, utilities or licensed pros.

Emergency Mode prioritizes safety over normal flows: it shows concise immediate guidance and
the user's own saved contacts/shutoff locations FIRST, then (only after) creates a private
incident record. No login steps, no long forms. AI never says it's safe to stay in danger,
never delays emergency calls, and never estimates insurance/legal outcomes. No risk "scores".

Collections: er_risk_profiles, er_contacts, er_locations, er_incidents, er_incident_media,
er_incident_timeline, er_prep_plans, er_prep_items.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

RISK_CATEGORIES = ["Water", "Fire", "Electrical", "Gas", "Weather", "Power", "Security", "Structural", "Exterior", "Environmental"]
RISK_STATUS = ["unknown", "monitored", "needs_attention", "planned", "mitigated"]
CONTACT_TYPES = ["emergency_service", "utility_gas", "utility_electric", "utility_water", "plumber", "electrician", "hvac", "insurance", "neighbor", "family", "other"]
LOCATION_TYPES = ["water_shutoff", "gas_shutoff", "electrical_panel", "main_breaker", "fire_extinguisher", "smoke_alarm", "co_alarm", "first_aid_kit", "emergency_supplies", "exit", "important_documents"]
INCIDENT_STATUS = ["active", "contained", "documenting", "repair_in_progress", "resolved"]
PLAN_STATUS = ["draft", "active", "completed", "archived"]

EMERGENCY_CATEGORIES = {
    "fire_smoke": {"label": "Fire or Smoke", "contact_types": ["emergency_service"], "location_types": ["fire_extinguisher", "exit"],
                   "steps": ["Get everyone out now — don't gather belongings.", "Call 911 from outside.",
                             "Only fight a small, contained fire if you have a clear exit behind you.", "Stay out until the fire department says it's safe."]},
    "gas_smell": {"label": "Gas Smell", "contact_types": ["utility_gas", "emergency_service"], "location_types": ["gas_shutoff"],
                  "steps": ["Don't use switches, phones, or anything that could spark indoors.", "Get everyone outside to fresh air.",
                            "From outside, call your gas utility's emergency line and 911.", "Don't go back in until professionals clear it."]},
    "water_flood": {"label": "Water Leak or Flood", "contact_types": ["plumber", "emergency_service"], "location_types": ["water_shutoff", "electrical_panel"],
                    "steps": ["Shut off the main water valve if you can reach it safely.", "Stay clear of water near outlets or the panel — cut power to the area if safe.",
                              "Move people and valuables to higher ground.", "Call a plumber; call 911 if anyone is in danger."]},
    "electrical": {"label": "Electrical Emergency", "contact_types": ["electrician", "utility_electric", "emergency_service"], "location_types": ["main_breaker", "electrical_panel"],
                   "steps": ["Never touch someone still in contact with current.", "If safe, cut power at the main breaker.",
                             "Call 911 for any shock injury or active sparking/fire.", "Keep away from water near electrical hazards."]},
    "medical": {"label": "Medical Emergency", "contact_types": ["emergency_service"], "location_types": ["first_aid_kit"],
                "steps": ["Call 911 immediately.", "Follow the dispatcher's instructions.", "Don't move someone with a possible serious injury unless they're in danger."]},
    "severe_weather": {"label": "Severe Weather", "contact_types": ["emergency_service", "utility_electric"], "location_types": ["emergency_supplies", "exit"],
                       "steps": ["Move to the safest interior area away from windows.", "Follow official local alerts and evacuation orders.",
                                 "Keep phones charged and supplies close.", "Call 911 for injuries or entrapment."]},
    "other": {"label": "Other Emergency", "contact_types": ["emergency_service"], "location_types": [],
              "steps": ["If anyone is in danger, call 911 now.", "Get to a safe location.", "Once safe, you can document what happened here."]},
}

PREP_TEMPLATES = {
    "power_outage": ["Confirm flashlights and fresh batteries", "Charge phones and backup power banks", "Know how to open the garage door manually",
                     "Keep a cooler and ice plan for the fridge/freezer", "Locate the main electrical panel"],
    "flood": ["Record the water shutoff location", "Move valuables off the floor in flood-prone areas", "Clear gutters and downspouts",
              "Test the sump pump", "Photograph the exterior condition"],
    "severe_weather": ["Bring in or secure loose outdoor items", "Charge devices and backup power", "Review emergency contacts",
                       "Stock water and non-perishable food", "Identify the safest interior room"],
    "wildfire_smoke": ["Set HVAC to recirculate", "Prepare clean-air / filtered room", "Have N95-type masks ready", "Seal gaps around doors/windows"],
    "winter_storm": ["Insulate exposed pipes", "Confirm heat source & fuel", "Stock warm supplies and blankets", "Know how to shut off water if a pipe bursts"],
    "hurricane": ["Board or protect windows", "Charge devices and backup power", "Stock water (1 gal/person/day, 3+ days)",
                  "Photograph exterior before the storm", "Know your evacuation route"],
    "vacation_mode": ["Pause deliveries / hold mail", "Set lights on timers", "Shut off water main if leaving long", "Ask a neighbor to check in",
                      "Confirm smoke/CO alarms work"],
    "rural_readiness": ["Confirm backup water source", "Stock extra fuel safely", "Confirm generator readiness", "Keep a well/septic service contact",
                        "Clear defensible space around the home"],
}
PLAN_LABELS = {"power_outage": "Power Outage", "flood": "Flood Readiness", "severe_weather": "Severe Weather",
               "wildfire_smoke": "Wildfire Smoke", "winter_storm": "Winter Storm", "hurricane": "Hurricane / Storm",
               "vacation_mode": "Vacation Mode", "rural_readiness": "Rural Readiness"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[emergency:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _property(user_id: str) -> Optional[dict]:
    return (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))


# ============================================================= models
class RiskReq(BaseModel):
    risk_category: str
    user_reported_context: Optional[str] = None
    risk_status: str = "monitored"
    confidence_level: Optional[str] = "medium"


class ContactReq(BaseModel):
    contact_type: str
    name: str
    phone: Optional[str] = None
    notes: Optional[str] = None


class LocationReq(BaseModel):
    location_type: str
    description: str
    room_id: Optional[str] = None
    photo_url: Optional[str] = None


class EmergencyStartReq(BaseModel):
    category: str


class IncidentReq(BaseModel):
    incident_type: str
    severity: str = "medium"
    occurred_at: Optional[str] = None


class IncidentStatusReq(BaseModel):
    status: str


class TimelineReq(BaseModel):
    event_type: str
    note: Optional[str] = None
    occurred_at: Optional[str] = None


class MediaReq(BaseModel):
    media_type: str
    storage_reference: str
    captured_at: Optional[str] = None


class PlanReq(BaseModel):
    plan_type: str


class ItemReq(BaseModel):
    title: str
    category: Optional[str] = "general"


class ItemStatusReq(BaseModel):
    status: str


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/emergency", dependencies=[Depends(get_current_user)])

    # ---------- overview ----------
    @r.get("/overview")
    async def overview(user: dict = Depends(get_current_user)):
        prop = await _property(user["id"])
        if not prop:
            return {"is_new_user": True}
        pid = prop["id"]
        contacts = await _db.er_contacts.count_documents({"user_id": user["id"]})
        locations = await _db.er_locations.find({"property_id": pid}, {"_id": 0, "location_type": 1}).to_list(100)
        loc_types = {l["location_type"] for l in locations}
        plans = await _db.er_prep_plans.count_documents({"property_id": pid, "status": {"$ne": "archived"}})
        incidents = await _db.er_incidents.count_documents({"property_id": pid})
        # practical suggestions (no scoring / no fear language)
        suggestions = []
        if contacts == 0:
            suggestions.append({"label": "Add emergency contacts", "route": "/home-intel/emergency"})
        if "water_shutoff" not in loc_types:
            suggestions.append({"label": "Add water shutoff location", "route": "/home-intel/emergency"})
        if "electrical_panel" not in loc_types and "main_breaker" not in loc_types:
            suggestions.append({"label": "Add electrical panel location", "route": "/home-intel/emergency"})
        if "fire_extinguisher" not in loc_types:
            suggestions.append({"label": "Note your fire extinguisher location", "route": "/home-intel/emergency"})
        if plans == 0:
            suggestions.append({"label": "Start a storm-readiness checklist", "route": "/home-intel/emergency"})
        key_locs = ["water_shutoff", "gas_shutoff", "electrical_panel", "fire_extinguisher"]
        completeness = round((len([k for k in key_locs if k in loc_types]) + (1 if contacts else 0)) / (len(key_locs) + 1) * 100)
        return {"is_new_user": False, "property": {"id": pid, "name": prop.get("name") or "My Home"},
                "contacts_count": contacts, "locations": sorted(loc_types), "plans_count": plans,
                "incidents_count": incidents, "info_completeness": completeness,
                "suggestions": suggestions[:4],
                "note": "This helps you prepare and respond calmly. It doesn't replace emergency services, insurers, or licensed pros."}

    # ---------- emergency mode ----------
    @r.get("/categories")
    async def categories(user: dict = Depends(get_current_user)):
        return {"categories": [{"key": k, "label": v["label"]} for k, v in EMERGENCY_CATEGORIES.items()]}

    @r.post("/mode/start")
    async def emergency_start(req: EmergencyStartReq, user: dict = Depends(get_current_user)):
        cat = EMERGENCY_CATEGORIES.get(req.category)
        if not cat:
            raise HTTPException(status_code=400, detail="Unknown emergency category.")
        await _cap(user["id"], "emergency_category_selected", {"category": req.category})
        prop = await _property(user["id"])
        contacts, locations, incident_id = [], [], None
        try:
            if prop:
                # user's own saved contacts relevant to this category
                contacts = await _db.er_contacts.find(
                    {"user_id": user["id"], "contact_type": {"$in": cat["contact_types"] + ["emergency_service"]}},
                    {"_id": 0}).to_list(20)
                if not contacts:
                    contacts = await _db.er_contacts.find({"user_id": user["id"]}, {"_id": 0}).to_list(10)
                # only show shutoff/exit info the user previously recorded
                if cat["location_types"]:
                    locations = await _db.er_locations.find(
                        {"property_id": prop["id"], "location_type": {"$in": cat["location_types"]}},
                        {"_id": 0}).to_list(20)
                # create private incident AFTER assembling safety content
                inc = {"id": _nid(), "property_id": prop["id"], "user_id": user["id"], "incident_type": req.category,
                       "severity": "unknown", "status": "active", "occurred_at": _now(), "created_at": _now()}
                await _db.er_incidents.insert_one(inc); incident_id = inc["id"]
        except Exception as e:
            _sentry("emergency_mode_failure", str(e))
        await _cap(user["id"], "emergency_mode_opened", {"category": req.category})
        return {"category": req.category, "label": cat["label"], "steps": cat["steps"],
                "call_emergency": "If anyone is in danger, call your local emergency number (911) now.",
                "your_contacts": contacts, "your_locations": locations, "incident_id": incident_id,
                "note": "These are general safety steps and only the info you've saved. They don't replace emergency services."}

    # ---------- risk profiles ----------
    @r.get("/risk-profiles")
    async def risk_list(user: dict = Depends(get_current_user)):
        prop = await _property(user["id"])
        if not prop:
            return {"profiles": [], "categories": RISK_CATEGORIES}
        rows = await _db.er_risk_profiles.find({"property_id": prop["id"]}, {"_id": 0}).to_list(100)
        return {"profiles": rows, "categories": RISK_CATEGORIES}

    @r.post("/risk-profiles")
    async def risk_create(req: RiskReq, user: dict = Depends(get_current_user)):
        if req.risk_category not in RISK_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid risk category.")
        if req.risk_status not in RISK_STATUS:
            raise HTTPException(status_code=400, detail="Invalid status.")
        prop = await _property(user["id"])
        if not prop:
            raise HTTPException(status_code=400, detail="Set up a home first.")
        doc = {"id": _nid(), "property_id": prop["id"], "user_id": user["id"], "risk_category": req.risk_category,
               "user_reported_context": (req.user_reported_context or "")[:1000] or None, "risk_status": req.risk_status,
               "confidence_level": req.confidence_level, "created_at": _now(), "updated_at": _now()}
        await _db.er_risk_profiles.insert_one(dict(doc)); doc.pop("_id", None)
        return {"profile": doc}

    @r.put("/risk-profiles/{rid}")
    async def risk_update(rid: str, req: RiskReq, user: dict = Depends(get_current_user)):
        res = await _db.er_risk_profiles.update_one({"id": rid, "user_id": user["id"]},
            {"$set": {"risk_status": req.risk_status, "user_reported_context": req.user_reported_context, "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Risk profile not found.")
        return {"ok": True}

    # ---------- contacts ----------
    @r.get("/contacts")
    async def contacts_list(user: dict = Depends(get_current_user)):
        rows = await _db.er_contacts.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"contacts": rows, "contact_types": CONTACT_TYPES}

    @r.post("/contacts")
    async def contact_create(req: ContactReq, user: dict = Depends(get_current_user)):
        if req.contact_type not in CONTACT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid contact type.")
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="Add a name.")
        prop = await _property(user["id"])
        doc = {"id": _nid(), "user_id": user["id"], "property_id": prop["id"] if prop else None,
               "contact_type": req.contact_type, "name": req.name.strip()[:120], "phone": (req.phone or "").strip()[:40] or None,
               "notes": (req.notes or "").strip()[:300] or None, "created_at": _now()}
        await _db.er_contacts.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "emergency_location_added", {"kind": "contact"})
        return {"contact": doc}

    @r.put("/contacts/{cid}")
    async def contact_update(cid: str, req: ContactReq, user: dict = Depends(get_current_user)):
        res = await _db.er_contacts.update_one({"id": cid, "user_id": user["id"]},
            {"$set": {"contact_type": req.contact_type, "name": req.name.strip()[:120], "phone": (req.phone or "").strip()[:40] or None, "notes": (req.notes or "")[:300] or None}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Contact not found.")
        return {"ok": True}

    @r.delete("/contacts/{cid}")
    async def contact_delete(cid: str, user: dict = Depends(get_current_user)):
        res = await _db.er_contacts.delete_one({"id": cid, "user_id": user["id"]})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Contact not found.")
        return {"ok": True}

    # ---------- locations ----------
    @r.get("/locations")
    async def locations_list(user: dict = Depends(get_current_user)):
        prop = await _property(user["id"])
        if not prop:
            return {"locations": [], "location_types": LOCATION_TYPES}
        rows = await _db.er_locations.find({"property_id": prop["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"locations": rows, "location_types": LOCATION_TYPES}

    @r.post("/locations")
    async def location_create(req: LocationReq, user: dict = Depends(get_current_user)):
        if req.location_type not in LOCATION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid location type.")
        prop = await _property(user["id"])
        if not prop:
            raise HTTPException(status_code=400, detail="Set up a home first.")
        doc = {"id": _nid(), "property_id": prop["id"], "user_id": user["id"], "room_id": req.room_id,
               "location_type": req.location_type, "description": req.description.strip()[:300], "photo_url": req.photo_url,
               "verification_status": "user_recorded", "created_at": _now()}
        await _db.er_locations.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "emergency_location_added", {"type": req.location_type})
        return {"location": doc}

    @r.delete("/locations/{lid}")
    async def location_delete(lid: str, user: dict = Depends(get_current_user)):
        res = await _db.er_locations.delete_one({"id": lid, "user_id": user["id"]})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Location not found.")
        return {"ok": True}

    # ---------- incidents ----------
    @r.get("/incidents")
    async def incidents_list(user: dict = Depends(get_current_user)):
        prop = await _property(user["id"])
        if not prop:
            return {"incidents": []}
        rows = await _db.er_incidents.find({"property_id": prop["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"incidents": rows}

    @r.post("/incidents")
    async def incident_create(req: IncidentReq, user: dict = Depends(get_current_user)):
        prop = await _property(user["id"])
        if not prop:
            raise HTTPException(status_code=400, detail="Set up a home first.")
        doc = {"id": _nid(), "property_id": prop["id"], "user_id": user["id"], "incident_type": req.incident_type[:60],
               "severity": req.severity, "status": "documenting", "occurred_at": req.occurred_at or _now(), "created_at": _now()}
        await _db.er_incidents.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "incident_record_created", {})
        return {"incident": doc}

    @r.get("/incidents/{iid}")
    async def incident_get(iid: str, user: dict = Depends(get_current_user)):
        inc = await _db.er_incidents.find_one({"id": iid, "user_id": user["id"]}, {"_id": 0})
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found.")
        timeline = await _db.er_incident_timeline.find({"incident_id": iid}, {"_id": 0}).sort("occurred_at", 1).to_list(200)
        media = await _db.er_incident_media.find({"incident_id": iid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"incident": inc, "timeline": timeline, "media": media,
                "note": "Documenting an incident supports your recovery. It doesn't guarantee insurance coverage, claim approval, or any valuation."}

    @r.put("/incidents/{iid}")
    async def incident_status(iid: str, req: IncidentStatusReq, user: dict = Depends(get_current_user)):
        if req.status not in INCIDENT_STATUS:
            raise HTTPException(status_code=400, detail="Invalid status.")
        res = await _db.er_incidents.update_one({"id": iid, "user_id": user["id"]}, {"$set": {"status": req.status, "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Incident not found.")
        return {"ok": True, "status": req.status}

    @r.post("/incidents/{iid}/timeline")
    async def incident_timeline(iid: str, req: TimelineReq, user: dict = Depends(get_current_user)):
        inc = await _db.er_incidents.find_one({"id": iid, "user_id": user["id"]}, {"_id": 0, "id": 1})
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found.")
        doc = {"id": _nid(), "incident_id": iid, "event_type": req.event_type[:60], "note": (req.note or "")[:1000] or None,
               "occurred_at": req.occurred_at or _now(), "created_at": _now()}
        await _db.er_incident_timeline.insert_one(dict(doc)); doc.pop("_id", None)
        return {"event": doc}

    @r.post("/incidents/{iid}/media")
    async def incident_media(iid: str, req: MediaReq, user: dict = Depends(get_current_user)):
        inc = await _db.er_incidents.find_one({"id": iid, "user_id": user["id"]}, {"_id": 0, "id": 1})
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found.")
        doc = {"id": _nid(), "incident_id": iid, "media_type": req.media_type[:30], "storage_reference": req.storage_reference[:500],
               "captured_at": req.captured_at or _now(), "created_at": _now()}
        await _db.er_incident_media.insert_one(dict(doc)); doc.pop("_id", None)
        return {"media": doc}

    # ---------- preparedness plans ----------
    @r.get("/prep-plans")
    async def plans_list(user: dict = Depends(get_current_user)):
        prop = await _property(user["id"])
        if not prop:
            return {"plans": [], "plan_types": [{"key": k, "label": v} for k, v in PLAN_LABELS.items()]}
        plans = await _db.er_prep_plans.find({"property_id": prop["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        for p in plans:
            total = await _db.er_prep_items.count_documents({"preparedness_plan_id": p["id"]})
            done = await _db.er_prep_items.count_documents({"preparedness_plan_id": p["id"], "status": "done"})
            p["total_items"] = total; p["done_items"] = done
        return {"plans": plans, "plan_types": [{"key": k, "label": v} for k, v in PLAN_LABELS.items()]}

    @r.post("/prep-plans")
    async def plan_create(req: PlanReq, user: dict = Depends(get_current_user)):
        if req.plan_type not in PREP_TEMPLATES:
            raise HTTPException(status_code=400, detail="Unknown plan type.")
        prop = await _property(user["id"])
        if not prop:
            raise HTTPException(status_code=400, detail="Set up a home first.")
        plan = {"id": _nid(), "property_id": prop["id"], "user_id": user["id"], "plan_type": req.plan_type,
                "label": PLAN_LABELS[req.plan_type], "status": "active", "created_at": _now()}
        await _db.er_prep_plans.insert_one(dict(plan)); plan.pop("_id", None)
        items = [{"id": _nid(), "preparedness_plan_id": plan["id"], "title": t, "category": req.plan_type,
                  "status": "todo", "created_at": _now()} for t in PREP_TEMPLATES[req.plan_type]]
        if items:
            await _db.er_prep_items.insert_many([dict(i) for i in items])
        await _cap(user["id"], "preparedness_plan_created", {"type": req.plan_type})
        return {"plan": plan, "items": items}

    @r.get("/prep-plans/{pid}")
    async def plan_get(pid: str, user: dict = Depends(get_current_user)):
        plan = await _db.er_prep_plans.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found.")
        items = await _db.er_prep_items.find({"preparedness_plan_id": pid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"plan": plan, "items": items}

    @r.post("/prep-plans/{pid}/items")
    async def item_add(pid: str, req: ItemReq, user: dict = Depends(get_current_user)):
        plan = await _db.er_prep_plans.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0, "id": 1})
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found.")
        if not req.title.strip():
            raise HTTPException(status_code=400, detail="Add a title.")
        doc = {"id": _nid(), "preparedness_plan_id": pid, "title": req.title.strip()[:200],
               "category": req.category or "general", "status": "todo", "created_at": _now()}
        await _db.er_prep_items.insert_one(dict(doc)); doc.pop("_id", None)
        return {"item": doc}

    @r.put("/prep-items/{iid}")
    async def item_status(iid: str, req: ItemStatusReq, user: dict = Depends(get_current_user)):
        if req.status not in ("todo", "done"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        res = await _db.er_prep_items.update_one({"id": iid}, {"$set": {"status": req.status, "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Item not found.")
        if req.status == "done":
            await _cap(user["id"], "preparedness_task_completed", {})
        return {"ok": True, "status": req.status}

    @r.put("/prep-plans/{pid}")
    async def plan_status(pid: str, req: ItemStatusReq, user: dict = Depends(get_current_user)):
        status = req.status if req.status in PLAN_STATUS else "active"
        res = await _db.er_prep_plans.update_one({"id": pid, "user_id": user["id"]}, {"$set": {"status": status, "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Plan not found.")
        return {"ok": True, "status": status}

    return r


# ============================================================= seed
async def seed_emergency():
    if _db is None:
        return
    try:
        await _db.er_contacts.create_index("user_id")
        await _db.er_incidents.create_index("property_id")
        if _logger:
            _logger.info("emergency readiness (B36) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"emergency readiness seed failed: {e}")
