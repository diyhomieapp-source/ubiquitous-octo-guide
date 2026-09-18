"""Backend tests for Sponsored Learning & Campaigns Suite (Info Sheet #63)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback used only within container test harness; public URL is source of truth.
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set")

DEMO = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")}


def _login(session, creds):
    r = session.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    assert token
    return token


@pytest.fixture(scope="module")
def demo_client():
    s = requests.Session()
    tok = _login(s, DEMO)
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    tok = _login(s, ADMIN)
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


# ----------------- User routes -----------------
class TestUserCampaigns:
    def test_list_campaigns(self, demo_client):
        r = demo_client.get(f"{BASE_URL}/api/campaigns", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "campaigns" in data
        camps = data["campaigns"]
        assert len(camps) >= 1
        slugs = {c["slug"] for c in camps}
        assert "smart-lighting-month" in slugs
        for c in camps:
            assert "progress" in c
            p = c["progress"]
            assert "joined" in p and "status" in p and "pct" in p
            assert isinstance(p["pct"], int)

    def test_join_idempotent(self, demo_client):
        # Fresh campaign for E2E per main agent note is smart-lighting-month
        r1 = demo_client.post(f"{BASE_URL}/api/campaigns/smart-lighting-month/join", timeout=20)
        assert r1.status_code == 200
        # Second call should return existing:true
        r2 = demo_client.post(f"{BASE_URL}/api/campaigns/smart-lighting-month/join", timeout=20)
        assert r2.status_code == 200
        assert r2.json().get("existing") is True

    def test_detail_milestones_and_auto_ready(self, demo_client):
        r = demo_client.get(f"{BASE_URL}/api/campaigns/smart-lighting-month", timeout=20)
        assert r.status_code == 200
        c = r.json()
        assert c["slug"] == "smart-lighting-month"
        ms = c["milestones"]
        assert len(ms) == 3
        # Each has a `completed` flag
        for m in ms:
            assert "completed" in m
        # m1 is a lesson tied to paint-basics which demo_home HAS completed
        m1 = next(m for m in ms if m["id"] == "m1")
        if not m1["completed"]:
            assert m1.get("auto_ready") is True, f"m1 auto_ready should be true, got {m1}"

    def test_complete_task_milestone(self, demo_client):
        # Task-type m2 completes immediately
        r = demo_client.post(
            f"{BASE_URL}/api/campaigns/smart-lighting-month/milestone/m2/complete", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        # progress should show m2 counted
        assert body["progress"]["completed"] >= 1

    def test_complete_lesson_milestone_auto_ready(self, demo_client):
        # m1 lesson tied to paint-basics which is completed → should succeed
        r = demo_client.post(
            f"{BASE_URL}/api/campaigns/smart-lighting-month/milestone/m1/complete", timeout=20)
        assert r.status_code == 200, r.text

    def test_complete_all_gives_reward(self, demo_client):
        # complete m3 which should be the last one, triggering reward
        r = demo_client.post(
            f"{BASE_URL}/api/campaigns/smart-lighting-month/milestone/m3/complete", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["completed"] is True
        assert body["reward"] is not None
        assert body["reward"].get("badge") == "Smart Lighting Pro"
        assert body["reward"].get("discount_code") == "LUMA15"
        assert body["progress"]["status"] == "completed"
        assert body["progress"]["reward_claimed"] is True

    def test_story_optin_true_then_false(self, demo_client):
        r = demo_client.post(f"{BASE_URL}/api/campaigns/smart-lighting-month/story-optin",
                             json={"opt_in": True, "story": "TEST_my lighting upgrade story"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["story_opt_in"] is True
        # verify via detail
        d = demo_client.get(f"{BASE_URL}/api/campaigns/smart-lighting-month", timeout=20).json()
        assert d["progress"]["story_opt_in"] is True
        # opt_out
        r2 = demo_client.post(f"{BASE_URL}/api/campaigns/smart-lighting-month/story-optin",
                              json={"opt_in": False}, timeout=20)
        assert r2.status_code == 200
        assert r2.json()["story_opt_in"] is False
        d2 = demo_client.get(f"{BASE_URL}/api/campaigns/smart-lighting-month", timeout=20).json()
        assert d2["progress"]["story_opt_in"] is False

    def test_me_returns_participations_and_badges(self, demo_client):
        r = demo_client.get(f"{BASE_URL}/api/campaigns/me", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "participations" in data and "badges" in data
        # After completing smart-lighting-month, at least one badge should be present
        badge_names = [b.get("badge") for b in data["badges"]]
        assert "Smart Lighting Pro" in badge_names or "Winter-Ready Homeowner" in badge_names


# ----------------- Non-admin 403 -----------------
class TestAuthorization:
    def test_non_admin_forbidden_on_admin_routes(self, demo_client):
        r = demo_client.get(f"{BASE_URL}/api/admin/campaigns", timeout=20)
        assert r.status_code == 403


# ----------------- Admin routes -----------------
class TestAdminCampaigns:
    def test_list_admin_campaigns(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/campaigns", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "campaigns" in data
        for c in data["campaigns"]:
            assert "participants" in c and "completions" in c
            assert isinstance(c["participants"], int)

    def test_analytics(self, admin_client):
        rows = admin_client.get(f"{BASE_URL}/api/admin/campaigns", timeout=20).json()["campaigns"]
        target = next((c for c in rows if c["slug"] == "smart-lighting-month"), None)
        assert target is not None
        cid = target["id"]
        r = admin_client.get(f"{BASE_URL}/api/admin/campaigns/{cid}/analytics", timeout=20)
        assert r.status_code == 200
        a = r.json()
        for k in ("joined", "completed", "completion_rate", "story_optins", "milestone_funnel", "stories"):
            assert k in a
        assert a["joined"] >= 1
        assert isinstance(a["milestone_funnel"], list) and len(a["milestone_funnel"]) == 3
        # stories only if consented — currently we've opted-out, so 0 in this campaign
        # (winter campaign may have story from prior)
        for s in a["stories"]:
            assert "story" in s

    def test_toggle_active_to_ended_and_back(self, admin_client):
        rows = admin_client.get(f"{BASE_URL}/api/admin/campaigns", timeout=20).json()["campaigns"]
        # Use a campaign we won't disrupt — use smart-lighting-month
        target = next(c for c in rows if c["slug"] == "smart-lighting-month")
        cid = target["id"]
        original_status = target["status"]

        r = admin_client.post(f"{BASE_URL}/api/admin/campaigns/{cid}/toggle", timeout=20)
        assert r.status_code == 200
        new_status = r.json()["status"]
        assert new_status != original_status
        assert new_status in ("active", "ended")

        # Toggle back
        r2 = admin_client.post(f"{BASE_URL}/api/admin/campaigns/{cid}/toggle", timeout=20)
        assert r2.status_code == 200
        assert r2.json()["status"] == original_status
