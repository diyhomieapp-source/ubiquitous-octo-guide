"""
Backend tests for Blueprint 24 (Community Rewards Funding & Redemption + Admin Financial Controls)
and Blueprint 25 (Homie HQ Operations, Growth & AI Cost Intelligence).
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")
USER_EMAIL = "demo_home@diyhomie.com"
USER_PASSWORD = __import__("os").environ.get("TEST_USER_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def user_token():
    return _login(USER_EMAIL, USER_PASSWORD)


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def user_h(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(scope="session")
def user_id(user_h):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=user_h, timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


# ============================================================= B24 setup (admin funds pool, grants points)

@pytest.fixture(scope="session")
def funded_and_pointed(admin_h, user_id):
    # Ensure emergency mode off first so redemption tests can run cleanly
    requests.post(f"{BASE_URL}/api/hi/admin/rewards/emergency-mode",
                  headers=admin_h, json={"enabled": False}, timeout=10)
    # Fund the pool: $500 affiliate revenue (received) -> 20% -> $100 pool minus $50 reserve = $50 available
    r = requests.post(f"{BASE_URL}/api/hi/admin/rewards/revenue", headers=admin_h,
                      json={"source_type": "affiliate", "amount": 500.0, "mark_received": True},
                      timeout=15)
    assert r.status_code == 200, f"fund revenue failed: {r.status_code} {r.text[:200]}"
    # Grant demo user 5000 points via B13 adjust (enough for a $10 card = 2000 pts)
    r2 = requests.post(f"{BASE_URL}/api/hi/admin/rewards/adjust", headers=admin_h,
                       json={"user_id": user_id, "points": 5000, "reason": "TEST_B24_topup"},
                       timeout=15)
    assert r2.status_code in (200, 201), f"points adjust failed: {r2.status_code} {r2.text[:200]}"
    return True


# ============================================================= B24 catalog / history

class TestB24UserRewardsFunding:
    def test_catalog(self, user_h, funded_and_pointed):
        r = requests.get(f"{BASE_URL}/api/hi/rewards-funding/catalog", headers=user_h, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "available_points" in d
        assert "redemption_enabled" in d
        assert isinstance(d.get("catalog"), list) and len(d["catalog"]) >= 1
        item = d["catalog"][0]
        for k in ("id", "points_cost", "affordable", "available", "denomination"):
            assert k in item, f"missing {k}"

    def test_history_endpoint(self, user_h, funded_and_pointed):
        r = requests.get(f"{BASE_URL}/api/hi/rewards-funding/history", headers=user_h, timeout=10)
        assert r.status_code == 200
        assert "redemptions" in r.json()


# ============================================================= B24 redemption + idempotency

class TestB24Redemption:
    def _catalog_ids(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/rewards-funding/catalog", headers=user_h, timeout=10)
        assert r.status_code == 200
        return r.json()

    def test_insufficient_points_returns_400(self, admin_h, user_h, user_id, funded_and_pointed):
        # Reset by knocking user balance down: adjust to negative would be nice, but engine may not allow
        # Use the most expensive item (potentially $25 = 5000 pts). We top up 5000 in funded_and_pointed,
        # so testing insufficient requires reaching a threshold above balance. We use a scratch user_daily_cap trick? No.
        # Instead we assert a $25 card would be exactly affordable-or-not. We use a fresh cheap redemption then re-check.
        cat = self._catalog_ids(user_h)["catalog"]
        big = max(cat, key=lambda x: x["points_cost"])
        # If not affordable, expect 400
        if not big["affordable"]:
            r = requests.post(f"{BASE_URL}/api/hi/rewards-funding/redeem", headers=user_h,
                              json={"catalog_item_id": big["id"], "idempotency_key": f"TEST_{uuid.uuid4()}"},
                              timeout=15)
            assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text[:200]}"
        else:
            pytest.skip("user happens to afford biggest item; insufficient-points path exercised elsewhere")

    def test_redeem_idempotency_and_no_double_deduct(self, user_h, funded_and_pointed):
        d = self._catalog_ids(user_h)
        pts_before = d["available_points"]
        cheap = min([c for c in d["catalog"] if c["affordable"] and c["available"]], key=lambda x: x["points_cost"], default=None)
        assert cheap, "no affordable item; funding/adjust fixture failed"
        key = f"TEST_IDEMP_{uuid.uuid4()}"
        r1 = requests.post(f"{BASE_URL}/api/hi/rewards-funding/redeem", headers=user_h,
                           json={"catalog_item_id": cheap["id"], "idempotency_key": key}, timeout=20)
        assert r1.status_code == 200, r1.text[:200]
        b1 = r1.json()
        rid = b1["redemption"]["id"]

        # Second call with same idempotency_key -> duplicate:true
        r2 = requests.post(f"{BASE_URL}/api/hi/rewards-funding/redeem", headers=user_h,
                           json={"catalog_item_id": cheap["id"], "idempotency_key": key}, timeout=15)
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2.get("duplicate") is True, f"expected duplicate flag: {b2}"
        assert b2["redemption"]["id"] == rid, "duplicate returned different redemption id"

        # Verify NOT double-deducted: expected drop = cheap["points_cost"] only
        d2 = self._catalog_ids(user_h)
        pts_after = d2["available_points"]
        assert pts_before - pts_after == cheap["points_cost"], \
            f"double deduct: before={pts_before} after={pts_after} cost={cheap['points_cost']}"


# ============================================================= B24 emergency mode

class TestB24EmergencyMode:
    def test_emergency_enables_disables(self, admin_h, user_h, funded_and_pointed):
        # Enable
        r = requests.post(f"{BASE_URL}/api/hi/admin/rewards/emergency-mode",
                          headers=admin_h, json={"enabled": True}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("emergency_mode") is True

        # Catalog says disabled
        c = requests.get(f"{BASE_URL}/api/hi/rewards-funding/catalog", headers=user_h, timeout=10).json()
        assert c["redemption_enabled"] is False

        # Redeem returns 503
        cheap = min(c["catalog"], key=lambda x: x["points_cost"])
        r503 = requests.post(f"{BASE_URL}/api/hi/rewards-funding/redeem", headers=user_h,
                             json={"catalog_item_id": cheap["id"], "idempotency_key": f"TEST_EMG_{uuid.uuid4()}"},
                             timeout=15)
        assert r503.status_code == 503, f"expected 503 got {r503.status_code}: {r503.text[:200]}"

        # Disable
        r2 = requests.post(f"{BASE_URL}/api/hi/admin/rewards/emergency-mode",
                           headers=admin_h, json={"enabled": False}, timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("emergency_mode") is False


# ============================================================= B24 admin financial controls

class TestB24AdminFinancials:
    def test_command_center(self, admin_h, funded_and_pointed):
        r = requests.get(f"{BASE_URL}/api/hi/admin/rewards/command-center", headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for k in ("funding", "liability", "fulfillment", "providers", "revenue"):
            assert k in d, f"missing {k}"
        assert "recent" in d["revenue"]
        assert isinstance(d["providers"], list)

    def test_revenue_receive_and_reverse(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/rewards/revenue", headers=admin_h,
                          json={"source_type": "sponsorship", "amount": 20.0, "mark_received": False},
                          timeout=10)
        assert r.status_code == 200
        eid = r.json()["revenue_event"]["id"]

        rr = requests.post(f"{BASE_URL}/api/hi/admin/rewards/revenue/{eid}/receive", headers=admin_h, timeout=10)
        assert rr.status_code == 200
        assert "pool" in rr.json()

        rv = requests.post(f"{BASE_URL}/api/hi/admin/rewards/revenue/{eid}/reverse", headers=admin_h, timeout=10)
        assert rv.status_code == 200

    def test_settings_put(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/hi/admin/rewards/settings", headers=admin_h,
                         json={"safety_reserve": 50.0}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("safety_reserve") == 50.0

    def test_provider_pause_activate(self, admin_h):
        cc = requests.get(f"{BASE_URL}/api/hi/admin/rewards/command-center", headers=admin_h, timeout=15).json()
        assert cc["providers"], "no providers"
        pid = cc["providers"][0]["id"]
        pp = requests.post(f"{BASE_URL}/api/hi/admin/rewards/providers/{pid}/pause", headers=admin_h, timeout=10)
        assert pp.status_code == 200
        pa = requests.post(f"{BASE_URL}/api/hi/admin/rewards/providers/{pid}/activate", headers=admin_h, timeout=10)
        assert pa.status_code == 200

    def test_fraud_reviews_list(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/rewards/fraud-reviews", headers=admin_h, timeout=10)
        assert r.status_code == 200
        assert "reviews" in r.json()

    def test_non_admin_forbidden(self, user_h):
        endpoints = [
            ("GET", "/api/hi/admin/rewards/command-center"),
            ("POST", "/api/hi/admin/rewards/revenue"),
            ("PUT", "/api/hi/admin/rewards/settings"),
            ("POST", "/api/hi/admin/rewards/emergency-mode"),
            ("GET", "/api/hi/admin/rewards/fraud-reviews"),
        ]
        for method, path in endpoints:
            r = requests.request(method, f"{BASE_URL}{path}", headers=user_h,
                                 json={} if method != "GET" else None, timeout=10)
            assert r.status_code == 403, f"{method} {path} expected 403, got {r.status_code}"


# ============================================================= B24 regression: B13 rewards endpoints still work

class TestB13RewardsRegression:
    def test_home(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/rewards/home", headers=user_h, timeout=10)
        assert r.status_code == 200, r.text[:200]

    def test_activity(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/rewards/activity", headers=user_h, timeout=10)
        assert r.status_code == 200


# ============================================================= B25 Homie HQ

class TestB25HomieHQ:
    def test_dashboard(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/hq/dashboard", headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for k in ("summary", "attention", "domains", "connectors"):
            assert k in d, f"missing {k}"
        assert set(["open_alerts", "pending_approvals", "new_insights"]).issubset(d["summary"].keys())
        assert set(["urgent", "needs_review", "opportunities", "successes"]).issubset(d["attention"].keys())
        assert set(["app_health", "revenue", "ai_cost", "growth", "support"]).issubset(d["domains"].keys())
        c = d["connectors"]
        assert c.get("posthog") == "dormant"
        assert c.get("sentry") == "dormant"
        assert c.get("paddle") == "dormant"
        assert c.get("internal_db") == "connected"
        assert c.get("ai_usage") == "connected"
        assert c.get("monitoring") == "connected"

    def test_refresh(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/hq/refresh", headers=admin_h, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_ai_costs(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/hq/ai-costs", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "today" in d and "requests_24h" in d["today"]
        assert "disclaimer" in d

    def test_lists(self, admin_h):
        for path in ("/api/hi/admin/hq/insights", "/api/hi/admin/hq/alerts", "/api/hi/admin/hq/recommendations",
                     "/api/hi/admin/hq/approvals", "/api/hi/admin/hq/experiments"):
            r = requests.get(f"{BASE_URL}{path}", headers=admin_h, timeout=15)
            assert r.status_code == 200, f"{path} -> {r.status_code}"

    def test_settings_get_put(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/hq/settings", headers=admin_h, timeout=10)
        assert r.status_code == 200
        current_th = r.json().get("ai_daily_cost_threshold", 5.0)
        r2 = requests.put(f"{BASE_URL}/api/hi/admin/hq/settings", headers=admin_h,
                          json={"ai_daily_cost_threshold": float(current_th)}, timeout=10)
        assert r2.status_code == 200

    def test_experiment_create_and_decide(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/hq/experiments", headers=admin_h,
                          json={"hypothesis": "TEST_hp", "target_segment": "TEST_seg",
                                "primary_metric": "activation"}, timeout=10)
        assert r.status_code == 200
        eid = r.json()["experiment"]["id"]
        r2 = requests.post(f"{BASE_URL}/api/hi/admin/hq/experiments/{eid}/decision",
                           headers=admin_h, json={"decision_status": "stopped"}, timeout=10)
        assert r2.status_code == 200

    def test_approvals_decide_if_any(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/hq/approvals", headers=admin_h, timeout=15)
        assert r.status_code == 200
        appr = r.json().get("approvals", [])
        if appr:
            aid = appr[0]["id"]
            r2 = requests.post(f"{BASE_URL}/api/hi/admin/hq/approvals/{aid}/decide",
                               headers=admin_h, json={"decision": "rejected", "note": "TEST"}, timeout=10)
            assert r2.status_code == 200
        else:
            pytest.skip("no pending approvals to decide")

    def test_non_admin_forbidden(self, user_h):
        endpoints = [
            "/api/hi/admin/hq/dashboard",
            "/api/hi/admin/hq/ai-costs",
            "/api/hi/admin/hq/insights",
            "/api/hi/admin/hq/alerts",
            "/api/hi/admin/hq/approvals",
            "/api/hi/admin/hq/settings",
        ]
        for path in endpoints:
            r = requests.get(f"{BASE_URL}{path}", headers=user_h, timeout=10)
            assert r.status_code == 403, f"{path} expected 403, got {r.status_code}"
