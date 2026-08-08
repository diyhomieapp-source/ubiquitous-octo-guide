"""
DIYhomie — Product Recommendation, Partner Routing & Affiliate Attribution Engine (Blueprint 23).

Helps users find the right tool/material/service for a real need (project, asset, task) while
staying PROJECT-FIRST, not shopping-first. DIYhomie NEVER processes retail payments or holds
funds — it hands off to an external partner and tracks attribution only when a partner confirms.

Ranking priority (safety/compatibility ALWAYS outrank commission):
  1 safety & compatibility  2 project suitability  3 availability  4 value  5 partner reliability
  6 affiliate economics (lowest weight)

Disclosure is mandatory + visible before any external handoff when a commission may apply.

Collections: rec_partners, rec_catalog_items, rec_compat_rules, product_needs,
product_recommendations, affiliate_clicks, partner_conversions, rec_config.
"""
import secrets
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

PARTNER_TYPES = ["retailer", "affiliate_network", "manufacturer", "rental", "service_referral"]
INTEGRATION_TYPES = ["api", "feed", "deep_link", "manual_catalog"]
COMPAT = ["compatible", "likely_compatible", "needs_verification", "incompatible"]
DEFAULT_DISCLOSURE = ("DIYhomie may earn a commission if you purchase through this link. "
                      "This does not change your price unless stated otherwise.")
DEFAULT_WEIGHTS = {"safety": 0.40, "suitability": 0.25, "availability": 0.15,
                   "value": 0.10, "partner_reliability": 0.07, "affiliate": 0.03}


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
        sentry_sdk.capture_message(f"[rec:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _config() -> dict:
    c = await _db.rec_config.find_one({"id": "singleton"}, {"_id": 0})
    if not c:
        c = {"id": "singleton", "weights": dict(DEFAULT_WEIGHTS),
             "disabled_categories": [], "updated_at": _now()}
        await _db.rec_config.insert_one(dict(c))
        c.pop("_id", None)
    return c


# ------------------------------------------------------------- seeding
SEED_PARTNERS = [
    {"key": "homefix_retail", "name": "HomeFix (Affiliate Retailer)", "partner_type": "affiliate_network",
     "integration_type": "deep_link", "has_commission": True, "reliability_score": 88,
     "disclosure_text": DEFAULT_DISCLOSURE, "link_format": "https://partner.example.com/p/{external_product_id}?ref=diyhomie",
     "tracking_configured": True, "geographic_coverage": "US"},
    {"key": "acme_mfg", "name": "Acme Manufacturer (Direct)", "partner_type": "manufacturer",
     "integration_type": "manual_catalog", "has_commission": False, "reliability_score": 95,
     "disclosure_text": None, "link_format": "https://acme.example.com/item/{external_product_id}",
     "tracking_configured": True, "geographic_coverage": "US"},
]
SEED_ITEMS = [
    {"partner": "homefix_retail", "external_product_id": "roller-9in", "title": "9\" Paint Roller Kit",
     "category": "paint_roller", "specifications": {"size": "9in", "nap": "3/8in"}, "availability_status": "in_stock",
     "price_reference": "$14.99", "price_verified": True},
    {"partner": "homefix_retail", "external_product_id": "latex-white-1g", "title": "Premium Interior Latex Paint (White, 1gal)",
     "category": "interior_paint", "specifications": {"finish": "eggshell", "base": "latex", "volume": "1gal"},
     "availability_status": "in_stock", "price_reference": "$32.00", "price_verified": True},
    {"partner": "acme_mfg", "external_product_id": "filter-16x25x1", "title": "HVAC Filter 16x25x1 MERV 11",
     "category": "hvac_filter", "specifications": {"size": "16x25x1", "merv": "11"}, "availability_status": "unknown",
     "price_reference": None, "price_verified": False},
]
SEED_RULES = [
    {"category": "hvac_filter", "rule_type": "verification_required", "condition_key": "size",
     "explanation": "Confirm the exact filter size (e.g. 16x25x1) printed on your old filter before buying."},
    {"category": "interior_paint", "rule_type": "warning", "condition_key": "ventilation",
     "explanation": "Ensure good ventilation while painting; some paints release fumes."},
]


async def seed_recommendations():
    if _db is None:
        return
    try:
        if await _db.rec_partners.find_one({"connector_key": "homefix_retail"}) or await _db.rec_partners.find_one({"key": "homefix_retail"}):
            return
        pmap = {}
        for p in SEED_PARTNERS:
            pid = _nid()
            pmap[p["key"]] = pid
            await _db.rec_partners.insert_one({
                "id": pid, "key": p["key"], "name": p["name"], "partner_type": p["partner_type"],
                "status": "active", "integration_type": p["integration_type"], "has_commission": p["has_commission"],
                "reliability_score": p["reliability_score"], "disclosure_text": p["disclosure_text"],
                "link_format": p["link_format"], "tracking_configured": p["tracking_configured"],
                "geographic_coverage": p["geographic_coverage"], "created_at": _now(), "updated_at": _now()})
        for it in SEED_ITEMS:
            await _db.rec_catalog_items.insert_one({
                "id": _nid(), "partner_id": pmap[it["partner"]], "external_product_id": it["external_product_id"],
                "title": it["title"], "category": it["category"], "specifications": it["specifications"],
                "product_url": None, "image_url": None, "availability_status": it["availability_status"],
                "price_reference": it["price_reference"], "price_verified": it["price_verified"],
                "price_checked_at": _now() if it["price_verified"] else None, "status": "active", "updated_at": _now()})
        for rl in SEED_RULES:
            await _db.rec_compat_rules.insert_one({
                "id": _nid(), "category": rl["category"], "rule_type": rl["rule_type"],
                "condition_key": rl["condition_key"], "explanation": rl["explanation"],
                "status": "active", "created_at": _now()})
    except Exception as e:
        if _logger:
            _logger.error(f"recommendation seed failed: {e}")


# ------------------------------------------------------------- core recommend
def _compat_and_score(item: dict, partner: dict, need_specs: dict, safety_critical: bool, rules: list, weights: dict):
    need_specs = need_specs or {}
    item_specs = item.get("specifications") or {}
    # spec overlap → suitability
    matched = sum(1 for k, v in need_specs.items() if str(item_specs.get(k, "")).lower() == str(v).lower())
    suitability = matched / max(len(need_specs), 1) if need_specs else 0.6
    # compatibility status
    verification_needed = [r for r in rules if r["rule_type"] == "verification_required" and not need_specs.get(r["condition_key"])]
    warnings = [r["explanation"] for r in rules if r["rule_type"] == "warning"]
    if need_specs and suitability >= 0.999:
        status = "compatible"
    elif verification_needed or (safety_critical and suitability < 0.999):
        status = "needs_verification"
    elif suitability >= 0.5:
        status = "likely_compatible"
    else:
        status = "needs_verification"
    verify_note = verification_needed[0]["explanation"] if verification_needed else None
    # component scores
    safety = 1.0 if status == "compatible" else (0.8 if status == "likely_compatible" else 0.5)
    avail = 1.0 if item.get("availability_status") == "in_stock" else 0.6
    value = 0.7 if item.get("price_verified") else 0.5
    reliab = (partner.get("reliability_score", 70)) / 100.0
    affiliate = 0.5 if partner.get("has_commission") else 0.0
    score = (weights["safety"] * safety + weights["suitability"] * suitability +
             weights["availability"] * avail + weights["value"] * value +
             weights["partner_reliability"] * reliab + weights["affiliate"] * affiliate)
    return status, round(score, 4), verify_note, warnings


async def _generate(need: dict, weights: dict) -> list:
    cfg = await _config()
    if need["category"] in cfg.get("disabled_categories", []):
        return []
    items = await _db.rec_catalog_items.find({"category": need["category"], "status": "active"}, {"_id": 0}).to_list(100)
    rules = await _db.rec_compat_rules.find({"category": need["category"], "status": "active"}, {"_id": 0}).to_list(50)
    recs = []
    for it in items:
        partner = await _db.rec_partners.find_one({"id": it["partner_id"], "status": "active"}, {"_id": 0})
        if not partner:
            continue
        status, score, verify_note, warnings = _compat_and_score(
            it, partner, need.get("required_specifications"), need.get("safety_critical", False), rules, weights)
        if status == "incompatible":
            continue
        rec = {"id": _nid(), "product_need_id": need["id"], "partner_catalog_item_id": it["id"],
               "partner_id": partner["id"], "compatibility_status": status, "ranking_score": score,
               "recommendation_reason": f"Matches your {need['category'].replace('_', ' ')} need.",
               "verify_note": verify_note, "safety_warning": warnings[0] if warnings else None,
               "disclosure_required": bool(partner.get("has_commission")),
               "disclosure_text": partner.get("disclosure_text") if partner.get("has_commission") else None,
               "status": "active", "created_at": _now(),
               # denormalized display fields
               "title": it["title"], "partner_name": partner["name"],
               "price_reference": it.get("price_reference") if it.get("price_verified") else None,
               "availability_status": it.get("availability_status")}
        await _db.product_recommendations.insert_one(dict(rec))
        rec.pop("_id", None)
        recs.append(rec)
    # SAFETY-FIRST ordering: compatibility rank then score (affiliate can never jump the queue)
    order = {"compatible": 0, "likely_compatible": 1, "needs_verification": 2}
    recs.sort(key=lambda r: (order.get(r["compatibility_status"], 3), -r["ranking_score"]))
    return recs


# ============================================================= models
class NeedReq(BaseModel):
    category: str
    required_specifications: Optional[dict] = None
    quantity: Optional[float] = None
    urgency: str = "normal"
    safety_critical: bool = False
    source: str = "manual_entry"
    project_id: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None


class ActionReq(BaseModel):
    action: str  # save | dismiss | already_have | not_relevant | report_mismatch
    note: Optional[str] = None


class PartnerReq(BaseModel):
    name: str
    partner_type: str = "retailer"
    integration_type: str = "deep_link"
    disclosure_text: Optional[str] = None
    link_format: Optional[str] = None
    reliability_score: int = 70
    has_commission: bool = False
    tracking_configured: bool = False


class ConversionReq(BaseModel):
    partner_id: str
    affiliate_click_id: Optional[str] = None
    partner_transaction_reference: str
    conversion_type: str = "purchase"
    commission_amount: Optional[float] = None
    currency: Optional[str] = "USD"


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/rec", dependencies=[Depends(get_current_user)])

    @r.post("/needs")
    async def create_need(req: NeedReq, user: dict = Depends(get_current_user)):
        need = {"id": _nid(), "user_id": user["id"], "property_id": None, "room_id": req.room_id,
                "asset_id": req.asset_id, "project_id": req.project_id, "source": req.source,
                "category": req.category, "required_specifications": req.required_specifications or {},
                "quantity": req.quantity, "urgency": req.urgency, "safety_critical": req.safety_critical,
                "created_at": _now()}
        await _db.product_needs.insert_one(dict(need))
        need.pop("_id", None)
        cfg = await _config()
        recs = await _generate(need, cfg["weights"])
        await _cap(user, "product_need_created", {"category": req.category})
        if recs:
            await _cap(user, "recommendation_shown", {"count": len(recs)})
        return {"need": need, "recommendations": recs,
                "fallback": len(recs) == 0}

    @r.get("/needs/{nid}/recommendations")
    async def get_recs(nid: str, user: dict = Depends(get_current_user)):
        need = await _db.product_needs.find_one({"id": nid, "user_id": user["id"]}, {"_id": 0})
        if not need:
            raise HTTPException(status_code=404, detail="Need not found.")
        recs = await _db.product_recommendations.find({"product_need_id": nid, "status": {"$ne": "dismissed"}}, {"_id": 0}).to_list(50)
        order = {"compatible": 0, "likely_compatible": 1, "needs_verification": 2}
        recs.sort(key=lambda x: (order.get(x["compatibility_status"], 3), -x["ranking_score"]))
        return {"need": need, "recommendations": recs}

    @r.post("/recommendations/{rid}/action")
    async def rec_action(rid: str, req: ActionReq, user: dict = Depends(get_current_user)):
        rec = await _db.product_recommendations.find_one({"id": rid}, {"_id": 0})
        if not rec:
            raise HTTPException(status_code=404, detail="Recommendation not found.")
        status_map = {"save": "selected", "dismiss": "dismissed", "already_have": "dismissed",
                      "not_relevant": "dismissed", "report_mismatch": "hidden"}
        if req.action not in status_map:
            raise HTTPException(status_code=400, detail="Invalid action.")
        upd = {"status": status_map[req.action]}
        if req.action == "report_mismatch":
            upd["reported_mismatch"] = {"note": (req.note or "")[:300], "at": _now(), "by": user["id"]}
        await _db.product_recommendations.update_one({"id": rid}, {"$set": upd})
        ev = {"save": "recommendation_saved", "dismiss": "recommendation_dismissed",
              "report_mismatch": "incorrect_match_reported"}.get(req.action, "recommendation_dismissed")
        await _cap(user, ev, {})
        return {"ok": True, "status": upd["status"]}

    @r.post("/recommendations/{rid}/click")
    async def click(rid: str, user: dict = Depends(get_current_user)):
        """Outbound handoff. Creates an AffiliateClick + returns the external link + disclosure.
        NEVER claims a purchase and NEVER collects payment credentials."""
        rec = await _db.product_recommendations.find_one({"id": rid}, {"_id": 0})
        if not rec:
            raise HTTPException(status_code=404, detail="Recommendation not found.")
        partner = await _db.rec_partners.find_one({"id": rec["partner_id"]}, {"_id": 0})
        item = await _db.rec_catalog_items.find_one({"id": rec["partner_catalog_item_id"]}, {"_id": 0})
        if not partner or partner["status"] != "active" or not partner.get("tracking_configured"):
            _sentry("affiliate_redirect_failure", f"partner unavailable for rec {rid}")
            raise HTTPException(status_code=503, detail="This partner link is temporarily unavailable. You can still use the product details to shop elsewhere.")
        tracking = secrets.token_urlsafe(12)
        url = (partner.get("link_format") or "{external_product_id}").replace("{external_product_id}", item["external_product_id"]) if item else None
        clk = {"id": _nid(), "user_id": user["id"], "product_recommendation_id": rid, "partner_id": partner["id"],
               "tracking_reference": tracking, "clicked_at": _now(), "status": "redirected"}
        await _db.affiliate_clicks.insert_one(dict(clk))
        await _cap(user, "affiliate_link_clicked", {"partner": partner["name"]})
        return {"click_id": clk["id"], "product_url": url, "tracking_reference": tracking,
                "disclosure": partner.get("disclosure_text") if partner.get("has_commission") else None,
                "note": "You're being handed off to the partner. DIYhomie doesn't process the payment."}

    @r.get("/for-project/{project_id}")
    async def for_project(project_id: str, user: dict = Depends(get_current_user)):
        """Derive needs from a project's not-yet-owned materials and recommend for each."""
        proj = await _db.hi_projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found.")
        mats = await _db.hi_project_materials.find({"project_id": project_id}, {"_id": 0}).to_list(200)
        cfg = await _config()
        groups = []
        for m in mats:
            if m.get("user_status") == "have_it":
                continue
            category = _guess_category(m.get("name", ""))
            if not category:
                continue
            need = {"id": _nid(), "user_id": user["id"], "project_id": project_id, "room_id": None, "asset_id": None,
                    "source": "project_plan", "category": category, "required_specifications": {},
                    "quantity": None, "urgency": "normal", "safety_critical": False, "created_at": _now()}
            await _db.product_needs.insert_one(dict(need))
            need.pop("_id", None)
            recs = await _generate(need, cfg["weights"])
            if recs:
                groups.append({"material": m.get("name"), "need_id": need["id"], "recommendations": recs})
        return {"project_id": project_id, "groups": groups}

    return r


def _guess_category(name: str) -> Optional[str]:
    n = (name or "").lower()
    if "roller" in n:
        return "paint_roller"
    if "paint" in n:
        return "interior_paint"
    if "filter" in n:
        return "hvac_filter"
    return None


# ============================================================= admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/rec", dependencies=[Depends(require_admin)])

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        partners = await _db.rec_partners.find({}, {"_id": 0}).to_list(200)
        out = []
        for p in partners:
            clicks = await _db.affiliate_clicks.count_documents({"partner_id": p["id"]})
            conversions = await _db.partner_conversions.count_documents({"partner_id": p["id"], "status": {"$in": ["approved", "paid"]}})
            reversals = await _db.partner_conversions.count_documents({"partner_id": p["id"], "status": "reversed"})
            items = await _db.rec_catalog_items.count_documents({"partner_id": p["id"], "status": "active"})
            out.append({**p, "clicks": clicks, "conversions": conversions, "reversals": reversals,
                        "catalog_items": items,
                        "conversion_rate": round(conversions / clicks, 2) if clicks else 0.0})
        mismatches = await _db.product_recommendations.count_documents({"status": "hidden"})
        cfg = await _config()
        return {"partners": out, "reported_mismatches": mismatches, "weights": cfg["weights"],
                "disabled_categories": cfg.get("disabled_categories", [])}

    @r.post("/partners")
    async def create_partner(req: PartnerReq, admin: dict = Depends(require_admin)):
        if req.partner_type not in PARTNER_TYPES:
            raise HTTPException(status_code=400, detail="Invalid partner type.")
        p = {"id": _nid(), "key": _nid()[:8], "name": req.name, "partner_type": req.partner_type,
             "status": "paused", "integration_type": req.integration_type, "has_commission": req.has_commission,
             "reliability_score": max(0, min(100, req.reliability_score)), "disclosure_text": req.disclosure_text,
             "link_format": req.link_format, "tracking_configured": req.tracking_configured,
             "geographic_coverage": "US", "created_at": _now(), "updated_at": _now()}
        await _db.rec_partners.insert_one(dict(p))
        p.pop("_id", None)
        return p

    @r.post("/partners/{pid}/activate")
    async def activate_partner(pid: str, admin: dict = Depends(require_admin)):
        p = await _db.rec_partners.find_one({"id": pid}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Partner not found.")
        # cannot activate without approved disclosure (if commission) + link format + tracking
        problems = []
        if p.get("has_commission") and not p.get("disclosure_text"):
            problems.append("approved disclosure text")
        if not p.get("link_format"):
            problems.append("a tested outbound link format")
        if not p.get("tracking_configured"):
            problems.append("valid tracking configuration")
        if problems:
            raise HTTPException(status_code=400, detail="Cannot activate — missing: " + ", ".join(problems))
        await _db.rec_partners.update_one({"id": pid}, {"$set": {"status": "active", "updated_at": _now()}})
        return {"ok": True, "status": "active"}

    @r.post("/partners/{pid}/pause")
    async def pause_partner(pid: str, admin: dict = Depends(require_admin)):
        if not await _db.rec_partners.find_one({"id": pid}):
            raise HTTPException(status_code=404, detail="Partner not found.")
        await _db.rec_partners.update_one({"id": pid}, {"$set": {"status": "paused", "updated_at": _now()}})
        return {"ok": True, "status": "paused"}

    @r.put("/weights")
    async def set_weights(body: dict, admin: dict = Depends(require_admin)):
        cfg = await _config()
        w = dict(cfg["weights"])
        for k, v in (body.get("weights") or {}).items():
            if k in DEFAULT_WEIGHTS:
                w[k] = max(0.0, min(1.0, float(v)))
        # policy guard: affiliate weight can never exceed safety weight
        if w["affiliate"] > w["safety"]:
            raise HTTPException(status_code=400, detail="Affiliate weight cannot exceed safety weight.")
        await _db.rec_config.update_one({"id": "singleton"}, {"$set": {"weights": w, "updated_at": _now()}})
        return {"weights": w}

    @r.get("/mismatches")
    async def mismatches(admin: dict = Depends(require_admin)):
        rows = await _db.product_recommendations.find({"status": "hidden"}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"mismatches": rows}

    @r.post("/conversions")
    async def record_conversion(req: ConversionReq, admin: dict = Depends(require_admin)):
        """Record a partner-confirmed conversion. Purchases are NEVER inferred — only recorded
        from an approved partner confirmation."""
        if not await _db.rec_partners.find_one({"id": req.partner_id}):
            raise HTTPException(status_code=404, detail="Partner not found.")
        conv = {"id": _nid(), "partner_id": req.partner_id, "affiliate_click_id": req.affiliate_click_id,
                "partner_transaction_reference": req.partner_transaction_reference,
                "conversion_type": req.conversion_type, "status": "approved",
                "commission_amount": req.commission_amount, "currency": req.currency,
                "occurred_at": _now(), "confirmed_at": _now()}
        await _db.partner_conversions.insert_one(dict(conv))
        if req.affiliate_click_id:
            await _db.affiliate_clicks.update_one({"id": req.affiliate_click_id}, {"$set": {"status": "confirmed_by_partner"}})
        conv.pop("_id", None)
        return conv

    @r.post("/conversions/{cid}/reverse")
    async def reverse_conversion(cid: str, admin: dict = Depends(require_admin)):
        if not await _db.partner_conversions.find_one({"id": cid}):
            raise HTTPException(status_code=404, detail="Conversion not found.")
        await _db.partner_conversions.update_one({"id": cid}, {"$set": {"status": "reversed"}})
        return {"ok": True}

    @r.get("/conversions")
    async def list_conversions(admin: dict = Depends(require_admin)):
        rows = await _db.partner_conversions.find({}, {"_id": 0}).sort("occurred_at", -1).to_list(200)
        total = sum((c.get("commission_amount") or 0) for c in rows if c["status"] in ("approved", "paid"))
        return {"conversions": rows, "total_commission_approved": round(total, 2)}

    return r
