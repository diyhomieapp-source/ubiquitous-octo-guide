"""
Tests for Active Home Switching feature (property_id scoping for rooms, assets, projects, inventory).
Regression: verifies each engine's _get_or_create_property() honors is_active=True.
Also validates that switching active home isolates data correctly.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = __import__("os").environ.get("TEST_USER_PASSWORD", "")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"No token in response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _get_properties(h):
    r = requests.get(f"{BASE_URL}/api/hi/account/properties", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("properties") if isinstance(j, dict) else j


@pytest.fixture(scope="module")
def properties(h):
    return _get_properties(h)


def _find(props, name_contains):
    for p in props:
        if p.get("name") and name_contains.lower() in p["name"].lower():
            return p
    return None


def _activate(h, pid):
    r = requests.post(f"{BASE_URL}/api/hi/account/properties/{pid}/activate", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. REGRESSION: My Home has expected data ----------
class TestRegressionMyHome:
    def test_ensure_my_home_active(self, h, properties):
        my_home = _find(properties, "My Home")
        assert my_home, f"'My Home' not found in properties: {[p.get('name') for p in properties]}"
        if not my_home.get("is_active"):
            _activate(h, my_home["id"])
        r = requests.get(f"{BASE_URL}/api/hi/account/properties", headers=h, timeout=15)
        pl = r.json().get("properties") if isinstance(r.json(), dict) else r.json()
        actives = [p for p in pl if p.get("is_active")]
        assert len(actives) == 1, f"Exactly one active expected: {actives}"
        assert actives[0]["id"] == my_home["id"]

    def test_rooms_map_five_rooms(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/rooms/map", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        rooms = data.get("rooms") or []
        assert len(rooms) == 5, f"Expected 5 rooms in My Home, got {len(rooms)}: {[r.get('name') for r in rooms]}"

    def test_assets_present(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/assets", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # response shape may be a list or {assets: [...]}
        items = data if isinstance(data, list) else (data.get("assets") or data.get("items") or [])
        assert len(items) >= 1, f"Expected >=1 asset in My Home, got {len(items)}"

    def test_projects_three(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data if isinstance(data, list) else (data.get("projects") or data.get("items") or [])
        assert len(items) == 3, f"Expected 3 projects in My Home, got {len(items)}"

    def test_inventory_three(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/inventory", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data if isinstance(data, list) else (data.get("items") or [])
        assert len(items) == 3, f"Expected 3 toolbox items in My Home, got {len(items)}"

    def test_dashboard_loads(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/dashboard", headers=h, timeout=30)
        assert r.status_code == 200, f"Dashboard failed: {r.status_code} {r.text[:200]}"

    def test_maintenance_home_loads(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/maintenance/home", headers=h, timeout=30)
        assert r.status_code == 200, f"Maintenance failed: {r.status_code} {r.text[:200]}"

    def test_documents_no_500(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/documents", headers=h, timeout=15)
        assert r.status_code == 200, r.text

    def test_homie_chat_works(self, h):
        # Create/reuse a conversation and send a message
        r = requests.post(f"{BASE_URL}/api/hi/chat/conversations", headers=h, json={}, timeout=15)
        assert r.status_code == 200, r.text
        cid = r.json().get("id") or r.json().get("conversation_id")
        assert cid, r.text
        r2 = requests.post(
            f"{BASE_URL}/api/hi/chat/conversations/{cid}/message",
            headers=h, json={"text": "Say hi in one short sentence."}, timeout=60
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        reply = (body.get("assistant") or {}).get("text") or body.get("reply") or ""
        assert reply, f"Empty chat reply: {body}"


# ---------- 2. ACTIVE SWITCHING to empty home ----------
class TestActiveSwitching:
    def test_switch_to_empty_home_and_lists_empty(self, h, properties):
        my_home = _find(properties, "My Home")
        lake = _find(properties, "Lake Cabin")
        assert my_home and lake, f"Need both 'My Home' and 'Lake Cabin' fixtures: {[p.get('name') for p in properties]}"

        _activate(h, lake["id"])
        try:
            # exactly one is_active
            r = requests.get(f"{BASE_URL}/api/hi/account/properties", headers=h, timeout=15)
            pl = r.json().get("properties") if isinstance(r.json(), dict) else r.json()
            actives = [p for p in pl if p.get("is_active")]
            assert len(actives) == 1 and actives[0]["id"] == lake["id"]

            # projects empty
            r = requests.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=15)
            assert r.status_code == 200
            projs = r.json() if isinstance(r.json(), list) else (r.json().get("projects") or [])
            assert len(projs) == 0, f"Expected 0 projects for Lake Cabin, got {len(projs)}"

            # inventory empty
            r = requests.get(f"{BASE_URL}/api/hi/inventory", headers=h, timeout=15)
            assert r.status_code == 200
            inv = r.json() if isinstance(r.json(), list) else (r.json().get("items") or [])
            assert len(inv) == 0, f"Expected 0 inventory for Lake Cabin, got {len(inv)}"

            # rooms empty
            r = requests.get(f"{BASE_URL}/api/hi/rooms/map", headers=h, timeout=15)
            assert r.status_code == 200
            rooms = r.json().get("rooms") or []
            assert len(rooms) == 0, f"Expected 0 rooms for Lake Cabin, got {len(rooms)}"

            # maintenance & documents still 200 (user-scoped, acceptable per spec)
            assert requests.get(f"{BASE_URL}/api/hi/maintenance/home", headers=h, timeout=30).status_code == 200
            assert requests.get(f"{BASE_URL}/api/hi/documents", headers=h, timeout=15).status_code == 200
        finally:
            # Always restore My Home active
            _activate(h, my_home["id"])

    def test_switching_back_restores(self, h, properties):
        my_home = _find(properties, "My Home")
        _activate(h, my_home["id"])
        projs = requests.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=15).json()
        inv = requests.get(f"{BASE_URL}/api/hi/inventory", headers=h, timeout=15).json()
        rooms = requests.get(f"{BASE_URL}/api/hi/rooms/map", headers=h, timeout=15).json().get("rooms") or []
        p_list = projs if isinstance(projs, list) else (projs.get("projects") or [])
        i_list = inv if isinstance(inv, list) else (inv.get("items") or [])
        assert len(p_list) == 3, f"Restore: projects {len(p_list)}"
        assert len(i_list) == 3, f"Restore: inventory {len(i_list)}"
        assert len(rooms) == 5, f"Restore: rooms {len(rooms)}"


# ---------- 3. Creates go to active home only ----------
class TestPropertyScopedCreates:
    def test_create_inventory_on_lake_not_visible_on_myhome(self, h, properties):
        my_home = _find(properties, "My Home")
        lake = _find(properties, "Lake Cabin")
        assert my_home and lake

        _activate(h, lake["id"])
        created_id = None
        try:
            # Create toolbox item while Lake Cabin is active
            r = requests.post(
                f"{BASE_URL}/api/hi/inventory",
                headers=h,
                json={"name": "TEST_ActiveSwitch_Hammer", "category": "Tool", "status": "have"},
                timeout=15,
            )
            assert r.status_code in (200, 201), r.text
            created_id = r.json().get("id")
            assert created_id

            # Visible while Lake Cabin active
            r = requests.get(f"{BASE_URL}/api/hi/inventory", headers=h, timeout=15).json()
            items = r if isinstance(r, list) else (r.get("items") or [])
            names = [i.get("name") for i in items]
            assert "TEST_ActiveSwitch_Hammer" in names, f"Created item not visible in Lake Cabin: {names}"

            # Switch to My Home — should NOT see the Lake Cabin item
            _activate(h, my_home["id"])
            r = requests.get(f"{BASE_URL}/api/hi/inventory", headers=h, timeout=15).json()
            items = r if isinstance(r, list) else (r.get("items") or [])
            names = [i.get("name") for i in items]
            assert "TEST_ActiveSwitch_Hammer" not in names, (
                f"Property scoping FAIL: Lake Cabin item leaked to My Home list: {names}"
            )
        finally:
            # Cleanup: switch back to Lake Cabin and archive
            if created_id:
                _activate(h, lake["id"])
                requests.delete(f"{BASE_URL}/api/hi/inventory/{created_id}", headers=h, timeout=10)
            _activate(h, my_home["id"])

    def test_create_project_on_lake_not_visible_on_myhome(self, h, properties):
        my_home = _find(properties, "My Home")
        lake = _find(properties, "Lake Cabin")
        _activate(h, lake["id"])
        pid = None
        try:
            r = requests.post(
                f"{BASE_URL}/api/hi/projects/start",
                headers=h,
                json={"goal": "TEST_ActiveSwitch_Proj — fix leaky faucet", "project_category": "Fix Something"},
                timeout=60,
            )
            # some engines return 200, some 201
            if r.status_code not in (200, 201):
                pytest.skip(f"Project create returned {r.status_code}: {r.text[:200]}")
            body = r.json()
            if body.get("needs_clarification"):
                pytest.skip("LLM needed clarification; skipping create-scope test")
            pid = (body.get("project") or {}).get("id")
            assert pid, f"No project id in {body}"

            # Visible on Lake Cabin
            r = requests.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=15).json()
            projs = r if isinstance(r, list) else (r.get("projects") or [])
            ids = [p.get("id") for p in projs]
            assert pid in ids, f"Created project missing from Lake Cabin list: {ids}"

            # Switch to My Home — not visible
            _activate(h, my_home["id"])
            r = requests.get(f"{BASE_URL}/api/hi/projects", headers=h, timeout=15).json()
            projs = r if isinstance(r, list) else (r.get("projects") or [])
            ids = [p.get("id") for p in projs]
            assert pid not in ids, f"Leaked project to My Home: {ids}"
        finally:
            if pid:
                # Try archive via status endpoint (no DELETE for projects). Best-effort.
                try:
                    _activate(h, lake["id"])
                    requests.put(f"{BASE_URL}/api/hi/projects/{pid}/status", headers=h, json={"status": "archived"}, timeout=10)
                except Exception:
                    pass
            _activate(h, my_home["id"])


# ---------- 4. Final state: make sure My Home is active ----------
class TestFinalState:
    def test_leave_my_home_active(self, h, properties):
        my_home = _find(properties, "My Home")
        _activate(h, my_home["id"])
        r = requests.get(f"{BASE_URL}/api/hi/account/properties", headers=h, timeout=15)
        pl = r.json().get("properties") if isinstance(r.json(), dict) else r.json()
        actives = [p for p in pl if p.get("is_active")]
        assert len(actives) == 1 and actives[0]["id"] == my_home["id"], "Final: My Home must be the single active home"
