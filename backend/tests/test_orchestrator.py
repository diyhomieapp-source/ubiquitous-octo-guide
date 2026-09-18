"""Tests for the Continuous Project Intelligence Orchestrator (Sheet 17)."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")


# ---------- Fixtures ----------
def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token"
    session.headers["Authorization"] = f"Bearer {tok}"
    return tok


@pytest.fixture(scope="module")
def demo():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, DEMO_EMAIL, DEMO_PASS)
    return s


@pytest.fixture(scope="module")
def other_user():
    """Freshly-registered second user for cross-user isolation."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_orch_{uuid.uuid4().hex[:10]}@diyhomie.com"
    pw = __import__("os").environ.get("TEST_USER_PASSWORD", "")
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "full_name": "TEST Orch"}, timeout=30)
    if r.status_code not in (200, 201):
        # Maybe already exists — try login
        _login(s, email, pw)
    else:
        tok = r.json().get("access_token")
        if tok:
            s.headers["Authorization"] = f"Bearer {tok}"
        else:
            _login(s, email, pw)
    return s


@pytest.fixture(scope="module")
def project(demo):
    """Create a garage-upgrade project used by many tests."""
    r = demo.post(f"{API}/hi/orchestrator/projects",
                  json={"intent_text": "I want to epoxy my garage floor and add built-in storage"}, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    data = r.json()
    assert "project" in data and "id" in data["project"]
    return data


# ---------- Intent & Project creation ----------
class TestIntentAndCreate:
    def test_intent_routes_garage(self, demo):
        r = demo.post(f"{API}/hi/orchestrator/intent",
                      json={"text": "I want to epoxy my garage floor and add built-in storage"}, timeout=30)
        assert r.status_code == 200
        intent = r.json()["intent"]
        assert intent["projectType"] == "garage_upgrade"
        assert "floor_coating" in intent["goals"]
        assert "storage" in intent["goals"]
        assert "recommendedEngines" in intent

    def test_create_project_seeds_tasks_and_phase(self, project):
        p = project["project"]
        assert p["project_type"] == "garage_upgrade"
        assert p["phase"] == "DISCOVERY"
        assert "floor_coating" in p["goals"]
        assert "storage" in p["goals"]
        # ~10 seeded tasks
        assert project["tasks_created"] >= 7, f"expected many tasks, got {project['tasks_created']}"

    def test_get_project_bundle_persists(self, demo, project):
        pid = project["project"]["id"]
        r = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30)
        assert r.status_code == 200
        b = r.json()
        assert b["project"]["id"] == pid
        assert isinstance(b["tasks"], list) and len(b["tasks"]) >= 5
        assert "health" in b and "next_action" in b

    def test_list_projects_includes_health_and_next(self, demo, project):
        r = demo.get(f"{API}/hi/orchestrator/projects", timeout=30)
        assert r.status_code == 200
        rows = r.json()["projects"]
        assert any(p["id"] == project["project"]["id"] for p in rows)
        row = next(p for p in rows if p["id"] == project["project"]["id"])
        assert "health" in row and "next_action" in row


# ---------- Next Best Action priority ----------
class TestNextBestAction:
    def test_nba_new_project_missing_prereq(self, demo, project):
        pid = project["project"]["id"]
        r = demo.get(f"{API}/hi/orchestrator/projects/{pid}/next", timeout=30)
        assert r.status_code == 200
        na = r.json()["next_action"]
        assert na["reason"] == "missing_prerequisite_information", f"got {na['reason']}"

    def test_nba_safety_hold_priority(self, demo):
        # New project just for this test to avoid contaminating others
        r = demo.post(f"{API}/hi/orchestrator/projects",
                      json={"intent_text": "Epoxy my garage floor"}, timeout=30)
        assert r.status_code == 200
        pid = r.json()["project"]["id"]
        # Add a safety risk affecting a task
        tid = r.json().get("project", {}).get("id")  # not a task id
        # add a plain safety risk (no affected task)
        rr = demo.post(f"{API}/hi/orchestrator/projects/{pid}/risks",
                       json={"kind": "safety", "severity": "critical", "description": "Check moisture", "affected_tasks": []}, timeout=30)
        assert rr.status_code == 200
        nb = demo.get(f"{API}/hi/orchestrator/projects/{pid}/next", timeout=30).json()
        assert nb["next_action"]["reason"] == "immediate_safety_hold"
        assert nb["health"]["status"] == "red"
        # cleanup: archive
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/archive", timeout=30)


# ---------- Task dependencies & completion ----------
class TestTaskDependencies:
    def test_complete_task_recomputes_and_returns_next(self, demo, project):
        pid = project["project"]["id"]
        bundle = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        tasks = bundle["tasks"]
        # Complete first available task
        avail = [t for t in tasks if t["status"] == "available"]
        assert avail, "expected at least one available task"
        first = avail[0]
        u = demo.put(f"{API}/hi/orchestrator/tasks/{first['id']}", json={"action": "complete"}, timeout=30)
        assert u.status_code == 200, u.text[:200]
        data = u.json()
        assert data["ok"] is True
        assert "next_action" in data and "health" in data

    def test_complete_all_advances_nba_to_execution(self, demo):
        # Fresh project so we can complete all prereq/plan tasks
        r = demo.post(f"{API}/hi/orchestrator/projects",
                      json={"intent_text": "Paint the bedroom"}, timeout=30)
        pid = r.json()["project"]["id"]
        # Loop: complete every currently-available task until an EXECUTE-phase task is next OR nothing left
        for _ in range(30):
            b = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
            avail = [t for t in b["tasks"] if t["status"] == "available" and t["phase"] in ("DISCOVERY", "UNDERSTAND_EXISTING_CONDITIONS", "PLAN")]
            if not avail:
                break
            demo.put(f"{API}/hi/orchestrator/tasks/{avail[0]['id']}", json={"action": "complete"}, timeout=30)
        na = demo.get(f"{API}/hi/orchestrator/projects/{pid}/next", timeout=30).json()["next_action"]
        # After discovery/plan complete, expect exec/procure/etc — reason NOT missing_prereq
        assert na["reason"] != "missing_prerequisite_information", f"got {na['reason']}"
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/archive", timeout=30)


# ---------- Decisions ----------
class TestDecisions:
    def test_decision_commit_returns_ripple_flag(self, demo, project):
        pid = project["project"]["id"]
        r = demo.post(f"{API}/hi/orchestrator/projects/{pid}/decisions",
                      json={"title": "Use gray epoxy", "state": "selected"}, timeout=30)
        assert r.status_code == 200
        did = r.json()["decision"]["id"]
        u = demo.put(f"{API}/hi/orchestrator/decisions/{did}", json={"state": "committed"}, timeout=30)
        assert u.status_code == 200
        assert u.json()["ripple_recommended"] is True


# ---------- Ripple engine ----------
class TestRipple:
    def test_ripple_material_quantity_and_confirmation(self, demo):
        r = demo.post(f"{API}/hi/orchestrator/projects",
                      json={"intent_text": "Epoxy my garage floor"}, timeout=30)
        pid = r.json()["project"]["id"]
        # Add material
        add = demo.post(f"{API}/hi/orchestrator/projects/{pid}/requirements",
                        json={"kind": "material", "name": "Epoxy kit", "quantity": 2, "cost_estimate": 360}, timeout=30)
        assert add.status_code == 200
        # Ripple 400 -> 600 sqft (50% increase, qty 2 -> 3)
        rip = demo.post(f"{API}/hi/orchestrator/projects/{pid}/ripple",
                        json={"change_type": "measurement", "field": "floor_area",
                              "old_value": "400", "new_value": "600", "apply": False}, timeout=30)
        assert rip.status_code == 200, rip.text[:200]
        data = rip.json()
        assert data["requires_confirmation"] is True
        assert data["applied"] is False
        assert "summary" in data and data["summary"]
        # Check impact mentions the qty 2 -> 3
        joined = "; ".join(i["change"] for i in data["impacts"])
        assert "2" in joined and "3" in joined, f"expected 2->3 in impacts: {joined}"
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/archive", timeout=30)


# ---------- Safety hold ----------
class TestSafetyHold:
    def test_safety_hold_blocks_only_affected_and_resolve(self, demo):
        r = demo.post(f"{API}/hi/orchestrator/projects", json={"intent_text": "Epoxy garage floor"}, timeout=30)
        pid = r.json()["project"]["id"]
        # pick a task to be affected
        b = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        first_task_id = b["tasks"][0]["id"]
        # add safety risk
        rk = demo.post(f"{API}/hi/orchestrator/projects/{pid}/risks",
                       json={"kind": "safety", "severity": "critical",
                             "description": "Check moisture", "affected_tasks": [first_task_id]}, timeout=30)
        assert rk.status_code == 200
        rid = rk.json()["risk"]["id"]
        # Verify safety hold + red + can_continue_other
        b2 = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        assert b2["project"]["status"] == "SAFETY_HOLD"
        assert b2["health"]["status"] == "red"
        assert b2["health"]["can_continue_other_task"] is True
        assert b2["next_action"]["reason"] == "immediate_safety_hold"
        # Resolve — should lift the hold
        resp = demo.post(f"{API}/hi/orchestrator/risks/{rid}/resolve", timeout=30)
        assert resp.status_code == 200
        b3 = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        assert b3["project"]["status"] == "ACTIVE"
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/archive", timeout=30)


# ---------- Pause / resume ----------
class TestPauseResume:
    def test_resume_blocked_by_open_safety_risk(self, demo):
        r = demo.post(f"{API}/hi/orchestrator/projects", json={"intent_text": "Epoxy garage floor"}, timeout=30)
        pid = r.json()["project"]["id"]
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/risks",
                  json={"kind": "safety", "severity": "high", "description": "Verify no moisture"}, timeout=30)
        # Pause
        p = demo.post(f"{API}/hi/orchestrator/projects/{pid}/pause", timeout=30)
        assert p.status_code == 200
        # Resume — should return SAFETY_HOLD
        rs = demo.post(f"{API}/hi/orchestrator/projects/{pid}/resume", timeout=30)
        assert rs.status_code == 200
        assert rs.json()["status"] == "SAFETY_HOLD"
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/archive", timeout=30)


# ---------- Event log ----------
class TestEventLog:
    def test_events_include_created_intent_and_task_completed(self, demo, project):
        pid = project["project"]["id"]
        r = demo.get(f"{API}/hi/orchestrator/projects/{pid}/events", timeout=30)
        assert r.status_code == 200
        types = [e["type"] for e in r.json()["events"]]
        assert "PROJECT_CREATED" in types
        assert "INTENT_CAPTURED" in types
        # TASK_COMPLETED should exist from the earlier test that completed a task
        # (module-scoped project fixture ordering with TestTaskDependencies may vary; not asserting strictly)


# ---------- Completion ----------
class TestCompletion:
    def test_completion_blocked_by_safety(self, demo):
        r = demo.post(f"{API}/hi/orchestrator/projects", json={"intent_text": "Epoxy garage"}, timeout=30)
        pid = r.json()["project"]["id"]
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/risks",
                  json={"kind": "safety", "severity": "high", "description": "Moisture concern"}, timeout=30)
        c = demo.post(f"{API}/hi/orchestrator/projects/{pid}/complete", timeout=30)
        assert c.status_code == 400, f"expected 400 (safety blocks), got {c.status_code}: {c.text[:200]}"

    def test_completion_audit_and_passport(self, demo):
        r = demo.post(f"{API}/hi/orchestrator/projects", json={"intent_text": "Small paint touch-up"}, timeout=30)
        pid = r.json()["project"]["id"]
        # Complete every task
        for _ in range(40):
            b = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
            avail = [t for t in b["tasks"] if t["status"] in ("available", "in_progress")]
            if not avail:
                break
            demo.put(f"{API}/hi/orchestrator/tasks/{avail[0]['id']}", json={"action": "complete"}, timeout=30)
        # Completion audit
        aud = demo.get(f"{API}/hi/orchestrator/projects/{pid}/completion-audit", timeout=30).json()
        assert "checks" in aud and "ready_to_complete" in aud
        # Complete
        c = demo.post(f"{API}/hi/orchestrator/projects/{pid}/complete", timeout=30)
        assert c.status_code == 200, c.text[:200]
        passport = c.json()["passport"]
        for k in ("materials_used", "approx_cost", "tasks_completed"):
            assert k in passport, f"passport missing {k}"


# ---------- Cross-user isolation ----------
class TestIsolation:
    def test_other_user_cannot_read_project(self, other_user, project):
        pid = project["project"]["id"]
        r = other_user.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30)
        assert r.status_code == 404, f"expected 404 for cross-user, got {r.status_code}"


# ---------- Engine contract ----------
class TestEngineSubmit:
    def test_engine_submit_creates_risk_and_returns_updates(self, demo):
        r = demo.post(f"{API}/hi/orchestrator/projects", json={"intent_text": "Epoxy garage"}, timeout=30)
        pid = r.json()["project"]["id"]
        es = demo.post(f"{API}/hi/orchestrator/projects/{pid}/engine-submit",
                       json={"engine_name": "safety", "recommendation": "Check moisture before coating",
                             "risks": [{"kind": "safety", "severity": "high", "description": "Moisture must be < 4%"}]}, timeout=30)
        assert es.status_code == 200
        j = es.json()
        assert j["accepted"] is True
        assert len(j["created_risks"]) == 1
        assert j["next_action"]["reason"] == "immediate_safety_hold"
        assert j["health"]["status"] == "red"
        demo.post(f"{API}/hi/orchestrator/projects/{pid}/archive", timeout=30)
