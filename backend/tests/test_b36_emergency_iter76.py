"""B36 Emergency Readiness backend tests (iteration 76)."""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
USER_EMAIL = "demo_home@diyhomie.com"
USER_PW = __import__("os").environ.get("TEST_USER_PASSWORD", "")


@pytest.fixture(scope="module")
def user_token():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PW}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def h(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


# --- overview ---
class TestOverview:
    def test_overview_has_completeness_no_score(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/emergency/overview", headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        if d.get("is_new_user"):
            pytest.skip("user has no property set up")
        assert "info_completeness" in d
        assert isinstance(d["info_completeness"], (int, float))
        assert "suggestions" in d
        # no risk score anywhere
        assert "risk_score" not in d
        assert "score" not in d


# --- categories ---
class TestCategories:
    def test_categories(self, h):
        r = requests.get(f"{BASE_URL}/api/hi/emergency/categories", headers=h, timeout=30)
        assert r.status_code == 200
        cats = r.json().get("categories", [])
        keys = {c["key"] for c in cats}
        for k in ("fire_smoke", "gas_smell", "water_flood", "electrical", "medical", "severe_weather", "other"):
            assert k in keys


# --- contacts CRUD ---
class TestContacts:
    def test_contact_full_cycle(self, h):
        payload = {"contact_type": "plumber", "name": "TEST_Plumber Bob", "phone": "555-1010"}
        r = requests.post(f"{BASE_URL}/api/hi/emergency/contacts", headers=h, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        cid = r.json()["contact"]["id"]

        r = requests.get(f"{BASE_URL}/api/hi/emergency/contacts", headers=h, timeout=30)
        assert r.status_code == 200
        assert any(c["id"] == cid for c in r.json()["contacts"])

        r = requests.put(f"{BASE_URL}/api/hi/emergency/contacts/{cid}", headers=h,
                         json={"contact_type": "plumber", "name": "TEST_Plumber Bob 2", "phone": "555-2020"}, timeout=30)
        assert r.status_code == 200

        r = requests.delete(f"{BASE_URL}/api/hi/emergency/contacts/{cid}", headers=h, timeout=30)
        assert r.status_code == 200

    def test_invalid_contact_type(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/contacts", headers=h,
                          json={"contact_type": "bogus", "name": "x"}, timeout=30)
        assert r.status_code == 400


# --- locations CRUD ---
class TestLocations:
    def test_location_cycle(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/locations", headers=h,
                          json={"location_type": "water_shutoff", "description": "TEST basement by heater"}, timeout=30)
        assert r.status_code == 200, r.text
        lid = r.json()["location"]["id"]

        r = requests.get(f"{BASE_URL}/api/hi/emergency/locations", headers=h, timeout=30)
        assert any(l["id"] == lid for l in r.json()["locations"])

        r = requests.delete(f"{BASE_URL}/api/hi/emergency/locations/{lid}", headers=h, timeout=30)
        assert r.status_code == 200


# --- risk profiles ---
class TestRiskProfiles:
    def test_risk_profile_create_and_update(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/risk-profiles", headers=h,
                          json={"risk_category": "Water", "user_reported_context": "TEST context", "risk_status": "monitored"}, timeout=30)
        assert r.status_code == 200, r.text
        rid = r.json()["profile"]["id"]
        assert "risk_score" not in r.json()["profile"]

        r = requests.put(f"{BASE_URL}/api/hi/emergency/risk-profiles/{rid}", headers=h,
                         json={"risk_category": "Water", "user_reported_context": "updated", "risk_status": "mitigated"}, timeout=30)
        assert r.status_code == 200

        r = requests.get(f"{BASE_URL}/api/hi/emergency/risk-profiles", headers=h, timeout=30)
        assert r.status_code == 200


# --- emergency mode start ---
class TestEmergencyMode:
    def test_mode_start_water_flood(self, h):
        # ensure user has a saved contact and location so response has them
        requests.post(f"{BASE_URL}/api/hi/emergency/contacts", headers=h,
                      json={"contact_type": "plumber", "name": "TEST_ModePlumber", "phone": "555-9"}, timeout=30)
        requests.post(f"{BASE_URL}/api/hi/emergency/locations", headers=h,
                      json={"location_type": "water_shutoff", "description": "TEST mode shutoff"}, timeout=30)

        r = requests.post(f"{BASE_URL}/api/hi/emergency/mode/start", headers=h,
                          json={"category": "water_flood"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["category"] == "water_flood"
        assert isinstance(d["steps"], list) and len(d["steps"]) >= 3
        assert "911" in d["call_emergency"]
        # user's saved contacts + previously-recorded shutoff locations
        assert isinstance(d["your_contacts"], list)
        assert isinstance(d["your_locations"], list)
        # incident created
        assert d.get("incident_id")

    def test_mode_start_invalid(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/mode/start", headers=h,
                          json={"category": "bogus"}, timeout=30)
        assert r.status_code == 400


# --- incidents ---
class TestIncidents:
    def test_incident_flow(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/incidents", headers=h,
                          json={"incident_type": "water_flood", "severity": "medium"}, timeout=30)
        assert r.status_code == 200
        iid = r.json()["incident"]["id"]

        r = requests.get(f"{BASE_URL}/api/hi/emergency/incidents/{iid}", headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["incident"]["id"] == iid
        assert "insurance" in (d.get("note") or "").lower() or "doesn't guarantee" in (d.get("note") or "").lower()

        r = requests.put(f"{BASE_URL}/api/hi/emergency/incidents/{iid}", headers=h,
                         json={"status": "contained"}, timeout=30)
        assert r.status_code == 200

        r = requests.post(f"{BASE_URL}/api/hi/emergency/incidents/{iid}/timeline", headers=h,
                          json={"event_type": "note", "note": "TEST timeline entry"}, timeout=30)
        assert r.status_code == 200

        r = requests.post(f"{BASE_URL}/api/hi/emergency/incidents/{iid}/media", headers=h,
                          json={"media_type": "photo", "storage_reference": "s3://TEST/xyz.jpg"}, timeout=30)
        assert r.status_code == 200

    def test_invalid_incident_status(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/incidents", headers=h,
                          json={"incident_type": "water_flood"}, timeout=30)
        iid = r.json()["incident"]["id"]
        r = requests.put(f"{BASE_URL}/api/hi/emergency/incidents/{iid}", headers=h,
                         json={"status": "foo"}, timeout=30)
        assert r.status_code == 400


# --- prep plans ---
class TestPrepPlans:
    def test_plan_create_seeds_items(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/prep-plans", headers=h,
                          json={"plan_type": "hurricane"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        pid = d["plan"]["id"]
        assert len(d["items"]) >= 3

        # get with progress
        r = requests.get(f"{BASE_URL}/api/hi/emergency/prep-plans", headers=h, timeout=30)
        assert r.status_code == 200
        plans = r.json()["plans"]
        me = next(p for p in plans if p["id"] == pid)
        assert me["total_items"] >= 3
        assert me["done_items"] == 0

        # get single
        r = requests.get(f"{BASE_URL}/api/hi/emergency/prep-plans/{pid}", headers=h, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 3
        first = items[0]

        # toggle done
        r = requests.put(f"{BASE_URL}/api/hi/emergency/prep-items/{first['id']}", headers=h,
                         json={"status": "done"}, timeout=30)
        assert r.status_code == 200
        # verify persisted
        r = requests.get(f"{BASE_URL}/api/hi/emergency/prep-plans/{pid}", headers=h, timeout=30)
        assert any(i["id"] == first["id"] and i["status"] == "done" for i in r.json()["items"])

        # add custom item
        r = requests.post(f"{BASE_URL}/api/hi/emergency/prep-plans/{pid}/items", headers=h,
                          json={"title": "TEST_custom item"}, timeout=30)
        assert r.status_code == 200

        # plan status
        r = requests.put(f"{BASE_URL}/api/hi/emergency/prep-plans/{pid}", headers=h,
                         json={"status": "completed"}, timeout=30)
        assert r.status_code == 200

    def test_plan_invalid_type(self, h):
        r = requests.post(f"{BASE_URL}/api/hi/emergency/prep-plans", headers=h,
                          json={"plan_type": "bogus"}, timeout=30)
        assert r.status_code == 400
