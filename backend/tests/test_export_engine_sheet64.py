"""
Backend tests for Info Sheet #64: Data, Analytics & Project Reporting Export Engine.
Covers /api/export/options, /api/export/generate (json+csv+share),
public download/report endpoints, and admin /api/admin/export/kpis + /jobs.
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            for key in ("EXPO_PUBLIC_BACKEND_URL=", "EXPO_BACKEND_URL="):
                if line.startswith(key):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
            if BASE_URL:
                break
assert BASE_URL, "BASE_URL not resolved from env or frontend/.env"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.text[:200]}"
    return tok


@pytest.fixture(scope="module")
def demo_headers():
    return {"Authorization": f"Bearer {_login(DEMO_EMAIL, DEMO_PASS)}"}


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASS)}"}


# ------------------------------------------------------------ options
class TestExportOptions:
    def test_options_returns_7_types_and_counts(self, demo_headers):
        r = requests.get(f"{BASE_URL}/api/export/options", headers=demo_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert set(data["types"]) == {"projects", "timeline", "events", "skills", "campaigns", "certificates", "notifications"}
        assert len(data["types"]) == 7
        assert data["formats"] == ["json", "csv"]
        counts = data["counts"]
        for t in data["types"]:
            assert t in counts and isinstance(counts[t], int)
        # demo_home has real data
        assert counts["projects"] >= 1, f"expected demo projects, got {counts}"


# ------------------------------------------------------------ generate
class TestExportGenerate:
    def test_generate_json(self, demo_headers):
        r = requests.post(f"{BASE_URL}/api/export/generate", headers=demo_headers,
                          json={"types": ["projects", "timeline", "certificates"], "format": "json"}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "summary" in body and "data" in body
        assert body["types"] == ["projects", "timeline", "certificates"]
        s = body["summary"]
        for k in ["projects", "completed_logged", "money_saved_usd", "certificates"]:
            assert k in s
        assert "csv" not in body

    def test_generate_csv(self, demo_headers):
        r = requests.post(f"{BASE_URL}/api/export/generate", headers=demo_headers,
                          json={"types": ["timeline"], "format": "csv"}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "csv" in body
        assert body["csv"].splitlines()[0].startswith("date,project,room,skill,cost_usd,saved_usd,hours")

    def test_generate_share_creates_token(self, demo_headers):
        r = requests.post(f"{BASE_URL}/api/export/generate", headers=demo_headers,
                          json={"types": ["projects", "timeline"], "format": "json", "share": True,
                                "expires_days": 3, "max_downloads": 2}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "share" in body
        sh = body["share"]
        assert sh["token"].startswith("exp_")
        assert sh["download_url"].startswith("/api/export/download/")
        assert sh["report_url"].startswith("/api/export/report/")
        pytest.share_token = sh["token"]  # stash for later tests
        pytest.share_expires = sh["expires_at"]

    def test_generate_audit_logged(self, demo_headers):
        # Verify data_export event appears in user's own audit stream (if endpoint present)
        r = requests.get(f"{BASE_URL}/api/audit/me?limit=20", headers=demo_headers, timeout=15)
        if r.status_code != 200:
            pytest.skip("audit/me endpoint not exposed; skipping audit-log verification")
        events = r.json().get("events") or r.json().get("items") or []
        # audit stores field name 'event' (not 'action')
        names = [e.get("event") or e.get("action") for e in events]
        assert any("data_export" in (n or "") for n in names), f"data_export not in {names[:10]}"


# ------------------------------------------------------------ public download / report
class TestPublicDownload:
    def test_download_returns_bundle_and_increments(self):
        token = getattr(pytest, "share_token", None)
        assert token, "share token missing from previous test"
        r1 = requests.get(f"{BASE_URL}/api/export/download/{token}", timeout=20)
        assert r1.status_code == 200
        body = r1.json()
        assert "summary" in body
        assert "user_name" in body
        # Second download increments count -> still fine
        r2 = requests.get(f"{BASE_URL}/api/export/download/{token}", timeout=20)
        assert r2.status_code == 200

    def test_download_exhausted_returns_410(self):
        token = getattr(pytest, "share_token", None)
        assert token
        # max_downloads was 2; two downloads already done -> third should 410
        r = requests.get(f"{BASE_URL}/api/export/download/{token}", timeout=20)
        assert r.status_code == 410, f"expected 410 after limit, got {r.status_code}: {r.text[:200]}"

    def test_unknown_token_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/export/download/exp_definitely_missing_xyz", timeout=15)
        assert r.status_code == 404

    def test_report_html(self, demo_headers):
        # Create fresh share token with more room for report fetch
        r = requests.post(f"{BASE_URL}/api/export/generate", headers=demo_headers,
                          json={"types": ["projects"], "format": "json", "share": True, "max_downloads": 5},
                          timeout=30)
        assert r.status_code == 200
        token = r.json()["share"]["token"]
        rp = requests.get(f"{BASE_URL}/api/export/report/{token}", timeout=20)
        assert rp.status_code == 200
        html = rp.text
        assert "<html" in html.lower()
        assert "DIYhomie" in html
        assert "Home Project Report" in html

    def test_report_unknown_token_410(self):
        rp = requests.get(f"{BASE_URL}/api/export/report/exp_unknown_zzz", timeout=15)
        assert rp.status_code == 410  # per implementation: any err -> 410 html


# ------------------------------------------------------------ admin
class TestAdminExport:
    def test_kpis_admin_ok(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/export/kpis", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "kpis" in body
        k = body["kpis"]
        for f in ["users", "projects", "project_completions", "active_certificates",
                  "lessons_completed", "campaigns", "campaign_completions",
                  "exports_generated", "audit_events", "total_member_savings_usd"]:
            assert f in k, f"missing KPI {f}"
        assert k["users"] >= 1
        assert k["exports_generated"] >= 1  # we generated some above

    def test_jobs_admin_ok(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/export/jobs", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "jobs" in body and "total" in body
        assert body["total"] >= 1
        # bundle excluded from list
        for j in body["jobs"]:
            assert "bundle" not in j
            assert "token" in j
            assert "user_name" in j

    def test_kpis_non_admin_forbidden(self, demo_headers):
        r = requests.get(f"{BASE_URL}/api/admin/export/kpis", headers=demo_headers, timeout=15)
        assert r.status_code == 403, f"non-admin should get 403 got {r.status_code}"

    def test_jobs_non_admin_forbidden(self, demo_headers):
        r = requests.get(f"{BASE_URL}/api/admin/export/jobs", headers=demo_headers, timeout=15)
        assert r.status_code == 403
