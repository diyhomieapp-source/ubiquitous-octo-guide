"""
DIYhomie intelligent affiliate product widget engine.

Turns every auto-generated blog article into a self-monetizing page: an AI pass
categorizes the materials, tools, optional upgrades, replacement parts and
"frequently bought together" items, then each item gets affiliate deep-search
links across 7 retailers (Amazon, Home Depot, Lowe's, Walmart, Ace, Tractor
Supply, Harbor Freight). Zero manual linking. Admin controls retailer priority,
affiliate IDs, preferred brands, pins, blacklist and custom links.

Phase 1 = affiliate search links (works today, no gated retailer APIs needed).
Phase 2 (later) = live price/image/rating via PA-API / Impact once approved.
"""
import asyncio
from datetime import datetime, timezone
from urllib.parse import quote
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

# Retailer search-URL templates ({q} = url-encoded query).
RETAILERS = {
    "amazon":        {"label": "Amazon",        "url": "https://www.amazon.com/s?k={q}",                  "priority": 1},
    "homedepot":     {"label": "Home Depot",    "url": "https://www.homedepot.com/s/{q}",                 "priority": 2},
    "lowes":         {"label": "Lowe's",        "url": "https://www.lowes.com/search?searchTerm={q}",     "priority": 3},
    "walmart":       {"label": "Walmart",       "url": "https://www.walmart.com/search?q={q}",            "priority": 4},
    "acehardware":   {"label": "Ace Hardware",  "url": "https://www.acehardware.com/search?query={q}",    "priority": 5},
    "tractorsupply": {"label": "Tractor Supply","url": "https://www.tractorsupply.com/tsc/search/{q}",    "priority": 6},
    "harborfreight": {"label": "Harbor Freight","url": "https://www.harborfreight.com/search?q={q}",      "priority": 7},
}

CATEGORIES = [
    ("main_product", "Main Product", False),
    ("materials", "Materials", False),
    ("tools", "Tools", False),
    ("optional_upgrades", "Optional Upgrades", True),
    ("replacement_parts", "Common Replacement Parts", True),
    ("frequently_bought", "Frequently Bought Together", True),
]

DISCLOSURE = ("As an Amazon Associate and retail affiliate, DIYhomie earns from qualifying "
              "purchases — at no extra cost to you. Prices and availability vary by retailer.")


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


def _now():
    return datetime.now(timezone.utc).isoformat()


def _default_config() -> dict:
    return {
        "id": "singleton",
        "enabled": True,
        "widget_title": "Materials & Tools Needed",
        "show_optional": True,
        "disclosure": DISCLOSURE,
        "preferred_brands": [],
        "blacklist": [],                 # item names to hide everywhere
        "pinned": [],                    # [{"category": "tools", "name": "..."}]
        "custom_links": {},              # {"item name": "https://..."}
        "retailers": {
            k: {"label": v["label"], "enabled": True, "priority": v["priority"],
                "affiliate_tag": "", "deeplink_template": ""}
            for k, v in RETAILERS.items()
        },
    }


async def ensure_config() -> dict:
    cfg = await _db.affiliate_config.find_one({"id": "singleton"}, {"_id": 0})
    if not cfg:
        cfg = _default_config()
        await _db.affiliate_config.insert_one(dict(cfg))
        return cfg
    # backfill any newly-added retailers / keys
    base = _default_config()
    for rk, rv in base["retailers"].items():
        cfg.setdefault("retailers", {}).setdefault(rk, rv)
    for k, v in base.items():
        cfg.setdefault(k, v)
    return cfg


# ---------------------------------------------------------------- list building
def _as_names(val) -> List[str]:
    if not val:
        return []
    if isinstance(val, str):
        return [val]
    out = []
    for x in val:
        if isinstance(x, str):
            out.append(x.strip())
        elif isinstance(x, dict):
            n = x.get("name") or x.get("item") or x.get("title")
            if n:
                out.append(str(n).strip())
    return [x for x in out if x]


def quick_list(post: dict) -> dict:
    """Instant, no-LLM shopping list from the guide's existing tools/materials."""
    return {
        "main_product": (post.get("product") or "").strip() or None,
        "materials": _as_names(post.get("materials"))[:14],
        "tools": _as_names(post.get("tools"))[:14],
        "optional_upgrades": [],
        "replacement_parts": [],
        "frequently_bought": [],
        "source": "quick",
        "generated_at": _now(),
    }


async def enrich_list(post: dict, config: Optional[dict] = None) -> dict:
    """AI categorization: expand into upgrades / replacement parts / FBT, using
    the article context. Falls back to quick_list on any failure."""
    base = quick_list(post)
    if not _llm_json:
        return base
    config = config or await ensure_config()
    brands = config.get("preferred_brands") or []
    system = (
        "You are a hardware-store expert helping a DIY homeowner buy everything for a project. "
        "Given an article, return ONLY valid JSON with short, searchable product names (2-5 words each, "
        "brand-agnostic unless a specific model is named). Do not invent fake brands. Keys: "
        "main_product (string or null), materials (array), tools (array), optional_upgrades (array), "
        "replacement_parts (array), frequently_bought (array). Max 10 items per array."
    )
    if brands:
        system += f" Prefer these brands when natural: {', '.join(brands)}."
    user = (
        f"Title: {post.get('title')}\n"
        f"Main product/model: {post.get('product') or 'n/a'}\n"
        f"Overview: {(post.get('overview') or '')[:600]}\n"
        f"Tools mentioned: {', '.join(base['tools']) or 'n/a'}\n"
        f"Materials mentioned: {', '.join(base['materials']) or 'n/a'}\n"
        f"Steps: {' | '.join(s.get('title','') for s in (post.get('steps') or [])[:12])}\n"
        "Build the complete shopping list a homeowner needs to finish this project."
    )
    try:
        data = await _llm_json(system, user, max_tokens=1100)
    except Exception as e:
        if _logger:
            _logger.warning(f"affiliate enrich failed: {e}")
        return base
    if not isinstance(data, dict):
        return base
    mp = data.get("main_product")
    out = {
        "main_product": (mp.strip() if isinstance(mp, str) and mp.strip() else base["main_product"]),
        "materials": (_as_names(data.get("materials")) or base["materials"])[:12],
        "tools": (_as_names(data.get("tools")) or base["tools"])[:12],
        "optional_upgrades": _as_names(data.get("optional_upgrades"))[:10],
        "replacement_parts": _as_names(data.get("replacement_parts"))[:10],
        "frequently_bought": _as_names(data.get("frequently_bought"))[:10],
        "source": "ai",
        "generated_at": _now(),
    }
    return out


async def generate_and_store(slug: str, use_ai: bool = True):
    post = await _db.blog_posts.find_one({"slug": slug}, {"_id": 0})
    if not post:
        return None
    cfg = await ensure_config()
    sl = await enrich_list(post, cfg) if use_ai else quick_list(post)
    await _db.blog_posts.update_one({"slug": slug}, {"$set": {"shopping_list": sl}})
    return sl


# ---------------------------------------------------------------- link building
def _build_link(rk: str, rconf: dict, query: str) -> str:
    q = quote(query)
    url = RETAILERS[rk]["url"].format(q=q)
    if rk == "amazon" and rconf.get("affiliate_tag"):
        url += ("&" if "?" in url else "?") + "tag=" + rconf["affiliate_tag"]
    tpl = (rconf.get("deeplink_template") or "").strip()
    if tpl and "{url}" in tpl:
        return tpl.replace("{url}", quote(url, safe="")).replace("{tag}", rconf.get("affiliate_tag", ""))
    return url


def _ordered_retailers(config: dict):
    rs = config.get("retailers", {})
    enabled = [(k, v) for k, v in rs.items() if v.get("enabled", True) and k in RETAILERS]
    return sorted(enabled, key=lambda kv: kv[1].get("priority", 99))


def build_widget_data(post: dict, config: dict) -> Optional[dict]:
    """Structured, render-ready widget payload (categories → items → links).
    Links are built at read time, so changing affiliate IDs needs no regeneration."""
    if not config.get("enabled", True):
        return None
    sl = post.get("shopping_list")
    if not sl:
        return None
    blacklist = {b.lower().strip() for b in config.get("blacklist", [])}
    custom = {k.lower().strip(): v for k, v in (config.get("custom_links") or {}).items()}
    retailers = _ordered_retailers(config)
    show_optional = config.get("show_optional", True)

    # admin-pinned items grouped by category
    pinned_by_cat: dict = {}
    for p in config.get("pinned", []):
        pinned_by_cat.setdefault(p.get("category", "materials"), []).append(p.get("name", ""))

    def item_obj(name: str):
        links = []
        cl = custom.get(name.lower().strip())
        if cl:
            links.append({"retailer": "direct", "label": "Buy now", "url": cl})
        for rk, rconf in retailers:
            links.append({"retailer": rk, "label": rconf.get("label", RETAILERS[rk]["label"]),
                          "url": _build_link(rk, rconf, name)})
        return {"name": name, "links": links}

    categories = []
    for key, label, optional in CATEGORIES:
        if optional and not show_optional:
            continue
        names = _as_names(sl.get(key)) + [n for n in pinned_by_cat.get(key, []) if n]
        # dedupe preserve order, drop blacklisted
        seen, clean = set(), []
        for n in names:
            low = n.lower().strip()
            if not low or low in seen or low in blacklist:
                continue
            seen.add(low)
            clean.append(n)
        if not clean:
            continue
        categories.append({"key": key, "label": label, "items": [item_obj(n) for n in clean]})

    if not categories:
        return None
    return {
        "title": config.get("widget_title", "Materials & Tools Needed"),
        "disclosure": config.get("disclosure", DISCLOSURE),
        "categories": categories,
    }


# ---------------------------------------------------------------- SSR HTML
def render_widget_html(widget: Optional[dict]) -> str:
    if not widget:
        return ""
    import html as _html
    esc = _html.escape

    def item_row(it):
        btns = "".join(
            f'<a class="aff-btn{" aff-direct" if l["retailer"]=="direct" else ""}" '
            f'href="{esc(l["url"])}" target="_blank" rel="nofollow sponsored noopener">{esc(l["label"])}</a>'
            for l in it["links"]
        )
        return f'<div class="aff-item"><div class="aff-name">{esc(it["name"])}</div><div class="aff-btns">{btns}</div></div>'

    groups = ""
    for c in widget["categories"]:
        rows = "".join(item_row(it) for it in c["items"])
        groups += f'<div class="aff-group"><h3 class="aff-cat">{esc(c["label"])}</h3>{rows}</div>'

    css = (
        "<style>.aff-wrap{margin:34px 0;padding:22px;border:2px solid #FF6A00;border-radius:16px;background:#FFF8F2}"
        ".aff-wrap h2{font-size:22px;margin:0 0 4px;border:0;padding:0}"
        ".aff-sub{color:#666;font-size:13px;margin-bottom:14px}"
        ".aff-group{margin-top:16px}.aff-cat{font-size:15px;font-weight:800;color:#C75300;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px}"
        ".aff-item{padding:10px 0;border-bottom:1px solid #f0e2d4}"
        ".aff-name{font-weight:700;margin-bottom:6px}"
        ".aff-btns{display:flex;flex-wrap:wrap;gap:6px}"
        ".aff-btn{font-size:12px;font-weight:700;color:#333;background:#fff;border:1px solid #e2c9b0;border-radius:8px;padding:6px 10px;text-decoration:none}"
        ".aff-btn:hover{border-color:#FF6A00;color:#FF6A00}.aff-direct{background:#FF6A00;color:#fff;border-color:#FF6A00}"
        ".aff-disc{color:#999;font-size:11px;margin-top:14px}</style>"
    )
    return (
        f'{css}<div class="aff-wrap"><h2>🛒 {esc(widget["title"])}</h2>'
        f'<div class="aff-sub">Everything you need for this project — pick your favorite store.</div>'
        f'{groups}<div class="aff-disc">{esc(widget["disclosure"])}</div></div>'
    )


# ---------------------------------------------------------------- models
class ConfigReq(BaseModel):
    enabled: Optional[bool] = None
    widget_title: Optional[str] = None
    show_optional: Optional[bool] = None
    disclosure: Optional[str] = None
    preferred_brands: Optional[List[str]] = None
    blacklist: Optional[List[str]] = None
    pinned: Optional[List[dict]] = None
    custom_links: Optional[dict] = None
    retailers: Optional[dict] = None


# ---------------------------------------------------------------- admin router
def build_admin_router(require_admin) -> APIRouter:
    r = APIRouter(prefix="/api/admin/affiliate", dependencies=[Depends(require_admin)])

    @r.get("/config")
    async def get_config():
        cfg = await ensure_config()
        return cfg

    @r.put("/config")
    async def update_config(req: ConfigReq):
        cfg = await ensure_config()
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if "retailers" in upd:  # merge per-retailer to avoid wiping fields
            merged = cfg.get("retailers", {})
            for rk, rv in upd["retailers"].items():
                if rk in RETAILERS:
                    merged[rk] = {**merged.get(rk, {}), **rv}
            upd["retailers"] = merged
        await _db.affiliate_config.update_one({"id": "singleton"}, {"$set": upd})
        return await ensure_config()

    @r.get("/posts")
    async def posts_with_widget(limit: int = 100):
        docs = await _db.blog_posts.find(
            {}, {"_id": 0, "slug": 1, "title": 1, "shopping_list": 1, "views": 1}
        ).sort("created_at", -1).limit(min(limit, 300)).to_list(300)
        for d in docs:
            sl = d.pop("shopping_list", None)
            d["has_list"] = bool(sl)
            d["list_source"] = (sl or {}).get("source")
            d["item_count"] = sum(len(_as_names((sl or {}).get(k))) for k, _, _ in CATEGORIES)
        return docs

    @r.get("/preview/{slug}")
    async def preview(slug: str):
        post = await _db.blog_posts.find_one({"slug": slug}, {"_id": 0})
        if not post:
            raise HTTPException(404, "Post not found")
        cfg = await ensure_config()
        return {"widget": build_widget_data(post, cfg), "shopping_list": post.get("shopping_list")}

    @r.post("/regenerate/{slug}")
    async def regenerate(slug: str):
        sl = await generate_and_store(slug, use_ai=True)
        if sl is None:
            raise HTTPException(404, "Post not found")
        return {"ok": True, "shopping_list": sl}

    @r.post("/backfill")
    async def backfill(only_missing: bool = True):
        q = {"shopping_list": {"$exists": False}} if only_missing else {}
        slugs = await _db.blog_posts.find(q, {"_id": 0, "slug": 1}).to_list(2000)
        asyncio.create_task(_run_backfill([s["slug"] for s in slugs]))
        return {"ok": True, "queued": len(slugs)}

    return r


async def _run_backfill(slugs: List[str]):
    for s in slugs:
        try:
            await generate_and_store(s, use_ai=True)
        except Exception as e:
            if _logger:
                _logger.warning(f"backfill {s}: {e}")
        await asyncio.sleep(0.3)
    if _logger:
        _logger.info(f"affiliate backfill done: {len(slugs)} posts")
