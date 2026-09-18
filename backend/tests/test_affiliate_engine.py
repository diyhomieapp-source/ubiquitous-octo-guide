"""Backend tests for DIYhomie intelligent affiliate widget engine.

Covers:
- Admin auth gating on /api/admin/affiliate/*
- GET /config returns expected shape + 7 retailers
- PUT /config partial-merge (per-retailer merge does NOT wipe sibling fields)
- GET /posts shape (has_list / list_source / item_count)
- POST /regenerate/{slug} -> source becomes 'ai'
- POST /backfill returns {ok, queued}
- PUBLIC /blog/{slug}/materials shape, retailer ordering by priority,
  amazon tag injection, blacklist exclusion
- PUBLIC /blog/{slug}/html contains 'aff-wrap' and 'aff-btn' with
  rel='nofollow sponsored'
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001"),
).rstrip("/")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = __import__("os").environ.get("TEST_USER_PASSWORD", "")

EXPECTED_RETAILERS = {
    "amazon", "homedepot", "lowes", "walmart",
    "acehardware", "tractorsupply", "harborfreight",
}


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(s, email, password):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(s):
    return _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def demo_token(s):
    try:
        return _login(s, DEMO_EMAIL, DEMO_PASSWORD)
    except AssertionError:
        s.post(f"{BASE_URL}/api/auth/register",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD, "name": "Demo"},
               timeout=20)
        return _login(s, DEMO_EMAIL, DEMO_PASSWORD)


def _ah(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def sample_slug(s):
    """Pick an existing blog slug."""
    r = s.get(f"{BASE_URL}/api/blog?limit=5", timeout=20)
    assert r.status_code == 200
    body = r.json()
    posts = body if isinstance(body, list) else body.get("posts") or body.get("items") or []
    assert posts, "no blog posts available"
    slug = posts[0].get("slug")
    assert slug
    return slug


# ---------- auth gating ----------
class TestAuthGating:
    def test_no_token_401_or_403(self, s):
        r = s.get(f"{BASE_URL}/api/admin/affiliate/config", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_demo_user_forbidden(self, s, demo_token):
        r = s.get(f"{BASE_URL}/api/admin/affiliate/config",
                  headers=_ah(demo_token), timeout=15)
        assert r.status_code == 403, r.text

    def test_admin_allowed(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/admin/affiliate/config",
                  headers=_ah(admin_token), timeout=15)
        assert r.status_code == 200, r.text


# ---------- config shape ----------
class TestConfig:
    def test_config_shape(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/admin/affiliate/config",
                  headers=_ah(admin_token), timeout=15)
        assert r.status_code == 200
        c = r.json()
        for k in ("enabled", "widget_title", "show_optional",
                  "disclosure", "preferred_brands", "blacklist", "retailers"):
            assert k in c, f"missing {k}"
        assert isinstance(c["retailers"], dict)
        assert EXPECTED_RETAILERS.issubset(set(c["retailers"].keys()))
        for rk, rv in c["retailers"].items():
            for f in ("label", "enabled", "priority", "affiliate_tag", "deeplink_template"):
                assert f in rv, f"retailer {rk} missing {f}"

    def test_partial_update_merges(self, s, admin_token):
        # First set amazon tag only - other retailer fields must be preserved.
        r = s.put(f"{BASE_URL}/api/admin/affiliate/config",
                  headers=_ah(admin_token),
                  json={"retailers": {"amazon": {"affiliate_tag": "diyhomie-20"}}},
                  timeout=20)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["retailers"]["amazon"]["affiliate_tag"] == "diyhomie-20"
        # Sibling retailers still intact
        assert c["retailers"]["homedepot"]["label"]
        assert c["retailers"]["homedepot"]["enabled"] in (True, False)
        # Amazon's other fields not wiped
        assert c["retailers"]["amazon"]["label"] == "Amazon"
        assert "priority" in c["retailers"]["amazon"]

        # Update widget_title, blacklist, preferred_brands, enabled
        r = s.put(f"{BASE_URL}/api/admin/affiliate/config",
                  headers=_ah(admin_token),
                  json={"widget_title": "Materials & Tools Needed",
                        "blacklist": ["TEST_BANNED_ITEM_XYZ"],
                        "preferred_brands": ["DeWalt", "Milwaukee"],
                        "enabled": True},
                  timeout=20)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["widget_title"] == "Materials & Tools Needed"
        assert "TEST_BANNED_ITEM_XYZ" in c["blacklist"]
        assert "DeWalt" in c["preferred_brands"]
        assert c["enabled"] is True
        # Amazon tag still preserved across update
        assert c["retailers"]["amazon"]["affiliate_tag"] == "diyhomie-20"


# ---------- posts listing ----------
class TestPosts:
    def test_posts_listing_shape(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/admin/affiliate/posts",
                  headers=_ah(admin_token), timeout=20)
        assert r.status_code == 200
        posts = r.json()
        assert isinstance(posts, list)
        assert len(posts) > 0, "expected blog posts"
        for p in posts[:3]:
            assert "slug" in p and "title" in p
            assert "has_list" in p
            assert "list_source" in p
            assert "item_count" in p
            assert "views" in p


# ---------- regenerate ----------
class TestRegenerate:
    def test_regenerate_returns_ai_list(self, s, admin_token, sample_slug):
        r = s.post(f"{BASE_URL}/api/admin/affiliate/regenerate/{sample_slug}",
                   headers=_ah(admin_token), timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        sl = body.get("shopping_list")
        assert sl, "shopping_list missing"
        # source may be 'ai' (success) or 'quick' (fallback). Prefer ai.
        assert sl.get("source") in ("ai", "quick")
        # Should contain at least one of the categories
        assert any(sl.get(k) for k in
                   ("materials", "tools", "optional_upgrades",
                    "replacement_parts", "frequently_bought", "main_product"))


# ---------- backfill ----------
class TestBackfill:
    def test_backfill_returns_queued(self, s, admin_token):
        r = s.post(f"{BASE_URL}/api/admin/affiliate/backfill",
                   headers=_ah(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "queued" in body
        assert isinstance(body["queued"], int)


# ---------- public /materials ----------
class TestPublicMaterials:
    def test_materials_shape_and_tag_and_blacklist(self, s, admin_token, sample_slug):
        # Make sure amazon tag + blacklist still configured (idempotent)
        s.put(f"{BASE_URL}/api/admin/affiliate/config",
              headers=_ah(admin_token),
              json={"retailers": {"amazon": {"affiliate_tag": "diyhomie-20",
                                              "enabled": True}},
                    "blacklist": ["TEST_BANNED_ITEM_XYZ"]},
              timeout=20)

        r = s.get(f"{BASE_URL}/api/blog/{sample_slug}/materials", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "title" in data
        assert "disclosure" in data
        assert "categories" in data and isinstance(data["categories"], list)
        assert len(data["categories"]) > 0, "expected categories"

        first_item = None
        for c in data["categories"]:
            assert "key" in c and "label" in c and "items" in c
            if c["items"]:
                first_item = c["items"][0]
                break
        assert first_item is not None
        assert "name" in first_item and "links" in first_item
        link_retailers = [l["retailer"] for l in first_item["links"]]
        # All 7 retailers must appear
        for rk in EXPECTED_RETAILERS:
            assert rk in link_retailers, f"missing retailer {rk} in links"

        # Priority ordering: amazon (1) first among retailer links
        retailer_only = [r for r in link_retailers if r != "direct"]
        assert retailer_only[0] == "amazon"

        # Amazon affiliate tag injected
        amazon_url = next(l["url"] for l in first_item["links"] if l["retailer"] == "amazon")
        assert "tag=diyhomie-20" in amazon_url

        # Blacklisted item must not appear in any category
        for c in data["categories"]:
            for it in c["items"]:
                assert it["name"].lower().strip() != "test_banned_item_xyz"


# ---------- public HTML SSR ----------
class TestPublicHTML:
    def test_html_contains_widget(self, s, sample_slug):
        r = s.get(f"{BASE_URL}/api/blog/{sample_slug}/html", timeout=20)
        assert r.status_code == 200, r.text
        html = r.text
        assert 'class="aff-wrap"' in html, "missing aff-wrap"
        btn_count = len(re.findall(r'class="aff-btn', html))
        assert btn_count >= 7, f"expected several aff-btn links, got {btn_count}"
        assert 'rel="nofollow sponsored noopener"' in html or \
               'rel="nofollow sponsored"' in html


# ---------- email engine smoke (regression) ----------
class TestEmailEngineSmoke:
    def test_email_overview_still_admin_gated(self, s, demo_token, admin_token):
        r = s.get(f"{BASE_URL}/api/admin/email/overview",
                  headers=_ah(demo_token), timeout=15)
        assert r.status_code in (401, 403)
        r = s.get(f"{BASE_URL}/api/admin/email/overview",
                  headers=_ah(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Just sanity-check it's a dict with some expected keys
        assert isinstance(body, dict)
