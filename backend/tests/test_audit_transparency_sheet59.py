"""Info Sheet #59 — Audit / Transparency & Consent tests."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text[:200]}"
    data = r.json()
    return data["access_token"], data["user"]


@pytest.fixture(scope="module")
def demo_token():
    tok, _ = _login(DEMO_EMAIL, DEMO_PASSWORD)
    return tok


@pytest.fixture(scope="module")
def admin_token():
    tok, _ = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    return tok


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# --- Audit self ------------------------------------------------------------
class TestAuditMe:
    def test_audit_me_returns_shape(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/audit/me?limit=50", headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert set(["total", "events", "summary", "consents"]).issubset(d.keys())
        assert isinstance(d["events"], list)
        assert isinstance(d["summary"], list)
        assert isinstance(d["consents"], dict)
        for t in ("marketing", "analytics", "cookies", "data_processing", "personalization"):
            assert t in d["consents"], f"missing consent {t}"

    def test_mutation_creates_audit_entry(self, demo_token):
        # Create a project (mutation) then verify it eventually appears in audit/me
        payload = {"title": f"TEST_audit_{uuid.uuid4().hex[:6]}", "space": "kitchen", "budget": 100}
        c = requests.post(f"{BASE_URL}/api/projects", headers=_h(demo_token), json=payload, timeout=30)
        assert c.status_code in (200, 201), c.text[:200]
        pid = c.json().get("id") or c.json().get("_id") or c.json().get("project", {}).get("id")
        # trigger a follow-up read so middleware flush + subsequent GET show the event
        time.sleep(1.2)
        r = requests.get(f"{BASE_URL}/api/audit/me?limit=50", headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        events = r.json()["events"]
        assert any(e.get("method") == "POST" and "/projects" in (e.get("path") or "") for e in events), \
            "POST /projects not audited"
        return pid

    def test_export_returns_bundle_and_logs(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/audit/me/export", headers=_h(demo_token), timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "event_count" in d and "events" in d and "consents" in d
        assert isinstance(d["events"], list)
        assert d["event_count"] == len(d["events"])
        time.sleep(1.2)
        r2 = requests.get(f"{BASE_URL}/api/audit/me?limit=50", headers=_h(demo_token), timeout=30)
        events = r2.json()["events"]
        assert any(e.get("event") == "data_export" for e in events), "data_export not logged"


# --- Consents --------------------------------------------------------------
class TestConsents:
    def test_get_consents_shape(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/consents", headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "types" in d and set(d["types"]) == {"marketing", "analytics", "cookies", "data_processing", "personalization"}
        assert set(d["consents"].keys()) >= set(d["types"])

    def test_toggle_consent_persists(self, demo_token):
        # Grant marketing
        r = requests.post(f"{BASE_URL}/api/consents", headers=_h(demo_token),
                          json={"type": "marketing", "status": "granted"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["consents"]["marketing"]["status"] == "granted"
        # Revoke it
        r = requests.post(f"{BASE_URL}/api/consents", headers=_h(demo_token),
                          json={"type": "marketing", "status": "revoked"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["consents"]["marketing"]["status"] == "revoked"

    def test_invalid_type_and_status(self, demo_token):
        r = requests.post(f"{BASE_URL}/api/consents", headers=_h(demo_token),
                          json={"type": "not_a_type", "status": "granted"}, timeout=30)
        assert r.status_code == 400
        r = requests.post(f"{BASE_URL}/api/consents", headers=_h(demo_token),
                          json={"type": "marketing", "status": "maybe"}, timeout=30)
        assert r.status_code == 400


# --- Admin router ---------------------------------------------------------
class TestAdminAudit:
    def test_non_admin_forbidden(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/admin/audit", headers=_h(demo_token), timeout=30)
        assert r.status_code == 403

    def test_admin_query_filters(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/audit?limit=50", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "total" in d and "events" in d
        # Category filter
        r2 = requests.get(f"{BASE_URL}/api/admin/audit?category=project&limit=20",
                          headers=_h(admin_token), timeout=30)
        assert r2.status_code == 200
        for e in r2.json()["events"]:
            assert e["category"] == "project"
        # Risk filter
        r3 = requests.get(f"{BASE_URL}/api/admin/audit?risk=medium&limit=20",
                          headers=_h(admin_token), timeout=30)
        assert r3.status_code == 200
        for e in r3.json()["events"]:
            assert e["risk_level"] == "medium"

    def test_analytics_shape(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/audit/analytics", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_events", "by_category", "by_risk", "by_actor_type", "top_actors", "open_alerts"):
            assert k in d, f"missing {k}"
        assert isinstance(d["by_category"], list) and len(d["by_category"]) > 0

    def test_user_trail(self, admin_token, demo_token):
        # Get demo user id
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(demo_token), timeout=30).json()
        uid = me["id"]
        r = requests.get(f"{BASE_URL}/api/admin/audit/user/{uid}", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("user", "as_actor", "as_target", "consents"):
            assert k in d


# --- Risk alerts ----------------------------------------------------------
class TestAlerts:
    def test_rapid_delete_and_export_alerts(self, demo_token, admin_token):
        # Seed >=8 projects then delete them fast to fire rapid_resource_delete
        ids = []
        for i in range(9):
            c = requests.post(f"{BASE_URL}/api/projects", headers=_h(demo_token),
                              json={"title": f"TEST_rapid_{uuid.uuid4().hex[:6]}", "space": "kitchen",
                                    "budget": 10}, timeout=30)
            assert c.status_code in (200, 201), c.text[:200]
            j = c.json()
            pid = j.get("id") or j.get("project", {}).get("id")
            assert pid, f"no id in {j}"
            ids.append(pid)
        for pid in ids:
            d = requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=_h(demo_token), timeout=30)
            assert d.status_code in (200, 204), f"delete {pid} => {d.status_code}"
        # Trigger export (already tested elsewhere but do it again to be sure alert fires now)
        requests.get(f"{BASE_URL}/api/audit/me/export", headers=_h(demo_token), timeout=60)
        time.sleep(2)
        r = requests.get(f"{BASE_URL}/api/admin/audit/alerts?status=open", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        kinds = [a["kind"] for a in r.json().get("alerts", [])]
        assert any("rapid_resource_delete" == k for k in kinds), f"no rapid_resource_delete alert, kinds={kinds}"
        assert any(k in ("data_export",) for k in kinds), f"no data_export alert, kinds={kinds}"

    def test_resolve_alert(self, admin_token):
        # Fetch one open alert and resolve
        r = requests.get(f"{BASE_URL}/api/admin/audit/alerts?status=open&limit=5",
                         headers=_h(admin_token), timeout=30)
        alerts = r.json().get("alerts", [])
        if not alerts:
            pytest.skip("no open alerts")
        aid = alerts[0]["id"]
        res = requests.post(f"{BASE_URL}/api/admin/audit/alerts/{aid}/resolve",
                            headers=_h(admin_token), json={"note": "TEST resolve"}, timeout=30)
        assert res.status_code == 200
        # Second resolve should 404
        res2 = requests.post(f"{BASE_URL}/api/admin/audit/alerts/{aid}/resolve",
                             headers=_h(admin_token), json={"note": "again"}, timeout=30)
        assert res2.status_code == 404


# --- Regression: delete project ------------------------------------------
class TestDeleteProjectRegression:
    def test_delete_own_ok_and_nonowner_404(self, demo_token, admin_token):
        c = requests.post(f"{BASE_URL}/api/projects", headers=_h(demo_token),
                          json={"title": f"TEST_reg_{uuid.uuid4().hex[:5]}", "space": "kitchen", "budget": 50}, timeout=30)
        assert c.status_code in (200, 201)
        pid = c.json().get("id") or c.json().get("project", {}).get("id")
        # admin (not owner) delete => 404
        d1 = requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=_h(admin_token), timeout=30)
        assert d1.status_code == 404, f"non-owner should 404, got {d1.status_code}"
        # owner delete => 200
        d2 = requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=_h(demo_token), timeout=30)
        assert d2.status_code in (200, 204)
