"""Tests for Build Doc 3 (Guided Project Execution & Adaptive Coaching) and
Build Doc 4 (Project Memory, Outcome Intelligence & Property Record).

Namespaces:
  - /api/hi/repair/*   (Doc 3 additions on top of Doc 2)
  - /api/hi/record/*   (Doc 4)
  - /api/hi/admin/record/*  (Doc 4 admin signals)
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL")
            or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = "diyhomie1122"


def _login(s, email, pw):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text[:400]
    s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.fixture(scope="module")
def demo():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    _login(s, DEMO_EMAIL, DEMO_PASS); return s


@pytest.fixture(scope="module")
def other():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_b3b4_{uuid.uuid4().hex[:10]}@diyhomie.com"; pw = "Test1234"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "TEST"}, timeout=30)
    tok = None
    if r.status_code in (200, 201):
        tok = r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    else:
        _login(s, email, pw)
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    _login(s, ADMIN_EMAIL, ADMIN_PASS); return s


def _new_planned_issue(demo, description="Slow leak under kitchen sink drip"):
    """Create issue -> assessment -> plan (benign). Returns (iid, plan)."""
    r = demo.post(f"{API}/hi/repair/issues", json={
        "description": description, "category": "plumbing", "urgency": "soon"}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    iid = r.json()["issue"]["id"]
    r = demo.post(f"{API}/hi/repair/issues/{iid}/assess", timeout=120)
    assert r.status_code == 200, r.text[:300]
    r = demo.post(f"{API}/hi/repair/issues/{iid}/plan", timeout=120)
    assert r.status_code == 200, r.text[:400]
    plan = r.json()["plan"]
    return iid, plan


# ============================================================ Doc 3

class TestDoc3Start:
    def test_start_requires_plan(self, demo):
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "loose knob in bathroom", "category": "other_unsure"}, timeout=30)
        iid = r.json()["issue"]["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/start", timeout=30)
        assert r.status_code == 400

    def test_start_returns_briefing(self, demo):
        iid, _ = _new_planned_issue(demo)
        r = demo.post(f"{API}/hi/repair/issues/{iid}/start", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        b = d["briefing"]
        for k in ("objective", "known_condition", "safety_boundary", "effort", "first_task"):
            assert k in b
        assert "session" in d and d["session"]["status"] == "active"
        assert "progress" in d
        for k in ("total", "completed", "percent", "label", "current_task"):
            assert k in d["progress"]

    def test_start_blocked_on_emergency(self, demo):
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "I smell gas near the furnace", "category": "hvac"}, timeout=30)
        iid = r.json()["issue"]["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/start", timeout=30)
        assert r.status_code == 409


@pytest.fixture(scope="module")
def running_project(demo):
    iid, plan = _new_planned_issue(demo, "Bathroom faucet aerator clogged and dribbling")
    r = demo.post(f"{API}/hi/repair/issues/{iid}/start", timeout=30)
    assert r.status_code == 200
    return iid, plan


class TestDoc3Progress:
    def test_progress_endpoint(self, demo, running_project):
        iid, _ = running_project
        r = demo.get(f"{API}/hi/repair/issues/{iid}/progress", timeout=30)
        assert r.status_code == 200
        p = r.json()["progress"]
        for k in ("total", "completed", "percent", "label", "current_task", "next_recommended_action"):
            assert k in p

    def test_session_pause_and_resume_briefing(self, demo, running_project):
        iid, _ = running_project
        r = demo.post(f"{API}/hi/repair/issues/{iid}/session-action", json={"action": "pause"}, timeout=30)
        assert r.status_code == 200 and r.json()["session_status"] == "paused"
        r = demo.get(f"{API}/hi/repair/issues/{iid}/session", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["session"]["status"] == "paused"
        assert d["resume_briefing"] is not None
        r = demo.post(f"{API}/hi/repair/issues/{iid}/session-action", json={"action": "resume"}, timeout=30)
        assert r.status_code == 200 and r.json()["session_status"] == "active"

    def test_professional_handoff(self, demo):
        iid, _ = _new_planned_issue(demo, "Small drywall crack in living room ceiling")
        demo.post(f"{API}/hi/repair/issues/{iid}/start", timeout=30)
        r = demo.post(f"{API}/hi/repair/issues/{iid}/session-action",
                      json={"action": "professional_handoff", "note": "prefers pro"}, timeout=30)
        assert r.status_code == 200 and r.json()["session_status"] == "professional_help"
        r = demo.get(f"{API}/hi/repair/issues/{iid}", timeout=30)
        assert r.json()["issue"]["phase"] == "BLOCKED_ESCALATED"


class TestDoc3PlanContract:
    def test_plan_has_tools_materials_and_task_contract(self, demo):
        iid, plan = _new_planned_issue(demo, "Replace worn kitchen faucet cartridge")
        # plan-level tools_materials
        assert "tools_materials" in plan
        # per-task keys
        t = plan["tasks"][0]
        for key in ("preconditions", "tools", "expected_result", "checkpoint", "checkpoint_satisfied"):
            assert key in t, f"task missing {key}"
        cp = t["checkpoint"]
        assert cp.get("mode") in ("advisory", "required", "stop")
        assert "needs" in cp


class TestDoc3CheckpointGating:
    def _find_gated_task(self, plan):
        for t in plan["tasks"]:
            cp = t.get("checkpoint") or {}
            if cp.get("mode") in ("required", "stop"):
                return t
        return None

    def test_checkpoint_gate_and_satisfy(self, demo):
        iid, plan = _new_planned_issue(demo, "Replace kitchen faucet supply valve washers")
        demo.post(f"{API}/hi/repair/issues/{iid}/start", timeout=30)
        target = self._find_gated_task(plan)
        if not target:
            pytest.skip("no required/stop checkpoint task in generated plan")
        # done -> awaiting_verification (needs_checkpoint)
        r = demo.post(f"{API}/hi/repair/plan-tasks/{target['id']}/action", json={"action": "done"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # if task wasn't first available it may 409; only assert when 200 path
        if d.get("task_status") == "awaiting_verification":
            assert d.get("needs_checkpoint") is True
            needs = (target.get("checkpoint") or {}).get("needs") or []
            # First submit with missing fields
            r = demo.post(f"{API}/hi/repair/plan-tasks/{target['id']}/checkpoint", json={}, timeout=30)
            assert r.status_code == 200
            if needs:
                assert r.json()["satisfied"] is False
                assert isinstance(r.json()["missing"], list)
            payload = {}
            if "photo" in needs:
                payload["base64"] = "AAAA" * 8
            if "measurement" in needs:
                payload["value"] = 1.0; payload["unit"] = "in"
            if "observation" in needs:
                payload["observation"] = "no visible leak after tightening"
            if "confirmation" in needs:
                payload["confirmation"] = True
            r = demo.post(f"{API}/hi/repair/plan-tasks/{target['id']}/checkpoint", json=payload, timeout=30)
            assert r.status_code == 200
            assert r.json()["satisfied"] is True
            assert r.json().get("task_status") == "complete"


class TestDoc3Prerequisite:
    def test_start_or_done_pending_task_conflicts(self, demo):
        iid, plan = _new_planned_issue(demo, "Silicone bead worn around bathtub perimeter")
        if len(plan["tasks"]) < 2:
            pytest.skip("not enough tasks")
        later = plan["tasks"][1]
        # pending later task, first still open
        r = demo.post(f"{API}/hi/repair/plan-tasks/{later['id']}/action", json={"action": "start"}, timeout=30)
        assert r.status_code == 409
        r = demo.post(f"{API}/hi/repair/plan-tasks/{later['id']}/action", json={"action": "done"}, timeout=30)
        assert r.status_code == 409


class TestDoc3Coach:
    def test_coach_reply(self, demo, running_project):
        _, plan = running_project
        tid = plan["tasks"][0]["id"]
        r = demo.post(f"{API}/hi/repair/plan-tasks/{tid}/coach",
                      json={"prompt": "which wrench should I use here?"}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d.get("reply") and isinstance(d.get("recommend_pause"), bool)
        assert d.get("emergency") is False

    def test_coach_emergency(self, demo, running_project):
        _, plan = running_project
        tid = plan["tasks"][0]["id"]
        r = demo.post(f"{API}/hi/repair/plan-tasks/{tid}/coach",
                      json={"prompt": "I smell gas suddenly, help!"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("emergency") is True


class TestDoc3Materials:
    def test_materials_update(self, demo, running_project):
        iid, plan = running_project
        mats = plan.get("tools_materials") or []
        name = mats[0]["name"] if mats else "test washer"
        r = demo.post(f"{API}/hi/repair/issues/{iid}/materials",
                      json={"name": name, "status": "borrowed"}, timeout=30)
        assert r.status_code == 200
        found = [m for m in r.json()["tools_materials"] if m["name"].lower() == name.lower()]
        assert found and found[0]["status"] == "borrowed"


class TestDoc3VerifyStart:
    def test_verify_gate(self, demo):
        iid, plan = _new_planned_issue(demo, "Replace kitchen sink strainer basket ring")
        r = demo.post(f"{API}/hi/repair/issues/{iid}/verify-start", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["ready"] is False
        assert isinstance(d["blocking"], list) and len(d["blocking"]) >= 1


# ============================================================ Doc 4

@pytest.fixture(scope="module")
def completed_issue(demo):
    """Fully resolve an issue for closeout/timeline/dashboard tests."""
    iid, plan = _new_planned_issue(demo, "Attic vent screen loose small gap")
    r = demo.post(f"{API}/hi/repair/issues/{iid}/complete", json={
        "outcome_status": "improved",
        "outcome_note": "sealed loose vent screen; verify next season",
        "work_performed": "reseated screen and applied trim",
        "follow_up": ["Check vent screen after next rain"],
        "rating": 4}, timeout=30)
    assert r.status_code == 200, r.text[:400]
    body = r.json()
    assert body["resolved"] is True
    assert body["outcome"]["outcome_status"] == "improved"
    assert len(body["follow_ups"]) >= 1
    return iid


class TestDoc4Complete:
    def test_unresolved_keeps_active(self, demo):
        iid, _ = _new_planned_issue(demo, "Bedroom door squeak occasional")
        r = demo.post(f"{API}/hi/repair/issues/{iid}/complete", json={
            "outcome_status": "unresolved", "outcome_note": "still squeaks"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["resolved"] is False
        r = demo.get(f"{API}/hi/repair/issues/{iid}", timeout=30)
        assert r.json()["issue"]["status"] == "active"

    def test_abandoned_sets_status(self, demo):
        iid, _ = _new_planned_issue(demo, "Small basement paint touchup nook")
        r = demo.post(f"{API}/hi/repair/issues/{iid}/complete", json={
            "outcome_status": "abandoned", "outcome_note": "decided not to do it"}, timeout=30)
        assert r.status_code == 200
        r = demo.get(f"{API}/hi/repair/issues/{iid}", timeout=30)
        assert r.json()["issue"]["status"] == "abandoned"


class TestDoc4Dashboard:
    def test_dashboard(self, demo, completed_issue):
        r = demo.get(f"{API}/hi/record/dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("counts", "open_issues", "followups_due", "recent_activity", "empty"):
            assert k in d
        for k in ("open_issues", "in_progress", "completed", "followups_due"):
            assert k in d["counts"]


class TestDoc4Timeline:
    def test_timeline(self, demo, completed_issue):
        r = demo.get(f"{API}/hi/record/timeline", timeout=30)
        assert r.status_code == 200
        events = r.json()["events"]
        assert isinstance(events, list) and len(events) >= 1
        # each event has type + provenance
        for e in events[:5]:
            assert "type" in e and "provenance" in e


class TestDoc4Closeout:
    def test_closeout_record(self, demo, completed_issue):
        r = demo.get(f"{API}/hi/record/issues/{completed_issue}/closeout", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("issue", "outcome", "decisions", "follow_ups", "stats"):
            assert k in d
        assert d["outcome"]["outcome_status"] == "improved"


class TestDoc4Followups:
    def test_list_create_and_convert(self, demo, completed_issue):
        # list open
        r = demo.get(f"{API}/hi/record/followups?status=open", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json()["follow_ups"], list)
        # create
        r = demo.post(f"{API}/hi/record/followups", json={
            "issue_id": completed_issue, "what": "Recheck sealant in 2 weeks",
            "type": "recheck", "due_days": 14}, timeout=30)
        assert r.status_code == 200
        fu = r.json()["follow_up"]
        assert fu["what"].startswith("Recheck sealant")
        # snooze
        r = demo.post(f"{API}/hi/record/followups/{fu['id']}/action",
                      json={"action": "snooze", "snooze_days": 3}, timeout=30)
        assert r.status_code == 200 and r.json()["status"] == "open"
        # convert -> new linked issue
        r = demo.post(f"{API}/hi/record/followups/{fu['id']}/action",
                      json={"action": "convert"}, timeout=30)
        assert r.status_code == 200
        new_iid = r.json()["new_issue_id"]
        r = demo.get(f"{API}/hi/repair/issues/{new_iid}", timeout=30)
        assert r.status_code == 200
        assert r.json()["issue"].get("continuation_of") == completed_issue


class TestDoc4Context:
    def test_context_no_filters(self, demo):
        r = demo.post(f"{API}/hi/record/context", json={}, timeout=30)
        assert r.status_code == 200
        assert r.json()["has_context"] is False

    def test_context_by_category(self, demo, completed_issue):
        r = demo.post(f"{API}/hi/record/context", json={"category": "plumbing"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # completed_issue used category plumbing, so has_context should be True
        assert d["has_context"] is True
        assert isinstance(d["prior_projects"], list)
        for k in ("unresolved", "measurements", "rejected_approaches", "homie_note"):
            assert k in d


class TestDoc4Reopen:
    def test_reopen(self, demo, completed_issue):
        r = demo.post(f"{API}/hi/record/issues/{completed_issue}/reopen",
                      json={"reason": "leak came back after two weeks"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["phase"] == "ASSESSMENT"
        r = demo.get(f"{API}/hi/repair/issues/{completed_issue}", timeout=30)
        iss = r.json()["issue"]
        assert iss["phase"] == "ASSESSMENT"
        assert iss["status"] == "active"
        assert iss.get("reopen_count", 0) >= 1


class TestDoc4Sharing:
    def test_share_and_public_and_expired(self, demo, completed_issue):
        r = demo.post(f"{API}/hi/record/issues/{completed_issue}/share",
                      json={"include_evidence": False, "expires_days": 7}, timeout=30)
        assert r.status_code == 200
        token = r.json()["token"]
        # public GET (no auth)
        pub = requests.get(f"{API}/hi/record/shared/{token}", timeout=30)
        assert pub.status_code == 200
        d = pub.json()
        assert "disclaimer" in d and "outcome" in d
        # invalid token
        bad = requests.get(f"{API}/hi/record/shared/invalidtokenxyz", timeout=30)
        assert bad.status_code == 404

    def test_export(self, demo, completed_issue):
        r = demo.get(f"{API}/hi/record/issues/{completed_issue}/export", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "disclaimer" in d and "outcome" in d


class TestDoc4RoomAssetHistory:
    def test_room_and_asset_history(self, demo):
        r = demo.get(f"{API}/hi/record/rooms/nonexistent_room/history", timeout=30)
        assert r.status_code == 200
        r = demo.get(f"{API}/hi/record/assets/nonexistent_asset/history", timeout=30)
        assert r.status_code == 200

    def test_links_update(self, demo, completed_issue):
        r = demo.put(f"{API}/hi/record/issues/{completed_issue}/links",
                     json={"room_id": "test_room_1", "asset_id": "test_asset_1"}, timeout=30)
        assert r.status_code == 200
        r = demo.get(f"{API}/hi/record/rooms/test_room_1/history", timeout=30)
        assert r.status_code == 200
        issues = r.json()["issues"]
        assert any(i["id"] == completed_issue for i in issues)


# ============================================================ Cross-user isolation
class TestCrossUserIsolation:
    def test_other_user_blocked(self, other, completed_issue):
        iid = completed_issue
        endpoints = [
            ("post", f"{API}/hi/repair/issues/{iid}/start", None),
            ("get", f"{API}/hi/repair/issues/{iid}/session", None),
            ("get", f"{API}/hi/repair/issues/{iid}/progress", None),
            ("post", f"{API}/hi/repair/issues/{iid}/materials", {"name": "x", "status": "unknown"}),
            ("post", f"{API}/hi/repair/issues/{iid}/complete", {"outcome_status": "resolved"}),
            ("get", f"{API}/hi/record/issues/{iid}/closeout", None),
            ("post", f"{API}/hi/record/issues/{iid}/reopen", {"reason": "hack"}),
        ]
        for method, url, body in endpoints:
            if method == "get":
                r = other.get(url, timeout=30)
            else:
                r = other.post(url, json=body or {}, timeout=30)
            assert r.status_code == 404, f"{method.upper()} {url} -> {r.status_code}"


# ============================================================ Admin
class TestAdminSignals:
    def test_normal_user_forbidden(self, demo):
        r = demo.get(f"{API}/hi/admin/record/signals", timeout=30)
        assert r.status_code in (401, 403)

    def test_admin_signals(self, admin):
        r = admin.get(f"{API}/hi/admin/record/signals", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_outcomes", "by_status", "avg_confidence", "replan_events",
                  "professional_handoffs", "low_outcomes", "issues_by_category"):
            assert k in d, f"missing key {k}"

    def test_repair_dashboard_and_quality_still_work(self, admin):
        r = admin.get(f"{API}/hi/admin/repair/dashboard", timeout=30)
        assert r.status_code == 200
        r = admin.get(f"{API}/hi/admin/repair/quality", timeout=30)
        assert r.status_code == 200
