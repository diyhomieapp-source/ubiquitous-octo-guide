"""
Tests for Sheet #28 — B2B/Contractor & Professional Services Suite.

Covers:
  - Pro apply -> pending -> admin verify -> gate access
  - Pro-only endpoint gate (403) until verified
  - Admin pro-accounts list / verify / ban
  - Job lifecycle (create, list, get, proposal, status)
  - Client portal (list, approve, change-request, review, permissions)
  - Messaging (both roles)
  - Invoices (create, send, outstanding stats)
  - Payment guard (400 when pro has no Connect account)
  - Weather API with the new key
"""

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL is required"
API = f"{BASE_URL}/api"

VERIFIED_PRO = {"email": "pat_pro_test@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
CLIENT = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")}


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    return data.get("access_token") or data["token"]


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- shared fixtures ----------
@pytest.fixture(scope="session")
def pro_token() -> str:
    return _login(**VERIFIED_PRO)


@pytest.fixture(scope="session")
def client_token() -> str:
    return _login(**CLIENT)


@pytest.fixture(scope="session")
def admin_token() -> str:
    return _login(**ADMIN)


@pytest.fixture(scope="session")
def new_user():
    """Register a fresh user so we can test the apply->pending->verify->ban gate."""
    email = f"TEST_pro_{uuid.uuid4().hex[:8]}@diyhomie.com"
    password = __import__("os").environ.get("TEST_USER_PASSWORD", "")
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "Test Pro"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token") or _login(email, password)
    return {"email": email, "password": password, "token": tok}


# ---------- Weather ----------
class TestWeather:
    def test_weather_with_new_key(self, client_token):
        r = requests.get(f"{API}/weather", headers=_hdr(client_token), params={"q": "Austin"}, timeout=25)
        assert r.status_code == 200, r.text
        data = r.json()
        # Advisory endpoint returns weather + advisories list
        assert "advisories" in data
        assert isinstance(data["advisories"], list)
        # Some weather content should be present (either 'current' block or 'summary')
        assert "weather" in data
        assert data["weather"].get("location")


# ---------- Pro apply gate ----------
class TestProApplyGate:
    def test_new_user_is_not_pro_before_apply(self, new_user):
        r = requests.get(f"{API}/auth/me", headers=_hdr(new_user["token"]), timeout=20)
        assert r.status_code == 200
        me = r.json()
        # tolerate missing field == false
        assert not me.get("is_pro", False)

    def test_pro_me_has_no_account_before_apply(self, new_user):
        r = requests.get(f"{API}/pro/me", headers=_hdr(new_user["token"]), timeout=20)
        assert r.status_code == 200
        assert r.json().get("has_account") is False

    def test_pro_apply_creates_pending(self, new_user):
        payload = {
            "name": "TEST New Pro",
            "trades": ["Plumbing"],
            "specialties": ["Leak repair"],
            "location": "Austin, TX",
            "bio": "TEST pro profile bio.",
            "phone": "555-0100",
            "website": "",
            "license_number": "TEST-1",
            "insurance": "TEST-INS",
        }
        r = requests.post(f"{API}/pro/apply", headers=_hdr(new_user["token"]), json=payload, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "pending"

        # /pro/me now says has_account=true, status pending
        r2 = requests.get(f"{API}/pro/me", headers=_hdr(new_user["token"]), timeout=20)
        assert r2.status_code == 200
        body = r2.json()
        assert body.get("has_account") is True
        assert body.get("profile", {}).get("status") == "pending"

        # auth/me still is_pro=false
        r3 = requests.get(f"{API}/auth/me", headers=_hdr(new_user["token"]), timeout=20)
        assert r3.status_code == 200
        assert not r3.json().get("is_pro", False)

    def test_pro_only_endpoints_forbidden_until_verified(self, new_user):
        # create job blocked
        r = requests.post(
            f"{API}/pro/jobs",
            headers=_hdr(new_user["token"]),
            json={"client_email": "someone@example.com", "title": "Test", "description": ""},
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

        # connect status blocked
        r2 = requests.get(f"{API}/pro/connect/status", headers=_hdr(new_user["token"]), timeout=20)
        assert r2.status_code == 403


# ---------- Admin vetting ----------
class TestAdminVetting:
    def test_admin_pro_accounts_requires_admin(self, client_token):
        r = requests.get(f"{API}/admin/pro-accounts", headers=_hdr(client_token), timeout=20)
        assert r.status_code == 403

    def test_admin_pro_accounts_list(self, admin_token):
        r = requests.get(f"{API}/admin/pro-accounts", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert any(row.get("email") == VERIFIED_PRO["email"] for row in rows)

    def test_admin_verify_then_ban_new_pro(self, new_user, admin_token):
        # verify
        r = requests.post(
            f"{API}/admin/pro-accounts/{_user_id(new_user['token'])}/verify",
            headers=_hdr(admin_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text

        # auth/me now is_pro=true
        me = requests.get(f"{API}/auth/me", headers=_hdr(new_user["token"]), timeout=20).json()
        assert me.get("is_pro") is True

        # appears in public directory
        pros_data = requests.get(f"{API}/pros", headers=_hdr(new_user["token"]), timeout=20).json()
        pros_list = pros_data.get("pros") if isinstance(pros_data, dict) else pros_data
        assert isinstance(pros_list, list)
        assert any(p.get("name") == "TEST New Pro" for p in pros_list), "verified pro missing from directory"

        # ban
        rb = requests.post(
            f"{API}/admin/pro-accounts/{_user_id(new_user['token'])}/ban",
            headers=_hdr(admin_token),
            timeout=20,
        )
        assert rb.status_code == 200, rb.text
        me2 = requests.get(f"{API}/auth/me", headers=_hdr(new_user["token"]), timeout=20).json()
        assert me2.get("is_pro") is False


def _user_id(token: str) -> str:
    r = requests.get(f"{API}/auth/me", headers=_hdr(token), timeout=20)
    r.raise_for_status()
    return r.json()["id"]


# ---------- Job lifecycle ----------
class TestJobLifecycle:
    _created_job_id: str | None = None

    def test_pro_jobs_list_has_seeded_deck_build(self, pro_token):
        r = requests.get(f"{API}/pro/jobs", headers=_hdr(pro_token), timeout=20)
        assert r.status_code == 200
        jobs = r.json()
        assert isinstance(jobs, list) and len(jobs) >= 1
        assert any("Deck" in (j.get("title") or "") for j in jobs), "expected seeded 'Deck build'"

    def test_create_job(self, pro_token):
        r = requests.post(
            f"{API}/pro/jobs",
            headers=_hdr(pro_token),
            json={
                "client_email": CLIENT["email"],
                "title": "TEST_Bathroom_Refresh",
                "description": "Testing job lifecycle",
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["title"] == "TEST_Bathroom_Refresh"
        assert job["status"] == "draft"
        assert job["is_pro_side"] is True
        TestJobLifecycle._created_job_id = job["id"]

    def test_get_job_pro_side(self, pro_token):
        jid = TestJobLifecycle._created_job_id
        assert jid
        r = requests.get(f"{API}/pro/jobs/{jid}", headers=_hdr(pro_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["is_pro_side"] is True
        assert "invoices" in r.json()

    def test_get_job_forbidden_for_unrelated(self, admin_token):
        jid = TestJobLifecycle._created_job_id
        assert jid
        r = requests.get(f"{API}/pro/jobs/{jid}", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 403

    def test_set_proposal(self, pro_token):
        jid = TestJobLifecycle._created_job_id
        r = requests.post(
            f"{API}/pro/jobs/{jid}/proposal",
            headers=_hdr(pro_token),
            json={
                "line_items": [
                    {"label": "Labor", "amount_cents": 150000},
                    {"label": "Materials", "amount_cents": 50000},
                ],
                "note": "Standard scope.",
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        # confirm status/total via GET
        j = requests.get(f"{API}/pro/jobs/{jid}", headers=_hdr(pro_token), timeout=20).json()
        assert j["status"] == "proposal_sent"
        assert j["proposal"]["total_cents"] == 200000

    def test_client_can_get_job_after_status_leaves_draft(self, client_token):
        jid = TestJobLifecycle._created_job_id
        r = requests.get(f"{API}/pro/jobs/{jid}", headers=_hdr(client_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["is_pro_side"] is False

    def test_client_list_jobs_shows_new_job(self, client_token):
        r = requests.get(f"{API}/client/jobs", headers=_hdr(client_token), timeout=20)
        assert r.status_code == 200
        jids = [j["id"] for j in r.json()]
        assert TestJobLifecycle._created_job_id in jids

    def test_message_both_roles(self, pro_token, client_token):
        jid = TestJobLifecycle._created_job_id
        r1 = requests.post(
            f"{API}/pro/jobs/{jid}/message",
            headers=_hdr(pro_token),
            json={"body": "TEST pro message"},
            timeout=20,
        )
        assert r1.status_code == 200 and r1.json()["from_role"] == "pro"
        r2 = requests.post(
            f"{API}/pro/jobs/{jid}/message",
            headers=_hdr(client_token),
            json={"body": "TEST client message"},
            timeout=20,
        )
        assert r2.status_code == 200 and r2.json()["from_role"] == "client"

    def test_pro_cannot_approve(self, pro_token):
        jid = TestJobLifecycle._created_job_id
        r = requests.post(f"{API}/client/jobs/{jid}/approve", headers=_hdr(pro_token), timeout=20)
        assert r.status_code == 403

    def test_client_approve(self, client_token):
        jid = TestJobLifecycle._created_job_id
        r = requests.post(f"{API}/client/jobs/{jid}/approve", headers=_hdr(client_token), timeout=20)
        assert r.status_code == 200, r.text

    def test_client_change_request(self, client_token):
        jid = TestJobLifecycle._created_job_id
        r = requests.post(
            f"{API}/client/jobs/{jid}/change-request",
            headers=_hdr(client_token),
            json={"body": "Please use ceramic instead."},
            timeout=20,
        )
        assert r.status_code == 200

    def test_review_before_completed_rejected(self, client_token):
        jid = TestJobLifecycle._created_job_id
        r = requests.post(
            f"{API}/client/jobs/{jid}/review",
            headers=_hdr(client_token),
            json={"rating": 5, "text": "great"},
            timeout=20,
        )
        assert r.status_code == 400

    def test_status_in_progress_then_completed_increments(self, pro_token):
        jid = TestJobLifecycle._created_job_id
        pre = requests.get(f"{API}/pro/me", headers=_hdr(pro_token), timeout=20).json()
        pre_completed = pre["stats"]["completed_jobs"]

        r1 = requests.patch(
            f"{API}/pro/jobs/{jid}/status",
            headers=_hdr(pro_token),
            params={"status": "in_progress"},
            timeout=20,
        )
        assert r1.status_code == 200
        r2 = requests.patch(
            f"{API}/pro/jobs/{jid}/status",
            headers=_hdr(pro_token),
            params={"status": "completed"},
            timeout=20,
        )
        assert r2.status_code == 200
        time.sleep(0.5)
        post = requests.get(f"{API}/pro/me", headers=_hdr(pro_token), timeout=20).json()
        assert post["stats"]["completed_jobs"] == pre_completed + 1

    def test_client_review_after_completed(self, client_token):
        jid = TestJobLifecycle._created_job_id
        r = requests.post(
            f"{API}/client/jobs/{jid}/review",
            headers=_hdr(client_token),
            json={"rating": 5, "text": "TEST review"},
            timeout=20,
        )
        assert r.status_code == 200


# ---------- Invoices ----------
class TestInvoices:
    _job_id: str | None = None
    _invoice_id: str | None = None

    def test_create_job_for_invoices(self, pro_token):
        r = requests.post(
            f"{API}/pro/jobs",
            headers=_hdr(pro_token),
            json={"client_email": CLIENT["email"], "title": "TEST_InvoiceJob", "description": ""},
            timeout=20,
        )
        assert r.status_code == 200
        TestInvoices._job_id = r.json()["id"]

    def test_invoice_amount_zero_rejected(self, pro_token):
        r = requests.post(
            f"{API}/pro/jobs/{TestInvoices._job_id}/invoices",
            headers=_hdr(pro_token),
            json={"label": "TEST_Bad", "amount_cents": 0, "kind": "progress"},
            timeout=20,
        )
        assert r.status_code == 400

    def test_create_invoice(self, pro_token):
        r = requests.post(
            f"{API}/pro/jobs/{TestInvoices._job_id}/invoices",
            headers=_hdr(pro_token),
            json={"label": "TEST_Deposit", "amount_cents": 25000, "kind": "deposit"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["status"] == "draft"
        TestInvoices._invoice_id = inv["id"]

    def test_send_invoice_updates_outstanding(self, pro_token):
        pre = requests.get(f"{API}/pro/me", headers=_hdr(pro_token), timeout=20).json()
        pre_out = pre["stats"]["outstanding_cents"]
        r = requests.post(
            f"{API}/pro/invoices/{TestInvoices._invoice_id}/send",
            headers=_hdr(pro_token),
            timeout=20,
        )
        assert r.status_code == 200
        post = requests.get(f"{API}/pro/me", headers=_hdr(pro_token), timeout=20).json()
        assert post["stats"]["outstanding_cents"] >= pre_out + 25000

    def test_payment_guard_when_no_connect(self, client_token):
        # verified pro `pat_pro_test` has no Stripe Connect account -> 400
        r = requests.post(
            f"{API}/client/invoices/{TestInvoices._invoice_id}/pay",
            headers=_hdr(client_token),
            json={"origin_url": BASE_URL},
            timeout=25,
        )
        assert r.status_code == 400, f"expected 400 payout-not-set-up, got {r.status_code}: {r.text}"
        assert "payout" in r.text.lower() or "setting up" in r.text.lower()
