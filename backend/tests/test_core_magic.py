"""Backend tests for Core Magic: intake → context-aware guide → adapt."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/') or \
    os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')
assert BASE_URL, "BACKEND URL must be set"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    ts = int(time.time())
    email = f"TEST_coremagic_{ts}@diyhomie.com"
    r = s.post(f"{API}/auth/register",
               json={"email": email, "password": "Test1234", "name": "CoreTester"},
               timeout=20)
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    # set location for weather context
    s.put(f"{API}/profile", json={"location": "10001", "experience": "Weekend Warrior"}, timeout=20)
    return s, email


@pytest.fixture(scope="module")
def project(auth_session):
    s, _ = auth_session
    r = s.post(f"{API}/projects", json={"title": "Replace my toilet"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ---- intake ----
def test_intake_returns_questions(auth_session, project):
    s, _ = auth_session
    r = s.post(f"{API}/projects/{project['id']}/intake", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "questions" in data
    qs = data["questions"]
    assert isinstance(qs, list)
    assert 2 <= len(qs) <= 4, f"Expected 2-4 questions, got {len(qs)}"
    for q in qs:
        assert "key" in q and "question" in q
        assert isinstance(q["question"], str) and len(q["question"]) > 4


def test_intake_is_free(auth_session, project):
    s, _ = auth_session
    me_before = s.get(f"{API}/auth/me", timeout=10).json()
    credits_before = me_before["credits"]
    r = s.post(f"{API}/projects/{project['id']}/intake", timeout=60)
    assert r.status_code == 200
    me_after = s.get(f"{API}/auth/me", timeout=10).json()
    assert me_after["credits"] == credits_before, "Intake must be free"


# ---- context-aware guide (first user gets free first guide) ----
def test_guide_with_context_persists_and_is_specific(auth_session, project):
    s, _ = auth_session
    ctx = {
        "model": "American Standard Cadet 3",
        "floor": "tile over concrete slab",
        "supply_line": "1/2-inch braided",
    }
    r = s.post(f"{API}/projects/{project['id']}/guide",
               json={"context": ctx}, timeout=180)
    assert r.status_code == 200, r.text
    proj = r.json()
    assert proj.get("guide") is not None
    assert proj.get("context") == ctx, "context must be persisted on project"
    steps = proj.get("steps") or []
    assert len(steps) >= 4
    for st in steps:
        assert "id" in st and "title" in st and "instruction" in st
        assert st.get("done") is False
        assert st.get("image_base64") is None

    # Guide should reference the specifics. Soft-assert: at least one of brand/floor mentioned.
    blob = (proj["guide"].get("overview", "") + " " +
            " ".join((s2.get("instruction") or "") for s2 in steps) + " " +
            " ".join((s2.get("title") or "") for s2 in steps) + " " +
            " ".join(proj["guide"].get("materials") or []) + " " +
            " ".join(proj["guide"].get("tools") or [])).lower()
    hits = sum(1 for k in ["american standard", "cadet", "tile", "concrete", "slab", "braided"] if k in blob)
    assert hits >= 1, f"Guide does not appear context-aware. Blob preview: {blob[:600]}"


# ---- adapt ----
def test_adapt_modifies_steps_and_costs_one_credit(auth_session, project):
    s, _ = auth_session
    me_before = s.get(f"{API}/auth/me", timeout=10).json()
    credits_before = me_before["credits"]

    r = s.post(f"{API}/projects/{project['id']}/adapt",
               json={"problem": "The closet bolts are rusted and snapped off — what now?"},
               timeout=180)
    assert r.status_code == 200, r.text
    out = r.json()
    assert "reply" in out and "project" in out and "changed_ids" in out and "credits" in out
    assert out["credits"] == credits_before - 1, "adapt must cost 1 credit"
    proj = out["project"]
    steps = proj["steps"]
    assert len(steps) >= 1
    # changed_ids should reference actual step ids in project
    step_ids = {s2["id"] for s2 in steps}
    for cid in out["changed_ids"]:
        assert cid in step_ids
    # at least one step changed (either revise or insert)
    assert len(out["changed_ids"]) >= 1, "Adapt should produce at least one change"
    # indices renumber sequentially starting at 1
    for i, st in enumerate(steps, start=1):
        assert st["index"] == i


def test_adapt_requires_existing_steps(auth_session):
    s, _ = auth_session
    r = s.post(f"{API}/projects", json={"title": "Hang a picture"}, timeout=20)
    pid = r.json()["id"]
    r2 = s.post(f"{API}/projects/{pid}/adapt", json={"problem": "stud finder is broken"}, timeout=20)
    assert r2.status_code == 400


# ---- regression: ask without adapt does not modify steps ----
def test_ask_does_not_modify_steps(auth_session, project):
    s, _ = auth_session
    proj_before = s.get(f"{API}/projects/{project['id']}", timeout=10).json()
    steps_before = [(st["id"], st["title"], st["instruction"]) for st in proj_before["steps"]]

    r = s.post(f"{API}/projects/{project['id']}/ask",
               json={"message": "What's the typical rough-in distance for a toilet?", "mode": "text"},
               timeout=60)
    assert r.status_code == 200, r.text
    ans = r.json()
    assert ans.get("answer") and isinstance(ans["answer"], str)

    proj_after = s.get(f"{API}/projects/{project['id']}", timeout=10).json()
    steps_after = [(st["id"], st["title"], st["instruction"]) for st in proj_after["steps"]]
    assert steps_before == steps_after, "ask should not modify steps"


# ---- skip path (new user, no context) ----
def test_guide_skip_path_no_context():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    ts = int(time.time())
    r = s.post(f"{API}/auth/register",
               json={"email": f"TEST_skip_{ts}@diyhomie.com", "password": "Test1234", "name": "Skip"},
               timeout=20)
    assert r.status_code == 200
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    p = s.post(f"{API}/projects", json={"title": "Patch a small drywall hole"}, timeout=20).json()
    # No body / no context
    r2 = s.post(f"{API}/projects/{p['id']}/guide", timeout=180)
    assert r2.status_code == 200, r2.text
    proj = r2.json()
    assert proj.get("guide") is not None
    assert (proj.get("context") or {}) == {}
    assert len(proj.get("steps") or []) >= 4
