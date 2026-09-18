"""Info Sheet #68 - Investor / Stakeholder Reporting Suite backend tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")
USER_EMAIL = "demo_home@diyhomie.com"
USER_PASSWORD = __import__("os").environ.get("TEST_USER_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


@pytest.fixture(scope="module")
def user_headers():
    return {"Authorization": f"Bearer {_login(USER_EMAIL, USER_PASSWORD)}"}


# ---- KPIs ----------------------------------------------------------------
class TestKpis:
    def test_kpis_ok(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/investor/kpis", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["generated_at", "users", "revenue", "engagement", "conversion"]:
            assert k in d, f"missing {k}"
        for k in ["total", "active_30d", "new_30d", "new_prev_30d", "growth_pct_mom"]:
            assert k in d["users"]
        for k in ["mrr_cents", "arr_cents", "arpu_cents", "paying_users", "monthly_expenses_cents",
                  "net_monthly_cents", "cash_on_hand_cents", "runway_months", "tier_counts"]:
            assert k in d["revenue"]
        for k in ["projects_total", "projects_completed", "completion_rate_pct",
                  "blog_posts_published", "community_projects", "certificates_issued",
                  "education_lessons", "pro_partners", "referrals"]:
            assert k in d["engagement"]
        assert "free_to_paid_pct" in d["conversion"] and "churn_pct" in d["conversion"]
        assert isinstance(d["users"]["total"], int) and d["users"]["total"] >= 0
        assert d["revenue"]["arr_cents"] == d["revenue"]["mrr_cents"] * 12

    def test_kpis_forbidden_for_non_admin(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/admin/investor/kpis", headers=user_headers, timeout=30)
        assert r.status_code in (401, 403), r.text

    def test_kpis_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/investor/kpis", timeout=30)
        assert r.status_code in (401, 403)


# ---- Reports CRUD --------------------------------------------------------
class TestReports:
    created_id = None

    def test_list_empty_or_ok(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/investor/reports", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "reports" in d and "total" in d
        assert isinstance(d["reports"], list)

    def test_generate_report_persists(self, admin_headers):
        payload = {"period": "monthly", "audience": "investors",
                   "highlights": "TEST_investor_sheet68 automated run"}
        r = requests.post(f"{BASE_URL}/api/admin/investor/reports", headers=admin_headers,
                          json=payload, timeout=120)
        assert r.status_code == 200, f"generate failed: {r.status_code} {r.text[:400]}"
        doc = r.json()
        for k in ["id", "created_at", "period", "audience", "title", "tldr",
                  "sections", "metrics_table", "asks", "risks", "kpi_snapshot"]:
            assert k in doc, f"missing {k}"
        assert doc["period"] == "monthly"
        assert doc["audience"] == "investors"
        assert isinstance(doc["sections"], list) and len(doc["sections"]) > 0
        for s in doc["sections"]:
            assert "heading" in s and "body" in s
        assert isinstance(doc["metrics_table"], list)
        assert "users" in doc["kpi_snapshot"] and "revenue" in doc["kpi_snapshot"]
        TestReports.created_id = doc["id"]

    def test_get_report_returns_full(self, admin_headers):
        assert TestReports.created_id, "prior test must set id"
        rid = TestReports.created_id
        r = requests.get(f"{BASE_URL}/api/admin/investor/reports/{rid}", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == rid
        assert "sections" in d and isinstance(d["sections"], list) and len(d["sections"]) > 0
        assert "kpi_snapshot" in d

    def test_list_contains_created(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/investor/reports", headers=admin_headers, timeout=30)
        d = r.json()
        ids = [x["id"] for x in d["reports"]]
        assert TestReports.created_id in ids

    def test_get_report_404(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/investor/reports/does-not-exist-xyz",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 404

    def test_reports_forbidden_for_non_admin(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/admin/investor/reports", headers=user_headers, timeout=30)
        assert r.status_code in (401, 403)
        r2 = requests.post(f"{BASE_URL}/api/admin/investor/reports", headers=user_headers,
                           json={"period": "monthly"}, timeout=30)
        assert r2.status_code in (401, 403)

    def test_delete_report_ok(self, admin_headers):
        assert TestReports.created_id
        rid = TestReports.created_id
        r = requests.delete(f"{BASE_URL}/api/admin/investor/reports/{rid}",
                            headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # verify gone
        r2 = requests.get(f"{BASE_URL}/api/admin/investor/reports/{rid}",
                          headers=admin_headers, timeout=30)
        assert r2.status_code == 404

    def test_delete_unknown_404(self, admin_headers):
        r = requests.delete(f"{BASE_URL}/api/admin/investor/reports/nope-nope-nope",
                            headers=admin_headers, timeout=30)
        assert r.status_code == 404


# ---- Investor Q&A --------------------------------------------------------
class TestAsk:
    def test_ask_ok(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/admin/investor/ask", headers=admin_headers,
                          json={"question": "What is our current MRR and paying user count?"},
                          timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "answer" in d and isinstance(d["answer"], str) and len(d["answer"]) > 0
        assert "supporting_metrics" in d and isinstance(d["supporting_metrics"], list)

    def test_ask_empty_400(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/admin/investor/ask", headers=admin_headers,
                          json={"question": "   "}, timeout=30)
        assert r.status_code == 400

    def test_ask_forbidden_for_non_admin(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/admin/investor/ask", headers=user_headers,
                          json={"question": "runway?"}, timeout=30)
        assert r.status_code in (401, 403)
