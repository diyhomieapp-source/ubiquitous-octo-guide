"""Tests for the Guided Repair & Evidence-to-Plan Engine (Build Doc 2).

Namespace: /api/hi/repair/*  (+ admin /api/hi/admin/repair/*)

Coverage:
 - Static safety triage (deterministic; emergency hard-stop, soft escalation, benign)
 - Intake CRUD + is_draft
 - Assessment engine (structured contract; versioned; auto-questions)
 - Progressive question answering -> becomes observation evidence
 - Evidence workspace (never leaks base64; delete)
 - Repair plan (409 on emergency hard-stop; requires assessment; task contract; first task available)
 - Reality-check / replan loop (done unlocks next; found_different marks superseded + revised assessment)
 - Decision ledger
 - Project Position
 - Repair chat (emergency short-circuit)
 - Outcome / completion + feedback (harmful goes to quality queue)
 - Cross-user isolation
 - Admin quality queue (requires admin; emergencies & low-confidence surface; resolve works)
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
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
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_repair_{uuid.uuid4().hex[:10]}@diyhomie.com"
    pw = __import__("os").environ.get("TEST_USER_PASSWORD", "")
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "full_name": "TEST Repair"}, timeout=30)
    if r.status_code in (200, 201):
        tok = r.json().get("access_token")
        if tok:
            s.headers["Authorization"] = f"Bearer {tok}"
        else:
            _login(s, email, pw)
    else:
        _login(s, email, pw)
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, ADMIN_EMAIL, ADMIN_PASS)
    return s


# ---------- static safety triage ----------
class TestStaticSafetyTriage:
    def test_emergency_hard_stop_gas(self, demo):
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "I smell gas near the furnace and hear a hissing sound",
            "category": "hvac", "urgency": "urgent"}, timeout=30)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["triage"]["hard_stop"] is True
        assert d["triage"]["risk_level"] == "emergency_review"
        assert d["issue"]["urgency"] == "emergency_review"
        assert d["issue"]["phase"] == "BLOCKED_ESCALATED"
        assert d["no_plan"] is True

    def test_soft_escalation_breaker(self, demo):
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "My breaker keeps tripping in the kitchen circuit",
            "category": "electrical_concern", "urgency": "soon"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["triage"]["soft_escalation"] is True
        assert d["triage"]["risk_level"] == "elevated"
        assert d["triage"]["hard_stop"] is False

    def test_benign_normal(self, demo):
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "There is a damp stain on the basement wall near the corner",
            "category": "water_moisture", "urgency": "soon"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["triage"]["risk_level"] == "normal"
        assert d["triage"]["hard_stop"] is False
        assert d["triage"]["soft_escalation"] is False


# ---------- Reusable issue for CRUD/assess/plan flows ----------
@pytest.fixture(scope="module")
def benign_issue(demo):
    r = demo.post(f"{API}/hi/repair/issues", json={
        "description": "Kitchen faucet drips slowly from the spout when off",
        "category": "plumbing", "urgency": "soon"}, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["triage"]["hard_stop"] is False
    return d["issue"]


class TestIntake:
    def test_list_issues(self, demo, benign_issue):
        r = demo.get(f"{API}/hi/repair/issues", timeout=30)
        assert r.status_code == 200
        ids = [i["id"] for i in r.json()["issues"]]
        assert benign_issue["id"] in ids

    def test_get_issue(self, demo, benign_issue):
        r = demo.get(f"{API}/hi/repair/issues/{benign_issue['id']}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["issue"]["id"] == benign_issue["id"]
        assert "evidence" in d and "assessment" in d and "plan" in d and "position" in d

    def test_update_description_retriages(self, demo):
        # create a benign draft, then update to gas smell -> must re-triage to hard_stop
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "small drip", "category": "plumbing", "urgency": "soon", "is_draft": True}, timeout=30)
        assert r.status_code == 200
        iid = r.json()["issue"]["id"]
        assert r.json()["issue"]["status"] == "draft"
        r = demo.put(f"{API}/hi/repair/issues/{iid}",
                     json={"description": "I smell gas near the furnace"}, timeout=30)
        assert r.status_code == 200
        u = r.json()["issue"]
        assert u["triage"]["hard_stop"] is True
        assert u["phase"] == "BLOCKED_ESCALATED"
        assert u["urgency"] == "emergency_review"


class TestEvidence:
    def test_add_observation_and_photo_never_leaks_base64(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/evidence",
                      json={"type": "observation", "note": "dripping about once per 5 seconds"}, timeout=30)
        assert r.status_code == 200
        assert "base64" not in r.json()["evidence"]
        # photo with base64
        r = demo.post(f"{API}/hi/repair/issues/{iid}/evidence",
                      json={"type": "photo", "base64": "AAAA" * 32, "note": "faucet under-cabinet"}, timeout=30)
        assert r.status_code == 200
        assert "base64" not in r.json()["evidence"]
        assert r.json()["evidence"]["has_media"] is True
        # list
        r = demo.get(f"{API}/hi/repair/issues/{iid}/evidence", timeout=30)
        assert r.status_code == 200
        for e in r.json()["evidence"]:
            assert "base64" not in e
        photo = next((e for e in r.json()["evidence"] if e["type"] == "photo"), None)
        assert photo and photo["has_media"] is True

    def test_delete_evidence(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/evidence",
                      json={"type": "observation", "note": "temporary evidence"}, timeout=30)
        eid = r.json()["evidence"]["id"]
        r = demo.delete(f"{API}/hi/repair/evidence/{eid}", timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True


class TestAssessmentAndQuestions:
    def test_assessment_contract_and_questions(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/assess", timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        a = d["assessment"]
        for key in ("issue_summary", "possible_causes", "confidence_level", "missing_information",
                    "safe_next_action", "DIY_boundary", "recommended_path"):
            assert key in a, f"missing key: {key}"
        assert a["confidence_level"] in ("verified", "high_confidence", "conditional", "uncertain")
        assert a["recommended_path"] in ("observe", "inspect", "repair", "pause", "escalate")
        assert isinstance(a["possible_causes"], list)
        # questions auto-generated (up to 3)
        assert isinstance(d["questions"], list)
        assert len(d["questions"]) <= 3

    def test_assessment_versioning(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/assess", timeout=90)
        assert r.status_code == 200
        v = r.json()["assessment"]["version"]
        assert v >= 2  # first assess in previous test made version 1

    def test_answer_question_stores_observation(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.get(f"{API}/hi/repair/issues/{iid}/questions", timeout=30)
        qs = [q for q in r.json()["questions"] if q["status"] == "open"]
        if not qs:
            pytest.skip("no open questions to answer")
        qid = qs[0]["id"]
        r = demo.post(f"{API}/hi/repair/questions/{qid}/answer",
                      json={"answer": "About two weeks ago after the cold snap"}, timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True
        # verify it became evidence
        r = demo.get(f"{API}/hi/repair/issues/{iid}/evidence", timeout=30)
        notes = " ".join([(e.get("note") or "") for e in r.json()["evidence"]])
        assert "cold snap" in notes or "Q:" in notes


class TestPlan:
    def test_plan_generation_contract(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/plan", timeout=120)
        assert r.status_code == 200, r.text[:400]
        p = r.json()["plan"]
        for key in ("objective", "safety_notes", "difficulty", "time_estimate",
                    "stop_escalate_conditions", "tasks"):
            assert key in p, f"plan missing {key}"
        assert p["difficulty"] in ("beginner", "intermediate", "advanced", "professional_review")
        assert isinstance(p["tasks"], list) and len(p["tasks"]) >= 1
        first = p["tasks"][0]
        for tk in ("title", "what_to_do", "why_it_matters", "verification_before_proceeding",
                   "safety_caution", "completion_criteria", "if_result_differs"):
            assert tk in first, f"task missing {tk}"
        assert first["status"] == "available"

    def test_plan_blocked_on_emergency(self, demo):
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "I smell gas and hear hissing", "category": "hvac"}, timeout=30)
        iid = r.json()["issue"]["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text[:200]}"

    def test_plan_requires_assessment(self, demo):
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "loose cabinet hinge in bathroom", "category": "other_unsure"}, timeout=30)
        iid = r.json()["issue"]["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        assert r.status_code == 400


class TestRealityCheckReplan:
    def test_done_unlocks_next(self, demo, benign_issue):
        iid = benign_issue["id"]
        # get current plan
        r = demo.get(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        plan = r.json()["plan"]
        if len(plan["tasks"]) < 2:
            pytest.skip("plan has <2 tasks; cannot test unlock")
        first_id = plan["tasks"][0]["id"]
        r = demo.post(f"{API}/hi/repair/plan-tasks/{first_id}/action",
                      json={"action": "done"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["task_status"] == "complete"
        # confirm second is now available
        r = demo.get(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        tasks = r.json()["plan"]["tasks"]
        assert tasks[0]["status"] == "complete"
        assert tasks[1]["status"] == "available"

    def test_found_different_triggers_revised_assessment(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.get(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        tasks = r.json()["plan"]["tasks"]
        # pick the currently available task
        avail = next((t for t in tasks if t["status"] == "available"), None)
        if not avail:
            pytest.skip("no available task")
        r = demo.post(f"{API}/hi/repair/plan-tasks/{avail['id']}/action",
                      json={"action": "found_different", "note": "the shutoff valve is corroded"}, timeout=90)
        assert r.status_code == 200
        d = r.json()
        assert d.get("revised") is True
        assert d.get("task_status") == "superseded"
        assert "assessment" in d
        # decision ledger entry with status superseded
        r = demo.get(f"{API}/hi/repair/issues/{iid}/decisions", timeout=30)
        statuses = [x["status"] for x in r.json()["decisions"]]
        assert "superseded" in statuses

    def test_need_help_returns_text(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.get(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        tasks = r.json()["plan"]["tasks"]
        # pick any pending or available
        target = next((t for t in tasks if t["status"] in ("available", "pending")), tasks[0])
        r = demo.post(f"{API}/hi/repair/plan-tasks/{target['id']}/action",
                      json={"action": "need_help"}, timeout=30)
        assert r.status_code == 200
        assert "help" in r.json()

    def test_pause_pauses_issue(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.get(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        tasks = r.json()["plan"]["tasks"]
        target = tasks[0]
        r = demo.post(f"{API}/hi/repair/plan-tasks/{target['id']}/action",
                      json={"action": "pause"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("issue_status") == "paused"


class TestDecisionLedgerAndPosition:
    def test_add_and_update_decision(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/decisions",
                      json={"decision": "Try replacing washer first", "status": "recommended",
                            "reason": "least invasive"}, timeout=30)
        assert r.status_code == 200
        did = r.json()["decision"]["id"]
        r = demo.put(f"{API}/hi/repair/decisions/{did}",
                     json={"status": "accepted", "reason": "user chose"}, timeout=30)
        assert r.status_code == 200

    def test_get_position(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.get(f"{API}/hi/repair/issues/{iid}/position", timeout=30)
        assert r.status_code == 200
        pos = r.json()["position"]
        for k in ("objective", "next_recommended_action", "rejected_approaches",
                  "professional_verification_requirements", "current_phase"):
            assert k in pos, f"position missing {k}"


class TestChat:
    def test_emergency_chat_short_circuit(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/chat",
                      json={"text": "I smell gas suddenly, what do I do?"}, timeout=45)
        assert r.status_code == 200
        assistant = r.json()["assistant"]
        assert assistant.get("emergency") is True

    def test_normal_chat_message(self, demo, benign_issue):
        iid = benign_issue["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/chat",
                      json={"text": "Can you clarify the first step?"}, timeout=60)
        assert r.status_code == 200
        assert r.json()["assistant"].get("text")
        r = demo.get(f"{API}/hi/repair/issues/{iid}/messages", timeout=30)
        assert r.status_code == 200
        assert len(r.json()["messages"]) >= 2


class TestOutcomeAndFeedback:
    def test_complete_and_harmful_feedback_queues_quality(self, demo, admin):
        # complete
        r = demo.post(f"{API}/hi/repair/issues", json={
            "description": "loose cabinet knob in kitchen", "category": "other_unsure"}, timeout=30)
        iid = r.json()["issue"]["id"]
        r = demo.post(f"{API}/hi/repair/issues/{iid}/complete",
                      json={"outcome_note": "tightened screw", "resolved": True, "rating": 5}, timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True
        # harmful feedback -> quality queue
        r = demo.post(f"{API}/hi/repair/issues/{iid}/feedback",
                      json={"rating": 1, "comment": "unsafe advice", "harmful": True}, timeout=30)
        assert r.status_code == 200
        # verify surfaced in admin quality queue
        r = admin.get(f"{API}/hi/admin/repair/quality?status=open", timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x.get("issue_id") == iid for x in items)


class TestCrossUserIsolation:
    def test_other_user_gets_404(self, other_user, benign_issue):
        iid = benign_issue["id"]
        r = other_user.get(f"{API}/hi/repair/issues/{iid}", timeout=30)
        assert r.status_code == 404
        r = other_user.post(f"{API}/hi/repair/issues/{iid}/assess", timeout=30)
        assert r.status_code == 404
        r = other_user.post(f"{API}/hi/repair/issues/{iid}/plan", timeout=30)
        assert r.status_code == 404
        r = other_user.post(f"{API}/hi/repair/issues/{iid}/evidence",
                            json={"type": "observation", "note": "x"}, timeout=30)
        assert r.status_code == 404


class TestAdmin:
    def test_normal_user_forbidden(self, demo):
        r = demo.get(f"{API}/hi/admin/repair/dashboard", timeout=30)
        assert r.status_code in (401, 403)
        r = demo.get(f"{API}/hi/admin/repair/quality", timeout=30)
        assert r.status_code in (401, 403)

    def test_admin_dashboard_and_queue(self, admin):
        r = admin.get(f"{API}/hi/admin/repair/dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_issues", "emergency_reviews", "repair_plans",
                  "open_quality_items", "quality_by_reason", "issues_by_category"):
            assert k in d
        assert d["emergency_reviews"] >= 1  # we created gas hard-stops above

    def test_admin_resolve_quality(self, admin):
        r = admin.get(f"{API}/hi/admin/repair/quality?status=open", timeout=30)
        items = r.json()["items"]
        if not items:
            pytest.skip("no open queue items to resolve")
        qid = items[0]["id"]
        r = admin.patch(f"{API}/hi/admin/repair/quality/{qid}", timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True
