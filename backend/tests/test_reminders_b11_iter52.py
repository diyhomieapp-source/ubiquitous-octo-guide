"""Backend tests for Maintenance Reminders (Blueprint 11 / iteration 52).

Covers:
- GET /api/hi/reminders/feed
- GET /api/hi/reminders/badge
- GET /api/hi/reminders/preferences (auto-create defaults)
- PUT /api/hi/reminders/preferences (persistence + invalid enum ignored)
- POST /api/hi/reminders/test-push (graceful with placeholder key)
- POST /api/register-push (route exists + validation)
- Auth gating (401/403 without token)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = "Test1234"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -------------------- Auth gating --------------------
class TestAuthGating:
    def test_feed_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/hi/reminders/feed", timeout=15)
        assert r.status_code in (401, 403)

    def test_badge_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/hi/reminders/badge", timeout=15)
        assert r.status_code in (401, 403)

    def test_prefs_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/hi/reminders/preferences", timeout=15)
        assert r.status_code in (401, 403)


# -------------------- Feed --------------------
class TestFeed:
    def test_feed_shape_and_overdue(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/reminders/feed", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("overdue", "due_today", "this_week", "counts", "headline"):
            assert k in d, f"missing {k}"
        c = d["counts"]
        for k in ("overdue", "due_today", "this_week", "badge"):
            assert k in c
        assert c["badge"] == c["overdue"] + c["due_today"]
        assert c["overdue"] >= 1, f"expected overdue>=1 for demo, got {c}"
        assert "overdue" in d["headline"].lower(), d["headline"]
        titles = [t.get("title", "") for t in d["overdue"]]
        assert any("HVAC" in t or "filter" in t.lower() for t in titles), titles


# -------------------- Badge --------------------
class TestBadge:
    def test_badge_matches_feed(self, h):
        feed = requests.get(f"{BASE_URL}/api/hi/reminders/feed", headers=h, timeout=30).json()
        b = requests.get(f"{BASE_URL}/api/hi/reminders/badge", headers=h, timeout=15)
        assert b.status_code == 200
        assert b.json()["count"] == feed["counts"]["badge"]


# -------------------- Preferences --------------------
class TestPreferences:
    def test_defaults_autocreated_and_updated(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/reminders/preferences", headers=h, timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert "push_enabled" in p and "digest_frequency" in p
        # Restore to defaults first (in case previous tests mutated it)
        rst = requests.put(f"{BASE_URL}/api/hi/reminders/preferences", headers=h,
                           json={"push_enabled": False, "digest_frequency": "weekly"}, timeout=15)
        assert rst.status_code == 200
        assert rst.json()["push_enabled"] is False
        assert rst.json()["digest_frequency"] == "weekly"

    def test_put_persists(self, h):
        r = requests.put(f"{BASE_URL}/api/hi/reminders/preferences", headers=h,
                         json={"push_enabled": True, "digest_frequency": "daily"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["push_enabled"] is True
        assert d["digest_frequency"] == "daily"
        # GET verifies persistence
        g = requests.get(f"{BASE_URL}/api/hi/reminders/preferences", headers=h, timeout=15).json()
        assert g["push_enabled"] is True
        assert g["digest_frequency"] == "daily"

    def test_invalid_digest_ignored(self, h):
        # First set to daily
        requests.put(f"{BASE_URL}/api/hi/reminders/preferences", headers=h,
                     json={"digest_frequency": "daily"}, timeout=15)
        r = requests.put(f"{BASE_URL}/api/hi/reminders/preferences", headers=h,
                         json={"digest_frequency": "hourly"}, timeout=15)
        assert r.status_code == 200
        # Should stay 'daily' because 'hourly' isn't in allowed enum
        assert r.json()["digest_frequency"] == "daily"

    def test_cleanup_reset_prefs(self, h):
        requests.put(f"{BASE_URL}/api/hi/reminders/preferences", headers=h,
                     json={"push_enabled": False, "digest_frequency": "weekly"}, timeout=15)


# -------------------- Test push --------------------
class TestTestPush:
    def test_test_push_graceful(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/reminders/test-push", headers=h, timeout=30)
        assert r.status_code == 200, f"must not 500 with placeholder key: {r.status_code} {r.text}"
        d = r.json()
        assert d.get("ok") is True
        # With placeholder key, sent should be False and there should be a note
        if d.get("sent") is False:
            assert "note" in d


# -------------------- Register push --------------------
class TestRegisterPush:
    def test_register_push_validation(self, h):
        # Missing fields -> 422
        r = requests.post(f"{BASE_URL}/api/register-push", headers=h, json={"user_id": "x"}, timeout=15)
        assert r.status_code == 422

    def test_register_push_route_registered(self, h):
        # With placeholder key we tolerate 500/502 but the route must exist (not 404)
        r = requests.post(f"{BASE_URL}/api/register-push", headers=h,
                          json={"user_id": "test-user", "platform": "ios", "device_token": "TESTTOKEN"}, timeout=30)
        assert r.status_code != 404, "route not registered"
        assert r.status_code in (201, 401, 500, 502), r.status_code
