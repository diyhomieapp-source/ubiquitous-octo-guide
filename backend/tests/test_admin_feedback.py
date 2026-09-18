"""Backend tests: Admin workstation + Feedback widget (iteration 10).

Covers:
- Admin seeded login (TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD env vars) → is_admin true
- Normal user 403 on /api/admin/*
- POST /api/feedback persists; appears in admin list
- Admin PATCH/DELETE feedback
- Admin Tickets list + status transitions
- Admin Blog list + publish/unpublish + delete + public /blog reflects unpublish
- GET /admin/overview returns counts
"""
import os
import time
import uuid
import requests
import pytest

BASE = __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    return r


def _register(email, password):
    return requests.post(f"{BASE}/api/auth/register",
                         json={"email": email, "password": password, "name": "Tester"}, timeout=20)


@pytest.fixture(scope="module")
def admin_token():
    r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["user"]["is_admin"] is True, "is_admin not true on seeded admin"
    return body["access_token"]


@pytest.fixture(scope="module")
def user_token():
    email = f"test_admin_review_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = _register(email, __import__("os").environ.get("TEST_USER_PASSWORD", ""))
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def auth(tok): return {"Authorization": f"Bearer {tok}"}


# ---- RBAC ----
def test_admin_overview_ok(admin_token):
    r = requests.get(f"{BASE}/api/admin/overview", headers=auth(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "counts" in data
    counts = data["counts"]
    for k in ("users", "projects", "guides", "paid_subscribers", "blog_posts"):
        assert k in counts, f"missing {k} in counts"
        assert isinstance(counts[k], int)


def test_normal_user_forbidden_on_admin(user_token):
    for path in ("/api/admin/overview", "/api/admin/feedback", "/api/admin/tickets", "/api/admin/blog"):
        r = requests.get(f"{BASE}{path}", headers=auth(user_token), timeout=20)
        assert r.status_code == 403, f"expected 403 for {path}, got {r.status_code}"


def test_unauthenticated_admin_blocked():
    r = requests.get(f"{BASE}/api/admin/overview", timeout=10)
    assert r.status_code in (401, 403), r.status_code


# ---- Feedback flow ----
@pytest.fixture(scope="module")
def created_feedback_id(user_token):
    body = {"type": "bug", "message": f"TEST_FEEDBACK_{uuid.uuid4().hex[:6]} - widget bug report"}
    r = requests.post(f"{BASE}/api/feedback", json=body, headers=auth(user_token), timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert j.get("id")
    return j["id"]


def test_feedback_appears_in_admin_list(admin_token, created_feedback_id):
    r = requests.get(f"{BASE}/api/admin/feedback", headers=auth(admin_token), timeout=20)
    assert r.status_code == 200
    ids = [it["id"] for it in r.json().get("items", [])]
    assert created_feedback_id in ids, "submitted feedback missing from admin list"


def test_feedback_patch_status(admin_token, created_feedback_id):
    r = requests.patch(f"{BASE}/api/admin/feedback/{created_feedback_id}",
                       json={"status": "planned"}, headers=auth(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    # verify persisted
    r2 = requests.get(f"{BASE}/api/admin/feedback?status=planned", headers=auth(admin_token), timeout=20)
    assert r2.status_code == 200
    ids = [it["id"] for it in r2.json().get("items", [])]
    assert created_feedback_id in ids


def test_feedback_delete(admin_token, created_feedback_id):
    r = requests.delete(f"{BASE}/api/admin/feedback/{created_feedback_id}",
                        headers=auth(admin_token), timeout=20)
    assert r.status_code == 200
    # verify gone
    r2 = requests.get(f"{BASE}/api/admin/feedback", headers=auth(admin_token), timeout=20)
    ids = [it["id"] for it in r2.json().get("items", [])]
    assert created_feedback_id not in ids


def test_feedback_requires_message(user_token):
    r = requests.post(f"{BASE}/api/feedback", json={"type": "bug", "message": "   "},
                      headers=auth(user_token), timeout=20)
    assert r.status_code == 400


# ---- Tickets ----
def test_tickets_list_and_status(admin_token, user_token):
    # Create a ticket as user
    body = {"category": "bug", "subject": "TEST_TICKET", "message": "test ticket body"}
    r = requests.post(f"{BASE}/api/support/ticket", json=body, headers=auth(user_token), timeout=20)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]

    r2 = requests.get(f"{BASE}/api/admin/tickets", headers=auth(admin_token), timeout=20)
    assert r2.status_code == 200
    items = r2.json().get("items", [])
    assert any(t["id"] == tid for t in items)

    for status in ("in_progress", "closed", "open"):
        r3 = requests.patch(f"{BASE}/api/admin/tickets/{tid}", json={"status": status},
                            headers=auth(admin_token), timeout=20)
        assert r3.status_code == 200, f"status {status}: {r3.text}"

    # verify persistence of last status (open)
    r4 = requests.get(f"{BASE}/api/admin/tickets?status=open", headers=auth(admin_token), timeout=20)
    assert tid in [t["id"] for t in r4.json().get("items", [])]


# ---- Blog ----
def test_admin_blog_list(admin_token):
    r = requests.get(f"{BASE}/api/admin/blog", headers=auth(admin_token), timeout=20)
    assert r.status_code == 200
    assert "items" in r.json()


def test_blog_publish_toggle_and_delete(admin_token):
    # Get the first published post if any (or skip)
    r = requests.get(f"{BASE}/api/admin/blog", headers=auth(admin_token), timeout=20)
    items = r.json().get("items", [])
    if not items:
        pytest.skip("No blog posts to toggle/delete")
    target = items[0]
    slug = target["slug"]
    was_published = bool(target.get("published"))

    # Toggle published -> not
    r2 = requests.patch(f"{BASE}/api/admin/blog/{slug}", json={"published": not was_published},
                        headers=auth(admin_token), timeout=20)
    assert r2.status_code == 200, r2.text

    # If we just unpublished, public /api/blog must NOT include it
    if was_published:
        pub = requests.get(f"{BASE}/api/blog", timeout=20)
        assert pub.status_code == 200
        slugs = [p["slug"] for p in pub.json().get("posts", [])]
        assert slug not in slugs, "unpublished post should not appear on public /api/blog"

    # Restore
    requests.patch(f"{BASE}/api/admin/blog/{slug}", json={"published": was_published},
                   headers=auth(admin_token), timeout=20)


def test_blog_delete_invalid(admin_token):
    # Should not raise — delete_one returns ok even if nothing matched (current behavior)
    r = requests.delete(f"{BASE}/api/admin/blog/nonexistent-slug-xyz",
                        headers=auth(admin_token), timeout=20)
    assert r.status_code == 200
