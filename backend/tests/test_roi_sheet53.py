"""Backend tests for Sheet #53 — AI Project ROI & Outcome Insights Engine."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def demo_headers():
    return {"Authorization": f"Bearer {_login(DEMO_EMAIL, DEMO_PASS)}"}


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASS)}"}


# ---------- /api/roi/summary ----------
class TestRoiSummary:
    def test_summary_shape_and_demo_totals(self, demo_headers):
        r = requests.get(f"{API}/roi/summary", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["totals", "best_project", "projects"]).issubset(data.keys())
        t = data["totals"]
        for k in ("saved_cents", "value_add_cents", "avg_roi_pct", "hours", "hourly_cents", "projects"):
            assert k in t, f"missing totals.{k}"

        # Demo user should have exactly 3 seeded completed projects
        # (other suites create TEST_-titled ROI rows — exclude them for stability)
        seeded = [p for p in data["projects"] if not str(p.get("title") or "").startswith("TEST_")]
        assert len(seeded) == 3, f"expected 3 seeded projects, got {len(seeded)} — emergency logs may be leaking in"
        # ~$2,760 saved across the seeded three
        seeded_saved = sum(int(p.get("saved_cents") or 0) for p in seeded)
        assert 260000 <= seeded_saved <= 300000, f"saved_cents ~2760 expected, got {seeded_saved}"

    def test_summary_project_shape(self, demo_headers):
        r = requests.get(f"{API}/roi/summary", headers=demo_headers, timeout=30).json()
        for p in r["projects"]:
            assert p.get("project_id"), "each ROI project must have project_id (no emergency logs)"
            for k in ("saved_cents", "value_add_cents", "roi_pct", "breakdown", "badges"):
                assert k in p, f"missing field {k}"
            assert isinstance(p["breakdown"], list) and len(p["breakdown"]) >= 4
            assert isinstance(p["badges"], list)

    def test_summary_has_badges_awarded(self, demo_headers):
        r = requests.get(f"{API}/roi/summary", headers=demo_headers, timeout=30).json()
        all_badges = {b for p in r["projects"] for b in p.get("badges", [])}
        # At least Best ROI should be awarded
        assert "Best ROI" in all_badges, f"expected Best ROI badge, got {all_badges}"

    def test_summary_excludes_emergency_logs(self, demo_headers):
        # Emergency-triage logs live in timeline collection but must be filtered out (no project_id)
        r = requests.get(f"{API}/roi/summary", headers=demo_headers, timeout=30).json()
        pids = [p.get("project_id") for p in r["projects"]]
        assert all(pids), "some ROI entries have missing project_id — filter is not applied"


# ---------- /api/roi/recommendations ----------
class TestRoiRecommendations:
    def test_recs_are_season_aware(self, demo_headers):
        r = requests.get(f"{API}/roi/recommendations", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["season"] in ("Winter", "Spring", "Summer", "Fall")
        assert isinstance(d["recommendations"], list)
        assert 1 <= len(d["recommendations"]) <= 6
        for rec in d["recommendations"]:
            for k in ("id", "title", "annual_savings_cents", "est_cost_cents", "note"):
                assert k in rec


# ---------- /api/roi/project/{id} ----------
class TestRoiProject:
    def test_missing_project_returns_404(self, demo_headers):
        r = requests.get(f"{API}/roi/project/nonexistent_project_xyz_123", headers=demo_headers, timeout=30)
        assert r.status_code == 404

    def test_existing_project_returns_roi(self, demo_headers):
        summary = requests.get(f"{API}/roi/summary", headers=demo_headers, timeout=30).json()
        if not summary["projects"]:
            pytest.skip("no seeded projects")
        pid = summary["projects"][0]["project_id"]
        r = requests.get(f"{API}/roi/project/{pid}", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["project_id"] == pid
        assert "breakdown" in d and len(d["breakdown"]) >= 4


# ---------- /api/admin/roi/analytics ----------
class TestAdminRoiAnalytics:
    def test_non_admin_forbidden(self, demo_headers):
        r = requests.get(f"{API}/admin/roi/analytics", headers=demo_headers, timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_no_auth_forbidden(self):
        r = requests.get(f"{API}/admin/roi/analytics", timeout=30)
        assert r.status_code in (401, 403)

    def test_admin_returns_analytics(self, admin_headers):
        r = requests.get(f"{API}/admin/roi/analytics", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("totals", "by_room", "top_share_drivers"):
            assert k in d, f"missing {k}"
        t = d["totals"]
        for k in ("projects", "saved_cents", "value_add_cents", "avg_roi_pct", "shares", "testimonials"):
            assert k in t
        assert isinstance(d["by_room"], list)
        assert isinstance(d["top_share_drivers"], list)


# ---------- Regression: timeline/journey endpoints untouched ----------
class TestRegressionTimeline:
    def test_journey_and_projects_still_work(self, demo_headers):
        # ROI feature only reads timeline — verify journey/projects endpoints still respond 200
        r_journey = requests.get(f"{API}/journey", headers=demo_headers, timeout=30)
        assert r_journey.status_code == 200, f"journey broken: {r_journey.status_code}"
        r_projects = requests.get(f"{API}/projects", headers=demo_headers, timeout=30)
        assert r_projects.status_code == 200, f"projects broken: {r_projects.status_code}"
