"""
Tests for the CFO Finance Dashboard, Homeowner Journey / Achievement / Completion Story engine,
Profile enhancements (bio, share_public, avatar), and Community Feed inclusion of shared completions.

Covers:
  - GET  /api/admin/finance/summary               (admin gated)
  - POST /api/admin/finance/expenses              (admin gated)
  - PUT  /api/admin/finance/cash                  (admin gated)
  - DELETE /api/admin/finance/expenses/{id}       (admin gated)
  - GET  /api/journey
  - POST /api/projects/{id}/complete              (idempotency + payload shape)
  - PUT  /api/profile                             (bio, share_public)
  - GET  /api/journey/u/{user_id}                 (public journey gate)
  - GET  /api/community/feed                      (shared completion appears)
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


# ---------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def user_ctx(api):
    """Fresh user (has 60 credits, first guide free)."""
    email = f"TEST_journey_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": "Timeline Tester"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    return {"token": j["access_token"], "user_id": j["user"]["id"], "email": email}


@pytest.fixture(scope="session")
def user_h(user_ctx):
    return {"Authorization": f"Bearer {user_ctx['token']}", "Content-Type": "application/json"}


# ---------------------------------------------------------------- Finance / CFO
class TestFinance:
    def test_summary_admin_only(self, api):
        r = api.get(f"{BASE_URL}/api/admin/finance/summary", timeout=30)
        assert r.status_code in (401, 403), f"Expected auth gate, got {r.status_code}"

    def test_summary_shape(self, api, admin_h):
        r = api.get(f"{BASE_URL}/api/admin/finance/summary", headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in [
            "mrr", "revenue_month", "monthly_expenses", "net_monthly", "margin",
            "cash_on_hand", "runway_months", "tier_counts", "paying_users",
            "total_users", "arpu", "expenses",
        ]:
            assert k in d, f"Missing key {k} in finance summary"
        assert isinstance(d["expenses"], list)
        assert isinstance(d["tier_counts"], dict)
        # net = mrr - monthly_expenses  (allow AI-independent math check)
        assert d["net_monthly"] == d["mrr"] - d["monthly_expenses"]

    def test_add_delete_expense_and_net_update(self, api, admin_h):
        before = api.get(f"{BASE_URL}/api/admin/finance/summary", headers=admin_h, timeout=30).json()
        payload = {"label": f"TEST_hosting_{uuid.uuid4().hex[:6]}", "amount_cents": 12345, "cadence": "monthly"}
        r = api.post(f"{BASE_URL}/api/admin/finance/expenses", headers=admin_h, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        exp = r.json()
        assert exp["label"] == payload["label"]
        assert exp["amount_cents"] == 12345
        assert exp["cadence"] == "monthly"
        assert "id" in exp

        # verify GET reflects change
        after = api.get(f"{BASE_URL}/api/admin/finance/summary", headers=admin_h, timeout=30).json()
        assert after["monthly_expenses"] == before["monthly_expenses"] + 12345
        assert any(e["id"] == exp["id"] for e in after["expenses"])
        # margin recomputed
        if after["mrr"]:
            assert abs(after["margin"] - round(after["net_monthly"] / after["mrr"] * 100, 1)) < 0.01

        # delete
        d = api.delete(f"{BASE_URL}/api/admin/finance/expenses/{exp['id']}", headers=admin_h, timeout=30)
        assert d.status_code == 200 and d.json().get("ok") is True
        gone = api.get(f"{BASE_URL}/api/admin/finance/summary", headers=admin_h, timeout=30).json()
        assert not any(e["id"] == exp["id"] for e in gone["expenses"])
        assert gone["monthly_expenses"] == before["monthly_expenses"]

    def test_set_cash(self, api, admin_h):
        target = 999_00  # $999
        r = api.put(f"{BASE_URL}/api/admin/finance/cash", headers=admin_h, json={"cash_on_hand_cents": target}, timeout=30)
        assert r.status_code == 200
        summary = api.get(f"{BASE_URL}/api/admin/finance/summary", headers=admin_h, timeout=30).json()
        assert summary["cash_on_hand"] == target


# ---------------------------------------------------------------- Profile enhancements
class TestProfile:
    def test_update_bio_and_share_public(self, api, user_h, user_ctx):
        r = api.put(
            f"{BASE_URL}/api/profile",
            headers=user_h,
            json={"bio": "TEST bio line", "share_public": True},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        me = api.get(f"{BASE_URL}/api/auth/me", headers=user_h, timeout=30).json()
        assert me.get("bio") == "TEST bio line"
        assert me.get("share_public") is True

    def test_public_journey_gate(self, api, user_ctx, user_h):
        # ensure share_public True (previous test)
        pub = api.get(f"{BASE_URL}/api/journey/u/{user_ctx['user_id']}", timeout=30)
        assert pub.status_code == 200, pub.text
        # now flip off and confirm 404
        api.put(f"{BASE_URL}/api/profile", headers=user_h, json={"share_public": False}, timeout=30)
        priv = api.get(f"{BASE_URL}/api/journey/u/{user_ctx['user_id']}", timeout=30)
        assert priv.status_code == 404


# ---------------------------------------------------------------- Journey + Completion
class TestJourneyCompletion:
    _project_id = None
    _shared_experience_title = None

    def test_empty_journey(self, api, user_h):
        r = api.get(f"{BASE_URL}/api/journey", headers=user_h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["projects_completed"] == 0
        assert d["money_saved_cents"] == 0
        assert isinstance(d["achievements"], list) and len(d["achievements"]) >= 9
        assert all(a["earned"] is False for a in d["achievements"])
        assert d["timeline"] == []

    def test_create_project_for_completion(self, api, user_h):
        r = api.post(
            f"{BASE_URL}/api/projects",
            headers=user_h,
            json={"title": "TEST Patch a small drywall hole", "location": "Boston, MA"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        assert pid
        TestJourneyCompletion._project_id = pid

    def test_complete_project_generates_story(self, api, user_h):
        pid = TestJourneyCompletion._project_id
        assert pid, "Project must be created first"
        payload = {
            "cost_cents": 1500,   # $15 materials
            "hours": 1.5,
            "rating": 5,
            "reflection": "Went smooth, no cracks.",
            "share_community": True,
        }
        r = api.post(f"{BASE_URL}/api/projects/{pid}/complete", headers=user_h, json=payload, timeout=180)
        assert r.status_code == 200, r.text
        d = r.json()
        # LLM story keys
        assert "entry" in d and d["entry"]["story_title"] and d["entry"]["story"]
        assert isinstance(d["money_saved_cents"], int)
        assert isinstance(d["pro_cost_cents"], int)
        assert d["pro_cost_cents"] >= 0
        assert d["money_saved_cents"] == max(0, d["pro_cost_cents"] - payload["cost_cents"])
        # new_achievements should contain 'first_project'
        ids = {a["id"] for a in d["new_achievements"]}
        assert "first_project" in ids, f"Expected first_project achievement, got {ids}"
        # timeline populated
        assert d["journey"]["projects_completed"] == 1
        assert len(d["journey"]["timeline"]) == 1
        TestJourneyCompletion._shared_experience_title = d["entry"]["story_title"]

    def test_double_complete_rejected(self, api, user_h):
        pid = TestJourneyCompletion._project_id
        r = api.post(
            f"{BASE_URL}/api/projects/{pid}/complete",
            headers=user_h,
            json={"cost_cents": 100, "hours": 1, "rating": 4, "reflection": "again", "share_community": False},
            timeout=60,
        )
        assert r.status_code == 400, r.text
        assert "already" in r.json().get("detail", "").lower()

    def test_journey_after_completion(self, api, user_h):
        r = api.get(f"{BASE_URL}/api/journey", headers=user_h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["projects_completed"] == 1
        assert d["total_hours"] == 1.5
        assert d["achievements_earned"] >= 1
        assert any(a["id"] == "first_project" and a["earned"] for a in d["achievements"])
        assert len(d["timeline"]) == 1
        assert len(d["skills"]) >= 1

    def test_shared_completion_in_community_feed(self, api):
        r = api.get(f"{BASE_URL}/api/community/feed", timeout=30)
        assert r.status_code == 200
        feed = r.json()
        assert isinstance(feed, list)
        title = TestJourneyCompletion._shared_experience_title
        matches = [f for f in feed if f.get("title") == title]
        assert matches, f"Shared completion '{title}' not found in community feed (feed has {len(feed)} items)"
        entry = matches[0]
        # completion post shape
        assert entry.get("body")
        assert entry.get("author")
