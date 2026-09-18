"""
Tests for DIYhomie Blueprint 23 — Product Recommendation, Partner Routing & Affiliate Attribution.

Endpoints:
  User:  /api/hi/rec/*
  Admin: /api/hi/admin/rec/*
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")

DEMO = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")}


# ------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_h(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json=DEMO, timeout=30)
    assert r.status_code == 200, f"user login: {r.status_code} {r.text[:200]}"
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_h(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"admin login: {r.status_code} {r.text[:200]}"
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ============================================================= User: needs & recs
class TestNeedsAndRanking:
    def test_paint_need_returns_recs_and_disclosure_only_for_commission(self, api, user_h):
        r = api.post(f"{BASE_URL}/api/hi/rec/needs", headers=user_h,
                     json={"category": "interior_paint",
                           "required_specifications": {"base": "latex"}}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "need" in d and "recommendations" in d
        recs = d["recommendations"]
        assert len(recs) >= 1
        for rc in recs:
            assert "compatibility_status" in rc
            assert "ranking_score" in rc
            assert "recommendation_reason" in rc
            # disclosure only for commission partners
            if rc.get("disclosure_required"):
                assert rc.get("disclosure_text"), "commission rec must include disclosure_text"
            else:
                assert not rc.get("disclosure_text"), "non-commission rec must NOT include disclosure_text"

    def test_hvac_needs_verification_without_size(self, api, user_h):
        r = api.post(f"{BASE_URL}/api/hi/rec/needs", headers=user_h,
                     json={"category": "hvac_filter", "safety_critical": True}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        recs = r.json()["recommendations"]
        assert len(recs) >= 1
        hvac = recs[0]
        assert hvac["compatibility_status"] == "needs_verification"
        assert hvac.get("verify_note"), "must include verify_note about confirming filter size"
        assert "size" in hvac["verify_note"].lower() or "filter" in hvac["verify_note"].lower()

    def test_ranking_safety_first(self, api, user_h):
        """Confirm compatible items always sort before needs_verification regardless of
        ranking_score (affiliate can never jump the queue)."""
        # interior_paint with matching base=latex → should be 'compatible' for the latex paint item
        r = api.post(f"{BASE_URL}/api/hi/rec/needs", headers=user_h,
                     json={"category": "interior_paint",
                           "required_specifications": {"base": "latex"}}, timeout=30)
        recs = r.json()["recommendations"]
        order = {"compatible": 0, "likely_compatible": 1, "needs_verification": 2}
        last = -1
        for rc in recs:
            cur = order.get(rc["compatibility_status"], 3)
            assert cur >= last, f"safety-first order broken at {rc}"
            last = cur


# ============================================================= User: handoff & actions
class TestHandoffAndActions:
    @pytest.fixture(scope="class")
    def rec_id(self, api, user_h):
        r = api.post(f"{BASE_URL}/api/hi/rec/needs", headers=user_h,
                     json={"category": "interior_paint",
                           "required_specifications": {"base": "latex"}}, timeout=30)
        recs = r.json()["recommendations"]
        # pick a commission rec for click test
        commission = [rc for rc in recs if rc.get("disclosure_required")]
        assert commission, "expected a commission rec in seeded data"
        return commission[0]["id"]

    def test_click_returns_url_disclosure_and_no_purchase_claim(self, api, user_h, rec_id):
        r = api.post(f"{BASE_URL}/api/hi/rec/recommendations/{rec_id}/click",
                     headers=user_h, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("product_url"), "must return product_url"
        assert d.get("disclosure"), "commission click must include disclosure"
        note = (d.get("note") or "").lower()
        assert "doesn't process" in note or "does not process" in note or "diyhomie" in note, \
            f"handoff note must clarify DIYhomie doesn't process the payment. got: {d.get('note')}"
        # must NOT claim a purchase
        for k in ("purchase", "purchased", "order_confirmed", "paid"):
            assert k not in d, f"click response must not claim purchase, but has: {k}"

    def test_action_save(self, api, user_h):
        r = api.post(f"{BASE_URL}/api/hi/rec/needs", headers=user_h,
                     json={"category": "paint_roller"}, timeout=30)
        recs = r.json()["recommendations"]
        assert recs, "no paint_roller recs"
        rid = recs[0]["id"]
        a = api.post(f"{BASE_URL}/api/hi/rec/recommendations/{rid}/action",
                     headers=user_h, json={"action": "save"}, timeout=30)
        assert a.status_code == 200, a.text[:200]
        assert a.json().get("status") == "selected"

    def test_action_report_mismatch(self, api, user_h):
        r = api.post(f"{BASE_URL}/api/hi/rec/needs", headers=user_h,
                     json={"category": "paint_roller"}, timeout=30)
        rid = r.json()["recommendations"][0]["id"]
        a = api.post(f"{BASE_URL}/api/hi/rec/recommendations/{rid}/action",
                     headers=user_h, json={"action": "report_mismatch", "note": "test mismatch"}, timeout=30)
        assert a.status_code == 200
        assert a.json().get("status") == "hidden"

    def test_action_invalid(self, api, user_h):
        r = api.post(f"{BASE_URL}/api/hi/rec/needs", headers=user_h,
                     json={"category": "paint_roller"}, timeout=30)
        rid = r.json()["recommendations"][0]["id"]
        a = api.post(f"{BASE_URL}/api/hi/rec/recommendations/{rid}/action",
                     headers=user_h, json={"action": "bogus"}, timeout=30)
        assert a.status_code == 400


# ============================================================= User: for-project
class TestForProject:
    def test_for_project_groups(self, api, user_h):
        # get any project owned by demo_home
        pr = api.get(f"{BASE_URL}/api/hi/projects", headers=user_h, timeout=30)
        assert pr.status_code == 200
        projects = pr.json().get("projects", [])
        if not projects:
            pytest.skip("no demo projects available")
        # Try each project until one yields groups; endpoint should return 200 in any case
        found_pid = projects[0]["id"]
        r = api.get(f"{BASE_URL}/api/hi/rec/for-project/{found_pid}", headers=user_h, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "groups" in d and "project_id" in d


# ============================================================= Admin
class TestAdminAuth:
    def test_dashboard_requires_admin(self, api, user_h):
        r = api.get(f"{BASE_URL}/api/hi/admin/rec/dashboard", headers=user_h, timeout=30)
        assert r.status_code == 403, f"non-admin should get 403, got {r.status_code}"

    def test_weights_requires_admin(self, api, user_h):
        r = api.put(f"{BASE_URL}/api/hi/admin/rec/weights", headers=user_h,
                    json={"weights": {"safety": 0.5}}, timeout=30)
        assert r.status_code == 403


class TestAdminDashboardAndWeights:
    def test_dashboard(self, api, admin_h):
        r = api.get(f"{BASE_URL}/api/hi/admin/rec/dashboard", headers=admin_h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "partners" in d and "weights" in d
        assert isinstance(d["partners"], list) and len(d["partners"]) >= 2
        p0 = d["partners"][0]
        for k in ("clicks", "conversions", "catalog_items"):
            assert k in p0

    def test_weights_reject_affiliate_gt_safety(self, api, admin_h):
        r = api.put(f"{BASE_URL}/api/hi/admin/rec/weights", headers=admin_h,
                    json={"weights": {"affiliate": 0.9}}, timeout=30)
        assert r.status_code == 400, f"must reject; got {r.status_code} {r.text[:200]}"

    def test_weights_accept_valid(self, api, admin_h):
        # keep affiliate < safety
        r = api.put(f"{BASE_URL}/api/hi/admin/rec/weights", headers=admin_h,
                    json={"weights": {"affiliate": 0.05}}, timeout=30)
        assert r.status_code == 200
        w = r.json()["weights"]
        assert w["affiliate"] <= w["safety"]


class TestAdminPartners:
    def test_activate_commission_without_disclosure_fails(self, api, admin_h):
        # create partner missing disclosure_text (but with commission)
        pr = api.post(f"{BASE_URL}/api/hi/admin/rec/partners", headers=admin_h,
                      json={"name": f"TEST_missing_disc_{uuid.uuid4().hex[:6]}",
                            "partner_type": "affiliate_network",
                            "has_commission": True,
                            "link_format": "https://x.example/{external_product_id}",
                            "tracking_configured": True}, timeout=30)
        assert pr.status_code == 200, pr.text[:200]
        pid = pr.json()["id"]
        a = api.post(f"{BASE_URL}/api/hi/admin/rec/partners/{pid}/activate",
                     headers=admin_h, timeout=30)
        assert a.status_code == 400
        assert "disclosure" in a.text.lower()

    def test_activate_missing_link_and_tracking_fails(self, api, admin_h):
        pr = api.post(f"{BASE_URL}/api/hi/admin/rec/partners", headers=admin_h,
                      json={"name": f"TEST_missing_link_{uuid.uuid4().hex[:6]}",
                            "partner_type": "retailer",
                            "has_commission": False,
                            "tracking_configured": False}, timeout=30)
        pid = pr.json()["id"]
        a = api.post(f"{BASE_URL}/api/hi/admin/rec/partners/{pid}/activate",
                     headers=admin_h, timeout=30)
        assert a.status_code == 400

    def test_activate_then_pause_valid(self, api, admin_h):
        pr = api.post(f"{BASE_URL}/api/hi/admin/rec/partners", headers=admin_h,
                      json={"name": f"TEST_valid_{uuid.uuid4().hex[:6]}",
                            "partner_type": "manufacturer",
                            "has_commission": False,
                            "link_format": "https://x.example/{external_product_id}",
                            "tracking_configured": True}, timeout=30)
        pid = pr.json()["id"]
        a = api.post(f"{BASE_URL}/api/hi/admin/rec/partners/{pid}/activate",
                     headers=admin_h, timeout=30)
        assert a.status_code == 200, a.text[:200]
        assert a.json()["status"] == "active"
        p = api.post(f"{BASE_URL}/api/hi/admin/rec/partners/{pid}/pause",
                     headers=admin_h, timeout=30)
        assert p.status_code == 200
        assert p.json()["status"] == "paused"


class TestAdminConversions:
    def test_record_reverse_and_totals(self, api, admin_h):
        d = api.get(f"{BASE_URL}/api/hi/admin/rec/dashboard", headers=admin_h, timeout=30).json()
        pid = d["partners"][0]["id"]
        # baseline total
        base = api.get(f"{BASE_URL}/api/hi/admin/rec/conversions", headers=admin_h, timeout=30).json()
        baseline = base.get("total_commission_approved", 0)

        c = api.post(f"{BASE_URL}/api/hi/admin/rec/conversions", headers=admin_h,
                     json={"partner_id": pid,
                           "partner_transaction_reference": f"TEST_txn_{uuid.uuid4().hex[:6]}",
                           "conversion_type": "purchase",
                           "commission_amount": 5.55,
                           "currency": "USD"}, timeout=30)
        assert c.status_code == 200, c.text[:200]
        cid = c.json()["id"]

        # totals go up
        after = api.get(f"{BASE_URL}/api/hi/admin/rec/conversions", headers=admin_h, timeout=30).json()
        assert round(after["total_commission_approved"] - baseline, 2) >= 5.55 - 0.01

        # reverse
        rv = api.post(f"{BASE_URL}/api/hi/admin/rec/conversions/{cid}/reverse",
                      headers=admin_h, timeout=30)
        assert rv.status_code == 200

        after2 = api.get(f"{BASE_URL}/api/hi/admin/rec/conversions", headers=admin_h, timeout=30).json()
        # after reverse, it must no longer count toward approved total
        # (approved should decrease by 5.55)
        assert round(after["total_commission_approved"] - after2["total_commission_approved"], 2) >= 5.55 - 0.01
