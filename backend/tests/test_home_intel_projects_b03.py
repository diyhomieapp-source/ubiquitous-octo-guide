"""
Tests for DIYhomie Home Intelligence B03 — AI Project Planner & Guided Workspace.

Endpoints exercised (all under /api/hi/projects):
  POST   /start                         -> categorize goal (or clarify)
  PUT    /{id}/discovery                -> save skill/budget/timing/tools
  POST   /{id}/plan                     -> SAFETY REVIEW + phased plan or 409 emergency
  GET    /{id}                          -> detail with phases/steps/current_step/progress
  GET    /{id}/materials                -> grouped shopping list
  PUT    /materials/{material_id}       -> user_status transitions
  PUT    /steps/{step_id}               -> completes/skips (progress updates)
  PUT    /{id}/status                   -> pause / resume
  POST   /{id}/ask                      -> Homie Q&A
  POST   /{id}/outcome                  -> completed/unresolved/escalated

Also re-verifies the Blueprint 02 collision fix:
  POST /api/hi/rooms now returns rich fields (room_type, persistent_room_id, status)
  and creating an asset via room_name links to a valid room.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://step-by-step-diy.preview.emergentagent.com"


# --------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_ctx(api):
    email = f"TEST_b03_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = api.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": "Test1234", "name": "B03 Tester"},
                 timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    return {"token": j["access_token"], "user_id": j["user"]["id"], "email": email}


@pytest.fixture(scope="session")
def h(user_ctx):
    return {"Authorization": f"Bearer {user_ctx['token']}",
            "Content-Type": "application/json"}


# =============================================================== B02 regression
class TestB02CollisionFix:
    """POST /api/hi/rooms must return the RICH room shape (regression from iter_46)."""

    def test_rich_room_create(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/rooms", headers=h,
                     json={"name": "TEST_B03_Kitchen", "room_type": "Kitchen",
                           "floor_name": "Main Floor",
                           "classification_confidence": "Confirmed"},
                     timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["room_type"] == "Kitchen", f"missing room_type: {d}"
        assert d["persistent_room_id"] == d["id"]
        assert d["status"] == "active"
        pytest.b03_room_id = d["id"]

    def test_map_and_profile_still_work(self, api, h):
        m = api.get(f"{BASE_URL}/api/hi/rooms/map", headers=h, timeout=30)
        assert m.status_code == 200
        assert any(r["id"] == pytest.b03_room_id for r in m.json()["rooms"])
        p = api.get(f"{BASE_URL}/api/hi/rooms/{pytest.b03_room_id}/profile",
                    headers=h, timeout=30)
        assert p.status_code == 200
        assert p.json()["room"]["room_type"] == "Kitchen"

    def test_asset_by_room_name_links(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/assets", headers=h,
                     json={"name": "TEST_Range", "category": "Appliance",
                           "room_name": "TEST_B03_Kitchen"}, timeout=30)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a.get("room_id") == pytest.b03_room_id, f"room_id not linked: {a}"
        pytest.b03_asset_id = a["id"]


# =============================================================== B03 happy path
class TestB03ProjectFlow:
    def test_start_categorizes_project(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/projects/start", headers=h,
                     json={"goal": "Build a floating shelf above my desk",
                           "room_id": pytest.b03_room_id}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        if d.get("needs_clarification"):
            # LLM asked a question — send an explicit category to force a project row
            r2 = api.post(f"{BASE_URL}/api/hi/projects/start", headers=h,
                          json={"goal": "Build a floating oak shelf 24 inches long "
                                        "above my desk on drywall with studs.",
                                "project_category": "Build Something",
                                "room_id": pytest.b03_room_id}, timeout=90)
            assert r2.status_code == 200
            d = r2.json()
        assert d["needs_clarification"] is False, d
        p = d["project"]
        assert p["status"] == "draft"
        assert p["project_category"] in [
            "Fix Something", "Maintain Something", "Build Something",
            "Remodel a Space", "Improve My Yard", "Organize My Home"]
        assert p["title"]
        pytest.b03_project_id = p["id"]

    def test_discovery_saves(self, api, h):
        r = api.put(f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/discovery",
                    headers=h,
                    json={"skill_level": "Beginner", "budget_preference": "Moderate",
                          "timing_preference": "This Week",
                          "available_tools": "drill, level, stud finder"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["skill_level"] == "Beginner"
        assert d["budget_preference"] == "Moderate"
        assert d["timing_preference"] == "This Week"

    def test_plan_generates_phases_steps_materials(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/plan",
                     headers=h, timeout=180)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        proj = d["project"]
        assert proj["risk_level"] in [
            "Low Risk", "Moderate Risk", "High Risk", "Professional Recommended"]
        assert proj["safety_status"] in [
            "Safe to continue", "Verify first", "Stop and contact a professional"]
        # ranges — not asserted values, but keys exist (LLM may occasionally omit)
        assert "estimated_cost_low" in proj and "estimated_cost_high" in proj
        assert len(d["phases"]) >= 1
        # each phase name must be in the allowed set
        allowed_phases = {"Plan", "Prepare", "Purchase Materials",
                          "Complete Work", "Inspect", "Clean Up", "Maintain"}
        for ph in d["phases"]:
            assert ph["phase_name"] in allowed_phases
        # at least one step
        total_steps = sum(len(ph["steps"]) for ph in d["phases"])
        assert total_steps >= 1, "plan has no steps"
        pytest.b03_first_step_id = d["current_step"]["id"] if d.get("current_step") else \
            d["phases"][0]["steps"][0]["id"]
        pytest.b03_total_steps = total_steps

    def test_get_project_detail(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}",
                    headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["project"]["id"] == pytest.b03_project_id
        assert d["steps_total"] == pytest.b03_total_steps
        assert 0 <= d["progress_pct"] <= 100

    def test_materials_grouped(self, api, h):
        r = api.get(
            f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/materials",
            headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert set(d["grouped"].keys()) == {
            "material", "tool", "safety_equipment", "optional_upgrade"}
        # at least ONE material in any group (LLM usually returns >=1)
        total_mats = sum(len(v) for v in d["grouped"].values())
        assert total_mats >= 1, "no materials returned"
        pytest.b03_mat_id = d["materials"][0]["id"]
        assert d["materials"][0]["user_status"] == "unsure"

    def test_update_material_status(self, api, h):
        r = api.put(f"{BASE_URL}/api/hi/projects/materials/{pytest.b03_mat_id}",
                    headers=h, json={"user_status": "have_it"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["user_status"] == "have_it"
        # GET-verify persisted
        rl = api.get(
            f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/materials",
            headers=h, timeout=30)
        assert any(m["id"] == pytest.b03_mat_id and m["user_status"] == "have_it"
                   for m in rl.json()["materials"])

    def test_complete_step_advances_progress(self, api, h):
        r = api.put(
            f"{BASE_URL}/api/hi/projects/steps/{pytest.b03_first_step_id}",
            headers=h, json={"status": "completed"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["steps_done"] >= 1
        assert d["progress_pct"] > 0

    def test_pause_and_resume(self, api, h):
        rp = api.put(
            f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/status",
            headers=h, json={"status": "paused"}, timeout=30)
        assert rp.status_code == 200 and rp.json()["status"] == "paused"
        rr = api.put(
            f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/status",
            headers=h, json={"status": "active"}, timeout=30)
        assert rr.status_code == 200 and rr.json()["status"] == "active"

    def test_ask_homie_returns_answer(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/ask",
                     headers=h,
                     json={"question": "What stud spacing should I plan for?"},
                     timeout=120)
        assert r.status_code == 200, r.text[:200]
        assert isinstance(r.json().get("answer"), str)
        assert len(r.json()["answer"]) > 0

    def test_outcome_completed(self, api, h):
        r = api.post(
            f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}/outcome",
            headers=h,
            json={"result": "completed", "actual_cost": "$45",
                  "actual_duration": "2h", "completion_notes": "TEST looks great",
                  "lessons_learned": "TEST measure twice"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "completed"
        # verify status persisted
        d = api.get(f"{BASE_URL}/api/hi/projects/{pytest.b03_project_id}",
                    headers=h, timeout=30).json()
        assert d["project"]["status"] == "completed"
        assert d["project"].get("completed_at")


# =============================================================== emergency path
class TestB03Emergency:
    def test_emergency_goal_returns_409_on_plan(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/projects/start", headers=h,
                     json={"goal": "I smell gas near the water heater and see sparks",
                           "project_category": "Fix Something"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["needs_clarification"] is False, d
        pid = d["project"]["id"]
        # skip discovery — plan should short-circuit on _danger()
        r2 = api.post(f"{BASE_URL}/api/hi/projects/{pid}/plan",
                      headers=h, timeout=60)
        assert r2.status_code == 409, f"expected 409, got {r2.status_code}: {r2.text[:200]}"
        # project row should be marked escalated
        d3 = api.get(f"{BASE_URL}/api/hi/projects/{pid}",
                     headers=h, timeout=30).json()
        assert d3["project"]["status"] == "escalated"
        assert d3["project"]["safety_status"] == "Stop and contact a professional"


# =============================================================== listing
class TestB03List:
    def test_list_projects(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=30)
        assert r.status_code == 200
        rows = r.json()["projects"]
        assert len(rows) >= 2  # happy-path + emergency
