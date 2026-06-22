"""DIYhomie Stripe checkout (real Emergent proxy) regression tests.

Validates:
 - POST /api/billing/checkout for valid tier (pro/master) -> 200 with real
   checkout.stripe.com url + cs_test_ session_id; payment_transactions row created.
 - POST /api/billing/checkout invalid tier -> 400.
 - GET  /api/billing/status/{session_id} before payment -> payment_status
   'unpaid'/'open'; user credits unchanged (still 60); no premature fulfilment.
 - Idempotency contract: repeated polling never double-credits a fulfilled tx
   (we simulate the fulfilled flag and verify status remains idempotent).
"""
import os
import uuid
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import asyncio

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ---------------------- fixtures
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def buyer(session):
    email = f"TEST_pay_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Test1234", "name": "Buyer"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["access_token"], "user": d["user"]}


def auth_h(user):
    return {"Authorization": f"Bearer {user['token']}", "Content-Type": "application/json"}


# ---------------------- helpers
def _get_db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client, client[DB_NAME]


async def _find_tx(session_id: str):
    client, db = _get_db()
    try:
        tx = await db.payment_transactions.find_one({"session_id": session_id})
    finally:
        client.close()
    return tx


async def _find_user(user_id: str):
    client, db = _get_db()
    try:
        u = await db.users.find_one({"id": user_id})
    finally:
        client.close()
    return u


async def _mark_fulfilled(session_id: str):
    """Helper to simulate Stripe paid + fulfilment side-effects so we can
    assert that polling /billing/status again does NOT double-credit."""
    client, db = _get_db()
    try:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"fulfilled": True, "payment_status": "paid"}},
        )
    finally:
        client.close()


# ---------------------- tests
class TestStripeCheckout:
    def test_invalid_tier_returns_400(self, session, buyer):
        r = session.post(
            f"{API}/billing/checkout",
            headers=auth_h(buyer),
            json={"tier": "bogus", "origin_url": "https://example.com"},
            timeout=20,
        )
        assert r.status_code == 400, r.text
        assert "Invalid tier" in r.text

    def test_unauthorized_checkout_rejected(self, session):
        r = session.post(
            f"{API}/billing/checkout",
            json={"tier": "pro", "origin_url": "https://example.com"},
            timeout=20,
        )
        assert r.status_code in (401, 403)

    @pytest.mark.parametrize("tier", ["pro", "master"])
    def test_checkout_creates_real_stripe_session(self, session, buyer, tier):
        r = session.post(
            f"{API}/billing/checkout",
            headers=auth_h(buyer),
            json={"tier": tier, "origin_url": "https://example.com"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body and "session_id" in body

        # Real Stripe checkout URL
        assert body["url"].startswith("https://checkout.stripe.com/"), body["url"]
        # Test-mode session id prefix
        assert body["session_id"].startswith("cs_test_"), body["session_id"]

        # payment_transactions row created with correct tier/amount/state
        tx = asyncio.run(_find_tx(body["session_id"]))
        assert tx is not None, "payment_transactions record was not persisted"
        assert tx["tier"] == tier
        assert tx["user_id"] == buyer["user"]["id"]
        assert tx["currency"] == "usd"
        assert tx["fulfilled"] is False
        assert tx["payment_status"] in ("initiated", "open", "unpaid")
        if tier == "pro":
            assert tx["amount"] == 12.0
        else:
            assert tx["amount"] == 29.0

    def test_status_before_payment_no_fulfillment(self, session, buyer):
        # create a fresh session and immediately poll status
        r = session.post(
            f"{API}/billing/checkout",
            headers=auth_h(buyer),
            json={"tier": "pro", "origin_url": "https://example.com"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]

        s = session.get(f"{API}/billing/status/{sid}", headers=auth_h(buyer), timeout=30)
        assert s.status_code == 200, s.text
        data = s.json()
        # Stripe will say 'unpaid'/'open' on a brand-new session
        assert data["payment_status"] in ("unpaid", "open", "no_payment_required"), data
        # User credits MUST stay at 60 — no premature fulfilment
        assert data["user"]["credits"] == 60, data["user"]
        assert data["user"]["subscription_tier"] == "free"
        # tx row must still be unfulfilled
        tx = asyncio.run(_find_tx(sid))
        assert tx is not None and tx["fulfilled"] is False

    def test_idempotent_fulfillment_no_double_credit(self, session, buyer):
        """Simulate a paid+fulfilled tx, then poll status again and assert
        no additional credit increment occurs."""
        # Snapshot current credits/tier (user may have been credited via mock
        # subscribe in a sibling test run — so we compare deltas, not absolutes)
        u_before = asyncio.run(_find_user(buyer["user"]["id"]))
        credits_before = u_before["credits"]
        tier_before = u_before["subscription_tier"]

        # Create a checkout + mark it as already-fulfilled in DB
        r = session.post(
            f"{API}/billing/checkout",
            headers=auth_h(buyer),
            json={"tier": "pro", "origin_url": "https://example.com"},
            timeout=30,
        )
        assert r.status_code == 200
        sid = r.json()["session_id"]
        asyncio.run(_mark_fulfilled(sid))

        # Poll status — must NOT double-credit since tx.fulfilled is already True
        s = session.get(f"{API}/billing/status/{sid}", headers=auth_h(buyer), timeout=30)
        assert s.status_code == 200, s.text
        body = s.json()

        u_after = asyncio.run(_find_user(buyer["user"]["id"]))
        assert u_after["credits"] == credits_before, (
            f"Double-credit detected! before={credits_before} after={u_after['credits']}"
        )
        # Tier should not be downgraded either
        assert u_after["subscription_tier"] == tier_before

        # And the API still reports same paid state
        assert body["user"]["credits"] == u_after["credits"]
