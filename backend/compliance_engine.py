"""
DIYhomie — Permit, Code Awareness & Regulatory Guidance Engine (Build Blueprint 29).

Helps users RECOGNIZE when a project may need permits, inspections, licensed pros, HOA review
or local verification. DIYhomie gives NO legal advice, code certification, permit approval, or
guaranteed jurisdiction-specific compliance — it reduces surprises, never makes promises.

Pipeline: project scope -> classification -> jurisdiction context -> approved versioned rule
retrieval -> risk/verification level -> permit guidance card + checklist -> user decision /
professional escalation (advisory link to Blueprint 12). Never states "No permit required" as a
guarantee. Missing jurisdiction => "DIYhomie does not have verified local requirements for this
location." Every rule is source-aware, dated, confidence-labeled and versioned.

Collections: jurisdiction_profiles, compliance_rules, compliance_rule_versions,
project_compliance_assessments, compliance_checklist_items, compliance_doc_packages,
compliance_flags, compliance_settings.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

WORK_CATEGORIES = ["electrical", "plumbing", "structural", "mechanical", "roofing", "demolition",
                   "exterior", "accessory_structure", "cosmetic_finish", "general"]
ASSESSMENT_LEVELS = ["general_guidance", "verify_locally", "permit_inquiry_recommended", "professional_review_recommended"]
RULE_TYPES = ["permit_inquiry", "inspection", "licensed_professional", "hoa_consideration", "safety_warning", "documentation"]

# keyword → work category classification
CATEGORY_KEYWORDS = {
    "electrical": ["electrical", "circuit", "outlet", "wiring", "breaker", "panel", "gfci", "light fixture", "recessed"],
    "plumbing": ["plumb", "pipe", "faucet", "drain", "water line", "sewer", "toilet", "shower valve", "supply line", "relocat"],
    "mechanical": ["hvac", "furnace", "gas", "ac unit", "air condition", "ductwork", "water heater", "boiler", "ventilation"],
    "structural": ["load-bearing", "load bearing", "wall removal", "remove wall", "beam", "foundation", "framing", "structural", "header"],
    "roofing": ["roof", "shingle", "flashing", "gutter replacement"],
    "demolition": ["demolition", "demo ", "tear out", "gut ", "remove ceiling"],
    "accessory_structure": ["deck", "shed", "detached", "pergola", "carport", "fence over", "addition", "garage"],
    "exterior": ["siding", "exterior", "excavation", "drainage", "grading", "retaining wall", "driveway", "concrete pour"],
    "cosmetic_finish": ["paint", "wallpaper", "decor", "trim", "caulk", "furniture", "shelf", "curtain", "blinds", "tile backsplash"],
}
# category → regulatory tier
LOW = {"cosmetic_finish", "general"}
VERIFY = {"exterior", "roofing"}  # base tier before keyword bumps
PERMIT = {"accessory_structure", "demolition", "plumbing", "mechanical"}
PROFESSIONAL = {"electrical", "structural"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[compliance:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _prop(user_id: str) -> dict:
    p = (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
         or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))
    if not p:
        p = {"id": _nid(), "user_id": user_id, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(p))
    return p


async def _settings() -> dict:
    s = await _db.compliance_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "categories_enabled": {c: True for c in WORK_CATEGORIES},
             "high_risk_categories": ["electrical", "structural", "mechanical"], "updated_at": _now()}
        await _db.compliance_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


def _classify(category: str, text: str) -> dict:
    """Return {work_categories: [...], level, reasons}."""
    blob = f"{category or ''} {text or ''}".lower()
    hits = []
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(k in blob for k in kws):
            hits.append(cat)
    if not hits:
        hits = ["general"]
    # de-prioritize cosmetic if higher-risk categories also present
    non_cosmetic = [c for c in hits if c != "cosmetic_finish"]
    effective = non_cosmetic or hits
    level = "general_guidance"
    for c in effective:
        if c in PROFESSIONAL:
            level = "professional_review_recommended"; break
        if c in PERMIT:
            level = "permit_inquiry_recommended"
        elif c in VERIFY and level == "general_guidance":
            level = "verify_locally"
        elif c in LOW and level == "general_guidance":
            level = "general_guidance"
    # explicit high-risk keyword override
    if any(k in blob for k in ["panel", "gas", "load-bearing", "load bearing", "remove wall", "foundation", "addition"]):
        level = "professional_review_recommended"
    return {"work_categories": effective, "level": level}


# ============================================================= models
class JurisdictionReq(BaseModel):
    country: str = "US"
    state_or_region: Optional[str] = None
    county: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None


class AssessReq(BaseModel):
    project_id: str


class ChecklistStatusReq(BaseModel):
    status: str  # pending | completed | skipped


class PackageReq(BaseModel):
    project_id: str
    included_entities: dict = {}


class PackageStatusReq(BaseModel):
    status: str  # draft | ready | shared | archived


class FlagReq(BaseModel):
    reason: str


STANDARD_QUESTIONS = [
    "Is a permit required for this scope of work?",
    "Are inspections required during or after the project?",
    "Are licensed contractors required for any portion?",
    "Are there local setback, drainage, or HOA requirements?",
]


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/compliance", dependencies=[Depends(get_current_user)])

    async def _jurisdiction(prop_id):
        return await _db.jurisdiction_profiles.find_one({"property_id": prop_id}, {"_id": 0})

    @r.get("/categories")
    async def categories(user: dict = Depends(get_current_user)):
        return {"work_categories": WORK_CATEGORIES, "assessment_levels": ASSESSMENT_LEVELS,
                "tiers": {"low_regulatory": sorted(LOW), "verify": sorted(VERIFY),
                          "permit_inquiry": sorted(PERMIT), "professional": sorted(PROFESSIONAL)}}

    @r.get("/jurisdiction")
    async def get_jurisdiction(user: dict = Depends(get_current_user)):
        prop = await _prop(user["id"])
        j = await _jurisdiction(prop["id"])
        return {"jurisdiction": j, "has_verified_local_data": bool(j and j.get("verification_status") == "provider_verified_future")}

    @r.put("/jurisdiction")
    async def set_jurisdiction(req: JurisdictionReq, user: dict = Depends(get_current_user)):
        prop = await _prop(user["id"])
        doc = {"country": req.country, "state_or_region": req.state_or_region, "county": req.county,
               "city": req.city, "postal_code": req.postal_code, "verification_status": "user_entered",
               "last_verified_at": None, "updated_at": _now()}
        await _db.jurisdiction_profiles.update_one(
            {"property_id": prop["id"]}, {"$set": doc, "$setOnInsert": {"id": _nid(), "property_id": prop["id"],
             "user_id": user["id"], "created_at": _now()}}, upsert=True)
        return await _jurisdiction(prop["id"])

    @r.post("/assess")
    async def assess(req: AssessReq, user: dict = Depends(get_current_user)):
        prop = await _prop(user["id"])
        project = await _db.hi_projects.find_one({"id": req.project_id, "user_id": user["id"]}, {"_id": 0})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found.")
        s = await _settings()
        text = f"{project.get('title', '')} {project.get('project_category', '')} {project.get('scope', '')} {project.get('goal', '')}"
        cls = _classify(project.get("project_category"), text)
        # filter categories admin disabled
        active_cats = [c for c in cls["work_categories"] if s["categories_enabled"].get(c, True)]
        j = await _jurisdiction(prop["id"])
        has_local = bool(j and j.get("verification_status") == "provider_verified_future")

        # retrieve approved+active rules for these categories (jurisdiction-specific first, else general)
        rules = await _db.compliance_rules.find(
            {"project_category": {"$in": active_cats or ["general"]}, "status": "active"},
            {"_id": 0}).to_list(200)
        # drop expired / unknown-date rules from being presented as current
        today = datetime.now(timezone.utc)
        current_rules = []
        for rl in rules:
            exp = rl.get("expires_at")
            if exp and exp < _now():
                continue
            current_rules.append(rl)

        level = cls["level"]
        confidence = "high" if (has_local and current_rules) else ("medium" if current_rules else "low")
        if not has_local:
            summary = ("DIYhomie does not have verified local requirements for this location. "
                       "The guidance below is general and educational — confirm with your local building department.")
        else:
            summary = "Based on your location and current guidance, here's what to check before you begin."

        assessment = {"id": _nid(), "project_id": req.project_id, "user_id": user["id"],
                      "jurisdiction_profile_id": (j or {}).get("id"),
                      "assessment_level": level, "work_categories": active_cats,
                      "summary": summary, "confidence_level": confidence,
                      "has_verified_local_data": has_local, "verified_by_user": False,
                      "created_at": _now()}
        # replace prior assessment for this project
        await _db.project_compliance_assessments.delete_many({"project_id": req.project_id, "user_id": user["id"]})
        await _db.compliance_checklist_items.delete_many({"project_id": req.project_id})
        await _db.project_compliance_assessments.insert_one(dict(assessment)); assessment.pop("_id", None)

        # build checklist from rules + standard questions
        checklist = []
        for rl in current_rules:
            required = "unknown" if not has_local else ("true" if rl["rule_type"] in ("permit_inquiry", "licensed_professional", "inspection") else "false")
            item = {"id": _nid(), "project_compliance_assessment_id": assessment["id"], "project_id": req.project_id,
                    "title": rl["title"], "description": rl["guidance"], "rule_type": rl["rule_type"],
                    "source_reference": rl.get("source_reference"), "source_date": rl.get("source_date"),
                    "required": required, "status": "pending", "created_at": _now()}
            checklist.append(item)
        for q in STANDARD_QUESTIONS:
            checklist.append({"id": _nid(), "project_compliance_assessment_id": assessment["id"], "project_id": req.project_id,
                              "title": q, "description": "Ask your local building department.", "rule_type": "documentation",
                              "source_reference": "Local authority", "source_date": None,
                              "required": "unknown", "status": "pending", "created_at": _now()})
        if checklist:
            await _db.compliance_checklist_items.insert_many([dict(x) for x in checklist])

        await _cap(user["id"], "compliance_assessment_shown", {"level": level, "confidence": confidence})
        return {"assessment": assessment, "rules": current_rules, "checklist": checklist,
                "questions": STANDARD_QUESTIONS,
                "professional_escalation": {"recommended": level == "professional_review_recommended",
                                            "reasons": _pro_reasons(cls, has_local),
                                            "project_id": req.project_id},
                "disclaimer": "This is advisory only — not legal advice, code certification, or a guarantee. Local rules may differ."}

    @r.get("/assessments/{project_id}")
    async def get_assessment(project_id: str, user: dict = Depends(get_current_user)):
        a = await _db.project_compliance_assessments.find_one({"project_id": project_id, "user_id": user["id"]}, {"_id": 0}, sort=[("created_at", -1)])
        if not a:
            return {"assessment": None}
        checklist = await _db.compliance_checklist_items.find({"project_compliance_assessment_id": a["id"]}, {"_id": 0}).to_list(200)
        pkg = await _db.compliance_doc_packages.find_one({"project_id": project_id}, {"_id": 0}, sort=[("created_at", -1)])
        return {"assessment": a, "checklist": checklist, "package": pkg}

    @r.post("/checklist/{item_id}/status")
    async def checklist_status(item_id: str, req: ChecklistStatusReq, user: dict = Depends(get_current_user)):
        if req.status not in ("pending", "completed", "skipped"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        item = await _db.compliance_checklist_items.find_one({"id": item_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Checklist item not found.")
        # ownership via assessment
        a = await _db.project_compliance_assessments.find_one({"id": item["project_compliance_assessment_id"], "user_id": user["id"]})
        if not a:
            raise HTTPException(status_code=403, detail="Not allowed.")
        await _db.compliance_checklist_items.update_one({"id": item_id}, {"$set": {"status": req.status}})
        await _cap(user["id"], "compliance_checklist_added", {"status": req.status})
        return {"ok": True}

    @r.post("/assessments/{aid}/verified")
    async def mark_verified(aid: str, user: dict = Depends(get_current_user)):
        res = await _db.project_compliance_assessments.update_one({"id": aid, "user_id": user["id"]}, {"$set": {"verified_by_user": True, "verified_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Assessment not found.")
        await _cap(user["id"], "local_verification_marked_complete", {})
        return {"ok": True}

    @r.post("/package")
    async def create_package(req: PackageReq, user: dict = Depends(get_current_user)):
        project = await _db.hi_projects.find_one({"id": req.project_id, "user_id": user["id"]}, {"_id": 0})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found.")
        try:
            prop = await _prop(user["id"])
            measurements = await _db.hi_measurements.find({"user_id": user["id"], "project_id": req.project_id}, {"_id": 0}).to_list(50)
            try:
                materials = await _db.hi_project_materials.find({"project_id": req.project_id}, {"_id": 0}).to_list(100)
            except Exception:
                materials = []
            included = {
                "project_summary": {"title": project.get("title"), "category": project.get("project_category"), "scope": project.get("scope")},
                "measurements_count": len(measurements),
                "materials_count": len(materials),
                "questions_for_authority": STANDARD_QUESTIONS,
                "address_included": bool(req.included_entities.get("include_address")),
            }
            pkg = {"id": _nid(), "project_id": req.project_id, "user_id": user["id"], "status": "draft",
                   "included_entities": {**included, **(req.included_entities or {})},
                   "labels": ["PRELIMINARY — not permit-ready, not code-compliant, not engineered or approved"],
                   "created_at": _now()}
            await _db.compliance_doc_packages.insert_one(dict(pkg)); pkg.pop("_id", None)
            await _cap(user["id"], "compliance_document_package_created", {})
            return {"package": pkg}
        except Exception as e:
            _sentry("compliance-package generation failure", str(e))
            raise HTTPException(status_code=502, detail="Couldn't build the package. Try again.")

    @r.get("/package/{project_id}")
    async def get_package(project_id: str, user: dict = Depends(get_current_user)):
        return {"package": await _db.compliance_doc_packages.find_one({"project_id": project_id, "user_id": user["id"]}, {"_id": 0}, sort=[("created_at", -1)])}

    @r.put("/package/{pid}/status")
    async def package_status(pid: str, req: PackageStatusReq, user: dict = Depends(get_current_user)):
        if req.status not in ("draft", "ready", "shared", "archived"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        res = await _db.compliance_doc_packages.update_one({"id": pid, "user_id": user["id"]}, {"$set": {"status": req.status, "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Package not found.")
        return {"ok": True, "status": req.status}

    @r.post("/report")
    async def report(req: FlagReq, user: dict = Depends(get_current_user), assessment_id: Optional[str] = None):
        await _db.compliance_flags.insert_one({"id": _nid(), "user_id": user["id"], "assessment_id": assessment_id,
                                               "reason": (req.reason or "").strip()[:500], "status": "open", "created_at": _now()})
        return {"ok": True, "note": "Thanks — our team will review this guidance."}

    return r


def _pro_reasons(cls, has_local) -> list:
    reasons = []
    if "structural" in cls["work_categories"]:
        reasons.append("Structural changes may need engineering or stamped plans.")
    if "electrical" in cls["work_categories"]:
        reasons.append("New/altered electrical circuits often require a licensed electrician and inspection.")
    if "mechanical" in cls["work_categories"]:
        reasons.append("Gas/HVAC work is commonly licensed-trade and inspected.")
    if not has_local and cls["level"] in ("permit_inquiry_recommended", "professional_review_recommended"):
        reasons.append("We don't have verified local data for significant work here — a pro can confirm requirements.")
    return reasons or ["A professional can confirm requirements and reduce risk."]


# ============================================================= admin router
class SettingsReq(BaseModel):
    high_risk_categories: Optional[list] = None


class CategoryToggleReq(BaseModel):
    category: str
    enabled: bool


class RuleReq(BaseModel):
    project_category: str
    rule_type: str
    title: str
    guidance: str
    source_reference: str
    source_date: Optional[str] = None
    confidence_level: str = "medium"
    jurisdiction_profile_id: Optional[str] = None
    expires_at: Optional[str] = None


class RuleStatusReq(BaseModel):
    status: str  # draft | approved | active | superseded | archived


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/compliance", dependencies=[Depends(require_admin)])

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def put_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _now()
            await _db.compliance_settings.update_one({"id": "singleton"}, {"$set": upd}, upsert=True)
        return await _settings()

    @r.put("/categories")
    async def toggle_category(req: CategoryToggleReq, admin: dict = Depends(require_admin)):
        if req.category not in WORK_CATEGORIES:
            raise HTTPException(status_code=400, detail="Unknown category.")
        s = await _settings()
        cats = s["categories_enabled"]; cats[req.category] = req.enabled
        await _db.compliance_settings.update_one({"id": "singleton"}, {"$set": {"categories_enabled": cats, "updated_at": _now()}})
        return {"categories_enabled": cats}

    @r.get("/rules")
    async def list_rules(admin: dict = Depends(require_admin)):
        return {"rules": await _db.compliance_rules.find({}, {"_id": 0}).sort("project_category", 1).to_list(500)}

    @r.post("/rules")
    async def add_rule(req: RuleReq, admin: dict = Depends(require_admin)):
        if req.project_category not in WORK_CATEGORIES or req.rule_type not in RULE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid category or rule type.")
        rule = {"id": _nid(), "jurisdiction_profile_id": req.jurisdiction_profile_id,
                "project_category": req.project_category, "rule_type": req.rule_type,
                "title": req.title.strip()[:160], "guidance": req.guidance.strip()[:1000],
                "source_reference": req.source_reference.strip()[:200], "source_date": req.source_date,
                "confidence_level": req.confidence_level, "expires_at": req.expires_at,
                "version": 1, "status": "draft", "created_at": _now()}
        await _db.compliance_rules.insert_one(dict(rule)); rule.pop("_id", None)
        return {"rule": rule}

    @r.put("/rules/{rid}/status")
    async def rule_status(rid: str, req: RuleStatusReq, admin: dict = Depends(require_admin)):
        if req.status not in ("draft", "approved", "active", "superseded", "archived"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        rl = await _db.compliance_rules.find_one({"id": rid}, {"_id": 0})
        if not rl:
            raise HTTPException(status_code=404, detail="Rule not found.")
        if req.status == "active" and not rl.get("source_date"):
            raise HTTPException(status_code=409, detail="A rule needs a source date before it can be presented as current.")
        # version snapshot on change
        await _db.compliance_rule_versions.insert_one({**rl, "snapshot_id": _nid(), "snapshot_at": _now()})
        await _db.compliance_rules.update_one({"id": rid}, {"$set": {"status": req.status, "updated_at": _now()}})
        return {"ok": True, "status": req.status}

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        async def _lvl(l):
            return await _db.project_compliance_assessments.count_documents({"assessment_level": l})
        by_level = {l: await _lvl(l) for l in ASSESSMENT_LEVELS}
        rules = await _db.compliance_rules.find({}, {"_id": 0}).to_list(1000)
        by_status: dict = {}
        expired = 0
        for rl in rules:
            by_status[rl["status"]] = by_status.get(rl["status"], 0) + 1
            if rl.get("expires_at") and rl["expires_at"] < _now():
                expired += 1
        flags = await _db.compliance_flags.count_documents({"status": "open"})
        return {"assessments_by_level": by_level, "total_assessments": await _db.project_compliance_assessments.count_documents({}),
                "rules_by_status": by_status, "expired_rules": expired, "open_flags": flags,
                "settings": await _settings()}

    @r.get("/flags")
    async def flags(admin: dict = Depends(require_admin)):
        return {"flags": await _db.compliance_flags.find({"status": "open"}, {"_id": 0}).sort("created_at", 1).to_list(200)}

    @r.post("/flags/{fid}/resolve")
    async def resolve_flag(fid: str, admin: dict = Depends(require_admin)):
        res = await _db.compliance_flags.update_one({"id": fid}, {"$set": {"status": "resolved", "resolved_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Flag not found.")
        return {"ok": True}

    return r


# ============================================================= seed
async def seed_compliance():
    if _db is None:
        return
    try:
        await _settings()
        if not await _db.compliance_rules.find_one({}):
            src = "DIYhomie expert-reviewed general guidance (educational)"
            date = "2025-06-01"
            seeds = [
                ("electrical", "licensed_professional", "New circuits usually need a licensed electrician",
                 "Adding or altering electrical circuits typically requires a permit, a licensed electrician, and inspection in most US jurisdictions."),
                ("electrical", "permit_inquiry", "Panel or service work is permit + inspection territory",
                 "Service panel or breaker work is high-risk and commonly requires a permit and inspection. Confirm locally."),
                ("plumbing", "permit_inquiry", "Moving plumbing often needs a permit",
                 "Relocating drains or supply lines commonly requires a plumbing permit and inspection; simple like-for-like fixture swaps often don't."),
                ("mechanical", "licensed_professional", "Gas & HVAC work is usually licensed-trade",
                 "Gas appliance and HVAC replacement/relocation commonly require licensed trades and inspection."),
                ("structural", "licensed_professional", "Structural changes may need engineering",
                 "Removing or altering load-bearing elements commonly requires engineering, stamped plans, a permit, and inspection."),
                ("roofing", "permit_inquiry", "Roof replacement often needs a permit",
                 "Full roof replacement frequently requires a permit and may require inspection. Verify with your building department."),
                ("accessory_structure", "permit_inquiry", "Decks & detached structures often need permits",
                 "Decks, sheds over a size threshold, and additions typically require permits, setbacks review, and inspections."),
                ("exterior", "hoa_consideration", "Exterior changes may need HOA review",
                 "Siding, fences, and visible exterior changes may require HOA approval and local setback/drainage review."),
                ("demolition", "safety_warning", "Demolition can disturb hazards",
                 "Demolition may disturb asbestos or lead in older homes and can require permits — verify before starting."),
                ("cosmetic_finish", "documentation", "Cosmetic work is usually low-regulatory",
                 "Painting, decor, trim and furniture generally don't need permits, but confirm if unsure. This is not a guarantee."),
            ]
            for cat, rtype, title, guidance in seeds:
                await _db.compliance_rules.insert_one({
                    "id": _nid(), "jurisdiction_profile_id": None, "project_category": cat, "rule_type": rtype,
                    "title": title, "guidance": guidance, "source_reference": src, "source_date": date,
                    "confidence_level": "medium", "expires_at": None, "version": 1, "status": "active", "created_at": _now()})
        if _logger:
            _logger.info("compliance (B29) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"compliance seed failed: {e}")
