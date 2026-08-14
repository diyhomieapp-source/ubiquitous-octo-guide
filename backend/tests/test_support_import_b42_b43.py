"""B42 (Support Intelligence) + B43 (Property Import & Reconciliation) integration tests."""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_token():
    return _login(DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def uheaders(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(scope="module")
def aheaders(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# -------------------- B42 Assistant --------------------
class TestB42Assist:
    def test_categories(self, uheaders):
        r = requests.get(f"{API}/hi/help/categories", headers=uheaders, timeout=30)
        assert r.status_code == 200
        cats = r.json()["categories"]
        assert len(cats) == 10
        keys = {c["key"] for c in cats}
        assert "account_access" in keys and "privacy_data" in keys

    def test_kb_published(self, uheaders):
        r = requests.get(f"{API}/hi/help/kb", headers=uheaders, timeout=30)
        assert r.status_code == 200
        arts = r.json()["articles"]
        assert len(arts) >= 10
        titles = {a["title"] for a in arts}
        assert "Reset your password" in titles

    def test_assist_forgot_password(self, uheaders):
        r = requests.post(f"{API}/hi/help/assist", headers=uheaders,
                          json={"message": "I forgot my password"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["category"] == "account_access"
        assert d["priority"] == "high"
        assert d["matched"] is True
        titles = [a["title"] for a in d["articles"]]
        assert "Reset your password" in titles

    def test_assist_hacked_critical(self, uheaders):
        r = requests.post(f"{API}/hi/help/assist", headers=uheaders,
                          json={"message": "my account was hacked"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["priority"] == "critical"


# -------------------- B42 Tickets --------------------
class TestB42Tickets:
    ticket_id = None

    def test_create_ticket_priority_escalation(self, uheaders):
        payload = {
            "subject": "TEST_ticket billing",
            "description": "I was charged twice for my subscription. Please help.",
            "category": "subscription_billing",
            "context": {"screen": "profile", "feature_area": "billing"},
        }
        r = requests.post(f"{API}/hi/help/tickets", headers=uheaders, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        t = r.json()["ticket"]
        assert t["priority"] == "critical", f"expected critical got {t['priority']}"
        assert t["status"] == "open"
        TestB42Tickets.ticket_id = t["id"]

    def test_list_tickets(self, uheaders):
        r = requests.get(f"{API}/hi/help/tickets", headers=uheaders, timeout=30)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()["tickets"]]
        assert TestB42Tickets.ticket_id in ids

    def test_get_ticket_with_messages(self, uheaders):
        tid = TestB42Tickets.ticket_id
        r = requests.get(f"{API}/hi/help/tickets/{tid}", headers=uheaders, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["ticket"]["id"] == tid
        assert len(d["messages"]) >= 1

    def test_add_message(self, uheaders):
        tid = TestB42Tickets.ticket_id
        r = requests.post(f"{API}/hi/help/tickets/{tid}/messages", headers=uheaders,
                          json={"body": "Any update?"}, timeout=30)
        assert r.status_code == 200

    def test_feedback(self, uheaders):
        tid = TestB42Tickets.ticket_id
        r = requests.post(f"{API}/hi/help/tickets/{tid}/feedback", headers=uheaders,
                          json={"rating": 5, "feedback": "helpful"}, timeout=30)
        assert r.status_code == 200

    def test_cross_user_isolation(self, aheaders):
        """Admin logging in via user route should still not see another user's ticket via user endpoint.
        Simulate by registering a fresh user and trying to read demo user's ticket."""
        tid = TestB42Tickets.ticket_id
        # Register throwaway user
        email = f"TEST_iso_{uuid.uuid4().hex[:8]}@diyhomie.com"
        reg = requests.post(f"{API}/auth/register",
                            json={"email": email, "password": "Test1234", "name": "iso"}, timeout=30)
        if reg.status_code not in (200, 201):
            pytest.skip(f"register unavailable: {reg.status_code}")
        tok = reg.json().get("access_token") or _login(email, "Test1234")
        h = {"Authorization": f"Bearer {tok}"}
        r = requests.get(f"{API}/hi/help/tickets/{tid}", headers=h, timeout=30)
        assert r.status_code == 404, f"cross-user isolation failed: {r.status_code} {r.text}"


# -------------------- B42 Admin Desk --------------------
class TestB42Admin:
    kb_id = None

    def test_dashboard(self, aheaders):
        r = requests.get(f"{API}/hi/admin/help/dashboard", headers=aheaders, timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("open", "escalated_open", "ai_resolved", "kb_published", "by_priority", "by_category"):
            assert k in d, f"missing {k}"

    def test_admin_tickets_sorted(self, aheaders):
        r = requests.get(f"{API}/hi/admin/help/tickets", headers=aheaders, timeout=30)
        assert r.status_code == 200
        tickets = r.json()["tickets"]
        assert len(tickets) >= 1
        # Priority-sort check
        rank = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        ranks = [rank.get(t["priority"], 9) for t in tickets]
        assert ranks == sorted(ranks), "tickets not priority-sorted"

    def test_admin_reply_and_resolve(self, aheaders):
        tid = TestB42Tickets.ticket_id
        # priority change
        r = requests.put(f"{API}/hi/admin/help/tickets/{tid}", headers=aheaders,
                        json={"priority": "high"}, timeout=30)
        assert r.status_code == 200
        # reply -> waiting_user
        r = requests.post(f"{API}/hi/admin/help/tickets/{tid}/reply", headers=aheaders,
                        json={"body": "We're investigating."}, timeout=30)
        assert r.status_code == 200
        r = requests.get(f"{API}/hi/admin/help/tickets/{tid}", headers=aheaders, timeout=30)
        assert r.json()["ticket"]["status"] == "waiting_user"
        # resolve
        r = requests.post(f"{API}/hi/admin/help/tickets/{tid}/resolve", headers=aheaders,
                        json={"resolution_type": "human_resolved", "summary": "Refund processed."}, timeout=30)
        assert r.status_code == 200
        r = requests.get(f"{API}/hi/admin/help/tickets/{tid}", headers=aheaders, timeout=30)
        assert r.json()["ticket"]["status"] == "resolved"

    def test_kb_create_and_publish(self, aheaders):
        r = requests.post(f"{API}/hi/admin/help/kb", headers=aheaders,
                        json={"title": "TEST_KB_iter78", "category": "other",
                              "content": "test body", "status": "draft"}, timeout=30)
        assert r.status_code == 200
        aid = r.json()["article"]["id"]
        TestB42Admin.kb_id = aid
        r = requests.put(f"{API}/hi/admin/help/kb/{aid}", headers=aheaders,
                        json={"status": "published"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["article"]["status"] == "published"


# -------------------- B43 Import --------------------
class TestB43Import:
    job_id = None
    issue_id = None
    field_key = f"test_year_built_{uuid.uuid4().hex[:6]}"

    def test_config(self, uheaders):
        r = requests.get(f"{API}/hi/import/config", headers=uheaders, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "fact_labels" in d and "disclaimer" in d
        assert "year_built" in d["fact_labels"]

    def test_create_job_new_information(self, uheaders):
        payload = {
            "import_type": "manual",
            "evidence": [{
                "evidence_type": "property_fact",
                "field_key": TestB43Import.field_key,
                "observed_value": "1985",
                "source_type": "user_document",
                "confidence_level": "high",
            }],
            "note": "TEST_iter78 import",
        }
        r = requests.post(f"{API}/hi/import/jobs", headers=uheaders, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["job"]["status"] == "ready_for_review"
        assert len(d["issues"]) == 1
        assert d["issues"][0]["issue_type"] == "new_information"
        TestB43Import.job_id = d["job"]["id"]
        TestB43Import.issue_id = d["issues"][0]["id"]

    def test_accept_issue(self, uheaders):
        r = requests.post(f"{API}/hi/import/issues/{TestB43Import.issue_id}/resolve",
                          headers=uheaders, json={"action": "accept"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"

    def test_facts_show_user_confirmed(self, uheaders):
        r = requests.get(f"{API}/hi/import/facts", headers=uheaders, timeout=30)
        assert r.status_code == 200
        facts = r.json()["facts"]
        mine = [f for f in facts if f["field_key"] == TestB43Import.field_key]
        assert len(mine) == 1
        assert mine[0]["value"] == "1985"
        assert mine[0]["verification_status"] == "user_confirmed"

    def test_conflict_protected_on_reimport(self, uheaders):
        payload = {
            "import_type": "manual",
            "evidence": [{
                "evidence_type": "property_fact",
                "field_key": TestB43Import.field_key,
                "observed_value": "1990",
                "source_type": "ai_extracted",
                "confidence_level": "medium",
            }],
        }
        r = requests.post(f"{API}/hi/import/jobs", headers=uheaders, json=payload, timeout=30)
        assert r.status_code == 200
        issues = r.json()["issues"]
        assert len(issues) == 1
        assert issues[0]["issue_type"] == "conflict"
        assert issues[0]["protected"] is True, "user-confirmed fact must be protected"
        # Keep should reject and not overwrite fact
        iid = issues[0]["id"]
        rr = requests.post(f"{API}/hi/import/issues/{iid}/resolve", headers=uheaders,
                           json={"action": "keep"}, timeout=30)
        assert rr.status_code == 200
        assert rr.json()["status"] == "rejected"
        # Verify fact unchanged
        f = requests.get(f"{API}/hi/import/facts", headers=uheaders, timeout=30).json()["facts"]
        mine = [x for x in f if x["field_key"] == TestB43Import.field_key][0]
        assert mine["value"] == "1985", "fact should not be overwritten after keep"

    def test_list_and_get_jobs(self, uheaders):
        r = requests.get(f"{API}/hi/import/jobs", headers=uheaders, timeout=30)
        assert r.status_code == 200
        ids = [j["id"] for j in r.json()["jobs"]]
        assert TestB43Import.job_id in ids
        r = requests.get(f"{API}/hi/import/jobs/{TestB43Import.job_id}", headers=uheaders, timeout=30)
        assert r.status_code == 200


# -------------------- B43 Admin --------------------
class TestB43Admin:
    src_id = None

    def test_dashboard(self, aheaders):
        r = requests.get(f"{API}/hi/admin/import/dashboard", headers=aheaders, timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("jobs_by_status", "issues_by_type", "pending_review", "sources"):
            assert k in d

    def test_sources_crud(self, aheaders):
        r = requests.post(f"{API}/hi/admin/import/sources", headers=aheaders,
                          json={"source_name": f"TEST_source_{uuid.uuid4().hex[:6]}",
                                "source_type": "parcel", "reliability_level": "external_provider"}, timeout=30)
        assert r.status_code == 200
        sid = r.json()["source"]["id"]
        TestB43Admin.src_id = sid
        r = requests.get(f"{API}/hi/admin/import/sources", headers=aheaders, timeout=30)
        assert r.status_code == 200
        assert sid in [s["id"] for s in r.json()["sources"]]
        r = requests.put(f"{API}/hi/admin/import/sources/{sid}?status=paused", headers=aheaders, timeout=30)
        assert r.status_code == 200
