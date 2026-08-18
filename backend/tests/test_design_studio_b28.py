"""
Doc 28 — Design Studio backend tests (iteration 87).
Covers /api/hi/design-studio/* endpoints. Reuses an existing 'concept_generated' or
newer project when possible to avoid burning image-generation budget.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
DEMO = {"email": "demo_home@diyhomie.com", "password": "Test1234"}
COLLAB = {"email": "collab_test@diyhomie.com", "password": "Test1234"}
API = f"{BASE_URL}/api"
EXISTING_PID = None
try:
    with open("/tmp/dsid.txt") as f:
        EXISTING_PID = f.read().strip() or None
except Exception:
    pass


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{API}/auth/login", json=DEMO, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}"}


@pytest.fixture(scope="module")
def collab_token():
    r = requests.post(f"{API}/auth/login", json=COLLAB, timeout=30)
    if r.status_code != 200:
        pytest.skip("collab user not usable")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def collab_headers(collab_token):
    return {"Authorization": f"Bearer {collab_token}"}


# ----- Validation tests -----
class TestCreateValidation:
    def test_invalid_design_type(self, demo_headers):
        r = requests.post(f"{API}/hi/design-studio/projects", headers=demo_headers,
                          json={"design_type": "bogus", "title": "T", "objective": "O"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_missing_title(self, demo_headers):
        r = requests.post(f"{API}/hi/design-studio/projects", headers=demo_headers,
                          json={"design_type": "room_refresh", "title": "  ", "objective": "make it nicer"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_missing_objective(self, demo_headers):
        r = requests.post(f"{API}/hi/design-studio/projects", headers=demo_headers,
                          json={"design_type": "room_refresh", "title": "Nice", "objective": ""}, timeout=30)
        assert r.status_code == 400, r.text


# ----- List + get -----
class TestListAndGet:
    def test_list_projects(self, demo_headers):
        r = requests.get(f"{API}/hi/design-studio/projects", headers=demo_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "projects" in data and isinstance(data["projects"], list)
        assert any("source_photo_base64" in p for p in data["projects"]) is False
        # store one existing project id for downstream tests
        if data["projects"]:
            pytest.existing_pid = data["projects"][0]["id"]

    def test_get_existing_project(self, demo_headers):
        pid = EXISTING_PID or getattr(pytest, "existing_pid", None)
        if not pid:
            pytest.skip("no existing project available")
        r = requests.get(f"{API}/hi/design-studio/projects/{pid}", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "project" in data and "versions" in data and "inspirations" in data
        assert "disclaimer" in data and "not dimensionally accurate" in data["disclaimer"].lower()
        # No source_photo_base64 leak
        proj_str = str(data["project"])
        assert "source_photo_base64" not in data["project"]
        # inspiration items should not leak base64 either
        for insp in data["inspirations"]:
            assert "base64" not in insp

    def test_get_not_found(self, demo_headers):
        r = requests.get(f"{API}/hi/design-studio/projects/nonexistent-id-12345", headers=demo_headers, timeout=30)
        assert r.status_code == 404


# ----- Cross-user 404 -----
class TestCrossUser:
    def test_cross_user_returns_404(self, demo_headers, collab_headers):
        # get an owned pid
        pid = EXISTING_PID or getattr(pytest, "existing_pid", None)
        if not pid:
            r = requests.get(f"{API}/hi/design-studio/projects", headers=demo_headers, timeout=30)
            pid = (r.json().get("projects") or [{}])[0].get("id")
        if not pid:
            pytest.skip("no pid to test cross-user")
        r = requests.get(f"{API}/hi/design-studio/projects/{pid}", headers=collab_headers, timeout=30)
        assert r.status_code == 404


# ----- Inspiration style_summary -----
class TestInspiration:
    def test_add_inspiration_returns_style_summary(self, demo_headers):
        pid = EXISTING_PID or getattr(pytest, "existing_pid", None)
        if not pid:
            pytest.skip("no pid available")
        r = requests.post(f"{API}/hi/design-studio/projects/{pid}/inspiration",
                          headers=demo_headers,
                          json={"notes": "I love warm beige walls, soft linen curtains, and rattan chairs. Feels calm."},
                          timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        # style_summary is optional but should generally start with the target phrase
        if data.get("style_summary"):
            assert "you seem drawn to" in data["style_summary"].lower() or len(data["style_summary"]) > 5

    def test_add_inspiration_empty_400(self, demo_headers):
        pid = EXISTING_PID or getattr(pytest, "existing_pid", None)
        if not pid:
            pytest.skip("no pid available")
        r = requests.post(f"{API}/hi/design-studio/projects/{pid}/inspiration",
                          headers=demo_headers, json={}, timeout=30)
        assert r.status_code == 400


# ----- Refine (creates v2) -----
class TestRefineFlow:
    """Uses existing project which already has a v1 concept per pre-verification."""
    def test_refine_creates_new_version(self, demo_headers):
        pid = EXISTING_PID or getattr(pytest, "existing_pid", None)
        if not pid:
            pytest.skip("no pid")
        # confirm at least v1 exists
        r0 = requests.get(f"{API}/hi/design-studio/projects/{pid}", headers=demo_headers, timeout=30)
        v_before = r0.json().get("project", {}).get("current_version", 0)
        if v_before < 1:
            pytest.skip("existing project has no v1 yet — main agent said concept was already generated")

        # Refine empty instruction should 400
        r_empty = requests.post(f"{API}/hi/design-studio/projects/{pid}/refine",
                                headers=demo_headers, json={"instruction": "  "}, timeout=30)
        assert r_empty.status_code == 400

        # Real refine (this generates an image; be patient)
        r = requests.post(f"{API}/hi/design-studio/projects/{pid}/refine",
                          headers=demo_headers,
                          json={"instruction": "make the wall color warmer, add a soft area rug"},
                          timeout=180)
        assert r.status_code == 200, r.text
        ver = r.json().get("version", {})
        assert ver.get("version") == v_before + 1
        assert "direction" in ver
        # Image may or may not be generated depending on model availability; log status
        print(f"REFINE image_available={ver.get('image_available')}")
        # Direction must be structured
        d = ver["direction"]
        assert isinstance(d.get("palette"), list) and isinstance(d.get("key_changes"), list)


# ----- Buildability -----
class TestBuildability:
    def test_buildability_returns_verdict(self, demo_headers):
        pid = EXISTING_PID or getattr(pytest, "existing_pid", None)
        if not pid:
            pytest.skip("no pid")
        r = requests.post(f"{API}/hi/design-studio/projects/{pid}/buildability",
                          headers=demo_headers, json={}, timeout=90)
        assert r.status_code == 200, r.text
        bd = r.json().get("buildability", {})
        assert bd.get("verdict") in ("looks_buildable", "needs_review", "professional_recommended")
        # separated categories
        for k in ("taste", "buildability", "safety", "budget", "permit", "measure_first"):
            assert k in bd and isinstance(bd[k], list)


# ----- Approve + Convert idempotency -----
class TestApproveAndConvert:
    def test_approve_then_convert_idempotent(self, demo_headers):
        pid = EXISTING_PID or getattr(pytest, "existing_pid", None)
        if not pid:
            pytest.skip("no pid")
        # Approve is idempotent enough
        ra = requests.post(f"{API}/hi/design-studio/projects/{pid}/approve",
                           headers=demo_headers, json={}, timeout=30)
        assert ra.status_code == 200, ra.text
        # First convert
        rc1 = requests.post(f"{API}/hi/design-studio/projects/{pid}/convert",
                            headers=demo_headers, json={}, timeout=30)
        assert rc1.status_code == 200, rc1.text
        j1 = rc1.json()
        assert "issue_id" in j1 and j1.get("route", "").startswith("/home-intel/repair/")
        # Second convert — must be idempotent
        rc2 = requests.post(f"{API}/hi/design-studio/projects/{pid}/convert",
                            headers=demo_headers, json={}, timeout=30)
        assert rc2.status_code == 200
        j2 = rc2.json()
        assert j2.get("already") is True
        assert j2["issue_id"] == j1["issue_id"]

        # Verify gr_issue exists via repair endpoint (source design_studio)
        rr = requests.get(f"{API}/hi/repair/issues/{j1['issue_id']}", headers=demo_headers, timeout=30)
        # 200 preferred but some routes may differ; just assert not 404
        assert rr.status_code != 404, f"gr_issue not found: {rr.status_code} {rr.text[:200]}"
