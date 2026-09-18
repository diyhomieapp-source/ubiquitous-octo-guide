"""Sheets #34 Real Estate + #35 Circular + #36 Bulk Buying — E2E backend tests.

Coverage:
- /api/realestate/report shape (totals, improvements+label/confidence, ai_summary, value_add, disclosure_checklist)
- /api/realestate/share + /api/realestate/public/{token} (public, wrong token 404)
- /api/circular/meta + /listings CRUD + claim (cross-user) + close + impact + eco-alternatives
- /api/bulk/meta + /deals create/list/join/leave/close (with cross-user)
"""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
PRO_EMAIL = "pat_pro_test@diyhomie.com"
PRO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _register_or_login(email, pw, name="Second User"):
    # try login first
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code == 200:
        return r.json()["access_token"]
    # try register
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": pw, "name": name, "location": "Austin, TX"},
                      timeout=30)
    if r.status_code == 200:
        return r.json()["access_token"]
    # fallback try again to login
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"register+login failed {email}: {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h1():
    return {"Authorization": f"Bearer {_login(DEMO_EMAIL, DEMO_PASS)}"}


@pytest.fixture(scope="module")
def h2():
    tok = _register_or_login(PRO_EMAIL, PRO_PASS, "Pat Pro")
    return {"Authorization": f"Bearer {tok}"}


# ============================================================ Sheet #34 Real Estate
class TestRealEstateReport:
    def test_report_shape(self, h1):
        r = requests.get(f"{BASE_URL}/api/realestate/report", headers=h1, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["totals", "improvements", "diy_count", "pro_count", "ai_summary",
                  "value_add", "disclosure_checklist", "share_token", "is_public"]:
            assert k in d, f"missing key {k}: keys={list(d.keys())}"
        va = d["value_add"]
        for k in ["estimate_cents", "roi_pct", "disclaimer"]:
            assert k in va
        assert isinstance(d["improvements"], list)
        assert d["totals"]["projects"] >= 0
        # improvements should carry label + confidence
        if d["improvements"]:
            im = d["improvements"][0]
            assert im["label"] in ("DIY", "Pro")
            assert im["confidence"] in ("documented", "partial", "self-reported")
        assert d["diy_count"] + d["pro_count"] == len(d["improvements"])
        assert isinstance(d["ai_summary"], str) and len(d["ai_summary"]) > 0

    def test_share_then_public(self, h1):
        s = requests.post(f"{BASE_URL}/api/realestate/share", headers=h1,
                         json={"public": True}, timeout=30)
        assert s.status_code == 200, s.text
        tok = s.json()["share_token"]
        assert tok and isinstance(tok, str)
        assert s.json()["is_public"] is True

        # Public access WITHOUT auth
        p = requests.get(f"{BASE_URL}/api/realestate/public/{tok}", timeout=90)
        assert p.status_code == 200, p.text
        pd = p.json()
        for k in ["totals", "improvements", "ai_summary", "value_add", "disclosure_checklist"]:
            assert k in pd

    def test_public_wrong_token_404(self):
        r = requests.get(f"{BASE_URL}/api/realestate/public/DEFINITELY_NOT_A_TOKEN_xyz", timeout=15)
        assert r.status_code == 404, r.text


# ============================================================ Sheet #35 Circular Economy
class TestCircular:
    listing_id = None
    donation_id = None

    def test_meta(self, h1):
        r = requests.get(f"{BASE_URL}/api/circular/meta", headers=h1, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "categories" in d and isinstance(d["categories"], list) and len(d["categories"]) > 0
        assert "Paint & Finishes" in d["categories"]

    def test_create_offer(self, h1):
        payload = {
            "type": "offer", "category": "Paint & Finishes",
            "title": "TEST_ leftover eggshell paint 1 gal",
            "description": "About a gallon of white eggshell, near-new.",
            "condition": "Like new", "price_cents": 500,
            "fulfillment": "Local pickup",
        }
        r = requests.post(f"{BASE_URL}/api/circular/listings", headers=h1, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"].startswith("TEST_")
        assert d["type"] == "offer"
        assert d["category"] == "Paint & Finishes"
        assert d["price_cents"] == 500
        assert d["is_donation"] is False
        assert d["eco"]["waste_lbs"] > 0
        assert d["is_owner"] is True
        TestCircular.listing_id = d["id"]

    def test_create_donation_zero_price(self, h1):
        payload = {
            "type": "offer", "category": "Lumber & Wood",
            "title": "TEST_ scrap 2x4 lumber pieces",
            "price_cents": 0,
        }
        r = requests.post(f"{BASE_URL}/api/circular/listings", headers=h1, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_donation"] is True
        assert d["price_cents"] == 0
        TestCircular.donation_id = d["id"]

    def test_list_offer_filter(self, h1):
        r = requests.get(f"{BASE_URL}/api/circular/listings?type=offer", headers=h1, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "listings" in d and isinstance(d["listings"], list)
        ids = [l["id"] for l in d["listings"]]
        assert TestCircular.listing_id in ids
        # eco keys present
        target = next(l for l in d["listings"] if l["id"] == TestCircular.listing_id)
        assert target["eco"]["waste_lbs"] > 0
        assert target["eco"]["co2_kg"] > 0

    def test_claim_own_forbidden(self, h1):
        r = requests.post(f"{BASE_URL}/api/circular/listings/{TestCircular.listing_id}/claim",
                         headers=h1, timeout=15)
        assert r.status_code == 400, r.text  # can't claim own

    def test_claim_cross_user(self, h2):
        assert TestCircular.listing_id is not None
        r = requests.post(f"{BASE_URL}/api/circular/listings/{TestCircular.listing_id}/claim",
                         headers=h2, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_claim_missing_404(self, h2):
        r = requests.post(f"{BASE_URL}/api/circular/listings/nonexistent_id_xxx/claim",
                         headers=h2, timeout=15)
        assert r.status_code == 404

    def test_close_listing(self, h1):
        r = requests.post(f"{BASE_URL}/api/circular/listings/{TestCircular.listing_id}/close",
                         headers=h1, timeout=15)
        assert r.status_code == 200, r.text
        # verify no longer in active listings
        listings = requests.get(f"{BASE_URL}/api/circular/listings?type=offer", headers=h1, timeout=30).json()["listings"]
        assert TestCircular.listing_id not in [l["id"] for l in listings]

    def test_impact(self, h1):
        r = requests.get(f"{BASE_URL}/api/circular/impact", headers=h1, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "totals" in d
        t = d["totals"]
        for k in ["gives", "waste_lbs", "co2_kg", "writeoff_cents", "active_listings"]:
            assert k in t
        assert t["gives"] >= 1  # we just closed one
        assert t["waste_lbs"] >= 12  # paint category = 12 lbs
        assert "leaderboard" in d
        assert "restore_directory" in d

    def test_eco_alternatives(self, h1):
        r = requests.get(f"{BASE_URL}/api/circular/eco-alternatives?query=paint", headers=h1, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "alternatives" in d and isinstance(d["alternatives"], list)
        assert len(d["alternatives"]) >= 1
        # first match should be a paint one
        top = d["alternatives"][0]
        assert "certs" in top
        assert "Low-VOC" in top["certs"] or "paint" in top["name"].lower()

    def test_cleanup_donation(self, h1):
        if TestCircular.donation_id:
            requests.post(f"{BASE_URL}/api/circular/listings/{TestCircular.donation_id}/close",
                         headers=h1, timeout=15)


# ============================================================ Sheet #36 Bulk Buying
class TestBulk:
    deal_id = None

    def test_meta(self, h1):
        r = requests.get(f"{BASE_URL}/api/bulk/meta", headers=h1, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["categories"], list) and len(d["categories"]) > 0
        assert isinstance(d["tiers"], list) and len(d["tiers"]) >= 3
        for t in d["tiers"]:
            assert "min" in t and "pct" in t

    def test_create_deal(self, h1):
        payload = {
            "title": "TEST_ Spring mulch group buy",
            "category": "Mulch & Soil",
            "item": "3 cu ft bag hardwood mulch",
            "unit": "bag",
            "price_full_cents": 899,
            "window_days": 14,
        }
        r = requests.post(f"{BASE_URL}/api/bulk/deals", headers=h1, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"].startswith("TEST_")
        assert d["price_full_cents"] == 899
        assert d["unit_price_cents"] <= 899
        assert d["participants"] == 1  # creator auto-joined
        assert d["is_creator"] is True
        assert d["joined"] is True
        assert d["status"] == "open"
        TestBulk.deal_id = d["id"]

    def test_create_invalid_price(self, h1):
        r = requests.post(f"{BASE_URL}/api/bulk/deals", headers=h1,
                         json={"title": "TEST_x", "price_full_cents": 0}, timeout=15)
        assert r.status_code == 400

    def test_list_deals(self, h1):
        r = requests.get(f"{BASE_URL}/api/bulk/deals", headers=h1, timeout=15)
        assert r.status_code == 200, r.text
        deals = r.json()["deals"]
        found = next((d for d in deals if d["id"] == TestBulk.deal_id), None)
        assert found is not None
        assert "unit_price_cents" in found and "discount_pct" in found and "next_tier" in found

    def test_join_cross_user(self, h2):
        assert TestBulk.deal_id is not None
        r = requests.post(f"{BASE_URL}/api/bulk/deals/{TestBulk.deal_id}/join",
                         headers=h2, json={"qty": 3}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["participants"] == 2
        assert d["discount_pct"] == 5  # 2 participants = 5% off tier
        assert d["unit_price_cents"] < d["price_full_cents"]
        assert d["joined"] is True
        assert d["my_qty"] == 3

    def test_leave(self, h2):
        r = requests.post(f"{BASE_URL}/api/bulk/deals/{TestBulk.deal_id}/leave",
                         headers=h2, timeout=15)
        assert r.status_code == 200, r.text
        # verify
        deals = requests.get(f"{BASE_URL}/api/bulk/deals", headers=h2, timeout=15).json()["deals"]
        found = next((d for d in deals if d["id"] == TestBulk.deal_id), None)
        if found:  # might be filtered if h2 isn't in same neighborhood
            assert found["joined"] is False

    def test_close_non_creator_forbidden(self, h2):
        r = requests.post(f"{BASE_URL}/api/bulk/deals/{TestBulk.deal_id}/close",
                         headers=h2, timeout=15)
        assert r.status_code == 404  # returned as not-found (creator gate)

    def test_close_by_creator(self, h1):
        r = requests.post(f"{BASE_URL}/api/bulk/deals/{TestBulk.deal_id}/close",
                         headers=h1, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert "discount_pct" in d

    def test_close_missing_404(self, h1):
        r = requests.post(f"{BASE_URL}/api/bulk/deals/nonexistent_xxx/close",
                         headers=h1, timeout=15)
        assert r.status_code == 404
