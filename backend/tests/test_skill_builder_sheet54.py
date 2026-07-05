"""
Sheet #54 - Smart Training, Quiz & DIY Skill Builder Engine backend tests.

Covers:
- Public quiz APIs: /api/quizzes, /api/quizzes/meta, /api/quizzes/{id}, /api/quizzes/for-project/{pid}
- Submission grading + badge awarding: /api/quizzes/{id}/submit
- Skills: /api/skills/me, /api/skills/mentor-optin, /api/skills/leaderboard
- Admin gated endpoints: /api/admin/quizzes* + 403 for non-admin
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"No token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def demo_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ----- meta + list

def test_quizzes_meta(demo_headers):
    r = requests.get(f"{BASE_URL}/api/quizzes/meta", headers=demo_headers, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("topics"), list) and len(body["topics"]) >= 6
    assert "Electrical" in body["topics"]


def test_list_quizzes_seed_count_and_shape(demo_headers):
    r = requests.get(f"{BASE_URL}/api/quizzes", headers=demo_headers, timeout=30)
    assert r.status_code == 200
    quizzes = r.json().get("quizzes", [])
    assert len(quizzes) >= 6, f"Expected ≥6 seeded quizzes, got {len(quizzes)}"
    fields = {"id", "topic", "title", "level", "question_count", "pass_pct", "passed", "best_score"}
    assert fields.issubset(quizzes[0].keys())
    # ensure no leaked correct answers on list endpoint
    assert "answer" not in quizzes[0]


def test_get_quiz_hides_answers(demo_headers):
    quizzes = requests.get(f"{BASE_URL}/api/quizzes", headers=demo_headers, timeout=30).json()["quizzes"]
    q0 = quizzes[0]
    r = requests.get(f"{BASE_URL}/api/quizzes/{q0['id']}", headers=demo_headers, timeout=30)
    assert r.status_code == 200
    detail = r.json()
    assert detail["id"] == q0["id"]
    for question in detail["questions"]:
        assert "answer" not in question, "Correct answer must not leak on public GET"
        assert isinstance(question["options"], list) and len(question["options"]) >= 2


# ----- submit grading & badge

def test_submit_all_correct_awards_badge(demo_headers, admin_headers):
    """Pick a topic the demo user hasn't necessarily passed. Submit correct answers with admin peek."""
    quizzes = requests.get(f"{BASE_URL}/api/quizzes", headers=demo_headers, timeout=30).json()["quizzes"]
    # Choose Painting for a fresh submit (per test note, Electrical already passed).
    target = next((q for q in quizzes if q["topic"] == "Painting"), None)
    if not target:
        target = next(q for q in quizzes if not q["passed"])

    # get correct answers via admin
    admin_view = requests.get(f"{BASE_URL}/api/admin/quizzes/{target['id']}", headers=admin_headers, timeout=30)
    assert admin_view.status_code == 200
    answers = [q["answer"] for q in admin_view.json()["questions"]]

    r = requests.post(f"{BASE_URL}/api/quizzes/{target['id']}/submit",
                      headers=demo_headers, json={"answers": answers}, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["passed"] is True
    assert body["score_pct"] == 100
    assert body["correct"] == body["total"]
    assert len(body["results"]) == body["total"]
    for res in body["results"]:
        assert res["correct"] is True and "explanation" in res
    assert body["recommendation"]["mentor_invite"] is True

    # verify /skills/me now reflects a badge for this topic
    me = requests.get(f"{BASE_URL}/api/skills/me", headers=demo_headers, timeout=30).json()
    assert f"{target['topic']} Pro" in me["badges"]


def test_submit_wrong_answers_fails(demo_headers, admin_headers):
    quizzes = requests.get(f"{BASE_URL}/api/quizzes", headers=demo_headers, timeout=30).json()["quizzes"]
    target = quizzes[0]
    admin_view = requests.get(f"{BASE_URL}/api/admin/quizzes/{target['id']}", headers=admin_headers, timeout=30).json()
    # deliberately wrong: pick answer+1 mod len
    wrong = [(q["answer"] + 1) % len(q["options"]) for q in admin_view["questions"]]
    r = requests.post(f"{BASE_URL}/api/quizzes/{target['id']}/submit",
                      headers=demo_headers, json={"answers": wrong}, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["passed"] is False
    assert body["score_pct"] < target["pass_pct"]
    assert body["recommendation"]["type"] == "remedial"


# ----- context-aware trigger

def test_quiz_for_project_matches_by_keyword(demo_headers):
    # Create a project titled to match Electrical triggers.
    p = requests.post(f"{BASE_URL}/api/projects", headers=demo_headers,
                      json={"title": "TEST_ Install a new light fixture in kitchen"}, timeout=30)
    assert p.status_code in (200, 201), p.text
    pid = p.json().get("id") or p.json().get("project", {}).get("id")
    assert pid, f"No project id in response: {p.json()}"
    try:
        r = requests.get(f"{BASE_URL}/api/quizzes/for-project/{pid}", headers=demo_headers, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body.get("quiz") is not None, f"Expected a matched quiz, got {body}"
        assert body["quiz"]["topic"] == "Electrical"
    finally:
        requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=demo_headers, timeout=30)


def test_quiz_for_project_no_match_returns_null(demo_headers):
    p = requests.post(f"{BASE_URL}/api/projects", headers=demo_headers,
                      json={"title": "TEST_ Random unrelated widget"}, timeout=30)
    pid = p.json().get("id") or p.json().get("project", {}).get("id")
    try:
        r = requests.get(f"{BASE_URL}/api/quizzes/for-project/{pid}", headers=demo_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("quiz") is None
    finally:
        if pid:
            requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=demo_headers, timeout=30)


# ----- skills endpoints

def test_skills_me_shape(demo_headers):
    r = requests.get(f"{BASE_URL}/api/skills/me", headers=demo_headers, timeout=30)
    assert r.status_code == 200
    body = r.json()
    for k in ("topics", "badges", "passed_count", "total_topics", "mentor_optin", "mentor_eligible", "leaderboard_optin"):
        assert k in body, f"missing {k}"
    assert body["total_topics"] >= 6
    assert body["passed_count"] >= 1  # electrical previously passed


def test_mentor_optin_toggle(demo_headers):
    r_on = requests.post(f"{BASE_URL}/api/skills/mentor-optin", headers=demo_headers,
                         json={"enabled": True}, timeout=30)
    assert r_on.status_code == 200 and r_on.json().get("enabled") is True
    me = requests.get(f"{BASE_URL}/api/skills/me", headers=demo_headers, timeout=30).json()
    assert me["mentor_optin"] is True
    # turn back off
    r_off = requests.post(f"{BASE_URL}/api/skills/mentor-optin", headers=demo_headers,
                          json={"enabled": False}, timeout=30)
    assert r_off.status_code == 200 and r_off.json().get("enabled") is False


def test_leaderboard(demo_headers):
    r = requests.get(f"{BASE_URL}/api/skills/leaderboard", headers=demo_headers, timeout=30)
    assert r.status_code == 200
    lb = r.json().get("leaderboard", [])
    assert isinstance(lb, list)
    assert len(lb) >= 1
    row = lb[0]
    for k in ("name", "badges", "is_me"):
        assert k in row


# ----- admin gating

def test_admin_endpoints_forbidden_for_non_admin(demo_headers):
    for path in ("/api/admin/quizzes", "/api/admin/quizzes/analytics"):
        r = requests.get(f"{BASE_URL}{path}", headers=demo_headers, timeout=30)
        assert r.status_code == 403, f"{path} expected 403 for non-admin, got {r.status_code}"


def test_admin_list_and_analytics(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/quizzes", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert len(body["quizzes"]) >= 6
    a = requests.get(f"{BASE_URL}/api/admin/quizzes/analytics", headers=admin_headers, timeout=30)
    assert a.status_code == 200
    ab = a.json()
    assert "totals" in ab and "by_topic" in ab
    assert ab["totals"]["quizzes"] >= 6


def test_admin_crud_lifecycle(admin_headers):
    """Create, toggle, update, delete quiz — verifies persistence with GETs."""
    payload = {
        "topic": "Safety Basics",
        "title": f"TEST_ Safety Quiz {uuid.uuid4().hex[:6]}",
        "level": "Beginner",
        "pass_pct": 60,
        "triggers": ["testtrigger-xyz"],
        "questions": [
            {"q": "Wear safety glasses?", "options": ["Yes", "No"], "answer": 0, "explanation": "Always."},
            {"q": "Ok to run cables through water?", "options": ["Yes", "No"], "answer": 1, "explanation": "Never."},
        ],
        "active": True,
    }
    c = requests.post(f"{BASE_URL}/api/admin/quizzes", headers=admin_headers, json=payload, timeout=30)
    assert c.status_code == 200, c.text
    qid = c.json()["id"]
    try:
        # Verify in list
        listed = requests.get(f"{BASE_URL}/api/admin/quizzes", headers=admin_headers, timeout=30).json()["quizzes"]
        assert any(q["id"] == qid for q in listed)

        # Toggle to inactive
        t = requests.post(f"{BASE_URL}/api/admin/quizzes/{qid}/toggle", headers=admin_headers, timeout=30)
        assert t.status_code == 200
        assert t.json()["active"] is False

        # Toggle back active
        requests.post(f"{BASE_URL}/api/admin/quizzes/{qid}/toggle", headers=admin_headers, timeout=30)

        # Update
        payload["title"] = payload["title"] + " Updated"
        u = requests.put(f"{BASE_URL}/api/admin/quizzes/{qid}", headers=admin_headers, json=payload, timeout=30)
        assert u.status_code == 200
        got = requests.get(f"{BASE_URL}/api/admin/quizzes/{qid}", headers=admin_headers, timeout=30).json()
        assert got["title"].endswith("Updated")
    finally:
        d = requests.delete(f"{BASE_URL}/api/admin/quizzes/{qid}", headers=admin_headers, timeout=30)
        assert d.status_code == 200
