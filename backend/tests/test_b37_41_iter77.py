"""
Backend tests for Build Blueprints 37-41 wiring (iteration 77).
- B41 Universal Search (user + admin)
- B40 Design System (public + admin)
- B39 Platform Architecture (admin)
- B37 Release Management (admin)
- B38 Investor Intelligence (admin)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"

DEMO = {"email": "demo_home@diyhomie.com", "password": "Test1234"}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": "diyhomie1122"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_h():
    return {"Authorization": f"Bearer {_login(DEMO)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN)}", "Content-Type": "application/json"}


# --------------------------------------------------------------------- B40 Design (public)
class TestB40DesignPublic:
    def test_foundation(self):
        r = requests.get(f"{BASE_URL}/api/hi/design/foundation", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "tokens" in d and "safety_statuses" in d and "component_registry" in d
        assert len(d["safety_statuses"]) == 4
        assert any(c["key"] == "safety_card" for c in d["component_registry"])

    def test_tokens(self):
        r = requests.get(f"{BASE_URL}/api/hi/design/tokens", timeout=20)
        assert r.status_code == 200
        assert "tokens" in r.json()


# --------------------------------------------------------------------- B40 Design (admin)
class TestB40DesignAdmin:
    _created_id = None

    def test_overview(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/design/overview", headers=admin_h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "coverage_pct" in d and "total_components" in d

    def test_registry(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/design/registry", headers=admin_h, timeout=20)
        assert r.status_code == 200
        assert len(r.json()["registry"]) > 10

    def test_components_list(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/design/components", headers=admin_h, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json()["components"], list)

    def test_safety_card_approved_rejected(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/design/components", headers=admin_h,
                          json={"component_key": "safety_card", "version": "TEST_9.9.9", "status": "approved",
                                "accessibility_review_status": "passed", "owner": "product+content"}, timeout=20)
        assert r.status_code == 400
        assert "safety" in r.text.lower()

    def test_component_workflow(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/design/components", headers=admin_h,
                          json={"component_key": "toast", "version": "TEST_iter77", "status": "draft",
                                "accessibility_review_status": "pending", "owner": "design"}, timeout=20)
        assert r.status_code == 200
        cid = r.json()["component"]["id"]
        TestB40DesignAdmin._created_id = cid

        # Approve BEFORE a11y passed should fail
        r2 = requests.put(f"{BASE_URL}/api/hi/admin/design/components/{cid}", headers=admin_h,
                         json={"status": "approved"}, timeout=20)
        assert r2.status_code == 400

        # Pass a11y, then approve
        r3 = requests.put(f"{BASE_URL}/api/hi/admin/design/components/{cid}", headers=admin_h,
                          json={"accessibility_review_status": "passed"}, timeout=20)
        assert r3.status_code == 200
        r4 = requests.put(f"{BASE_URL}/api/hi/admin/design/components/{cid}", headers=admin_h,
                          json={"status": "approved"}, timeout=20)
        assert r4.status_code == 200
        assert r4.json()["component"]["status"] == "approved"

    def test_component_delete(self, admin_h):
        cid = TestB40DesignAdmin._created_id
        if not cid:
            pytest.skip("no component created")
        r = requests.delete(f"{BASE_URL}/api/hi/admin/design/components/{cid}", headers=admin_h, timeout=20)
        assert r.status_code == 200


# --------------------------------------------------------------------- B39 Platform
class TestB39Platform:
    def test_domains(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/platform/domains", headers=admin_h, timeout=20)
        assert r.status_code == 200
        assert len(r.json()["domains"]) >= 8

    def test_standards(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/platform/api-standards", headers=admin_h, timeout=20)
        assert r.status_code == 200
        assert "event_types" in r.json()

    def test_events_list(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/platform/events", headers=admin_h, timeout=20)
        assert r.status_code == 200

    def test_events_invalid_type_400(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/platform/events", headers=admin_h,
                          json={"event_type": "TOTALLY_BOGUS", "domain": "Test", "entity_id": "x"}, timeout=20)
        assert r.status_code == 400

    def test_events_valid_type(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/platform/events", headers=admin_h,
                          json={"event_type": "project.started", "domain": "Project Intelligence",
                                "entity_id": "TEST_iter77_entity", "payload": {"note": "TEST_iter77"}}, timeout=20)
        assert r.status_code == 200
        assert r.json()["event"]["event_type"] == "project.started"


# --------------------------------------------------------------------- B37 Release
class TestB37Release:
    def test_dashboard(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/release/dashboard", headers=admin_h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "releases_by_status" in d and "critical_journeys" in d

    def test_lists(self, admin_h):
        for path in ["releases", "incidents", "flags"]:
            r = requests.get(f"{BASE_URL}/api/hi/admin/release/{path}", headers=admin_h, timeout=20)
            assert r.status_code == 200, f"/{path} -> {r.status_code}"

    def test_release_create_and_transition(self, admin_h):
        payload = {"version": "TEST_iter77", "release_type": "backend", "summary": "TEST_iter77 smoke release",
                   "risk_level": "low", "owner": "TEST_iter77", "rollback_plan": "Rollback plan for iter77"}
        r = requests.post(f"{BASE_URL}/api/hi/admin/release/releases", headers=admin_h, json=payload, timeout=20)
        assert r.status_code == 200
        rid = r.json()["release"]["id"]

        r2 = requests.put(f"{BASE_URL}/api/hi/admin/release/releases/{rid}", headers=admin_h,
                          json={"status": "deployed"}, timeout=20)
        assert r2.status_code == 200
        assert r2.json()["status"] == "deployed"


# --------------------------------------------------------------------- B38 Investor Intel (namespace is /invintel)
class TestB38InvestorIntel:
    def test_dashboard(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/invintel/dashboard", headers=admin_h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "growth" in d and "readiness_by_category" in d

    def test_lists(self, admin_h):
        for path in ["metrics", "vendors", "documents", "readiness", "transfer", "invites", "questions"]:
            r = requests.get(f"{BASE_URL}/api/hi/admin/invintel/{path}", headers=admin_h, timeout=20)
            assert r.status_code == 200, f"/{path} -> {r.status_code} {r.text[:100]}"


# --------------------------------------------------------------------- B41 Universal Search (user)
class TestB41SearchUser:
    _room_id = None

    def test_kitchen_rooms(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/search?q=kitchen", headers=user_h, timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["result_count"] >= 0
        # capture a room id for context test
        for res in d["results"]:
            if res["entity_type"] == "room":
                TestB41SearchUser._room_id = res["entity_id"]
                break

    def test_electrical_projects_rank_above_guides(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/search?q=electrical", headers=user_h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        types = [res["entity_type"] for res in d["results"]]
        if "project" in types and "guide" in types:
            first_p = types.index("project"); first_g = types.index("guide")
            assert first_p < first_g, f"projects should outrank guides: {types}"

    def test_shelf(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/search?q=shelf", headers=user_h, timeout=30)
        assert r.status_code == 200

    def test_warranty(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/search?q=warranty", headers=user_h, timeout=30)
        assert r.status_code == 200

    def test_light_fixture(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/search?q=light fixture", headers=user_h, timeout=30)
        assert r.status_code == 200

    def test_nonsense_zero(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/search?q=zqxwcevrbtnyum1234noresults", headers=user_h, timeout=30)
        assert r.status_code == 200
        assert r.json()["result_count"] == 0

    def test_owner_data_never_leaks(self, user_h, admin_h):
        # Admin should not see the demo user's private records (rooms/projects/assets/etc.)
        # We call search as admin and ensure any owner-scoped result is not from demo user's namespace.
        r_admin = requests.get(f"{BASE_URL}/api/hi/search?q=kitchen", headers=admin_h, timeout=30)
        r_user = requests.get(f"{BASE_URL}/api/hi/search?q=kitchen", headers=user_h, timeout=30)
        assert r_admin.status_code == 200 and r_user.status_code == 200
        admin_ids = {r["entity_id"] for r in r_admin.json()["results"] if r["permission_scope"] == "owner"}
        user_ids = {r["entity_id"] for r in r_user.json()["results"] if r["permission_scope"] == "owner"}
        assert admin_ids.isdisjoint(user_ids), "Owner-scoped ids leaked across users!"

    def test_context_room(self, user_h):
        if not TestB41SearchUser._room_id:
            pytest.skip("no room id available")
        rid = TestB41SearchUser._room_id
        r = requests.get(f"{BASE_URL}/api/hi/search?q=a&context_type=room&context_id={rid}",
                         headers=user_h, timeout=30)
        assert r.status_code == 200
        # In context, no global guides/templates should appear
        for res in r.json()["results"]:
            assert res["entity_type"] not in {"template", "guide", "community"}, \
                f"Context scoping leaked global type {res['entity_type']}"

    def test_select_ok(self, user_h):
        # ensure a query log exists
        requests.get(f"{BASE_URL}/api/hi/search?q=kitchen", headers=user_h, timeout=20)
        r = requests.post(f"{BASE_URL}/api/hi/search/select?entity_type=asset", headers=user_h, timeout=20)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# --------------------------------------------------------------------- B41 Search admin
class TestB41SearchAdmin:
    def test_health(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/search/health", headers=admin_h, timeout=30)
        assert r.status_code == 200
        assert "health" in r.json()

    def test_reindex(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/search/reindex", headers=admin_h, timeout=30)
        assert r.status_code == 200
        assert r.json()["health"]["index_status"] == "indexed"

    def test_config_get(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/search/config", headers=admin_h, timeout=20)
        assert r.status_code == 200
        assert "excluded_types" in r.json()["config"]

    def test_config_put(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/hi/admin/search/config", headers=admin_h,
                         json={"community_in_search": True, "excluded_types": []}, timeout=20)
        assert r.status_code == 200

    def test_synonyms_crud(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/search/synonyms", headers=admin_h,
                          json={"term": "TEST_iter77_term", "synonyms": ["TEST_synonym1", "TEST_synonym2"]}, timeout=20)
        assert r.status_code == 200
        sid = r.json()["synonym"]["id"]
        r2 = requests.get(f"{BASE_URL}/api/hi/admin/search/synonyms", headers=admin_h, timeout=20)
        assert r2.status_code == 200
        assert any(s["id"] == sid for s in r2.json()["synonyms"])
        r3 = requests.delete(f"{BASE_URL}/api/hi/admin/search/synonyms/{sid}", headers=admin_h, timeout=20)
        assert r3.status_code == 200

    def test_logs(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/search/logs", headers=admin_h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "logs" in d and "no_results" in d
