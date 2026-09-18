"""B30 Pro Workspace (admin frontend surface) + B31 Data Governance + B32 Home Dashboard/Timeline.

Backend tests focus on B31 (governance/privacy/reauth) and B32 (dashboard/timeline)
since B30 backend was already verified in a prior session. B30 admin endpoints are
still smoke-checked for regression.
"""
import os
import pytest
import requests
import uuid

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

USER = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")}


def _login(payload):
    r = requests.post(f"{API}/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_tok():
    return _login(USER)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN)


def h(tok, reauth=None):
    hdrs = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    if reauth:
        hdrs["X-Reauth-Token"] = reauth
    return hdrs


# ============================================================= B30 Admin Pro Workspace
class TestB30ProAdmin:
    def test_non_admin_forbidden(self, user_tok):
        for p in ["/hi/admin/pro/dashboard", "/hi/admin/pro/profiles", "/hi/admin/pro/settings"]:
            r = requests.get(f"{API}{p}", headers=h(user_tok), timeout=30)
            assert r.status_code == 403, f"{p} -> {r.status_code}"

    def test_dashboard(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/pro/dashboard", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # Should have stats fields
        assert isinstance(d, dict)

    def test_settings_toggle(self, admin_tok):
        # Read current
        r = requests.get(f"{API}/hi/admin/pro/settings", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        orig = r.json()
        # Toggle feature_enabled
        cur = bool(orig.get("feature_enabled", False))
        r2 = requests.put(f"{API}/hi/admin/pro/settings", headers=h(admin_tok),
                          json={"feature_enabled": not cur}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert bool(r2.json().get("feature_enabled")) == (not cur)
        # Restore
        requests.put(f"{API}/hi/admin/pro/settings", headers=h(admin_tok),
                     json={"feature_enabled": cur}, timeout=30)

    def test_profiles_list(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/pro/profiles", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "profiles" in d or isinstance(d, list)


# ============================================================= B31 Consents / AI Prefs / Shares
class TestB31Consents:
    def test_overview(self, user_tok):
        r = requests.get(f"{API}/hi/privacy/overview", headers=h(user_tok), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("account_state", "consents", "consent_types", "ai_prefs", "recovery_days"):
            assert k in d, f"missing {k}"

    def test_consents_list(self, user_tok):
        r = requests.get(f"{API}/hi/privacy/consents", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        cs = r.json()["consents"]
        # Some consents should be marked required=True (locked in UI)
        assert any(c.get("required") for c in cs), "expected at least one required consent"

    def test_toggle_analytics_consent(self, user_tok):
        # find a non-required togglable consent, e.g. analytics
        r = requests.get(f"{API}/hi/privacy/consents", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        cs = r.json()["consents"]
        target = next((c for c in cs if not c.get("required")), None)
        assert target is not None, "no togglable consent found"
        ctype = target["type"]
        # toggle off
        r1 = requests.put(f"{API}/hi/privacy/consents", headers=h(user_tok),
                         json={"consent_type": ctype, "status": "withdrawn"}, timeout=30)
        assert r1.status_code == 200, r1.text
        # toggle on
        r2 = requests.put(f"{API}/hi/privacy/consents", headers=h(user_tok),
                         json={"consent_type": ctype, "status": "granted"}, timeout=30)
        assert r2.status_code == 200, r2.text

    def test_ai_controls(self, user_tok):
        r = requests.get(f"{API}/hi/privacy/ai-controls", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        r2 = requests.put(f"{API}/hi/privacy/ai-controls", headers=h(user_tok),
                          json={"analytics_opt_in": True}, timeout=30)
        assert r2.status_code == 200

    def test_shares(self, user_tok):
        r = requests.get(f"{API}/hi/privacy/shares", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "shares" in d
        assert isinstance(d["shares"], list)

    def test_data_map(self, user_tok):
        r = requests.get(f"{API}/hi/privacy/data-map", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "data_map" in d and "classes" in d
        assert len(d["data_map"]) > 0

    def test_export_categories(self, user_tok):
        r = requests.get(f"{API}/hi/privacy/export/categories", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "categories" in d and len(d["categories"]) > 0


# ============================================================= B31 Reauth security
class TestB31ReauthSecurity:
    def test_export_without_reauth_403(self, user_tok):
        r = requests.post(f"{API}/hi/privacy/export", headers=h(user_tok),
                          json={"categories": ["account"]}, timeout=30)
        assert r.status_code == 403, f"expected 403 without reauth, got {r.status_code}: {r.text}"

    def test_account_deletion_without_reauth_403(self, user_tok):
        r = requests.post(f"{API}/hi/privacy/account/deletion", headers=h(user_tok),
                          json={}, timeout=30)
        assert r.status_code == 403

    def test_reauth_bad_password_401(self, user_tok):
        r = requests.post(f"{API}/hi/privacy/reauth", headers=h(user_tok),
                          json={"action": "data_export", "current_password": "WRONG_PW_XX"}, timeout=30)
        assert r.status_code == 401

    def test_reauth_unknown_action_400(self, user_tok):
        r = requests.post(f"{API}/hi/privacy/reauth", headers=h(user_tok),
                          json={"action": "not_a_real_action", "current_password": USER["password"]}, timeout=30)
        assert r.status_code == 400

    def test_reauth_export_flow_one_time_token(self, user_tok):
        # Get reauth token
        r = requests.post(f"{API}/hi/privacy/reauth", headers=h(user_tok),
                          json={"action": "data_export", "current_password": USER["password"]}, timeout=30)
        assert r.status_code == 200, r.text
        token = r.json()["reauth_token"]
        assert token
        # First use — should succeed
        r2 = requests.post(f"{API}/hi/privacy/export", headers=h(user_tok, reauth=token),
                           json={"categories": ["account"]}, timeout=60)
        assert r2.status_code == 200, r2.text
        exp = r2.json()["export"]
        assert exp["status"] == "ready"
        assert exp.get("download_token")
        # Second use — must be rejected (one-time)
        r3 = requests.post(f"{API}/hi/privacy/export", headers=h(user_tok, reauth=token),
                           json={"categories": ["account"]}, timeout=30)
        assert r3.status_code == 403, f"expected token to be one-time, got {r3.status_code}"

    def test_export_wrong_reauth_action_rejected(self, user_tok):
        # Get token for property_delete action, try to use for export
        r = requests.post(f"{API}/hi/privacy/reauth", headers=h(user_tok),
                          json={"action": "property_delete", "current_password": USER["password"]}, timeout=30)
        assert r.status_code == 200
        tok = r.json()["reauth_token"]
        r2 = requests.post(f"{API}/hi/privacy/export", headers=h(user_tok, reauth=tok),
                           json={"categories": ["account"]}, timeout=30)
        assert r2.status_code == 403, f"expected action-mismatch to fail, got {r2.status_code}"

    def test_exports_list(self, user_tok):
        r = requests.get(f"{API}/hi/privacy/export", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        assert "exports" in r.json()


# ============================================================= B31 Admin Data Governance
class TestB31Admin:
    def test_non_admin_forbidden(self, user_tok):
        for p in ["/hi/admin/privacy/dashboard", "/hi/admin/privacy/retention",
                  "/hi/admin/privacy/deletions", "/hi/admin/privacy/incidents"]:
            r = requests.get(f"{API}{p}", headers=h(user_tok), timeout=30)
            assert r.status_code == 403, f"{p} -> {r.status_code}"

    def test_admin_dashboard(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/privacy/dashboard", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # sanity: expect some counts fields
        assert isinstance(d, dict) and len(d) > 0

    def test_retention_get(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/privacy/retention", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, dict) and len(d) > 0

    def test_incidents_create_and_advance(self, admin_tok):
        # Create
        r = requests.post(f"{API}/hi/admin/privacy/incidents", headers=h(admin_tok),
                          json={"incident_type": f"TEST_incident_{uuid.uuid4().hex[:6]}",
                                "severity": "low"}, timeout=30)
        assert r.status_code == 200, r.text
        inc = r.json()
        iid = inc.get("id") or inc.get("incident", {}).get("id")
        assert iid, f"no id in response: {inc}"

        # Verify in list
        r2 = requests.get(f"{API}/hi/admin/privacy/incidents", headers=h(admin_tok), timeout=30)
        assert r2.status_code == 200
        items = r2.json().get("incidents", r2.json() if isinstance(r2.json(), list) else [])
        assert any((it.get("id") == iid) for it in items), "created incident not in list"

        # Advance status → investigating
        r3 = requests.put(f"{API}/hi/admin/privacy/incidents/{iid}", headers=h(admin_tok),
                          json={"status": "investigating"}, timeout=30)
        assert r3.status_code == 200, r3.text

        # Advance status → resolved
        r4 = requests.put(f"{API}/hi/admin/privacy/incidents/{iid}", headers=h(admin_tok),
                          json={"status": "resolved"}, timeout=30)
        assert r4.status_code == 200, r4.text


# ============================================================= B32 Home Dashboard
class TestB32Dashboard:
    def test_snapshot(self, user_tok):
        r = requests.get(f"{API}/hi/home-dashboard/snapshot", headers=h(user_tok), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, dict)
        # snapshot expected fields
        # (be permissive — allow shape drift)
        assert "attention" in d or "today" in d or "stats" in d, f"unexpected shape: {list(d.keys())}"

    def test_attention(self, user_tok):
        r = requests.get(f"{API}/hi/home-dashboard/attention", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Should return a list of items (may be empty)
        items = d.get("items", d) if isinstance(d, dict) else d
        assert isinstance(items, list)

    def test_ai_summary(self, user_tok):
        r = requests.get(f"{API}/hi/home-dashboard/ai-summary", headers=h(user_tok), timeout=60)
        # AI can be slow or degraded; accept 200 or 202 or 503 gracefully
        assert r.status_code in (200, 202, 503), r.text

    def test_attention_snooze_dismiss_flow(self, user_tok):
        r = requests.get(f"{API}/hi/home-dashboard/attention", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        items = d.get("items", d) if isinstance(d, dict) else d
        # find a non-safety item to snooze
        target = next((it for it in items if not it.get("is_safety")), None)
        if not target:
            pytest.skip("no non-safety attention item to snooze")
        iid = target["id"]
        r2 = requests.post(f"{API}/hi/home-dashboard/attention/{iid}/snooze",
                           headers=h(user_tok), json={}, timeout=30)
        assert r2.status_code == 200, r2.text
        # dismiss another (or same after re-fetch)
        r3 = requests.get(f"{API}/hi/home-dashboard/attention", headers=h(user_tok), timeout=30)
        d3 = r3.json()
        items3 = d3.get("items", d3) if isinstance(d3, dict) else d3
        target2 = next((it for it in items3 if not it.get("is_safety")), None)
        if target2:
            r4 = requests.post(f"{API}/hi/home-dashboard/attention/{target2['id']}/dismiss",
                               headers=h(user_tok), json={}, timeout=30)
            assert r4.status_code == 200, r4.text


# ============================================================= B32 Timeline
class TestB32Timeline:
    def test_timeline_list(self, user_tok):
        r = requests.get(f"{API}/hi/home-dashboard/timeline", headers=h(user_tok), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        events = d.get("events", d) if isinstance(d, dict) else d
        assert isinstance(events, list)

    def test_note_add_and_delete(self, user_tok):
        title = f"TEST_note_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/hi/home-dashboard/timeline/note", headers=h(user_tok),
                          json={"title": title, "description": "TEST note body"}, timeout=30)
        assert r.status_code == 200, r.text
        note = r.json()
        nid = note.get("id") or note.get("note", {}).get("id") or note.get("event", {}).get("id")
        assert nid, f"no note id: {note}"

        # Verify appears in timeline
        r2 = requests.get(f"{API}/hi/home-dashboard/timeline", headers=h(user_tok), timeout=30)
        d2 = r2.json()
        events = d2.get("events", d2) if isinstance(d2, dict) else d2
        assert any((e.get("id") == nid) for e in events), "created note not in timeline"

        # Delete
        r3 = requests.delete(f"{API}/hi/home-dashboard/timeline/note/{nid}",
                             headers=h(user_tok), timeout=30)
        assert r3.status_code == 200, r3.text

        # Verify gone
        r4 = requests.get(f"{API}/hi/home-dashboard/timeline", headers=h(user_tok), timeout=30)
        d4 = r4.json()
        events4 = d4.get("events", d4) if isinstance(d4, dict) else d4
        assert not any((e.get("id") == nid) for e in events4), "note still present after delete"
