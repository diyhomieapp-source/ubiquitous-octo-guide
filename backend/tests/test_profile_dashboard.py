"""DIYhomie Profile & Dashboard backend regression tests.

Covers the NEW endpoints introduced for the Profile-tab dashboard:

  - GET  /api/billing/summary       — tier/credits/voice/payments/plans/has_customer
  - POST /api/billing/customer-portal — returns live billing.stripe.com URL
  - GET  /api/support/tickets       — scoped to the logged-in user only

Auth gating (401/403 without token) and cross-user ticket isolation are
validated explicitly. Stripe is LIVE — only the *portal-session* call is
exercised; no checkout/subscription is completed.
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------------------------- fixtures ----------------------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(session, label="prof"):
    email = f"TEST_{label}_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": label.title()},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def user_a(session):
    return _register(session, "profA")


@pytest.fixture(scope="module")
def user_b(session):
    return _register(session, "profB")


def H(u):
    return {"Authorization": f"Bearer {u['token']}"}


# ============================================================
# Billing summary
# ============================================================
class TestBillingSummary:
    def test_requires_auth(self, session):
        r = session.get(f"{API}/billing/summary", timeout=20)
        # FastAPI HTTPBearer returns 403 when header missing; either is acceptable
        assert r.status_code in (401, 403), r.text

    def test_summary_shape_for_free_user(self, session, user_a):
        r = session.get(f"{API}/billing/summary", headers=H(user_a), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()

        # Required top-level keys per contract
        required = [
            "tier", "tier_label", "status", "credits", "voice_minutes", "amount",
            "renews_at", "cancel_at_period_end", "credit_cents", "payments",
            "plans", "has_customer",
        ]
        for k in required:
            assert k in d, f"missing key: {k} in {d.keys()}"

        # Free user defaults
        assert d["tier"] == "free"
        assert d["tier_label"] == "Free"
        assert d["amount"] == 0
        assert d["cancel_at_period_end"] is False
        assert d["credit_cents"] == 0
        assert isinstance(d["payments"], list)
        assert isinstance(d["has_customer"], bool)
        # New user has 60 starter credits
        assert d["credits"] >= 0
        assert isinstance(d["voice_minutes"], int)

    def test_plans_include_pro_and_master(self, session, user_a):
        r = session.get(f"{API}/billing/summary", headers=H(user_a), timeout=30)
        d = r.json()
        plans = d["plans"]
        assert isinstance(plans, list) and len(plans) >= 2
        tiers = {p["tier"] for p in plans}
        assert {"pro", "master"}.issubset(tiers), f"plans missing pro/master: {tiers}"
        for p in plans:
            for k in ("tier", "label", "amount", "credits", "voice_minutes"):
                assert k in p, f"plan missing {k}: {p}"
            assert isinstance(p["amount"], int)
            assert p["amount"] > 0


# ============================================================
# Customer portal (LIVE Stripe — portal session only)
# ============================================================
class TestCustomerPortal:
    def test_requires_auth(self, session):
        r = session.post(
            f"{API}/billing/customer-portal",
            json={"origin_url": "https://example.com"},
            timeout=20,
        )
        assert r.status_code in (401, 403), r.text

    def test_returns_stripe_billing_portal_url(self, session, user_a):
        r = session.post(
            f"{API}/billing/customer-portal",
            headers=H(user_a),
            json={"origin_url": __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")},
            timeout=60,
        )
        from conftest import skip_unless_real_stripe
        skip_unless_real_stripe(r)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "url" in d, d
        assert isinstance(d["url"], str)
        assert "billing.stripe.com" in d["url"], (
            f"Expected billing.stripe.com host, got: {d['url']}"
        )

    def test_portal_creates_or_reuses_stripe_customer(self, session, user_a):
        # First call should ensure a stripe customer exists
        r1 = session.post(
            f"{API}/billing/customer-portal",
            headers=H(user_a),
            json={"origin_url": __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")},
            timeout=60,
        )
        from conftest import skip_unless_real_stripe
        skip_unless_real_stripe(r1)
        assert r1.status_code == 200
        # Now /billing/summary should reflect has_customer=true
        s = session.get(f"{API}/billing/summary", headers=H(user_a), timeout=30).json()
        assert s["has_customer"] is True

        # Second call should still return a valid portal URL (customer is reused)
        r2 = session.post(
            f"{API}/billing/customer-portal",
            headers=H(user_a),
            json={"origin_url": __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")},
            timeout=60,
        )
        assert r2.status_code == 200
        assert "billing.stripe.com" in r2.json()["url"]


# ============================================================
# Support tickets (Create → GET scoping)
# ============================================================
class TestSupportTicketsScoping:
    def test_get_requires_auth(self, session):
        r = session.get(f"{API}/support/tickets", timeout=20)
        assert r.status_code in (401, 403), r.text

    def test_post_requires_auth(self, session):
        r = session.post(
            f"{API}/support/ticket",
            json={"category": "billing", "subject": "x", "message": "y"},
            timeout=20,
        )
        assert r.status_code in (401, 403), r.text

    def test_create_and_appears_only_for_owner(self, session, user_a, user_b):
        # User A creates a ticket
        subject_a = f"TEST_ticket_a_{uuid.uuid4().hex[:6]}"
        r = session.post(
            f"{API}/support/ticket",
            headers=H(user_a),
            json={"category": "billing", "subject": subject_a,
                  "message": "Please help me upgrade."},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        tid_a = r.json().get("id")
        assert tid_a and r.json().get("status") == "open"

        # User B creates a different ticket
        subject_b = f"TEST_ticket_b_{uuid.uuid4().hex[:6]}"
        r = session.post(
            f"{API}/support/ticket",
            headers=H(user_b),
            json={"category": "account", "subject": subject_b,
                  "message": "Cannot log in."},
            timeout=20,
        )
        assert r.status_code == 200, r.text

        # A's GET must contain A's ticket and NOT B's ticket
        ra = session.get(f"{API}/support/tickets", headers=H(user_a), timeout=20)
        assert ra.status_code == 200, ra.text
        lst_a = ra.json()
        assert isinstance(lst_a, list)
        subjects_a = [t["subject"] for t in lst_a]
        assert subject_a in subjects_a, "A's ticket should appear in A's list"
        assert subject_b not in subjects_a, "B's ticket leaked into A's list"

        # B's GET must contain B's ticket and NOT A's ticket
        rb = session.get(f"{API}/support/tickets", headers=H(user_b), timeout=20)
        assert rb.status_code == 200, rb.text
        lst_b = rb.json()
        subjects_b = [t["subject"] for t in lst_b]
        assert subject_b in subjects_b
        assert subject_a not in subjects_b, "A's ticket leaked into B's list"

        # Verify ticket payload shape & no _id leak
        sample = next(t for t in lst_a if t["subject"] == subject_a)
        for k in ("id", "category", "subject", "message", "status", "created_at"):
            assert k in sample, f"missing key {k} in ticket payload"
        assert "_id" not in sample, "MongoDB _id leaked into response"
        assert sample["status"] == "open"

    def test_tickets_sorted_desc_by_created_at(self, session, user_a):
        # Add a second ticket and verify newest is first
        subj_new = f"TEST_newest_{uuid.uuid4().hex[:6]}"
        session.post(
            f"{API}/support/ticket",
            headers=H(user_a),
            json={"category": "general", "subject": subj_new, "message": "newest msg"},
            timeout=20,
        )
        r = session.get(f"{API}/support/tickets", headers=H(user_a), timeout=20)
        lst = r.json()
        assert len(lst) >= 2
        # First should be the newly created ticket
        assert lst[0]["subject"] == subj_new, f"Expected newest first, got {lst[0]['subject']}"
