"""
Tests for DIYhomie Blueprint 21 — Adaptive Project Intelligence & Execution Engine.

All endpoints under /api/hi/pi/*. Reads existing hi_projects / hi_project_steps /
hi_project_materials created by Blueprint 03 planner. Uses demo_home@diyhomie.com.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://step-by-step-diy.preview.emergentagent.com"

DEMO = {"email": "demo_home@diyhomie.com", "password": "Test1234"}


# --------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_ctx(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json=DEMO, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    return {"token": j["access_token"], "user_id": j["user"]["id"]}


@pytest.fixture(scope="session")
def h(demo_ctx):
    return {"Authorization": f"Bearer {demo_ctx['token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def other_ctx(api):
    """A DIFFERENT user, to test 404 (cross-user) enforcement."""
    email = f"TEST_b21other_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = api.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": "Test1234", "name": "Other"},
                 timeout=30)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    return {"token": j["access_token"], "user_id": j["user"]["id"]}


def _pick_active_project(api, h):
    """Return an existing planner project owned by demo_home in a testable state.

    Prefer non-completed, non-blocked, risk_level != Professional Recommended.
    """
    r = api.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=30)
    assert r.status_code == 200
    projects = r.json()["projects"]
    for p in projects:
        if p.get("status") in ("draft", "planning", "active", "paused"):
            return p
    # fallback: any project
    if projects:
        return projects[0]
    return None


def _pick_risky_project(api, h):
    """Return a project with risk_level High Risk / Professional Recommended."""
    r = api.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=30)
    assert r.status_code == 200
    for p in r.json()["projects"]:
        if p.get("risk_level") in ("High Risk", "Professional Recommended"):
            return p
    return None


@pytest.fixture(scope="session")
def project_id(api, h):
    p = _pick_active_project(api, h)
    if not p:
        # Create one via existing planner
        r = api.post(f"{BASE_URL}/api/hi/projects/start", headers=h,
                     json={"goal": "Install a floating oak shelf 24 inches above my desk.",
                           "project_category": "Build Something"}, timeout=90)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert not d.get("needs_clarification"), d
        pid = d["project"]["id"]
        api.put(f"{BASE_URL}/api/hi/projects/{pid}/discovery", headers=h,
                json={"skill_level": "Beginner", "budget_preference": "Moderate",
                      "timing_preference": "This Week"}, timeout=30)
        api.post(f"{BASE_URL}/api/hi/projects/{pid}/plan", headers=h, timeout=180)
        return pid
    return p["id"]


# ============================================================= Auth enforcement
class TestAuth:
    def test_workspace_requires_auth(self, api, project_id):
        r = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/workspace", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_workspace_wrong_owner_returns_404(self, api, other_ctx, project_id):
        oh = {"Authorization": f"Bearer {other_ctx['token']}",
              "Content-Type": "application/json"}
        r = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/workspace",
                    headers=oh, timeout=30)
        assert r.status_code == 404, r.text[:200]


# =============================================================== Workspace/NBA
class TestWorkspace:
    def test_workspace_shape(self, api, h, project_id):
        r = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/workspace",
                    headers=h, timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for k in ("project", "next_best_action", "progress", "blockers",
                  "decisions", "needed_now", "budget"):
            assert k in d, f"missing key {k}: {list(d.keys())}"
        nba = d["next_best_action"]
        for k in ("title", "why", "actions", "phase"):
            assert k in nba, f"nba missing {k}: {nba}"
        pg = d["progress"]
        for k in ("total", "done", "pct"):
            assert k in pg
        b = d["budget"]
        for k in ("estimated_required_cost", "estimated_optional_cost",
                  "actual_spend", "budget_limit", "variance", "over_budget"):
            assert k in b, f"budget missing {k}: {b}"

    def test_next_best_action_endpoint(self, api, h, project_id):
        r = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/next-best-action",
                    headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["project_id"] == project_id
        assert "title" in d["next_best_action"]
        assert "phase" in d["next_best_action"]


# ================================================================== Blockers
class TestBlockers:
    def test_add_blocker_and_nba_reflects(self, api, h, project_id):
        r = api.post(f"{BASE_URL}/api/hi/pi/projects/{project_id}/blockers",
                     headers=h,
                     json={"blocker_type": "missing_measurement",
                           "description": "TEST_B21 need wall width"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        b = r.json()
        assert b["blocker_type"] == "missing_measurement"
        assert b["status"] == "active"
        assert b["id"]
        pytest.b21_blocker_id = b["id"]

        # NBA must now surface this blocker (phase=blocked)
        w = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/workspace",
                    headers=h, timeout=30).json()
        assert w["next_best_action"]["phase"] == "blocked", w["next_best_action"]
        assert w["next_best_action"].get("blocker_id") == b["id"]
        assert any(x["id"] == b["id"] for x in w["blockers"])

    def test_safety_blocker_marks_project_blocked(self, api, h, project_id):
        r = api.post(f"{BASE_URL}/api/hi/pi/projects/{project_id}/blockers",
                     headers=h,
                     json={"blocker_type": "safety",
                           "description": "TEST_B21 exposed wiring"}, timeout=30)
        assert r.status_code == 200
        pytest.b21_safety_blocker_id = r.json()["id"]

        proj = api.get(f"{BASE_URL}/api/hi/projects/{project_id}",
                       headers=h, timeout=30).json()["project"]
        assert proj["status"] == "blocked", proj

    def test_resolve_blockers_unblocks_project(self, api, h, project_id):
        # resolve both
        for bid in (pytest.b21_blocker_id, pytest.b21_safety_blocker_id):
            r = api.post(f"{BASE_URL}/api/hi/pi/blockers/{bid}/resolve",
                         headers=h, timeout=30)
            assert r.status_code == 200, r.text[:200]

        # project no longer 'blocked'
        proj = api.get(f"{BASE_URL}/api/hi/projects/{project_id}",
                       headers=h, timeout=30).json()["project"]
        assert proj["status"] != "blocked", proj

        # NBA no longer 'blocked'
        w = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/workspace",
                    headers=h, timeout=30).json()
        assert w["next_best_action"]["phase"] != "blocked", w["next_best_action"]

    def test_add_blocker_empty_desc_400(self, api, h, project_id):
        r = api.post(f"{BASE_URL}/api/hi/pi/projects/{project_id}/blockers",
                     headers=h,
                     json={"blocker_type": "other", "description": "   "}, timeout=30)
        assert r.status_code == 400


# =============================================================== Change impact
class TestChange:
    def test_budget_low_preserves_safety(self, api, h, project_id):
        r = api.post(f"{BASE_URL}/api/hi/pi/projects/{project_id}/change",
                     headers=h,
                     json={"change_type": "budget", "new_value": "Low"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        ev = r.json()
        for k in ("id", "impact_summary", "recommendations", "status"):
            assert k in ev, ev
        assert ev["status"] == "pending_review"
        recs = " ".join(ev["recommendations"]).lower()
        assert "safety" in recs, f"safety missing from recs: {ev['recommendations']}"
        assert any("defer" in r.lower() or "optional" in r.lower()
                   for r in ev["recommendations"]), ev["recommendations"]
        pytest.b21_change_id = ev["id"]

    def test_apply_change(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/pi/change-events/{pytest.b21_change_id}/apply",
                     headers=h, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_change_history_preserved(self, api, h, project_id):
        # add a second change so history has >=2 entries
        api.post(f"{BASE_URL}/api/hi/pi/projects/{project_id}/change",
                 headers=h,
                 json={"change_type": "measurement", "new_value": "Updated"}, timeout=30)
        r = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/changes",
                    headers=h, timeout=30)
        assert r.status_code == 200
        changes = r.json()["changes"]
        assert len(changes) >= 2
        # applied change is still in history
        assert any(c["id"] == pytest.b21_change_id and c["status"] == "applied"
                   for c in changes)

    def test_invalid_change_type_400(self, api, h, project_id):
        r = api.post(f"{BASE_URL}/api/hi/pi/projects/{project_id}/change",
                     headers=h,
                     json={"change_type": "bogus", "new_value": "x"}, timeout=30)
        assert r.status_code == 400


# ==================================================================== Budget
class TestBudget:
    def test_get_budget(self, api, h, project_id):
        r = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/budget",
                    headers=h, timeout=30)
        assert r.status_code == 200
        b = r.json()
        assert "estimated_required_cost" in b
        assert "over_budget" in b

    def test_set_limit_and_actual_over_budget(self, api, h, project_id):
        # set high limit first
        r = api.put(f"{BASE_URL}/api/hi/pi/projects/{project_id}/budget",
                    headers=h, json={"budget_limit": 500}, timeout=30)
        assert r.status_code == 200
        assert r.json()["budget_limit"] == 500

        # GET verify persisted
        b = api.get(f"{BASE_URL}/api/hi/pi/projects/{project_id}/budget",
                    headers=h, timeout=30).json()
        assert b["budget_limit"] == 500

        # push actual over limit
        r2 = api.put(f"{BASE_URL}/api/hi/pi/projects/{project_id}/budget",
                     headers=h, json={"actual_cost": 750}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["over_budget"] is True
        assert r2.json()["variance"] == -250  # 500 - 750

    def test_reset_actual(self, api, h, project_id):
        # cleanup: bring actual back down (so other tests unaffected)
        r = api.put(f"{BASE_URL}/api/hi/pi/projects/{project_id}/budget",
                    headers=h, json={"actual_cost": 0}, timeout=30)
        assert r.status_code == 200


# ================================================================ Safety gate
class TestSafetyGate:
    def test_safe_complete_requires_confirm_on_risky_step(self, api, h, project_id):
        """A step is 'risky' when it has a safety_note OR when project risk_level is
        High Risk / Professional Recommended. Prefer risky project, fall back to a
        step-level safety_note within the active project."""
        target_pid = project_id
        step_id = None
        risky = _pick_risky_project(api, h)
        if risky:
            rd = api.get(f"{BASE_URL}/api/hi/projects/{risky['id']}",
                         headers=h, timeout=30).json()
            for ph in rd.get("phases", []):
                for s in ph.get("steps", []):
                    if s.get("status") in ("not_started", "active"):
                        step_id = s["id"]; target_pid = risky["id"]; break
                if step_id: break

        if not step_id:
            # fallback: use the current project, find a step with safety_note
            rd = api.get(f"{BASE_URL}/api/hi/projects/{target_pid}",
                         headers=h, timeout=30).json()
            for ph in rd.get("phases", []):
                for s in ph.get("steps", []):
                    if s.get("status") in ("not_started", "active") and s.get("safety_note"):
                        step_id = s["id"]; break
                if step_id: break
        if not step_id:
            pytest.skip("no risky step available on demo_home projects")

        # confirm=false -> 428
        r = api.post(
            f"{BASE_URL}/api/hi/pi/projects/{target_pid}/steps/{step_id}/safe-complete",
            headers=h, json={"confirm": False}, timeout=30)
        assert r.status_code == 428, f"expected 428, got {r.status_code} {r.text[:200]}"

        # confirm=true -> 200
        r2 = api.post(
            f"{BASE_URL}/api/hi/pi/projects/{target_pid}/steps/{step_id}/safe-complete",
            headers=h, json={"confirm": True}, timeout=30)
        assert r2.status_code == 200, r2.text[:200]
        assert r2.json().get("ok") is True
