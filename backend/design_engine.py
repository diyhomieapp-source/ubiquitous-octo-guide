"""
DIYhomie — Design System, Navigation & Accessibility Foundation (Build Blueprint 40).

Central governance surface for the platform-wide design language. Exposes:
  - A machine-readable catalog of DESIGN TOKENS (color, typography, spacing, elevation,
    radius, motion) so every client references one source of truth.
  - The canonical COMPONENT REGISTRY (reusable components + required states).
  - SAFETY UI STATUS definitions used consistently across Homie, Projects, AR, Maintenance,
    Professional handoff and Emergency Mode.
  - A DesignComponentVersion governance store with accessibility-review workflow.

Public namespace  /api/hi/design/*   (read-only tokens/registry for clients)
Admin namespace   /api/hi/admin/design/*   (governance CRUD)
Collection: design_components
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

# ---- Design tokens (single source of truth mirrored by frontend theme) ----
DESIGN_TOKENS = {
    "color": {
        "brandPrimary": "#FF5A00", "brandSecondary": "#E65100",
        "surface": "#121212", "surfaceSecondary": "#1C1C1E", "surfaceTertiary": "#2C2C2E",
        "onSurface": "#FFFFFF", "onSurfaceSecondary": "#E0E0E0", "onSurfaceTertiary": "#A0A0A5",
        "success": "#00E676", "warning": "#FFC400", "danger": "#FF3D00", "info": "#29B6F6",
        "border": "#2C2C2E", "borderStrong": "#4A4A4D",
        "safetySafe": "#00E676", "safetyVerify": "#FFC400", "safetyStop": "#FF6A00", "safetyEmergency": "#FF3D00",
    },
    "typography": {
        "display": {"family": "BebasNeue", "size": 32, "role": "Screen titles / hero numbers"},
        "heading": {"family": "DMSans-Bold", "size": 20, "role": "Section headers"},
        "body": {"family": "DMSans", "size": 14, "role": "Primary reading text"},
        "caption": {"family": "DMSans", "size": 12, "role": "Meta / secondary"},
        "button": {"family": "DMSans-Bold", "size": 14, "role": "Action labels"},
        "numeric": {"family": "BebasNeue", "size": 24, "role": "Measurements / stats"},
    },
    "spacing": {"xs": 4, "sm": 8, "md": 12, "lg": 16, "xl": 24, "2xl": 32, "3xl": 48},
    "radius": {"sm": 6, "md": 12, "lg": 20, "pill": 999},
    "elevation": {"flat": 0, "raised": 2, "modal": 8, "critical": 12},
    "motion": {"fast": 120, "standard": 240, "slow": 400, "reduced": 0},
}

SAFETY_STATUSES = [
    {"key": "safe", "label": "Safe to Continue", "icon": "check-circle-outline", "color": "#00E676",
     "tone": "informational", "blocks_monetization": False,
     "description": "Informational guidance. Normal DIY steps apply."},
    {"key": "verify", "label": "Verify First", "icon": "alert-outline", "color": "#FFC400",
     "tone": "amber", "blocks_monetization": False,
     "description": "Check a detail before continuing. Uses amber treatment plus clear text — never color alone."},
    {"key": "stop", "label": "Stop and Escalate", "icon": "hand-back-right-outline", "color": "#FF6A00",
     "tone": "high_visibility", "blocks_monetization": True,
     "description": "High-visibility warning with immediate action controls. Reaches a professional path."},
    {"key": "emergency", "label": "Emergency", "icon": "alarm-light-outline", "color": "#FF3D00",
     "tone": "full_screen", "blocks_monetization": True,
     "description": "Full-screen priority treatment. No promotional, rewards, subscription or affiliate content."},
]

# AI response is rendered as structured sections, never one large paragraph.
AI_RESPONSE_SECTIONS = ["summary", "safety_status", "confidence", "why_it_applies", "next_action",
                        "tools_materials", "source_basis", "stop_conditions", "follow_up", "escalation"]

REQUIRED_STATES = ["default", "disabled", "loading", "error", "accessibility_label"]

COMPONENT_REGISTRY = [
    {"key": "app_header", "label": "App Header", "category": "navigation"},
    {"key": "property_switcher", "label": "Property Switcher", "category": "navigation"},
    {"key": "bottom_navigation", "label": "Bottom Navigation", "category": "navigation"},
    {"key": "primary_button", "label": "Primary Action Button", "category": "action"},
    {"key": "secondary_button", "label": "Secondary Action Button", "category": "action"},
    {"key": "danger_button", "label": "Danger Action Button", "category": "action"},
    {"key": "safety_card", "label": "Safety Alert Card", "category": "safety"},
    {"key": "ai_response_card", "label": "AI Response Card", "category": "ai"},
    {"key": "source_reference_card", "label": "Source Reference Card", "category": "ai"},
    {"key": "confidence_label", "label": "Confidence Label", "category": "ai"},
    {"key": "project_progress", "label": "Project Progress Indicator", "category": "project"},
    {"key": "task_checklist_item", "label": "Task Checklist Item", "category": "project"},
    {"key": "room_card", "label": "Room Card", "category": "property"},
    {"key": "asset_card", "label": "Asset Card", "category": "property"},
    {"key": "document_card", "label": "Document Card", "category": "property"},
    {"key": "measurement_card", "label": "Measurement Card", "category": "property"},
    {"key": "recommendation_card", "label": "Recommendation Card", "category": "content"},
    {"key": "empty_state", "label": "Empty State", "category": "state"},
    {"key": "loading_state", "label": "Loading State", "category": "state"},
    {"key": "error_state", "label": "Error State", "category": "state"},
    {"key": "permission_panel", "label": "Permission Request Panel", "category": "system"},
    {"key": "confirmation_modal", "label": "Confirmation Modal", "category": "system"},
    {"key": "share_modal", "label": "Share Modal", "category": "system"},
    {"key": "toast", "label": "Toast / Notification", "category": "system"},
    {"key": "bottom_sheet", "label": "Bottom Sheet", "category": "system"},
    {"key": "data_table", "label": "Data Table (admin/pro)", "category": "admin"},
]

ACCESSIBILITY_REQUIREMENTS = [
    "WCAG-oriented contrast", "Dynamic text scaling", "Screen-reader labels", "Keyboard navigation (web)",
    "Visible focus states", "Captions for voice output", "Text alternative for avatar/AR", "Reduced-motion mode",
    "Non-color status indicators", "Minimum 44pt touch targets", "Plain-language error messages",
]

CONSUMER_NAV = [
    {"key": "home", "label": "Home", "children": ["Today's priorities", "Active project", "Maintenance", "Recent activity"]},
    {"key": "projects", "label": "Projects", "children": ["Active", "Planned", "Completed", "Templates"]},
    {"key": "homie", "label": "Homie", "children": ["Text", "Voice", "Image", "Avatar entry point"]},
    {"key": "my_home", "label": "My Home", "children": ["Rooms", "Assets", "Documents", "Measurements", "Inventory", "Maintenance", "Timeline"]},
    {"key": "profile", "label": "Profile", "children": ["Account", "Properties", "Rewards", "Subscription", "Preferences", "Support"]},
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


class ComponentReq(BaseModel):
    component_key: str
    version: str
    status: str = "draft"          # draft | approved | deprecated
    accessibility_review_status: str = "pending"  # pending | in_review | passed | failed
    owner: str = "design"
    notes: Optional[str] = None


class ComponentUpdateReq(BaseModel):
    status: Optional[str] = None
    accessibility_review_status: Optional[str] = None
    notes: Optional[str] = None


_STATUSES = {"draft", "approved", "deprecated"}
_A11Y = {"pending", "in_review", "passed", "failed"}
_SAFETY_KEYS = {"safety_card"}


def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api/hi/design")

    @r.get("/tokens")
    async def tokens():
        return {"tokens": DESIGN_TOKENS}

    @r.get("/foundation")
    async def foundation():
        return {
            "tokens": DESIGN_TOKENS,
            "safety_statuses": SAFETY_STATUSES,
            "ai_response_sections": AI_RESPONSE_SECTIONS,
            "component_registry": COMPONENT_REGISTRY,
            "required_states": REQUIRED_STATES,
            "accessibility_requirements": ACCESSIBILITY_REQUIREMENTS,
            "consumer_navigation": CONSUMER_NAV,
        }

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/design", dependencies=[Depends(require_admin)])

    @r.get("/overview")
    async def overview(admin: dict = Depends(require_admin)):
        comps = await _db.design_components.find({}, {"_id": 0}).to_list(1000)
        registered = {c["component_key"] for c in comps}
        coverage = round(100 * len(registered & {c["key"] for c in COMPONENT_REGISTRY}) / max(1, len(COMPONENT_REGISTRY)))
        return {
            "total_components": len(COMPONENT_REGISTRY),
            "registered_versions": len(comps),
            "coverage_pct": coverage,
            "approved": len([c for c in comps if c["status"] == "approved"]),
            "a11y_passed": len([c for c in comps if c["accessibility_review_status"] == "passed"]),
            "a11y_pending": len([c for c in comps if c["accessibility_review_status"] in ("pending", "in_review")]),
            "safety_statuses": len(SAFETY_STATUSES),
            "tokens_groups": list(DESIGN_TOKENS.keys()),
        }

    @r.get("/registry")
    async def registry(admin: dict = Depends(require_admin)):
        return {"registry": COMPONENT_REGISTRY, "required_states": REQUIRED_STATES,
                "safety_statuses": SAFETY_STATUSES, "consumer_navigation": CONSUMER_NAV,
                "accessibility_requirements": ACCESSIBILITY_REQUIREMENTS}

    @r.get("/components")
    async def list_components(admin: dict = Depends(require_admin)):
        rows = await _db.design_components.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return {"components": rows}

    @r.post("/components")
    async def create_component(req: ComponentReq, admin: dict = Depends(require_admin)):
        if req.component_key not in {c["key"] for c in COMPONENT_REGISTRY}:
            raise HTTPException(status_code=400, detail="Unknown component. New components must be added to the registry first.")
        if req.status not in _STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status.")
        if req.accessibility_review_status not in _A11Y:
            raise HTTPException(status_code=400, detail="Invalid accessibility status.")
        # Safety components require product+content approval => cannot be born approved.
        if req.component_key in _SAFETY_KEYS and req.status == "approved":
            raise HTTPException(status_code=400, detail="Safety components require product and content approval before they can be marked approved.")
        doc = {"id": _nid(), "component_key": req.component_key, "version": req.version, "status": req.status,
               "accessibility_review_status": req.accessibility_review_status, "owner": req.owner,
               "notes": req.notes, "created_at": _now(), "updated_at": _now()}
        await _db.design_components.insert_one(dict(doc)); doc.pop("_id", None)
        return {"component": doc}

    @r.put("/components/{cid}")
    async def update_component(cid: str, req: ComponentUpdateReq, admin: dict = Depends(require_admin)):
        cur = await _db.design_components.find_one({"id": cid}, {"_id": 0})
        if not cur:
            raise HTTPException(status_code=404, detail="Component version not found.")
        upd = {"updated_at": _now()}
        if req.status is not None:
            if req.status not in _STATUSES:
                raise HTTPException(status_code=400, detail="Invalid status.")
            # New/updated components require accessibility review before approval.
            if req.status == "approved":
                a11y = req.accessibility_review_status or cur["accessibility_review_status"]
                if a11y != "passed":
                    raise HTTPException(status_code=400, detail="Accessibility review must pass before a component can be approved.")
            upd["status"] = req.status
        if req.accessibility_review_status is not None:
            if req.accessibility_review_status not in _A11Y:
                raise HTTPException(status_code=400, detail="Invalid accessibility status.")
            upd["accessibility_review_status"] = req.accessibility_review_status
        if req.notes is not None:
            upd["notes"] = req.notes
        await _db.design_components.update_one({"id": cid}, {"$set": upd})
        return {"component": {**cur, **upd}}

    @r.delete("/components/{cid}")
    async def delete_component(cid: str, admin: dict = Depends(require_admin)):
        res = await _db.design_components.delete_one({"id": cid})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Component version not found.")
        return {"ok": True}

    return r


async def seed_design():
    if _db is None:
        return
    try:
        await _db.design_components.create_index("component_key")
        if await _db.design_components.count_documents({}) == 0:
            seeds = [
                {"component_key": "primary_button", "version": "1.0.0", "status": "approved", "accessibility_review_status": "passed", "owner": "design"},
                {"component_key": "safety_card", "version": "1.0.0", "status": "approved", "accessibility_review_status": "passed", "owner": "product+content"},
                {"component_key": "ai_response_card", "version": "1.0.0", "status": "approved", "accessibility_review_status": "passed", "owner": "design"},
                {"component_key": "empty_state", "version": "1.0.0", "status": "approved", "accessibility_review_status": "passed", "owner": "design"},
                {"component_key": "error_state", "version": "1.0.0", "status": "approved", "accessibility_review_status": "passed", "owner": "design"},
                {"component_key": "toast", "version": "0.9.0", "status": "draft", "accessibility_review_status": "in_review", "owner": "design"},
            ]
            for s in seeds:
                await _db.design_components.insert_one({"id": _nid(), **s, "notes": None, "created_at": _now(), "updated_at": _now()})
        if _logger:
            _logger.info("design system (B40) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"design seed failed: {e}")
