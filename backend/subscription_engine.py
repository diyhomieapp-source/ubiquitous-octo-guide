"""
DIYhomie — Subscription Access, Feature Gating & Billing (Build Blueprint 09).

Adds a Home-Intelligence–facing subscription layer with three tiers
(free / starter / pro) and a reusable feature-gating helper the other HI
engines call to enforce plan limits. Checkout reuses the existing, tested
Stripe recurring-subscription flow in server.py (POST /api/billing/checkout),
so this module owns NO payment secrets — it only reads the user's
`subscription_tier` (kept in sync by the existing Stripe webhook) and derives
entitlements from it.

Endpoints (prefix /api/hi/subscription):
  GET /me     — current tier, plan meta, limits, live usage snapshot
  GET /plans  — plan catalogue for the paywall

Shared helpers (imported by other engines):
  _tier(user)              -> "free" | "starter" | "pro"
  check(user, feature)     -> (allowed: bool, info: dict)
  enforce(user, feature)   -> raises HTTPException(402) when over the limit
"""
from datetime import datetime, timezone, timedelta
import math
from typing import Callable, Tuple

from fastapi import APIRouter, Depends, HTTPException

_db = None
_logger = None

TIERS = ["free", "starter", "pro"]

# Product-facing plan metadata. `checkout_tier` maps to server.py PLAN_TIERS keys
# that drive the existing Stripe checkout (None = free, no checkout).
PLAN_META = {
    "free":    {"label": "Free",    "price_label": "$0",     "amount": 0,    "checkout_tier": None,
                "tagline": "The essentials to get started"},
    "starter": {"label": "Starter", "price_label": "$9/mo",  "amount": 900,  "checkout_tier": "starter",
                "tagline": "For active homeowners"},
    "pro":     {"label": "Pro",     "price_label": "$12/mo", "amount": 1200, "checkout_tier": "pro",
                "tagline": "Unlimited everything"},
}

# -1 == unlimited. Count-based limits, plus feature flags.
LIMITS = {
    "free":    {"homes": 1,  "projects": 3,  "chat_daily": 15,  "inventory": 25,  "documents": 10,
                "reminders": False, "code_check": False, "export": False, "priority_ai": False},
    "starter": {"homes": 3,  "projects": 25, "chat_daily": 100, "inventory": 250, "documents": 100,
                "reminders": True,  "code_check": False, "export": True,  "priority_ai": False},
    "pro":     {"homes": -1, "projects": -1, "chat_daily": -1,  "inventory": -1,  "documents": -1,
                "reminders": True,  "code_check": True,  "export": True,  "priority_ai": True},
}

FEATURE_HIGHLIGHTS = {
    "free": ["1 home profile", "3 saved projects", "15 Homie AI chats / day",
             "Track up to 25 tools & materials", "10 documents in your vault"],
    "starter": ["3 home profiles", "25 saved projects", "100 Homie AI chats / day",
                "250 inventory items", "100 vault documents", "Maintenance reminders"],
    "pro": ["Unlimited homes", "Unlimited projects", "Unlimited Homie AI chats",
            "Unlimited inventory & documents", "Local code checks", "Priority AI & data export"],
}

# feature key -> LIMITS key
FEATURE_LIMIT_KEY = {
    "home": "homes", "project": "projects", "inventory": "inventory",
    "document": "documents", "chat": "chat_daily",
}


def _cap(n: int) -> str:
    return "Unlimited" if n == -1 else str(n)


def perks_for(tier: str) -> list:
    """Full capability list for a tier, each flagged included/locked."""
    L = LIMITS[tier]
    return [
        {"label": f"{_cap(L['homes'])} home profile" + ("" if L['homes'] == 1 else "s"), "included": True},
        {"label": f"{_cap(L['projects'])} saved projects", "included": True},
        {"label": f"{('Unlimited' if L['chat_daily'] == -1 else L['chat_daily'])} Homie AI chats per day", "included": True},
        {"label": f"Track {_cap(L['inventory'])} tools & materials", "included": True},
        {"label": f"{_cap(L['documents'])} vault documents", "included": True},
        {"label": "Maintenance reminders", "included": L["reminders"]},
        {"label": "Data export", "included": L["export"]},
        {"label": "Local code checks", "included": L["code_check"]},
        {"label": "Priority AI responses", "included": L["priority_ai"]},
    ]

DENY_MSG = {
    "home": "You've reached your plan's home limit. Upgrade to add more homes.",
    "project": "You've reached your plan's saved-project limit. Upgrade for more projects.",
    "chat": "You've hit today's Homie AI chat limit on your plan. Upgrade for more daily chats.",
    "inventory": "You've reached your plan's inventory limit. Upgrade to track more items.",
    "document": "You've reached your plan's document limit. Upgrade for more vault storage.",
}


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _tier(user: dict) -> str:
    st = (user.get("subscription_tier") or "free").lower()
    if st == "master":          # legacy top tier grants full HI access
        return "pro"
    if st in ("starter", "pro"):
        return st
    if _trial_active(user):      # active free Pro trial → full Pro access
        return "pro"
    return "free"


def _trial_active(user: dict) -> bool:
    ends = user.get("hi_pro_trial_ends_at")
    if not ends or (user.get("subscription_tier") or "free").lower() not in ("free",):
        return False
    try:
        return datetime.now(timezone.utc) < datetime.fromisoformat(ends)
    except Exception:
        return False


def _trial_state(user: dict) -> dict:
    ends = user.get("hi_pro_trial_ends_at")
    active = _trial_active(user)
    days_left = None
    if active and ends:
        try:
            secs = (datetime.fromisoformat(ends) - datetime.now(timezone.utc)).total_seconds()
            days_left = max(0, math.ceil(secs / 86400))
        except Exception:
            days_left = None
    return {"active": active, "used": bool(user.get("hi_pro_trial_used")),
            "ends_at": ends, "days_left": days_left,
            "eligible": not user.get("hi_pro_trial_used") and (user.get("subscription_tier") or "free").lower() == "free"}


async def _usage_count(user_id: str, feature: str) -> int:
    if feature == "home":
        return await _db.hi_properties.count_documents({"user_id": user_id})
    if feature == "project":
        return await _db.hi_projects.count_documents({"user_id": user_id, "status": {"$ne": "archived"}})
    if feature == "inventory":
        return await _db.hi_inventory_items.count_documents({"user_id": user_id, "status": {"$ne": "archived"}})
    if feature == "document":
        return await _db.hi_documents.count_documents({"user_id": user_id})
    if feature == "chat":
        today = datetime.now(timezone.utc).date().isoformat()
        return await _db.hi_conversation_messages.count_documents(
            {"user_id": user_id, "role": "user", "created_at": {"$regex": f"^{today}"}})
    return 0


async def check(user: dict, feature: str) -> Tuple[bool, dict]:
    """Return (allowed, {tier, limit, used}). limit == -1 means unlimited."""
    tier = _tier(user)
    lk = FEATURE_LIMIT_KEY[feature]
    limit = LIMITS[tier][lk]
    if limit == -1:
        return True, {"tier": tier, "limit": -1, "used": None}
    used = await _usage_count(user["id"], feature)
    return (used < limit), {"tier": tier, "limit": limit, "used": used}


async def enforce(user: dict, feature: str):
    """Raise HTTPException(402) when the user is at/over the plan limit."""
    allowed, _info = await check(user, feature)
    if not allowed:
        raise HTTPException(status_code=402, detail=DENY_MSG.get(feature, "Upgrade required to continue."))


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/subscription", dependencies=[Depends(get_current_user)])

    @r.get("/me")
    async def me(user: dict = Depends(get_current_user)):
        tier = _tier(user)
        usage = {}
        for f in ("home", "project", "chat", "inventory", "document"):
            _, info = await check(user, f)
            usage[f] = {"used": info["used"], "limit": info["limit"]}
        trial = _trial_state(user)
        return {
            "tier": tier,
            "is_trial": trial["active"],
            "trial": trial,
            "plan": PLAN_META[tier],
            "limits": LIMITS[tier],
            "highlights": FEATURE_HIGHLIGHTS[tier],
            "perks": perks_for(tier),
            "usage": usage,
            "status": user.get("subscription_status", "active" if tier != "free" else "none"),
            "has_customer": bool(user.get("stripe_customer_id")),
        }

    @r.post("/trial/start")
    async def start_trial(user: dict = Depends(get_current_user)):
        if user.get("hi_pro_trial_used"):
            raise HTTPException(status_code=409, detail="You've already used your free Pro trial.")
        if (user.get("subscription_tier") or "free").lower() != "free":
            raise HTTPException(status_code=400, detail="You already have a paid plan.")
        ends = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        await _db.users.update_one({"id": user["id"]},
                                   {"$set": {"hi_pro_trial_ends_at": ends, "hi_pro_trial_used": True}})
        return {"ok": True, "ends_at": ends, "days_left": 7}

    @r.get("/plans")
    async def plans(user: dict = Depends(get_current_user)):
        cur = _tier(user)
        return {"current_tier": cur, "plans": [
            {"tier": t, **PLAN_META[t], "highlights": FEATURE_HIGHLIGHTS[t],
             "limits": LIMITS[t], "current": t == cur}
            for t in TIERS
        ]}

    return r
