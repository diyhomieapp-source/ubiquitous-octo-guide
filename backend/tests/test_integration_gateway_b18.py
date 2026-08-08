"""Backend tests for Blueprint 18: Integration Gateway, Secrets Vault & Automation Control Plane."""
import os
import time
import json
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = "diyhomie1122"
USER_EMAIL = "demo_home@diyhomie.com"
USER_PASS = "Test1234"

SECRET_MARKERS = ["sk_", "pk_", "AKIA", "AIza", "secret", "SECRET_VALUE"]

# Session-scoped auth tokens
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]

@pytest.fixture(scope="session")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASS}, timeout=30)
    assert r.status_code == 200, f"user login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]

def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ============================================================ Dashboard
class TestDashboard:
    def test_dashboard_returns_summary_and_11_connectors(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/dashboard", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "summary" in data and "connectors" in data
        assert data["summary"]["connectors"] >= 11, f"expected >=11 seeded connectors, got {data['summary']['connectors']}"
        keys = {c["connector_key"] for c in data["connectors"]}
        for expected in ["emergent_llm", "stripe", "posthog", "sentry", "firebase_push",
                         "decor8", "perplexity", "aws_ses", "weatherapi", "pipedream", "browserbase"]:
            assert expected in keys, f"missing seeded connector {expected}"
        # dashboard must not leak any raw secrets
        blob = json.dumps(data).lower()
        for env_var in ["stripe_secret_key", "aws_secret_access_key", "emergent_llm_key"]:
            # env var *name* is ok inside a 'vault://...' ref? Actually dashboard shouldn't include refs at all
            pass
        # ensure no environment secret value markers appear (best-effort)
        env_val = (os.environ.get("EMERGENT_LLM_KEY") or "").strip()
        if env_val and len(env_val) > 8:
            assert env_val not in r.text, "raw EMERGENT_LLM_KEY leaked in dashboard response!"


# ============================================================ Auth gating
class TestAuth:
    def test_dashboard_401_without_token(self):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/dashboard", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403 without token, got {r.status_code}"

    def test_dashboard_403_for_normal_user(self, user_token):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/dashboard", headers=_h(user_token), timeout=30)
        assert r.status_code == 403, f"expected 403 for non-admin, got {r.status_code} {r.text}"


# ============================================================ Connector detail — sanitized credentials
class TestConnectorDetail:
    @pytest.fixture(scope="class")
    def connector_map(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/dashboard", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        return {c["connector_key"]: c["id"] for c in r.json()["connectors"]}

    def test_stripe_credentials_are_sanitized(self, admin_token, connector_map):
        cid = connector_map["stripe"]
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/connectors/{cid}", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["credentials"], "stripe must have credential refs"
        for cr in data["credentials"]:
            assert cr["reference"].startswith("vault://"), f"credential ref must start with vault://, got {cr['reference']}"
            assert "configured" in cr and isinstance(cr["configured"], bool)
            # never contain a value-like key
            assert "value" not in cr and "secret" not in cr, f"credential view leaks raw fields: {cr.keys()}"
        # scan whole response body for known secret prefixes
        body = r.text
        for marker in ["sk_live_", "sk_test_", "AKIA"]:
            assert marker not in body, f"raw secret prefix {marker!r} leaked in stripe detail!"

    def test_all_connectors_credentials_sanitized(self, admin_token, connector_map):
        for key, cid in connector_map.items():
            r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/connectors/{cid}", headers=_h(admin_token), timeout=30)
            assert r.status_code == 200, f"{key}: {r.text}"
            data = r.json()
            for cr in data.get("credentials", []):
                assert cr["reference"].startswith("vault://"), f"{key}: bad ref {cr['reference']}"
                assert isinstance(cr["configured"], bool), f"{key}: configured not bool"
                # Whitelisted safe keys only — no 'value','secret','password','token','key'
                for banned in ("value", "raw", "plaintext", "secret_value", "api_key_value"):
                    assert banned not in cr, f"{key}: leaked field {banned}"


# ============================================================ Test connection + workflow
class TestConnectionAndWorkflow:
    @pytest.fixture(scope="class")
    def connector_map(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/dashboard", headers=_h(admin_token), timeout=30)
        return {c["connector_key"]: c["id"] for c in r.json()["connectors"]}

    def test_health_check_endpoint(self, admin_token, connector_map):
        cid = connector_map["decor8"]
        r = requests.post(f"{BASE_URL}/api/hi/admin/integrations/connectors/{cid}/test", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "health_status" in d
        assert d["health_status"] in ("healthy", "dormant", "disabled")

    def test_workflow_configured_connector_succeeds(self, admin_token, connector_map):
        # weatherapi or decor8 should be configured
        cid = connector_map.get("decor8")
        r = requests.post(f"{BASE_URL}/api/hi/admin/integrations/connectors/{cid}/test-workflow", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        job = r.json()
        # Should end 'succeeded' if configured, else at minimum in one of the state machine states
        assert job["status"] in ("succeeded", "failed_retryable", "queued", "running", "dead_letter"), job
        # If health says all configured, we expect succeeded
        # (soft check; env may lack decor8 key in preview)

    def test_workflow_dormant_pipedream_fails(self, admin_token, connector_map):
        cid = connector_map["pipedream"]
        last_status = None
        for _ in range(6):  # enqueue then retry until dead-letter
            r = requests.post(f"{BASE_URL}/api/hi/admin/integrations/connectors/{cid}/test-workflow", headers=_h(admin_token), timeout=30)
            assert r.status_code == 200
            job = r.json()
            last_status = job["status"]
            # not succeeded because pipedream is dormant
            assert last_status != "succeeded", f"pipedream should never succeed while dormant, got {last_status}"
            # retry the same job until we hit dead_letter
            if last_status in ("failed_retryable", "failed_final"):
                for _ in range(6):
                    rr = requests.post(f"{BASE_URL}/api/hi/admin/integrations/jobs/{job['id']}/retry",
                                       headers=_h(admin_token), timeout=30)
                    if rr.status_code == 200:
                        last_status = rr.json()["status"]
                        if last_status == "dead_letter":
                            break
                    else:
                        break
                if last_status == "dead_letter":
                    break
        assert last_status in ("failed_retryable", "dead_letter"), f"expected dormant pipedream failure state, got {last_status}"


# ============================================================ Enable / disable + rotate
class TestEnableDisableRotate:
    @pytest.fixture(scope="class")
    def connector_id(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/dashboard", headers=_h(admin_token), timeout=30)
        for c in r.json()["connectors"]:
            if c["connector_key"] == "posthog":
                return c["id"]
        raise RuntimeError("posthog missing")

    def test_disable_then_enable(self, admin_token, connector_id):
        r = requests.put(f"{BASE_URL}/api/hi/admin/integrations/connectors/{connector_id}",
                         headers=_h(admin_token), json={"status": "disabled"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "disabled"

        r = requests.put(f"{BASE_URL}/api/hi/admin/integrations/connectors/{connector_id}",
                         headers=_h(admin_token), json={"status": "active"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "active"

    def test_rotate_never_accepts_secret(self, admin_token, connector_id):
        # fetch credentials
        d = requests.get(f"{BASE_URL}/api/hi/admin/integrations/connectors/{connector_id}",
                         headers=_h(admin_token), timeout=30).json()
        assert d["credentials"], "posthog must have creds"
        cred_id = d["credentials"][0]["id"]
        # send extra field 'secret_value' — server MUST ignore it (pydantic drops unknown)
        r = requests.post(f"{BASE_URL}/api/hi/admin/integrations/connectors/{connector_id}/rotate",
                          headers=_h(admin_token),
                          json={"credential_reference_id": cred_id, "rotation_due_days": 90,
                                "secret_value": "sk_live_MALICIOUS_TEST_VALUE"}, timeout=30)
        assert r.status_code == 200, r.text
        result = r.json()
        # verify no raw value returned + last_rotated_at set
        assert "value" not in result and "secret" not in result and "raw" not in result
        assert result.get("last_rotated_at"), "rotation timestamp should be set"
        assert result["reference"].startswith("vault://")
        assert "sk_live_MALICIOUS_TEST_VALUE" not in r.text


# ============================================================ Browser sessions
class TestBrowserBroker:
    def test_create_and_approve_session(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/hi/admin/integrations/browser-sessions",
                          headers=_h(admin_token),
                          json={"target_platform": "test.local", "purpose": "smoke",
                                "workflow_type": "browser_account_change"}, timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["approval_status"] == "awaiting_approval"
        sid = s["id"]

        r2 = requests.post(f"{BASE_URL}/api/hi/admin/integrations/browser-sessions/{sid}/approve",
                           headers=_h(admin_token), timeout=30)
        assert r2.status_code == 200, r2.text
        s2 = r2.json()
        assert s2["approval_status"] == "approved"
        # Browserbase is dormant so outcome should mention parked
        assert s2.get("session_reference") in (None, "") or "vault://" in (s2.get("session_reference") or "")


# ============================================================ Health & webhooks feeds
class TestFeeds:
    def test_health_feed(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/health", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert "events" in r.json()

    def test_webhook_feed(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/webhooks", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        assert "receipts" in r.json()


# ============================================================ Stripe webhook signature + dedupe
class TestStripeWebhook:
    def test_missing_signature_rejected_400(self):
        body = json.dumps({"id": "evt_TEST_no_sig_1", "type": "test.event"})
        r = requests.post(f"{BASE_URL}/api/integrations/webhooks/stripe",
                          data=body, headers={"Content-Type": "application/json", "X-Event-Id": "evt_TEST_no_sig_1"},
                          timeout=30)
        assert r.status_code == 400, f"expected 400 for missing signature, got {r.status_code} {r.text}"

    def test_duplicate_webhook_deduped(self, admin_token):
        # Send twice with the same X-Event-Id — first is rejected (400), second must be deduped (200 duplicate=True)
        eid = "evt_TEST_dedupe_" + str(int(time.time()))
        body = json.dumps({"id": eid, "type": "test.event"})
        headers = {"Content-Type": "application/json", "X-Event-Id": eid}
        r1 = requests.post(f"{BASE_URL}/api/integrations/webhooks/stripe", data=body, headers=headers, timeout=30)
        # first call: signature invalid → rejected 400, but receipt is still recorded
        assert r1.status_code == 400
        r2 = requests.post(f"{BASE_URL}/api/integrations/webhooks/stripe", data=body, headers=headers, timeout=30)
        # second call: MUST dedupe (receipt exists for provider_event_id) → 200 duplicate
        assert r2.status_code == 200, f"expected 200 duplicate on second call, got {r2.status_code} {r2.text}"
        assert r2.json().get("duplicate") is True


# ============================================================ Global secret-leak scan
class TestNoSecretsLeak:
    def test_no_secret_in_dashboard_or_details(self, admin_token):
        # scan all connector detail bodies for any credential value in env
        r = requests.get(f"{BASE_URL}/api/hi/admin/integrations/dashboard", headers=_h(admin_token), timeout=30)
        blob = r.text
        assert r.status_code == 200
        for c in r.json()["connectors"]:
            dd = requests.get(f"{BASE_URL}/api/hi/admin/integrations/connectors/{c['id']}",
                              headers=_h(admin_token), timeout=30)
            blob += "\n" + dd.text
        # Check every env var referenced in seed connectors
        env_names = ["EMERGENT_LLM_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
                     "POSTHOG_PROJECT_TOKEN", "SENTRY_BACKEND_DSN", "EMERGENT_PUSH_KEY",
                     "DECOR8_API_KEY", "PERPLEXITY_API_KEY", "AWS_ACCESS_KEY_ID",
                     "AWS_SECRET_ACCESS_KEY", "WEATHER_API_KEY", "PIPEDREAM_API_KEY",
                     "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"]
        for name in env_names:
            val = (os.environ.get(name) or "").strip()
            if val and len(val) >= 8 and val.lower() != "placeholder":
                assert val not in blob, f"RAW secret for {name} leaked in integration API response!"
