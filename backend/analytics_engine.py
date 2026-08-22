"""
DIYhomie — Product Analytics, Error Monitoring & Privacy-Safe Events (Build Blueprint 11).

PostHog for product analytics + feature flags (evaluated server-side) and Sentry
for error/performance monitoring. Both are OPTIONAL: with no keys present every
function is a safe no-op, and product events are still recorded to an internal,
privacy-safe collection so the Admin Analytics dashboard works out of the box.

Architecture: the client forwards approved events to the backend, which strips
disallowed data, honours the user's analytics opt-out (Blueprint 08 prefs), and
forwards to PostHog when a project token exists.

Collections: analytics_events, analytics_event_registry, feature_flag_registry,
release_records, error_incidents.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_app_version = "unknown"
_ph = None            # PostHog client (or None)
_sentry_on = False

# ---------------------------------------------------------------- event catalog
# feature_area, description, and the ONLY properties allowed for each event.
EVENT_CATALOG = [
    # account & onboarding
    ("welcome_viewed", "onboarding", "Welcome screen viewed", ["source"]),
    ("guest_session_started", "onboarding", "Guest session began", ["source"]),
    ("account_creation_started", "onboarding", "Signup started", ["source"]),
    ("account_created", "onboarding", "Account created", ["source", "referred"]),
    ("property_created", "onboarding", "Property added", ["property_type", "has_year_built"]),
    ("onboarding_completed", "onboarding", "Onboarding finished", ["progress"]),
    ("property_switched", "onboarding", "Active home switched", []),
    ("project_intent_captured", "onboarding", "Ask-Homie intent captured", ["need_type", "is_emergency"]),
    ("first_project_created", "onboarding", "First project created from intent", ["project_category", "source", "need_type"]),
    ("activation_completed", "onboarding", "User activated (first value action)", ["signals"]),
    ("new_homeowner_pathway_started", "onboarding", "New homeowner pathway started", []),
    ("accessibility_settings_updated", "onboarding", "Accessibility settings changed", ["language", "reading_level", "simplified_mode", "text_size", "voice_guidance", "high_contrast", "reduce_motion"]),
    # Homie AI
    ("homie_opened", "homie", "Homie chat opened", ["source"]),
    ("conversation_started", "homie", "New conversation", ["has_context"]),
    ("voice_input_used", "homie", "Voice input used", []),
    ("image_uploaded", "homie", "Photo attached to chat", ["has_identification"]),
    ("recommendation_shown", "homie", "Suggested action shown", ["action_type"]),
    ("recommendation_accepted", "homie", "Suggested action approved", ["action_type"]),
    ("safety_alert_shown", "homie", "Safety alert shown", ["risk_type", "risk_level", "source", "escalation_action_selected"]),
    # rooms & assets
    ("home_walkthrough_started", "rooms", "Room walkthrough started", ["source"]),
    ("room_capture_completed", "rooms", "Room captured", ["room_type"]),
    ("room_classification_confirmed", "rooms", "Room type confirmed", ["room_type"]),
    ("asset_created", "assets", "Asset added", ["category", "source"]),
    ("asset_document_uploaded", "assets", "Asset document uploaded", ["document_category", "file_type"]),
    # projects
    ("project_started", "projects", "Project started", ["project_category", "source", "has_room_context", "has_asset_context", "user_skill_level"]),
    ("project_plan_generated", "projects", "Plan generated", ["project_category", "risk_level", "step_count"]),
    ("project_step_completed", "projects", "Step completed", ["project_category", "step_index"]),
    ("project_paused", "projects", "Project paused", ["project_category"]),
    ("project_resumed", "projects", "Project resumed", ["project_category"]),
    ("project_completed", "projects", "Project completed", ["project_category", "estimated_duration_range", "completion_status", "has_completion_photo", "has_project_cost"]),
    ("project_escalated", "projects", "Escalated to pro", ["project_category", "risk_level"]),
    ("shopping_list_opened", "projects", "Shopping list opened", ["project_category", "item_count"]),
    # maintenance
    ("maintenance_task_created", "maintenance", "Task created", ["category", "priority", "frequency_type", "source"]),
    ("maintenance_suggestion_accepted", "maintenance", "Suggestion accepted", ["category"]),
    ("maintenance_task_completed", "maintenance", "Task completed", ["category", "has_cost"]),
    ("maintenance_task_rescheduled", "maintenance", "Task rescheduled", ["category"]),
    ("maintenance_reminder_opened", "maintenance", "Reminder opened", ["source"]),
    # documents & inventory
    ("document_upload_completed", "documents", "Document uploaded", ["document_category", "file_type", "processing_status", "has_asset_link", "has_project_link"]),
    ("document_linked", "documents", "Document linked", ["document_category", "link_type"]),
    ("inventory_item_added", "inventory", "Inventory item added", ["category", "source"]),
    ("project_inventory_match_confirmed", "inventory", "Inventory matched to project", ["updated"]),
    # monetization
    ("pricing_page_viewed", "monetization", "Plans/paywall viewed", ["source", "current_tier"]),
    ("upgrade_prompt_shown", "monetization", "Upgrade nudge shown", ["feature", "current_tier"]),
    ("checkout_started", "monetization", "Checkout started", ["tier"]),
    ("checkout_completed", "monetization", "Checkout completed", ["tier"]),
    ("subscription_activated", "monetization", "Subscription activated", ["tier", "is_trial"]),
    ("subscription_cancelled", "monetization", "Subscription cancelled", ["tier"]),
    ("trial_started", "monetization", "Pro trial started", ["tier"]),
    # professional escalation (Blueprint 12)
    ("professional_escalation_shown", "escalation", "Escalation screen shown", ["source", "risk_level"]),
    ("job_summary_started", "escalation", "Job summary started", ["source"]),
    ("job_summary_created", "escalation", "Job summary created", ["has_asset", "item_count"]),
    ("job_summary_downloaded", "escalation", "Job summary downloaded", []),
    ("job_summary_copied", "escalation", "Job summary copied", []),
    ("secure_share_link_created", "escalation", "Share link created", ["include_photos", "include_documents", "include_address"]),
    ("secure_share_link_opened", "escalation", "Share link opened", []),
    ("secure_share_link_revoked", "escalation", "Share link revoked", []),
    ("professional_job_status_changed", "escalation", "Job status changed", ["status"]),
    ("professional_job_completed", "escalation", "Job completed", ["had_professional"]),
    # community points & rewards (Blueprint 13)
    ("rewards_home_opened", "rewards", "Rewards home opened", ["source"]),
    ("referral_link_created", "rewards", "Referral link created", []),
    ("referral_registered", "rewards", "Referral registered", []),
    ("referral_verified", "rewards", "Referral verified", []),
    ("project_contribution_started", "rewards", "Contribution started", ["project_category"]),
    ("project_contribution_submitted", "rewards", "Contribution submitted", ["sharing_preference"]),
    ("project_contribution_approved", "rewards", "Contribution approved", []),
    ("feedback_submitted", "rewards", "Community feedback submitted", ["feedback_type"]),
    ("reward_event_created", "rewards", "Reward event created", ["event_type"]),
    ("points_awarded", "rewards", "Points awarded", ["event_type", "points"]),
    ("points_reversed", "rewards", "Points reversed", ["points"]),
    ("reward_account_restricted", "rewards", "Reward account restricted", []),
    # guided measurement (Blueprint 15)
    ("measurement_home_opened", "measurement", "Measure home opened", ["source"]),
    ("measurement_started", "measurement", "Measurement started", ["source"]),
    ("manual_measurement_created", "measurement", "Manual measurement created", ["measurement_type", "unit"]),
    ("camera_measurement_started", "measurement", "Camera estimate started", []),
    ("camera_measurement_saved", "measurement", "Camera estimate saved", ["measurement_type"]),
    ("measurement_confirmed", "measurement", "Measurement confirmed", []),
    ("measurement_edited", "measurement", "Measurement edited", []),
    ("measurement_linked_to_project", "measurement", "Measurement linked to project", []),
    ("measurement_request_completed", "measurement", "Measurement request completed", []),
    # project cleanup & disposal (Blueprint 16)
    ("cleanup_session_started", "cleanup", "Cleanup session started", []),
    ("leftover_material_added", "cleanup", "Leftover material added", ["material_category", "recommended_action"]),
    ("waste_item_added", "cleanup", "Waste item added", ["waste_category"]),
    ("waste_item_classified", "cleanup", "Waste item classified", ["risk_level"]),
    ("disposal_guidance_viewed", "cleanup", "Disposal guidance viewed", ["waste_category"]),
    ("material_moved_to_inventory", "cleanup", "Material moved to inventory", []),
    ("waste_item_marked_handled", "cleanup", "Waste item handled", []),
    ("cleanup_session_completed", "cleanup", "Cleanup session completed", ["unresolved_items"]),
    ("global_search_opened", "search", "Global search opened", ["surface"]),
    ("search_query_submitted", "search", "Search query submitted", ["result_count", "context_type"]),
    ("search_result_opened", "search", "Search result opened", ["entity_type"]),
    ("search_no_results", "search", "Search returned no results", ["context_type"]),
    ("homie_search_used", "search", "Homie conversational search used", ["result_count"]),
    ("search_filter_applied", "search", "Search filter applied", ["filter"]),
    ("support_opened", "support", "Support opened", ["surface"]),
    ("support_category_selected", "support", "Support category selected", ["category"]),
    ("support_ai_response_shown", "support", "Support AI response shown", ["matched"]),
    ("ticket_created", "support", "Support ticket created", ["category", "priority"]),
    ("ticket_resolved", "support", "Support ticket resolved", ["resolution_type"]),
    ("support_feedback_submitted", "support", "Support feedback submitted", ["rating"]),
    ("property_import_started", "import", "Property import started", ["import_type"]),
    ("property_import_completed", "import", "Property import completed", ["import_type", "evidence_count"]),
    ("property_import_reviewed", "import", "Property import reviewed", []),
    ("reconciliation_issue_shown", "import", "Reconciliation issue shown", ["issue_type"]),
    ("reconciliation_issue_resolved", "import", "Reconciliation issue resolved", ["status"]),
    ("external_property_source_connected", "import", "External property source connected", ["source_type"]),
    ("fund_this_project_opened", "funding", "Fund This Project opened", []),
    ("funding_goal_created", "funding", "Funding goal created", ["target"]),
    ("savings_scan_started", "funding", "Savings scan started", []),
    ("savings_scan_completed", "funding", "Savings scan completed", ["options"]),
    ("project_cost_reduced", "funding", "Project cost reduced", ["saving"]),
    ("reward_confirmed", "funding", "Savings reward confirmed", ["amount"]),
    ("project_funding_goal_reached", "funding", "Project funding goal reached", []),
    # Doc 47 — unified visual guidance runtime (anonymized product analytics; no camera footage)
    ("guidance.session.started", "guidance", "Guidance session started", ["procedure_id", "mode", "blocked"]),
    ("guidance.mode.selected", "guidance", "Guidance mode selected", ["mode", "procedure_id"]),
    ("procedure.step.presented", "guidance", "Procedure step presented", ["procedure_id", "step_index"]),
    ("procedure.step.replayed", "guidance", "Procedure step replayed", ["procedure_id", "step_id"]),
    ("procedure.step.slowed", "guidance", "Procedure step slowed", ["procedure_id", "step_id"]),
    ("target.detected", "guidance", "Target detected", ["procedure_id", "step_id"]),
    ("target.confirmed", "guidance", "Target confirmed", ["procedure_id", "step_id"]),
    ("target.lost", "guidance", "Target lost", ["procedure_id", "step_id"]),
    ("user.marked.complete", "guidance", "User marked step complete", ["procedure_id", "step_id"]),
    ("verification.passed", "guidance", "Verification passed", ["procedure_id", "step_id", "state"]),
    ("verification.needs_review", "guidance", "Verification needs review", ["procedure_id", "step_id", "state"]),
    ("user.requested.help", "guidance", "User requested help", ["procedure_id", "step_id"]),
    ("user.brought.in.pro", "guidance", "User brought in a pro", ["procedure_id"]),
    ("procedure.completed", "guidance", "Procedure completed", ["procedure_id", "mode"]),
    # Doc 48 — procedure packs, creator content & bring in a pro
    ("procedure.pack.selected", "pro_connect", "Procedure pack selected", ["procedure_id", "mode"]),
    ("professional.content.viewed", "pro_connect", "Professional content viewed", ["demo_id", "creator_id", "label"]),
    ("creator.followed", "pro_connect", "Creator followed", ["creator_id"]),
    ("professional.insight.opened", "pro_connect", "Professional insight opened", ["insight_id", "creator_id"]),
    ("bring_in_pro.opened", "pro_connect", "Bring in a Pro opened", ["procedure_id", "has_session"]),
    ("project_brief.generated", "pro_connect", "Project brief generated", ["procedure_id"]),
    ("professional_request.submitted", "pro_connect", "Professional request submitted", ["assistance_type", "has_pro"]),
    ("consultation_requested", "pro_connect", "Consultation requested", ["assistance_type"]),
    ("quote_requested", "pro_connect", "Quote requested", ["assistance_type"]),
    ("diy_pro_scope.updated", "pro_connect", "DIY/Pro scope updated", ["procedure_id", "selection", "pro_step_count"]),
    ("professional_request.completed", "pro_connect", "Professional request completed", ["assistance_type"]),
    # Doc 49 — active project workspace & adaptive daily guidance
    ("project.opened", "workspace", "Project workspace opened", ["project_id"]),
    ("project.briefing.viewed", "workspace", "Daily project briefing viewed", ["project_id", "style"]),
    ("project.problem.reported", "workspace", "Project problem reported", ["project_id", "problem_type", "route"]),
    ("materials.checked", "workspace", "Materials readiness checked", ["project_id", "ready"]),
    ("materials.missing", "workspace", "Materials missing", ["project_id", "missing_count"]),
    # Doc 52 — guided task execution & hands-free work mode
    ("guided_task_started", "guided", "Guided task started", ["project_id", "mode"]),
    ("guided_step_viewed", "guided", "Guided step viewed", ["project_id", "step_id"]),
    ("guided_step_replayed", "guided", "Guided step replayed", ["project_id"]),
    ("guided_step_slow_mode_used", "guided", "Guided slow mode used", ["project_id"]),
    ("guided_voice_mode_started", "guided", "Guided voice mode started", ["project_id"]),
    ("guided_ar_mode_started", "guided", "Guided AR mode started", ["project_id"]),
    ("guided_instruction_repeated", "guided", "Guided instruction repeated", ["project_id"]),
    ("guided_step_completed", "guided", "Guided step completed", ["project_id", "step_id"]),
    ("guided_step_failed", "guided", "Guided step needs another look", ["project_id", "step_id"]),
    ("guided_task_paused", "guided", "Guided task paused", ["project_id"]),
    ("guided_task_resumed", "guided", "Guided task resumed", ["project_id"]),
    ("guided_help_requested", "guided", "Guided help requested", ["project_id"]),
    ("guided_pro_requested", "guided", "Guided pro requested", ["project_id"]),
    ("guided_verification_completed", "guided", "Guided verification completed", ["project_id", "step_id", "method"]),
    # Doc 53 — AR scan, measurement & spatial targeting
    ("surface_detected", "spatial", "Surface detected", ["target_type"]),
    ("target_confirmed_pending", "spatial", "Target created pending confirmation", ["target_type"]),
    ("target_confirmed", "spatial", "Spatial target confirmed", ["target_type"]),
    ("target_rejected", "spatial", "Spatial target rejected", []),
    ("scan_deleted", "spatial", "Scan or target deleted", []),
    ("measurement_confirmed", "spatial", "Measurement confirmed", ["measurement_id"]),
    ("measurement_edited", "spatial", "Measurement edited", ["measurement_id"]),
    ("ar_guidance_requested", "spatial", "AR guidance preflight requested", ["ready"]),
    # Doc 54 — Homie conversation & contextual assistant
    ("homie_message_sent", "homie", "Homie message sent", ["intent", "from_voice"]),
    ("homie_intent_classified", "homie", "Homie intent classified", ["intent"]),
    ("homie_safety_response_shown", "homie", "Homie safety response shown", ["intent"]),
    ("homie_action_selected", "homie", "Homie action chip selected", ["action"]),
    # Doc 56 — safety, stop-work & escalation system
    ("safety_warning_shown", "safety_sys", "Safety warning shown", ["project_id", "risk_color", "tier"]),
    ("safety_warning_acknowledged", "safety_sys", "Safety warning acknowledged", ["project_id", "tier"]),
    ("safety_checkpoint_started", "safety_sys", "Safety checkpoint started", ["project_id", "checkpoint_type"]),
    ("safety_checkpoint_completed", "safety_sys", "Safety checkpoint completed", ["project_id", "checkpoint_type"]),
    ("safety_stop_triggered", "safety_sys", "Safety stop triggered", ["project_id"]),
    ("safety_override_requested", "safety_sys", "Safety override requested", ["project_id", "risk_color"]),
    ("safety_override_recorded", "safety_sys", "Safety override recorded", ["project_id", "risk_color"]),
    ("emergency_intent_detected", "safety_sys", "Emergency intent detected", ["category"]),
]
_APPROVED = {name: set(props) for name, _fa, _d, props in EVENT_CATALOG}
_FEATURE_AREA = {name: fa for name, fa, _d, _p in EVENT_CATALOG}

# Global always-safe envelope properties (in addition to per-event approved set).
_SAFE_ENVELOPE = {"app_version", "platform", "source"}

# feature flags: key, description, owner, default_value, rollout_status, rollback_notes
FLAG_CATALOG = [
    ("voice_input", "Voice input for Homie chat", "product", False, "beta", "Disable flag; text input unaffected."),
    ("photo_identification", "AI photo identification", "product", True, "ga", "Disable flag; users add items manually."),
    ("document_extraction", "AI document text extraction", "product", True, "ga", "Disable flag; documents still stored, no auto-extract."),
    ("room_walkthrough", "Guided room walkthrough capture", "product", True, "ga", "Disable flag; single-room capture remains."),
    ("maintenance_suggestions", "AI maintenance suggestions", "product", True, "ga", "Disable flag; manual scheduling remains."),
    ("subscription_checkout", "Stripe checkout / paywall", "growth", True, "ga", "Disable flag; app stays on free tier."),
    ("new_project_templates", "New project templates", "product", False, "beta", "Disable flag; classic planner remains."),
    ("new_ai_models", "New AI models / workflows", "ai", False, "beta", "Disable flag; revert to current model."),
]

# ---------------------------------------------------------------- severity
SEVERITY = ["critical", "high", "medium", "low"]
_SEVERITY_MAP = {
    "app_unavailable": "critical", "auth_mass_failure": "critical", "data_loss": "critical",
    "billing_access": "critical", "safety_flow": "critical",
    "project_create": "high", "document_upload": "high", "ai_unavailable": "high", "entitlement_mismatch": "high",
    "partial_feature": "medium", "perf_degradation": "medium", "integration": "medium",
    "visual": "low", "ui_nonblocking": "low",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


# ================================================================ init
def configure(db, logger, app_version: str = "unknown"):
    global _db, _logger, _app_version, _ph
    _db, _logger, _app_version = db, logger, app_version or "unknown"
    token = os.getenv("POSTHOG_PROJECT_TOKEN")
    host = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")
    if token:
        try:
            from posthog import Posthog
            _ph = Posthog(token, host=host, disabled=False, flush_at=20)
            logger.info("PostHog analytics enabled")
        except Exception as e:
            logger.warning(f"PostHog init failed (running without): {e}")
            _ph = None
    else:
        _ph = None


def init_sentry():
    """Guarded Sentry init for the FastAPI process. No-op without a DSN."""
    global _sentry_on
    dsn = os.getenv("SENTRY_BACKEND_DSN")
    if not dsn:
        return
    try:
        import sentry_sdk

        def _redact(event, _hint):
            req = event.get("request") or {}
            req.pop("data", None)
            headers = req.get("headers") or {}
            for k in list(headers):
                if k.lower() in {"authorization", "cookie", "x-api-key"}:
                    headers.pop(k, None)
            event["request"] = req
            return event

        sentry_sdk.init(
            dsn=dsn,
            release=os.getenv("APP_RELEASE", f"diyhomie-backend@{_app_version}"),
            environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            send_default_pii=False,
            before_send=_redact,
        )
        _sentry_on = True
        if _logger:
            _logger.info("Sentry error monitoring enabled")
    except Exception as e:
        if _logger:
            _logger.warning(f"Sentry init failed (running without): {e}")


def report_error(exc: Exception, feature_area: str = "backend", kind: str = "integration", context: Optional[dict] = None):
    """Send an exception to Sentry with privacy-safe tags. No-op without Sentry."""
    if not _sentry_on:
        return
    try:
        import sentry_sdk
        with sentry_sdk.push_scope() as scope:
            scope.set_tag("feature_area", feature_area)
            scope.set_tag("severity", _SEVERITY_MAP.get(kind, "medium"))
            for k, v in (context or {}).items():
                scope.set_tag(k, str(v)[:80])
            sentry_sdk.capture_exception(exc)
    except Exception:
        pass


# ================================================================ capture
async def _opted_out(user_id: str) -> bool:
    if not user_id:
        return False
    p = await _db.hi_user_prefs.find_one({"user_id": user_id}, {"_id": 0, "analytics_opt_out": 1})
    return bool(p and p.get("analytics_opt_out"))


ESSENTIAL = {"account_created", "subscription_activated", "checkout_completed", "safety_alert_shown"}


def _filter_props(event: str, props: dict) -> dict:
    """Keep only registry-approved + safe-envelope keys. Everything else dropped."""
    allowed = _APPROVED.get(event, set()) | _SAFE_ENVELOPE
    out = {}
    for k, v in (props or {}).items():
        if k not in allowed:
            continue
        if isinstance(v, str) and len(v) > 120:
            continue  # defensive: never let long free-text through
        out[k] = v
    return out


async def capture(user: Optional[dict], event: str, properties: Optional[dict] = None,
                  guest_session_id: Optional[str] = None, app_version: Optional[str] = None,
                  platform: Optional[str] = None, property_id: Optional[str] = None):
    """Record a privacy-safe product event (internal + PostHog). Never raises."""
    try:
        if event not in _APPROVED:
            return  # unregistered events are ignored (schema is the contract)
        user_id = (user or {}).get("id") if user else None
        # opt-out: only essential ops/security events for opted-out users
        if user_id and event not in ESSENTIAL and await _opted_out(user_id):
            return
        props = _filter_props(event, properties or {})
        props.setdefault("app_version", app_version or _app_version)
        if platform:
            props.setdefault("platform", platform)
        distinct = user_id or guest_session_id or "anonymous"
        doc = {"id": _new_id(), "event_name": event, "feature_area": _FEATURE_AREA.get(event, "unknown"),
               "user_id": user_id, "guest_session_id": guest_session_id, "property_id": property_id,
               "properties": props, "app_version": props.get("app_version"),
               "platform": platform, "at": _now()}
        await _db.analytics_events.insert_one(dict(doc))
        if _ph:
            try:
                _ph.capture(distinct_id=distinct, event=event, properties={**props, "feature_area": doc["feature_area"]})
            except Exception:
                pass
    except Exception as e:
        if _logger:
            _logger.warning(f"analytics capture failed [{event}]: {e}")


async def identify(user: dict):
    """Set privacy-safe PostHog user properties (no personal-property content)."""
    if not _ph or not user:
        return
    try:
        uid = user["id"]
        prefs = await _db.hi_user_prefs.find_one({"user_id": uid}, {"_id": 0}) or {}
        props = {
            "subscription_plan": user.get("subscription_tier", "free"),
            "account_status": user.get("subscription_status", "none"),
            "diy_experience_level": prefs.get("experience_level"),
            "preferred_interaction": prefs.get("tone"),
            "onboarding_completed": bool(prefs.get("onboarding_complete")),
            "property_count": await _db.hi_properties.count_documents({"user_id": uid}),
            "active_project_count": await _db.hi_projects.count_documents({"user_id": uid, "status": {"$in": ["active", "draft"]}}),
            "completed_project_count": await _db.hi_projects.count_documents({"user_id": uid, "status": "completed"}),
            "room_count": await _db.hi_rooms.count_documents({"user_id": uid}),
            "asset_count": await _db.hi_assets.count_documents({"user_id": uid}),
            "created_at": user.get("created_at"),
        }
        _ph.set(distinct_id=uid, properties={k: v for k, v in props.items() if v is not None})
    except Exception:
        pass


# ================================================================ feature flags
async def get_flags(user: Optional[dict]) -> dict:
    """Resolve flags from the registry defaults, overlaid with PostHog when enabled."""
    reg = await _db.feature_flag_registry.find({}, {"_id": 0, "feature_key": 1, "default_value": 1}).to_list(100)
    flags = {r["feature_key"]: bool(r.get("default_value")) for r in reg}
    if _ph and user:
        try:
            for k in list(flags.keys()):
                v = _ph.feature_enabled(k, user["id"])
                if v is not None:
                    flags[k] = bool(v)
        except Exception:
            pass
    return flags


# ================================================================ seeds
async def seed():
    for name, fa, desc, props in EVENT_CATALOG:
        await _db.analytics_event_registry.update_one(
            {"event_name": name},
            {"$set": {"event_name": name, "feature_area": fa, "description": desc,
                      "approved_properties": props, "owner": "product", "status": "active",
                      "updated_at": _now()},
             "$setOnInsert": {"id": _new_id(), "created_at": _now()}},
            upsert=True)
    for key, desc, owner, default, status, rollback in FLAG_CATALOG:
        await _db.feature_flag_registry.update_one(
            {"feature_key": key},
            {"$setOnInsert": {"id": _new_id(), "feature_key": key, "description": desc, "owner": owner,
                              "default_value": default, "rollout_status": status, "rollback_notes": rollback,
                              "created_at": _now(), "updated_at": _now()}},
            upsert=True)
    if not await _db.release_records.find_one({}):
        await _db.release_records.insert_one({
            "id": _new_id(), "version": _app_version, "environment": os.getenv("SENTRY_ENVIRONMENT", "production"),
            "deployed_at": _now(), "deployed_by": "system", "release_notes": "Blueprint 11 baseline",
            "status": "active", "created_at": _now()})
    if _logger:
        _logger.info("analytics (B11) seeded")


# ================================================================ models
class TrackReq(BaseModel):
    event: str
    properties: Optional[dict] = None
    guest_session_id: Optional[str] = None
    app_version: Optional[str] = None
    platform: Optional[str] = None


class OptOutReq(BaseModel):
    opt_out: bool


class FlagUpdateReq(BaseModel):
    default_value: Optional[bool] = None
    rollout_status: Optional[str] = None
    rollback_notes: Optional[str] = None
    owner: Optional[str] = None


class ReleaseReq(BaseModel):
    version: str
    environment: str = "production"
    release_notes: Optional[str] = None


class IncidentReq(BaseModel):
    sentry_issue_id: Optional[str] = None
    severity: str
    feature_area: str
    release_record_id: Optional[str] = None


class IncidentUpdateReq(BaseModel):
    status: Optional[str] = None  # open | investigating | resolved
    severity: Optional[str] = None


# ================================================================ routers
def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/analytics", dependencies=[Depends(get_current_user)])

    @r.post("/track")
    async def track(req: TrackReq, user: dict = Depends(get_current_user)):
        await capture(user, req.event, req.properties, guest_session_id=req.guest_session_id,
                      app_version=req.app_version, platform=req.platform)
        return {"ok": True}

    @r.get("/flags")
    async def flags(user: dict = Depends(get_current_user)):
        return {"flags": await get_flags(user)}

    @r.get("/config")
    async def config(user: dict = Depends(get_current_user)):
        prefs = await _db.hi_user_prefs.find_one({"user_id": user["id"]}, {"_id": 0, "analytics_opt_out": 1}) or {}
        return {"posthog_enabled": bool(_ph), "sentry_enabled": _sentry_on,
                "app_version": _app_version, "opt_out": bool(prefs.get("analytics_opt_out"))}

    @r.get("/opt-out")
    async def get_opt_out(user: dict = Depends(get_current_user)):
        prefs = await _db.hi_user_prefs.find_one({"user_id": user["id"]}, {"_id": 0, "analytics_opt_out": 1}) or {}
        return {"opt_out": bool(prefs.get("analytics_opt_out"))}

    @r.put("/opt-out")
    async def set_opt_out(req: OptOutReq, user: dict = Depends(get_current_user)):
        await _db.hi_user_prefs.update_one({"user_id": user["id"]},
                                           {"$set": {"analytics_opt_out": bool(req.opt_out), "updated_at": _now()}},
                                           upsert=True)
        return {"ok": True, "opt_out": bool(req.opt_out)}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/analytics", dependencies=[Depends(require_admin)])

    @r.get("/summary")
    async def summary(admin: dict = Depends(require_admin)):
        now = datetime.now(timezone.utc)
        day_ago = (now - timedelta(days=1)).isoformat()
        week_ago = (now - timedelta(days=7)).isoformat()
        dau = len(await _db.analytics_events.distinct("user_id", {"at": {"$gte": day_ago}, "user_id": {"$ne": None}}))
        new_accounts = await _db.users.count_documents({"created_at": {"$gte": week_ago}})
        total_prefs = await _db.hi_user_prefs.count_documents({})
        onboarded = await _db.hi_user_prefs.count_documents({"onboarding_complete": True})
        projects_started = await _db.hi_projects.count_documents({})
        projects_completed = await _db.hi_projects.count_documents({"status": "completed"})
        maintenance_completed = await _db.hi_maintenance_occurrences.count_documents({"status": "completed"})
        document_uploads = await _db.hi_documents.count_documents({})
        paid_users = await _db.users.count_documents({"subscription_tier": {"$nin": ["free", None]}})
        checkouts = await _db.payment_transactions.count_documents({"fulfilled": True})
        # top errors (open incidents grouped by feature_area)
        incidents = await _db.error_incidents.find({"status": {"$ne": "resolved"}}, {"_id": 0}).to_list(200)
        top_errors = {}
        for i in incidents:
            k = f"{i.get('feature_area', 'unknown')} · {i.get('severity', 'medium')}"
            top_errors[k] = top_errors.get(k, 0) + 1
        top_errors = [{"label": k, "count": v} for k, v in sorted(top_errors.items(), key=lambda x: -x[1])][:8]
        releases = await _db.release_records.find({}, {"_id": 0}).sort("created_at", -1).to_list(5)
        return {
            "generated_at": _now(),
            "integrations": {"posthog": bool(_ph), "sentry": _sentry_on},
            "usage": {"dau": dau, "new_accounts_7d": new_accounts,
                      "onboarding_completion_pct": round(onboarded / total_prefs * 100) if total_prefs else 0},
            "projects": {"started": projects_started, "completed": projects_completed},
            "maintenance": {"completed": maintenance_completed},
            "documents": {"uploads": document_uploads},
            "subscriptions": {"paid_users": paid_users, "checkouts_completed": checkouts},
            "top_errors": top_errors,
            "releases": releases,
        }

    @r.get("/events")
    async def event_registry(admin: dict = Depends(require_admin)):
        rows = await _db.analytics_event_registry.find({}, {"_id": 0}).sort("feature_area", 1).to_list(300)
        return {"events": rows, "count": len(rows)}

    @r.get("/flags")
    async def list_flags(admin: dict = Depends(require_admin)):
        rows = await _db.feature_flag_registry.find({}, {"_id": 0}).sort("feature_key", 1).to_list(100)
        return {"flags": rows}

    @r.post("/flags/{key}/toggle")
    async def toggle_flag(key: str, admin: dict = Depends(require_admin)):
        f = await _db.feature_flag_registry.find_one({"feature_key": key}, {"_id": 0})
        if not f:
            raise HTTPException(status_code=404, detail="Flag not found.")
        newv = not bool(f.get("default_value"))
        await _db.feature_flag_registry.update_one({"feature_key": key}, {"$set": {"default_value": newv, "updated_at": _now()}})
        return {"ok": True, "feature_key": key, "default_value": newv}

    @r.put("/flags/{key}")
    async def update_flag(key: str, req: FlagUpdateReq, admin: dict = Depends(require_admin)):
        upd = {"updated_at": _now()}
        for fld in ("default_value", "rollout_status", "rollback_notes", "owner"):
            v = getattr(req, fld)
            if v is not None:
                upd[fld] = v
        res = await _db.feature_flag_registry.update_one({"feature_key": key}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Flag not found.")
        return await _db.feature_flag_registry.find_one({"feature_key": key}, {"_id": 0})

    @r.get("/releases")
    async def list_releases(admin: dict = Depends(require_admin)):
        rows = await _db.release_records.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)
        return {"releases": rows}

    @r.post("/releases")
    async def create_release(req: ReleaseReq, admin: dict = Depends(require_admin)):
        doc = {"id": _new_id(), "version": req.version, "environment": req.environment,
               "deployed_at": _now(), "deployed_by": admin.get("email", "admin"),
               "release_notes": req.release_notes, "status": "active", "created_at": _now()}
        await _db.release_records.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.post("/releases/{rid}/rollback")
    async def rollback_release(rid: str, admin: dict = Depends(require_admin)):
        res = await _db.release_records.update_one({"id": rid}, {"$set": {"status": "rolled_back", "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Release not found.")
        return {"ok": True}

    @r.get("/incidents")
    async def list_incidents(status: Optional[str] = None, admin: dict = Depends(require_admin)):
        q = {} if not status else {"status": status}
        rows = await _db.error_incidents.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"incidents": rows}

    @r.post("/incidents")
    async def create_incident(req: IncidentReq, admin: dict = Depends(require_admin)):
        if req.severity not in SEVERITY:
            raise HTTPException(status_code=400, detail="Invalid severity.")
        doc = {"id": _new_id(), "sentry_issue_id": req.sentry_issue_id, "severity": req.severity,
               "feature_area": req.feature_area, "status": "open", "release_record_id": req.release_record_id,
               "created_at": _now(), "resolved_at": None}
        await _db.error_incidents.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.put("/incidents/{iid}")
    async def update_incident(iid: str, req: IncidentUpdateReq, admin: dict = Depends(require_admin)):
        upd = {"updated_at": _now()}
        if req.severity:
            if req.severity not in SEVERITY:
                raise HTTPException(status_code=400, detail="Invalid severity.")
            upd["severity"] = req.severity
        if req.status:
            if req.status not in ("open", "investigating", "resolved"):
                raise HTTPException(status_code=400, detail="Invalid status.")
            upd["status"] = req.status
            upd["resolved_at"] = _now() if req.status == "resolved" else None
        res = await _db.error_incidents.update_one({"id": iid}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Incident not found.")
        return await _db.error_incidents.find_one({"id": iid}, {"_id": 0})

    return r
