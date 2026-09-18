"""Backend tests for SEO blog platform feature (DIYhomie iteration 9).

Light re-confirm of: blog auto-gen on guide build, /api/blog feed, /api/blog/{slug},
/api/blog/{slug}/html (SEO HTML with og:title + HowTo JSON-LD + share + CTA).
"""
import os
import time
import requests
import pytest

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

API = f"{BASE_URL}/api"


# --- helpers ----------------------------------------------------------------
def _register_unique() -> dict:
    ts = int(time.time() * 1000)
    email = f"TEST_blog_{ts}@diyhomie.com"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": "Blog Tester"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- 1. blog list endpoint is PUBLIC ---------------------------------------
class TestBlogPublicAccess:
    def test_blog_feed_no_auth(self):
        r = requests.get(f"{API}/blog", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "posts" in body and isinstance(body["posts"], list)
        assert "categories" in body and isinstance(body["categories"], list)

    def test_blog_filters_accept_category_and_q(self):
        # both filter params should be accepted (may return empty results)
        r = requests.get(f"{API}/blog?category=Kitchen&q=faucet&limit=5", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json().get("posts"), list)


# --- 2. full end-to-end: build a guide → blog post auto-created -----------
@pytest.fixture(scope="module")
def seeded_post():
    """Register a user, drive intake → guide for a known task, return the post slug."""
    auth = _register_unique()
    token = auth["access_token"]
    h = _auth(token)

    # create project
    r = requests.post(f"{API}/projects", headers=h, json={"title": "Replace a kitchen faucet"}, timeout=30)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]

    # intake (just to pass) — endpoint exists in earlier iterations
    requests.post(f"{API}/projects/{pid}/intake", headers=h, json={}, timeout=60)

    # build the guide (this triggers maybe_create_blog_post)
    r = requests.post(
        f"{API}/projects/{pid}/guide",
        headers=h,
        json={"context": {"model": "Moen Adler 87233"}},
        timeout=180,
    )
    assert r.status_code == 200, f"guide build failed: {r.status_code} {r.text[:300]}"
    proj = r.json()
    assert proj.get("steps"), "guide should have steps"

    # give the auto-gen a moment in case it's not awaited inline
    time.sleep(1.0)
    return {"token": token, "pid": pid, "project": proj}


class TestBlogAutoGen:
    def test_blog_post_created_for_guide(self, seeded_post):
        r = requests.get(f"{API}/blog?limit=50", timeout=15)
        assert r.status_code == 200
        posts = r.json()["posts"]
        assert len(posts) >= 1, "expected at least one auto-generated blog post"
        # find one matching kitchen faucet
        match = [p for p in posts if "kitchen-faucet" in p.get("slug", "") or "faucet" in p.get("title", "").lower()]
        assert match, f"no blog post resembling 'kitchen faucet' found in {[p.get('slug') for p in posts]}"
        p = match[0]
        assert p.get("category"), "post should have a category"
        assert p.get("title")
        assert p.get("slug")

    def test_blog_post_detail_has_full_fields(self, seeded_post):
        r = requests.get(f"{API}/blog?limit=50", timeout=15)
        slugs = [p["slug"] for p in r.json()["posts"] if "faucet" in p.get("slug", "") or "faucet" in p.get("title", "").lower()]
        assert slugs, "no slug to test"
        slug = slugs[0]
        d = requests.get(f"{API}/blog/{slug}", timeout=15)
        assert d.status_code == 200, d.text
        post = d.json()
        # expected enriched fields for the in-app reader
        for k in ("title", "h1", "slug", "category", "overview", "steps", "tools", "materials", "safety", "common_mistakes"):
            assert k in post, f"missing field {k}"
        assert isinstance(post["steps"], list) and len(post["steps"]) >= 1
        assert "_id" not in post, "MongoDB _id must be excluded"

    def test_blog_html_seo(self, seeded_post):
        r = requests.get(f"{API}/blog?limit=50", timeout=15)
        slugs = [p["slug"] for p in r.json()["posts"] if "faucet" in p.get("slug", "") or "faucet" in p.get("title", "").lower()]
        slug = slugs[0]
        h = requests.get(f"{API}/blog/{slug}/html", timeout=15)
        assert h.status_code == 200
        assert "text/html" in h.headers.get("content-type", "")
        html = h.text
        # SEO essentials
        assert 'property="og:title"' in html, "missing og:title"
        assert '"@type": "HowTo"' in html or '"@type":"HowTo"' in html, "missing HowTo JSON-LD"
        # share + CTA presence
        assert "share" in html.lower(), "no share link"
        # CTA funnel back to app
        assert "utm_source=blog" in html or "ref=blog" in html, "missing CTA app link"


# --- 3. guide build regression: blog auto-gen wrapped in try/except --------
class TestGuideBuildRegression:
    def test_second_user_first_guide_returns_200(self):
        auth = _register_unique()
        h = _auth(auth["access_token"])
        r = requests.post(f"{API}/projects", headers=h, json={"title": "Patch a small drywall hole"}, timeout=30)
        assert r.status_code == 200
        pid = r.json()["id"]
        requests.post(f"{API}/projects/{pid}/intake", headers=h, json={}, timeout=60)
        r = requests.post(f"{API}/projects/{pid}/guide", headers=h, json={"context": {}}, timeout=180)
        assert r.status_code == 200, f"guide build broken: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert body.get("steps"), "guide should still produce steps after blog feature"
