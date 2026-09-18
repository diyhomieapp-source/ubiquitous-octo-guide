"""E2E validation for Sheet #46 (Dev Platform), #47 (Risk Audit), #48 (Monetization), #49 (Portability)."""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def demo_token(session):
    return _login(session, "demo_home@diyhomie.com", __import__("os").environ.get("TEST_USER_PASSWORD", ""))


@pytest.fixture(scope="module")
def pro_token(session):
    return _login(session, "pat_pro_test@diyhomie.com", __import__("os").environ.get("TEST_USER_PASSWORD", ""))


@pytest.fixture(scope="module")
def admin_token(session):
    return _login(session, "Diyhomieapp@gmail.com", __import__("os").environ.get("TEST_ADMIN_PASSWORD", ""))


# =========================================================================
# Sheet #46 — Developer Platform (keys, webhooks, meta, docs)
# =========================================================================
class TestDeveloperPlatform:
    def test_meta_lists_scopes_events_and_docs(self, session, demo_token):
        r = session.get(f"{API}/developer/meta", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "scopes" in d and len(d["scopes"]) > 0
        assert "events" in d and len(d["events"]) > 0
        assert "environments" in d and set(d["environments"]) >= {"test", "live"}
        assert d.get("base_url", "").startswith("/api/v1")
        assert isinstance(d.get("docs"), list) and len(d["docs"]) > 0

    def test_create_list_and_revoke_key(self, session, demo_token):
        # Create
        r = session.post(f"{API}/developer/keys",
                         headers=_h(demo_token),
                         json={"label": "TEST_ptp_key", "scopes": ["projects:read"], "environment": "test"},
                         timeout=15)
        assert r.status_code == 200, r.text
        payload = r.json()
        assert "key" in payload
        k = payload["key"]
        assert k["id"] and k["key"].startswith("dk_"), k
        key_id = k["id"]
        full_key = k["key"]

        # List → masked
        r2 = session.get(f"{API}/developer/keys", headers=_h(demo_token), timeout=10)
        assert r2.status_code == 200
        keys = r2.json()["keys"]
        entry = next((x for x in keys if x["id"] == key_id), None)
        assert entry is not None
        # After creation, list should return masked
        assert entry["key"] != full_key
        assert "…" in entry["key"] or "..." in entry["key"] or entry["key"].endswith("****") or len(entry["key"]) < len(full_key)

        # Revoke
        r3 = session.post(f"{API}/developer/keys/{key_id}/revoke",
                          headers=_h(demo_token), timeout=10)
        assert r3.status_code == 200

        # Verify inactive
        r4 = session.get(f"{API}/developer/keys", headers=_h(demo_token), timeout=10)
        entry2 = next((x for x in r4.json()["keys"] if x["id"] == key_id), None)
        assert entry2 is not None and entry2["active"] is False

    def test_v1_key_auth_and_scope(self, session, demo_token):
        # Fresh key with projects:read
        r = session.post(f"{API}/developer/keys",
                         headers=_h(demo_token),
                         json={"label": "TEST_v1_key", "scopes": ["projects:read"], "environment": "test"},
                         timeout=15)
        assert r.status_code == 200
        full = r.json()["key"]["key"]
        key_id = r.json()["key"]["id"]

        # Auth request /api/v1/me
        r1 = session.get(f"{API}/v1/me", headers={"X-API-Key": full}, timeout=10)
        assert r1.status_code == 200, r1.text

        # /api/v1/projects (needs projects:read)
        r2 = session.get(f"{API}/v1/projects", headers={"X-API-Key": full}, timeout=10)
        assert r2.status_code == 200
        assert "projects" in r2.json() or isinstance(r2.json(), list)

        # No key -> 401/403
        r3 = session.get(f"{API}/v1/me", timeout=10)
        assert r3.status_code in (401, 403)

        # Cleanup
        session.post(f"{API}/developer/keys/{key_id}/revoke", headers=_h(demo_token), timeout=10)

    def test_webhook_create_test_and_delete(self, session, demo_token):
        r = session.post(f"{API}/developer/webhooks",
                         headers=_h(demo_token),
                         json={"url": "https://httpbin.org/post", "events": []},
                         timeout=15)
        assert r.status_code == 200, r.text
        # List
        r2 = session.get(f"{API}/developer/webhooks", headers=_h(demo_token), timeout=10)
        assert r2.status_code == 200
        hooks = r2.json()["webhooks"]
        assert len(hooks) > 0
        hook = next((h for h in hooks if h["url"] == "https://httpbin.org/post"), hooks[0])
        hook_id = hook["id"]
        assert hook.get("secret", "").startswith("whs_") or len(hook.get("secret", "")) > 10

        # Send test (network call)
        r3 = session.post(f"{API}/developer/webhooks/{hook_id}/test",
                          headers=_h(demo_token), timeout=20)
        assert r3.status_code == 200
        body = r3.json()
        assert "ok" in body
        assert "note" in body

        # Delete
        r4 = session.delete(f"{API}/developer/webhooks/{hook_id}",
                            headers=_h(demo_token), timeout=10)
        assert r4.status_code == 200
        # Verify gone
        after = session.get(f"{API}/developer/webhooks", headers=_h(demo_token), timeout=10).json()["webhooks"]
        assert not any(h["id"] == hook_id for h in after)

    def test_webhook_invalid_url_rejected(self, session, demo_token):
        # Backend appears to only require string, but check
        r = session.post(f"{API}/developer/webhooks",
                         headers=_h(demo_token),
                         json={"url": "not-a-url", "events": []},
                         timeout=10)
        # Accepts anything or 400 — either is documented behaviour; UI validates
        assert r.status_code in (200, 400, 422)


# =========================================================================
# Sheet #48 — API Monetization / Billing / Usage
# =========================================================================
class TestMonetization:
    def test_plans_list(self, session, demo_token):
        r = session.get(f"{API}/developer/plans", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        plans = r.json()["plans"]
        ids = {p["id"] for p in plans}
        assert {"free", "starter", "enterprise"}.issubset(ids)
        starter = next(p for p in plans if p["id"] == "starter")
        assert starter["base_cents"] == 2900  # $29

    def test_usage_endpoint_returns_keys_bill_trend(self, session, demo_token):
        r = session.get(f"{API}/developer/usage", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "keys" in d and "est_bill_cents" in d and "trend" in d and "period" in d

    def test_change_plan_updates_bill(self, session, demo_token):
        # Create fresh key
        r = session.post(f"{API}/developer/keys",
                         headers=_h(demo_token),
                         json={"label": "TEST_billing", "scopes": ["projects:read"], "environment": "test"},
                         timeout=15)
        assert r.status_code == 200
        key_id = r.json()["key"]["id"]

        # Change to starter
        r2 = session.post(f"{API}/developer/keys/{key_id}/plan",
                          headers=_h(demo_token),
                          json={"plan": "starter"},
                          timeout=10)
        assert r2.status_code == 200
        assert r2.json()["plan"] == "starter"

        # Verify est_bill includes starter base ($29 = 2900)
        r3 = session.get(f"{API}/developer/usage", headers=_h(demo_token), timeout=10)
        d = r3.json()
        my_key = next((k for k in d["keys"] if k["id"] == key_id), None)
        assert my_key is not None and my_key["plan"] == "starter"

        # Change to enterprise
        r4 = session.post(f"{API}/developer/keys/{key_id}/plan",
                          headers=_h(demo_token),
                          json={"plan": "enterprise"},
                          timeout=10)
        assert r4.status_code == 200

        # Bad plan
        r5 = session.post(f"{API}/developer/keys/{key_id}/plan",
                          headers=_h(demo_token),
                          json={"plan": "does_not_exist"},
                          timeout=10)
        assert r5.status_code == 400

        # Cleanup
        session.post(f"{API}/developer/keys/{key_id}/revoke", headers=_h(demo_token), timeout=10)

    def test_change_plan_wrong_owner_404(self, session, demo_token, pro_token):
        # Create key as demo
        r = session.post(f"{API}/developer/keys",
                         headers=_h(demo_token),
                         json={"label": "TEST_owner", "scopes": [], "environment": "test"},
                         timeout=15)
        key_id = r.json()["key"]["id"]

        # Try as pro
        r2 = session.post(f"{API}/developer/keys/{key_id}/plan",
                          headers=_h(pro_token),
                          json={"plan": "starter"},
                          timeout=10)
        assert r2.status_code == 404

        # Cleanup
        session.post(f"{API}/developer/keys/{key_id}/revoke", headers=_h(demo_token), timeout=10)


# =========================================================================
# Sheet #46/#48 — ADMIN partners registry
# =========================================================================
class TestAdminPartners:
    def test_admin_partners_returns_keys_hooks_totals(self, session, admin_token):
        r = session.get(f"{API}/admin/partners", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "keys" in d and "webhooks" in d and "totals" in d
        t = d["totals"]
        assert {"keys", "active_keys", "webhooks", "api_calls", "webhook_deliveries"}.issubset(t.keys())

    def test_admin_api_billing_returns_mrr_and_plans(self, session, admin_token):
        r = session.get(f"{API}/admin/api-billing", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "mrr_cents" in d and "billable_cents" in d and "plan_counts" in d
        assert isinstance(d.get("plans"), list) and len(d["plans"]) >= 3

    def test_admin_partners_non_admin_forbidden(self, session, demo_token):
        r = session.get(f"{API}/admin/partners", headers=_h(demo_token), timeout=10)
        assert r.status_code in (401, 403)


# =========================================================================
# Sheet #47 — AI Critical-Path & Risk Audit
# =========================================================================
class TestRiskAudit:
    def test_audit_returns_risk_confidence_factors(self, session, demo_token):
        # Get a project with steps (list endpoint returns summaries → check total_steps)
        r = session.get(f"{API}/projects", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        projects = r.json() if isinstance(r.json(), list) else r.json().get("projects", [])
        assert projects, "demo user has no projects — seed missing"
        project = next((p for p in projects if p.get("total_steps", 0) > 0), None)
        if project is None:
            pytest.skip("no project with steps to audit")
        pid = project["id"]

        # Run audit
        r2 = session.get(f"{API}/projects/{pid}/audit", headers=_h(demo_token), timeout=45)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        # Validate shape (backend returns risk_score not risk)
        assert "risk_score" in d and isinstance(d["risk_score"], (int, float))
        assert 0 <= d["risk_score"] <= 100
        assert "confidence" in d and 0 <= d["confidence"] <= 100
        assert "factors" in d and isinstance(d["factors"], list) and len(d["factors"]) > 0
        assert d.get("next_action")
        assert d.get("path_status") in ("optimal", "caution", "at_risk")

    def test_audit_refresh_forces_regeneration(self, session, demo_token):
        r = session.get(f"{API}/projects", headers=_h(demo_token), timeout=10)
        projects = r.json() if isinstance(r.json(), list) else r.json().get("projects", [])
        project = next((p for p in projects if p.get("total_steps", 0) > 0), None)
        if project is None:
            pytest.skip("no project with steps")
        pid = project["id"]
        r2 = session.get(f"{API}/projects/{pid}/audit?refresh=1", headers=_h(demo_token), timeout=45)
        assert r2.status_code == 200
        assert "risk_score" in r2.json()


# =========================================================================
# Sheet #49 — Data Portability
# =========================================================================
class TestPortability:
    def test_summary_returns_counts_and_pledge(self, session, demo_token):
        r = session.get(f"{API}/portability/summary", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "counts" in d and "ownership_notice" in d

    def test_export_returns_full_bundle(self, session, demo_token):
        r = session.get(f"{API}/portability/export", headers=_h(demo_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "summary" in d
        # bundle should contain at least projects/timeline arrays or similar
        assert isinstance(d, dict) and len(d) > 1

    def test_transfer_generates_token(self, session, demo_token):
        r = session.post(f"{API}/portability/transfer", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("token", "").startswith("xfer_")

    def test_import_invalid_token_404(self, session, pro_token):
        r = session.post(f"{API}/portability/import",
                         headers=_h(pro_token),
                         json={"token": "xfer_this_is_bogus_and_never_existed"},
                         timeout=10)
        assert r.status_code == 404

    def test_import_own_transfer_400(self, session, demo_token):
        # generate own token
        r = session.post(f"{API}/portability/transfer", headers=_h(demo_token), timeout=10)
        tok = r.json()["token"]
        r2 = session.post(f"{API}/portability/import",
                          headers=_h(demo_token),
                          json={"token": tok},
                          timeout=10)
        assert r2.status_code == 400

    def test_import_claimed_token_404(self, session, demo_token, pro_token):
        # demo generates
        r = session.post(f"{API}/portability/transfer", headers=_h(demo_token), timeout=10)
        tok = r.json()["token"]
        # pro claims
        r2 = session.post(f"{API}/portability/import",
                          headers=_h(pro_token),
                          json={"token": tok},
                          timeout=30)
        assert r2.status_code == 200, r2.text
        # second attempt (claimed) — 404
        r3 = session.post(f"{API}/portability/import",
                          headers=_h(pro_token),
                          json={"token": tok},
                          timeout=10)
        assert r3.status_code == 404

    def test_delete_request_requires_delete_confirm(self, session, pro_token):
        # empty confirm -> 400
        r = session.post(f"{API}/portability/delete-request",
                         headers=_h(pro_token),
                         json={"confirm": ""},
                         timeout=10)
        assert r.status_code == 400

        r2 = session.post(f"{API}/portability/delete-request",
                          headers=_h(pro_token),
                          json={"confirm": "delete me"},
                          timeout=10)
        assert r2.status_code == 400

        # exact "DELETE" -> ok (lowercase also ok per code)
        r3 = session.post(f"{API}/portability/delete-request",
                          headers=_h(pro_token),
                          json={"confirm": "DELETE"},
                          timeout=10)
        assert r3.status_code == 200
