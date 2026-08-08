"""
DIYhomie — Asset Exit, Resale & Responsible Disposition Engine (Build Blueprint 26).

Helps a user decide the best next step for an asset they no longer need: keep, repair,
sell, trade in, donate, recycle or dispose. DIYhomie is NOT a marketplace, escrow, lender,
dealer, recycler or payment processor — every transaction happens on an approved third party.

Flow: identify -> document condition (user-reported AND optional AI-observed, kept separate)
-> estimate exit paths (value ranges are ESTIMATES, never guaranteed offers) -> compare
effort/speed/value/suitability -> route to an approved partner (user value over commission,
disclosed) -> record disposition + update household asset/inventory history.

Reuses: hi_assets (B01), hi_inventory_items (B07), Smart Waste disposal ideas (B16), _llm_json AI.
Collections: asset_exit_cases, asset_condition_assessments, exit_options, exit_partner_matches,
listing_drafts, asset_disposition_outcomes, exit_partners, exit_settings, exit_valuation_flags.
"""
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Callable = None
_llm_key: str = ""

EXIT_TYPES = ["keep", "repair", "private_sale", "managed_marketplace", "instant_buyback",
              "trade_in", "donation", "recycle", "dispose"]
CONDITION_LABELS = ["New", "Like New", "Good", "Fair", "Poor", "Nonworking", "Unknown"]
WORKING_STATUS = ["working", "partially_working", "not_working", "unknown"]
CATEGORIES = ["Phones & Electronics", "Tools", "Appliances", "Lawn Equipment", "Furniture", "Building Materials"]

# per-exit static profile: effort, typical time, fee pct (of sale), value factor vs market, sustainability
EXIT_PROFILE = {
    "keep":                {"effort": "low",    "time": "Immediate",     "fee_pct": 0.0,  "factor": None, "sustain": 3},
    "repair":              {"effort": "medium", "time": "1–2 weeks",     "fee_pct": 0.0,  "factor": None, "sustain": 5},
    "private_sale":        {"effort": "high",   "time": "1–4 weeks",     "fee_pct": 0.03, "factor": 1.0,  "sustain": 4},
    "managed_marketplace": {"effort": "medium", "time": "1–3 weeks",     "fee_pct": 0.13, "factor": 0.92, "sustain": 4},
    "instant_buyback":     {"effort": "low",    "time": "2–5 days",      "fee_pct": 0.0,  "factor": 0.55, "sustain": 4},
    "trade_in":            {"effort": "low",    "time": "Same/next day", "fee_pct": 0.0,  "factor": 0.55, "sustain": 4},
    "donation":            {"effort": "low",    "time": "Same day",      "fee_pct": 0.0,  "factor": 0.0,  "sustain": 5},
    "recycle":             {"effort": "low",    "time": "Same day",      "fee_pct": 0.0,  "factor": 0.0,  "sustain": 5},
    "dispose":             {"effort": "low",    "time": "Same day",      "fee_pct": 0.0,  "factor": 0.0,  "sustain": 1},
}

EXIT_STATUS_MAP = {"private_sale": "sold", "managed_marketplace": "sold", "instant_buyback": "sold",
                   "trade_in": "traded_in", "donation": "donated", "recycle": "recycled",
                   "dispose": "disposed", "keep": "active", "repair": "active"}

SAFETY_GUIDANCE = [
    "Meet in a safe, public location (a police-station 'safe exchange zone' is ideal) and bring someone with you.",
    "Don't share unnecessary personal information — no home alone-times, ID scans or bank logins.",
    "Beware of overpayment, gift-card, 'accidental' extra-payment and shipping-label scams.",
    "Never ship an item before you have verified, cleared payment — pending is not paid.",
    "Use the partner platform's built-in messaging and safety tools instead of moving off-platform.",
]

DONATION_NOTE = "Community benefit is possible, but tax deductibility depends on the charity and your situation — verify with the organization and a tax professional."
RECYCLE_NOTE = "Good for unusable or unsupported items. Local acceptance rules vary — confirm your facility accepts this item before you go."
DISPOSE_NOTE = "Only when reuse, resale, donation and recycling aren't options. Follow local disposal rules; hazardous items need special handling."


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger, llm_json: Callable, llm_key: str = ""):
    global _db, _logger, _llm_json, _llm_key
    _db, _logger, _llm_json = db, logger, llm_json
    _llm_key = llm_key or os.environ.get("EMERGENT_LLM_KEY", "")


async def _cap(user, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[asset_exit:{event_type}] {message}", level="error")
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
    s = await _db.exit_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "categories": {c: True for c in CATEGORIES},
             "safety_guidance": SAFETY_GUIDANCE, "updated_at": _now()}
        await _db.exit_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


def _strip_json(s: str) -> dict:
    from json import loads
    s = (s or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", s).strip()
    try:
        return loads(s)
    except Exception:
        return {}


# ------------------------------------------------------------- AI helpers
async def _observe_condition(image_base64: str) -> dict:
    """gpt-4o vision — VISIBLE cosmetic condition only. Cannot certify function/authenticity/safety."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(api_key=_llm_key, session_id=_nid(), system_message=(
            "You describe ONLY the visible cosmetic condition of a second-hand item from a photo. "
            "Return STRICT JSON: {\"ai_observed_condition\": one of [New, Like New, Good, Fair, Poor, Unknown], "
            "\"visible_damage_notes\": one honest sentence about visible wear/damage or 'None visible', "
            "\"confidence\": one of [High, Medium, Low]}. You CANNOT judge whether it works, is authentic, "
            "is safe, or has hidden defects — never claim to. Use Unknown/Low if unsure."
        )).with_model("openai", "gpt-4o")
        out = await chat.send_message(UserMessage(text="Assess visible condition only. JSON only.",
                                                  file_contents=[ImageContent(image_base64)]))
        return _strip_json(out)
    except Exception as e:
        _sentry("valuation_service_failure", f"vision: {e}")
        return {}


async def _ai_valuation(title: str, category: str, condition: str, working_status: str, damage: str) -> dict:
    """Rough resale market value range (USD). ESTIMATE only, never an offer."""
    try:
        system = ("You are a cautious used-goods appraiser for a US homeowner app. Given an item, return "
                  "STRICT JSON: {\"market_value_low\": number, \"market_value_high\": number, "
                  "\"confidence\": one of [High, Medium, Low], \"note\": one short sentence}. Values are the "
                  "typical USED private-resale price range in USD for average condition of this item type. "
                  "Be conservative. If unknown or the item has little/no resale value, use 0 and Low. "
                  "These are ESTIMATES for comparison only, never guaranteed offers.")
        user_text = (f"Item: {title}\nCategory: {category}\nUser-reported condition: {condition}\n"
                     f"Working status: {working_status}\nVisible damage: {damage or 'not specified'}")
        data = await _llm_json(system, user_text, max_tokens=250, feature_area="asset_exit_valuation")
        lo = max(0.0, float(data.get("market_value_low") or 0))
        hi = max(lo, float(data.get("market_value_high") or 0))
        return {"low": round(lo, 2), "high": round(hi, 2),
                "confidence": data.get("confidence") or "Low", "note": data.get("note") or ""}
    except Exception as e:
        _sentry("valuation_service_failure", str(e))
        return {"low": 0.0, "high": 0.0, "confidence": "Low", "note": ""}


async def _ai_listing(case: dict, assess: dict, price_low, price_high) -> dict:
    try:
        system = ("You write a clean, honest second-hand LISTING for a US homeowner to review before posting. "
                  "Return STRICT JSON: {\"title\": <=70 chars, \"description\": 2-4 honest sentences, "
                  "\"condition_summary\": one sentence, \"photo_checklist\": array of 4-6 short photo suggestions}. "
                  "Be truthful about condition and flaws; never exaggerate or invent features/specs.")
        user_text = (f"Item: {case['title']}\nCategory: {case['category']}\n"
                     f"User condition: {assess.get('user_reported_condition')}\n"
                     f"Working: {assess.get('working_status')}\nDamage: {assess.get('visible_damage_notes') or 'none noted'}\n"
                     f"Missing accessories: {', '.join(assess.get('missing_accessories') or []) or 'none'}\n"
                     f"Suggested price range: ${price_low}–${price_high}")
        data = await _llm_json(system, user_text, max_tokens=400, feature_area="asset_exit_listing")
        return data or {}
    except Exception as e:
        _sentry("listing_generation_failure", str(e))
        return {}


# ------------------------------------------------------------- valuation + comparison
def _suitability(exit_type: str, condition: str, working: str, has_partner: bool) -> int:
    """0-100 suitability. Higher = better fit for this item's state."""
    score = 50
    broken = working in ("not_working",) or condition in ("Nonworking", "Poor")
    likenew = condition in ("New", "Like New") and working == "working"
    if exit_type in ("private_sale", "managed_marketplace", "instant_buyback", "trade_in"):
        score = 85 if likenew else (68 if not broken else 15)
        if not has_partner and exit_type in ("instant_buyback", "trade_in", "managed_marketplace"):
            score = min(score, 20)
    elif exit_type == "repair":
        score = 70 if broken and condition != "Nonworking" else 30
    elif exit_type == "donation":
        score = 50 if not broken else 25
    elif exit_type == "recycle":
        score = 80 if broken else 35
    elif exit_type == "dispose":
        score = 55 if condition == "Nonworking" else 20
    elif exit_type == "keep":
        score = 40
    return max(0, min(100, score))


def _explanation(exit_type: str) -> str:
    return {
        "keep": "Hold onto it if you may still use it — no cost, no effort.",
        "repair": "A repair could restore value and extend its life instead of replacing it.",
        "private_sale": "Highest potential return, but more time and effort and you handle the buyer yourself.",
        "managed_marketplace": "Good reach and buyer protection tools; a platform fee reduces your net.",
        "instant_buyback": "Fast and low-effort with a guaranteed-style quote, but a lower estimated return.",
        "trade_in": "Quick credit toward a replacement; typically less than a private sale.",
        "donation": DONATION_NOTE,
        "recycle": RECYCLE_NOTE,
        "dispose": DISPOSE_NOTE,
    }[exit_type]


async def _partners_for(category: str) -> List[dict]:
    return await _db.exit_partners.find(
        {"status": "active", "eligible_categories": category}, {"_id": 0}).to_list(50)


async def _build_options(case: dict, assess: dict) -> dict:
    val = await _ai_valuation(case["title"], case["category"], assess.get("user_reported_condition") or "Unknown",
                              assess.get("working_status") or "unknown", assess.get("visible_damage_notes") or "")
    partners = await _partners_for(case["category"])
    # partner exit-type coverage
    by_type: dict = {}
    for p in partners:
        by_type.setdefault(p["partner_type"], []).append(p)

    # clear prior generated options/matches for idempotent regeneration
    await _db.exit_options.delete_many({"asset_exit_case_id": case["id"]})
    await _db.exit_partner_matches.delete_many({"asset_exit_case_id": case["id"]})

    condition = assess.get("user_reported_condition") or "Unknown"
    working = assess.get("working_status") or "unknown"
    options = []
    for et in EXIT_TYPES:
        prof = EXIT_PROFILE[et]
        has_partner = et in by_type or et in ("keep", "repair", "private_sale", "dispose")
        factor = prof["factor"]
        lo = hi = None
        fees = None
        if factor is not None and val["high"] > 0:
            base_lo = val["low"] * factor
            base_hi = val["high"] * factor
            fee = prof["fee_pct"]
            fees = round((base_lo + base_hi) / 2 * fee, 2) if fee else 0.0
            lo = round(max(0.0, base_lo - (base_lo * fee)), 2)
            hi = round(max(0.0, base_hi - (base_hi * fee)), 2)
        elif factor == 0.0:
            lo = hi = 0.0
        suit = _suitability(et, condition, working, has_partner)
        status = "available" if has_partner else ("needs_verification" if et in ("recycle", "donation") else "unavailable")
        if et in ("recycle", "donation", "dispose"):
            status = "needs_verification"
        opt = {"id": _nid(), "asset_exit_case_id": case["id"], "exit_type": et,
               "estimated_value_low": lo, "estimated_value_high": hi, "currency": "USD",
               "effort_level": prof["effort"], "estimated_time_to_complete": prof["time"],
               "fees_estimate": fees, "suitability_score": suit, "sustainability_score": prof["sustain"],
               "explanation": _explanation(et), "status": status, "created_at": _now()}
        await _db.exit_options.insert_one(dict(opt)); opt.pop("_id", None)
        # partner matches for this exit option
        for p in by_type.get(et, []):
            match = {"id": _nid(), "exit_option_id": opt["id"], "asset_exit_case_id": case["id"],
                     "partner_id": p["id"], "partner_name": p["name"],
                     "eligibility_status": "eligible", "routing_score": p.get("reliability_score", 50),
                     "partner_offer_reference": None, "disclosure_required": p.get("compensated", False),
                     "disclosure_text": p.get("disclosure_text"), "status": "active", "created_at": _now()}
            await _db.exit_partner_matches.insert_one(dict(match))
        options.append(opt)

    await _db.asset_exit_cases.update_one({"id": case["id"]}, {"$set": {
        "status": "comparing", "market_value_low": val["low"], "market_value_high": val["high"],
        "valuation_confidence": val["confidence"], "valuation_note": val["note"], "updated_at": _now()}})
    return {"valuation": val, "options": options}


def _mid(o):
    lo, hi = o.get("estimated_value_low"), o.get("estimated_value_high")
    if lo is None or hi is None:
        return -1
    return (lo + hi) / 2


def _highlights(options: List[dict]) -> dict:
    avail = [o for o in options if o["status"] != "unavailable"]
    if not avail:
        avail = options
    effort_rank = {"low": 0, "medium": 1, "high": 2}
    best = max(avail, key=lambda o: (o["suitability_score"], _mid(o)))
    valuable = [o for o in avail if _mid(o) > 0]
    fastest = min(avail, key=lambda o: effort_rank.get(o["effort_level"], 1) if o["exit_type"] in ("instant_buyback", "trade_in", "donation", "recycle", "dispose") else 3)
    lowest_effort = min(avail, key=lambda o: effort_rank.get(o["effort_level"], 1))
    sustainable = max(avail, key=lambda o: o.get("sustainability_score", 0))
    def _pick(o):
        return {"exit_type": o["exit_type"], "option_id": o["id"], "why": o["explanation"],
                "estimated_value_low": o["estimated_value_low"], "estimated_value_high": o["estimated_value_high"],
                "effort_level": o["effort_level"], "estimated_time_to_complete": o["estimated_time_to_complete"]}
    return {"best_overall": _pick(best),
            "highest_return": _pick(max(valuable, key=_mid)) if valuable else None,
            "fastest": _pick(fastest), "lowest_effort": _pick(lowest_effort),
            "most_sustainable": _pick(sustainable)}


# ============================================================= models
class StartReq(BaseModel):
    asset_id: Optional[str] = None
    inventory_item_id: Optional[str] = None
    title: Optional[str] = None
    category: Optional[str] = None


class AssessReq(BaseModel):
    user_reported_condition: str
    working_status: str = "unknown"
    visible_damage_notes: Optional[str] = None
    missing_accessories: List[str] = []
    image_base64: Optional[str] = None


class SelectReq(BaseModel):
    exit_option_id: str
    partner_match_id: Optional[str] = None


class ListingReviewReq(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    condition_summary: Optional[str] = None
    suggested_price_low: Optional[float] = None
    suggested_price_high: Optional[float] = None
    mark_reviewed: bool = False


class CompleteReq(BaseModel):
    selected_exit_type: str
    partner_id: Optional[str] = None
    realized_value: Optional[float] = None
    completion_status: str = "completed"
    notes: Optional[str] = None


class FlagReq(BaseModel):
    reason: str


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/exit", dependencies=[Depends(get_current_user)])

    async def _case(cid, uid):
        c = await _db.asset_exit_cases.find_one({"id": cid, "user_id": uid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Item not found.")
        return c

    @r.get("/partners")
    async def partners(category: Optional[str] = None, user: dict = Depends(get_current_user)):
        flt = {"status": "active"}
        if category:
            flt["eligible_categories"] = category
        rows = await _db.exit_partners.find(flt, {"_id": 0}).sort("reliability_score", -1).to_list(100)
        return {"partners": rows}

    @r.get("/config")
    async def config(user: dict = Depends(get_current_user)):
        s = await _settings()
        return {"categories": [c for c in CATEGORIES if s["categories"].get(c, True)],
                "condition_labels": CONDITION_LABELS, "working_status": WORKING_STATUS, "exit_types": EXIT_TYPES}

    @r.post("/cases")
    async def start(req: StartReq, user: dict = Depends(get_current_user)):
        prop = await _prop(user["id"])
        s = await _settings()
        title = (req.title or "").strip()
        category = (req.category or "").strip()
        asset = inv = None
        if req.asset_id:
            asset = await _db.hi_assets.find_one({"id": req.asset_id, "property_id": prop["id"]}, {"_id": 0})
            if not asset:
                raise HTTPException(status_code=404, detail="Asset not found.")
            title = title or asset.get("name") or "Item"
            category = category or asset.get("category") or "Building Materials"
        elif req.inventory_item_id:
            inv = await _db.hi_inventory_items.find_one({"id": req.inventory_item_id, "user_id": user["id"]}, {"_id": 0})
            if not inv:
                raise HTTPException(status_code=404, detail="Inventory item not found.")
            title = title or inv.get("name") or "Item"
            category = category or inv.get("category") or "Tools"
        if not title:
            raise HTTPException(status_code=400, detail="Tell Homie what the item is.")
        # normalize category to a supported one
        if category not in CATEGORIES:
            category = next((c for c in CATEGORIES if c.lower().split(" ")[0] in category.lower()), "Building Materials")
        if not s["categories"].get(category, True):
            raise HTTPException(status_code=400, detail="This category isn't available for exit right now.")
        case = {"id": _nid(), "user_id": user["id"], "property_id": prop["id"],
                "asset_id": req.asset_id, "inventory_item_id": req.inventory_item_id,
                "title": title[:120], "category": category, "status": "identifying",
                "market_value_low": None, "market_value_high": None,
                "created_at": _now(), "updated_at": _now()}
        await _db.asset_exit_cases.insert_one(dict(case)); case.pop("_id", None)
        await _cap(user, "asset_exit_started", {"category": category})
        return {"case": case}

    @r.get("/cases")
    async def list_cases(user: dict = Depends(get_current_user)):
        rows = await _db.asset_exit_cases.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
        return {"cases": rows}

    @r.get("/cases/{cid}")
    async def get_case(cid: str, user: dict = Depends(get_current_user)):
        c = await _case(cid, user["id"])
        assess = await _db.asset_condition_assessments.find_one({"asset_exit_case_id": cid}, {"_id": 0}, sort=[("created_at", -1)])
        options = await _db.exit_options.find({"asset_exit_case_id": cid}, {"_id": 0}).sort("suitability_score", -1).to_list(50)
        matches = await _db.exit_partner_matches.find({"asset_exit_case_id": cid}, {"_id": 0}).to_list(100)
        listing = await _db.listing_drafts.find_one({"asset_exit_case_id": cid}, {"_id": 0}, sort=[("created_at", -1)])
        outcome = await _db.asset_disposition_outcomes.find_one({"asset_exit_case_id": cid}, {"_id": 0}, sort=[("created_at", -1)])
        m_by_opt: dict = {}
        for m in matches:
            m_by_opt.setdefault(m["exit_option_id"], []).append(m)
        for o in options:
            o["partner_matches"] = m_by_opt.get(o["id"], [])
        return {"case": c, "assessment": assess, "options": options, "listing": listing, "outcome": outcome}

    @r.delete("/cases/{cid}")
    async def cancel_case(cid: str, user: dict = Depends(get_current_user)):
        await _case(cid, user["id"])
        await _db.asset_exit_cases.update_one({"id": cid}, {"$set": {"status": "cancelled", "updated_at": _now()}})
        return {"ok": True}

    @r.post("/cases/{cid}/assess")
    async def assess(cid: str, req: AssessReq, user: dict = Depends(get_current_user)):
        c = await _case(cid, user["id"])
        if req.user_reported_condition not in CONDITION_LABELS:
            raise HTTPException(status_code=400, detail="Choose a valid condition.")
        ai_obs = {}
        if req.image_base64:
            ai_obs = await _observe_condition(req.image_base64)
        doc = {"id": _nid(), "asset_exit_case_id": cid,
               "user_reported_condition": req.user_reported_condition,
               "ai_observed_condition": ai_obs.get("ai_observed_condition"),
               "working_status": req.working_status if req.working_status in WORKING_STATUS else "unknown",
               "visible_damage_notes": (req.visible_damage_notes or ai_obs.get("visible_damage_notes") or "").strip()[:500] or None,
               "missing_accessories": req.missing_accessories[:20],
               "confidence_level": ai_obs.get("confidence") or "User-reported", "created_at": _now()}
        await _db.asset_condition_assessments.insert_one(dict(doc)); doc.pop("_id", None)
        await _db.asset_exit_cases.update_one({"id": cid}, {"$set": {"status": "assessing", "updated_at": _now()}})
        await _cap(user, "condition_assessment_completed", {"category": c["category"], "had_photo": bool(req.image_base64)})
        return {"assessment": doc}

    @r.post("/cases/{cid}/options")
    async def options(cid: str, user: dict = Depends(get_current_user)):
        c = await _case(cid, user["id"])
        assess = await _db.asset_condition_assessments.find_one({"asset_exit_case_id": cid}, {"_id": 0}, sort=[("created_at", -1)])
        if not assess:
            raise HTTPException(status_code=409, detail="Add the item's condition first.")
        try:
            res = await _build_options(c, assess)
        except Exception as e:
            _sentry("partner_match_failure", str(e))
            raise HTTPException(status_code=502, detail="Homie couldn't compare options right now. Try again.")
        await _cap(user, "exit_options_viewed", {"category": c["category"]})
        return res

    @r.get("/cases/{cid}/compare")
    async def compare(cid: str, user: dict = Depends(get_current_user)):
        await _case(cid, user["id"])
        options = await _db.exit_options.find({"asset_exit_case_id": cid}, {"_id": 0}).to_list(50)
        if not options:
            raise HTTPException(status_code=409, detail="Generate options first.")
        table = [{"exit_type": o["exit_type"],
                  "estimated_return": (f"${o['estimated_value_low']}–${o['estimated_value_high']}"
                                       if o["estimated_value_low"] is not None else "—"),
                  "effort": o["effort_level"], "speed": o["estimated_time_to_complete"],
                  "fees_estimate": o["fees_estimate"], "suitability": o["suitability_score"],
                  "what_you_do": o["explanation"], "status": o["status"]} for o in options]
        return {"comparison": table, "highlights": _highlights(options),
                "disclaimer": "All values are ESTIMATES for comparison only — not offers, guaranteed proceeds, or financial advice. Fees, shipping and taxes vary by partner and location."}

    @r.post("/cases/{cid}/select")
    async def select(cid: str, req: SelectReq, user: dict = Depends(get_current_user)):
        await _case(cid, user["id"])
        opt = await _db.exit_options.find_one({"id": req.exit_option_id, "asset_exit_case_id": cid}, {"_id": 0})
        if not opt:
            raise HTTPException(status_code=404, detail="Option not found.")
        if req.partner_match_id:
            await _db.exit_partner_matches.update_many({"asset_exit_case_id": cid}, {"$set": {"status": "active"}})
            await _db.exit_partner_matches.update_one({"id": req.partner_match_id}, {"$set": {"status": "selected"}})
        await _db.asset_exit_cases.update_one({"id": cid}, {"$set": {
            "status": "routed", "selected_exit_type": opt["exit_type"], "selected_option_id": opt["id"], "updated_at": _now()}})
        await _cap(user, "exit_option_selected", {"exit_type": opt["exit_type"]})
        if req.partner_match_id:
            await _cap(user, "partner_routing_clicked", {"exit_type": opt["exit_type"]})
        return {"ok": True, "selected_exit_type": opt["exit_type"],
                "safety_guidance": SAFETY_GUIDANCE if opt["exit_type"] == "private_sale" else None}

    @r.get("/cases/{cid}/safety")
    async def safety(cid: str, user: dict = Depends(get_current_user)):
        await _case(cid, user["id"])
        s = await _settings()
        return {"safety_guidance": s.get("safety_guidance") or SAFETY_GUIDANCE,
                "note": "DIYhomie doesn't verify buyers, hold funds, handle payment, or resolve disputes. All of that happens on the partner platform."}

    @r.post("/cases/{cid}/listing")
    async def make_listing(cid: str, user: dict = Depends(get_current_user)):
        c = await _case(cid, user["id"])
        assess = await _db.asset_condition_assessments.find_one({"asset_exit_case_id": cid}, {"_id": 0}, sort=[("created_at", -1)])
        if not assess:
            raise HTTPException(status_code=409, detail="Add the item's condition first.")
        sale_opt = await _db.exit_options.find_one({"asset_exit_case_id": cid, "exit_type": {"$in": ["private_sale", "managed_marketplace"]}}, {"_id": 0})
        plo = (sale_opt or {}).get("estimated_value_low")
        phi = (sale_opt or {}).get("estimated_value_high")
        ai = await _ai_listing(c, assess, plo, phi)
        draft = {"id": _nid(), "asset_exit_case_id": cid,
                 "title": (ai.get("title") or c["title"])[:120],
                 "description": ai.get("description") or "",
                 "condition_summary": ai.get("condition_summary") or f"{assess.get('user_reported_condition')} condition.",
                 "suggested_price_low": plo, "suggested_price_high": phi,
                 "photo_checklist": ai.get("photo_checklist") or ["Front", "Back", "Serial/label", "Any damage close-up"],
                 "status": "draft", "created_at": _now()}
        await _db.listing_drafts.insert_one(dict(draft)); draft.pop("_id", None)
        await _cap(user, "listing_draft_created", {"category": c["category"]})
        return {"listing": draft, "safety_guidance": SAFETY_GUIDANCE}

    @r.put("/cases/{cid}/listing")
    async def review_listing(cid: str, req: ListingReviewReq, user: dict = Depends(get_current_user)):
        await _case(cid, user["id"])
        draft = await _db.listing_drafts.find_one({"asset_exit_case_id": cid}, {"_id": 0}, sort=[("created_at", -1)])
        if not draft:
            raise HTTPException(status_code=404, detail="No listing to review.")
        upd = {k: v for k, v in req.dict().items() if v is not None and k != "mark_reviewed"}
        if req.mark_reviewed:
            upd["status"] = "user_reviewed"
        if upd:
            await _db.listing_drafts.update_one({"id": draft["id"]}, {"$set": upd})
        return await _db.listing_drafts.find_one({"id": draft["id"]}, {"_id": 0})

    @r.post("/cases/{cid}/complete")
    async def complete(cid: str, req: CompleteReq, user: dict = Depends(get_current_user)):
        c = await _case(cid, user["id"])
        if req.selected_exit_type not in EXIT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid exit type.")
        if req.completion_status not in ("pending", "completed", "unsuccessful", "cancelled"):
            raise HTTPException(status_code=400, detail="Invalid completion status.")
        outcome = {"id": _nid(), "asset_exit_case_id": cid, "selected_exit_type": req.selected_exit_type,
                   "partner_id": req.partner_id, "realized_value": req.realized_value, "currency": "USD",
                   "completion_status": req.completion_status, "completion_date": _now() if req.completion_status == "completed" else None,
                   "notes": (req.notes or "").strip()[:1000] or None, "created_at": _now()}
        await _db.asset_disposition_outcomes.insert_one(dict(outcome)); outcome.pop("_id", None)
        case_status = "completed" if req.completion_status == "completed" else c["status"]
        await _db.asset_exit_cases.update_one({"id": cid}, {"$set": {"status": case_status, "updated_at": _now()}})
        # asset lifecycle integration (preserve history; never delete by default)
        if req.completion_status == "completed":
            new_status = EXIT_STATUS_MAP.get(req.selected_exit_type, "archived")
            if c.get("asset_id"):
                await _db.hi_assets.update_one({"id": c["asset_id"]}, {"$set": {
                    "status": new_status, "exit_case_id": cid, "retired_at": _now() if new_status not in ("active",) else None,
                    "updated_at": _now()}})
            if c.get("inventory_item_id") and req.selected_exit_type not in ("keep", "repair"):
                await _db.hi_inventory_items.update_one({"id": c["inventory_item_id"]}, {"$set": {"status": "archived", "archived_reason": new_status, "updated_at": _now()}})
            # record partner conversion (attribution) if a partner was used
            if req.partner_id:
                try:
                    await _db.exit_partners.update_one({"id": req.partner_id}, {"$inc": {"conversions": 1}})
                except Exception as e:
                    _sentry("attribution_webhook_failure", str(e))
        await _cap(user, "disposition_completed", {"exit_type": req.selected_exit_type, "status": req.completion_status})
        return {"outcome": outcome, "asset_status": EXIT_STATUS_MAP.get(req.selected_exit_type)}

    @r.post("/cases/{cid}/report-valuation")
    async def report_valuation(cid: str, req: FlagReq, user: dict = Depends(get_current_user)):
        c = await _case(cid, user["id"])
        await _db.exit_valuation_flags.insert_one({
            "id": _nid(), "asset_exit_case_id": cid, "user_id": user["id"], "category": c["category"],
            "reason": (req.reason or "").strip()[:500], "status": "open", "created_at": _now()})
        return {"ok": True, "note": "Thanks — our team will review this valuation."}

    return r


# ============================================================= admin router
class PartnerReq(BaseModel):
    name: str
    partner_type: str
    eligible_categories: List[str] = []
    reliability_score: int = 60
    compensated: bool = False
    disclosure_text: Optional[str] = None
    geographic_eligibility: str = "US"


class PartnerPatchReq(BaseModel):
    status: Optional[str] = None
    reliability_score: Optional[int] = None
    eligible_categories: Optional[List[str]] = None
    compensated: Optional[bool] = None
    disclosure_text: Optional[str] = None


class CategoryReq(BaseModel):
    category: str
    enabled: bool


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/exit", dependencies=[Depends(require_admin)])

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        s = await _settings()
        async def _c(st):
            return await _db.asset_exit_cases.count_documents({"status": st})
        cases_by_status = {st: await _c(st) for st in ["identifying", "assessing", "comparing", "routed", "completed", "cancelled"]}
        outcomes = await _db.asset_disposition_outcomes.find({"completion_status": "completed"}, {"_id": 0}).to_list(5000)
        by_exit: dict = {}
        realized = 0.0
        for o in outcomes:
            by_exit[o["selected_exit_type"]] = by_exit.get(o["selected_exit_type"], 0) + 1
            realized += (o.get("realized_value") or 0)
        partners = await _db.exit_partners.find({}, {"_id": 0}).sort("reliability_score", -1).to_list(100)
        flags = await _db.exit_valuation_flags.count_documents({"status": "open"})
        return {"categories": s["categories"], "cases_by_status": cases_by_status,
                "completed_by_exit": by_exit, "realized_value_total": round(realized, 2),
                "partners": partners, "open_valuation_flags": flags,
                "total_cases": await _db.asset_exit_cases.count_documents({})}

    @r.put("/categories")
    async def set_category(req: CategoryReq, admin: dict = Depends(require_admin)):
        if req.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Unknown category.")
        s = await _settings()
        cats = s["categories"]; cats[req.category] = req.enabled
        await _db.exit_settings.update_one({"id": "singleton"}, {"$set": {"categories": cats, "updated_at": _now()}})
        return {"categories": cats}

    @r.get("/partners")
    async def list_partners(admin: dict = Depends(require_admin)):
        return {"partners": await _db.exit_partners.find({}, {"_id": 0}).sort("reliability_score", -1).to_list(200)}

    @r.post("/partners")
    async def add_partner(req: PartnerReq, admin: dict = Depends(require_admin)):
        if req.partner_type not in EXIT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid partner type.")
        if req.compensated and not (req.disclosure_text or "").strip():
            raise HTTPException(status_code=400, detail="Compensated partners require a disclosure.")
        p = {"id": _nid(), "name": req.name.strip()[:120], "partner_type": req.partner_type,
             "eligible_categories": [c for c in req.eligible_categories if c in CATEGORIES],
             "reliability_score": max(0, min(100, req.reliability_score)), "compensated": req.compensated,
             "disclosure_text": (req.disclosure_text or "").strip() or None,
             "geographic_eligibility": req.geographic_eligibility, "status": "active",
             "simulated": True, "conversions": 0, "created_at": _now()}
        await _db.exit_partners.insert_one(dict(p)); p.pop("_id", None)
        return {"partner": p}

    @r.patch("/partners/{pid}")
    async def patch_partner(pid: str, req: PartnerPatchReq, admin: dict = Depends(require_admin)):
        p = await _db.exit_partners.find_one({"id": pid}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Partner not found.")
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd.get("status") and upd["status"] not in ("active", "paused"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        compensated = upd.get("compensated", p.get("compensated"))
        disclosure = upd.get("disclosure_text", p.get("disclosure_text"))
        if compensated and not (disclosure or "").strip():
            raise HTTPException(status_code=400, detail="Compensated partners require a disclosure.")
        if "eligible_categories" in upd:
            upd["eligible_categories"] = [c for c in upd["eligible_categories"] if c in CATEGORIES]
        if upd:
            upd["updated_at"] = _now()
            await _db.exit_partners.update_one({"id": pid}, {"$set": upd})
        return await _db.exit_partners.find_one({"id": pid}, {"_id": 0})

    @r.delete("/partners/{pid}")
    async def remove_partner(pid: str, admin: dict = Depends(require_admin)):
        if not await _db.exit_partners.find_one({"id": pid}):
            raise HTTPException(status_code=404, detail="Partner not found.")
        await _db.exit_partners.delete_one({"id": pid})
        return {"ok": True}

    @r.get("/flags")
    async def flags(admin: dict = Depends(require_admin)):
        return {"flags": await _db.exit_valuation_flags.find({"status": "open"}, {"_id": 0}).sort("created_at", 1).to_list(200)}

    @r.post("/flags/{fid}/resolve")
    async def resolve_flag(fid: str, admin: dict = Depends(require_admin)):
        res = await _db.exit_valuation_flags.update_one({"id": fid}, {"$set": {"status": "resolved", "resolved_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Flag not found.")
        return {"ok": True}

    return r


# ============================================================= seed
async def seed_exit():
    if _db is None:
        return
    try:
        await _settings()
        if not await _db.exit_partners.find_one({}):
            seeds = [
                ("QuickCash Electronics Buyback", "instant_buyback", ["Phones & Electronics"], 82, True, "DIYhomie may earn a commission if you sell through this partner."),
                ("Carrier & Retailer Trade-In", "trade_in", ["Phones & Electronics"], 78, True, "Compensated partner link — clearly disclosed."),
                ("Managed Resale Marketplace", "managed_marketplace", ["Phones & Electronics", "Tools", "Appliances", "Lawn Equipment", "Furniture"], 80, True, "DIYhomie may earn a referral fee. Transactions occur on the partner platform."),
                ("Tool Resale Exchange", "managed_marketplace", ["Tools"], 72, False, None),
                ("Local Donation Network", "donation", ["Tools", "Appliances", "Furniture", "Lawn Equipment", "Building Materials"], 70, False, None),
                ("Certified Electronics Recycler", "recycle", ["Phones & Electronics", "Appliances"], 75, False, None),
                ("Building Materials Reuse Center", "donation", ["Building Materials"], 68, False, None),
            ]
            for name, ptype, cats, rel, comp, disc in seeds:
                await _db.exit_partners.insert_one({
                    "id": _nid(), "name": name, "partner_type": ptype, "eligible_categories": cats,
                    "reliability_score": rel, "compensated": comp, "disclosure_text": disc,
                    "geographic_eligibility": "US", "status": "active", "simulated": True,
                    "conversions": 0, "created_at": _now()})
        if _logger:
            _logger.info("asset exit (B26) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"asset exit seed failed: {e}")
