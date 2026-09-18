"""Tests for the Savings Intelligence & Project Funding Engine (Phase 1).

Namespace: /api/hi/funding/* & /api/hi/admin/funding/*
Guarantees to verify:
 - confirmed/pending/expected/potential/opportunistic are NEVER conflated
 - opportunistic and potential do not reduce the funding gap
 - applying a cost reduction lowers the linked orchestrator requirement cost
 - user wallet never exposes revenue
 - per-user authorization (404 cross-user)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token"
    session.headers["Authorization"] = f"Bearer {tok}"
    return tok


@pytest.fixture(scope="module")
def demo():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, DEMO_EMAIL, DEMO_PASS)
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, ADMIN_EMAIL, ADMIN_PASS)
    return s


@pytest.fixture(scope="module")
def other_user():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_fund_{uuid.uuid4().hex[:10]}@diyhomie.com"
    pw = __import__("os").environ.get("TEST_USER_PASSWORD", "")
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "full_name": "TEST Fund"}, timeout=30)
    if r.status_code in (200, 201):
        tok = r.json().get("access_token")
        if tok:
            s.headers["Authorization"] = f"Bearer {tok}"
        else:
            _login(s, email, pw)
    else:
        _login(s, email, pw)
    return s


@pytest.fixture(scope="module")
def project(demo):
    """Create a fresh orchestrator project (kitchen faucet) with a tool + material requirement."""
    r = demo.post(f"{API}/hi/orchestrator/projects",
                  json={"intent_text": "replace kitchen faucet"}, timeout=30)
    assert r.status_code == 200, f"create project failed: {r.status_code} {r.text[:200]}"
    pid = r.json()["project"]["id"]
    # Add a material and a tool requirement
    m = demo.post(f"{API}/hi/orchestrator/projects/{pid}/requirements",
                  json={"kind": "material", "name": "Faucet", "cost_estimate": 180}, timeout=30)
    assert m.status_code == 200, f"add material failed: {m.status_code} {m.text[:200]}"
    material_rid = m.json()["requirement"]["id"]
    t = demo.post(f"{API}/hi/orchestrator/projects/{pid}/requirements",
                  json={"kind": "tool", "name": "Basin wrench", "cost_estimate": 22}, timeout=30)
    assert t.status_code == 200
    tool_rid = t.json()["requirement"]["id"]
    return {"pid": pid, "material_rid": material_rid, "tool_rid": tool_rid}


# ---------- Config ----------
class TestFundingConfig:
    def test_user_config_returns_classifications(self, demo):
        r = demo.get(f"{API}/hi/funding/config", timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["enabled"] is True
        for c in ("confirmed", "pending", "expected", "potential", "opportunistic"):
            assert c in j["classifications"], f"missing {c}"


# ---------- Goals ----------
class TestGoal:
    def test_create_goal_and_gap(self, demo, project):
        pid = project["pid"]
        r = demo.post(f"{API}/hi/funding/goals",
                      json={"project_id": pid, "target_amount": 250, "current_budget": 100}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        plan = r.json()["plan"]
        assert plan["target"] == 250.0
        assert plan["budget"] == 100.0
        assert plan["remaining_confirmed_gap"] == 150.0
        # GET returns same plan
        g = demo.get(f"{API}/hi/funding/goals/{pid}", timeout=30)
        assert g.status_code == 200
        gp = g.json()["plan"]
        assert gp["target"] == 250.0 and gp["budget"] == 100.0
        assert gp["remaining_confirmed_gap"] == 150.0


# ---------- Savings classifications must stay SEPARATE ----------
class TestSavingsClassifications:
    def test_confirmed_reduces_confirmed_gap(self, demo, project):
        pid = project["pid"]
        r = demo.post(f"{API}/hi/funding/savings",
                      json={"project_id": pid, "amount": 22.40, "classification": "confirmed"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        plan = r.json()["plan"]
        assert plan["confirmed"] == 22.40
        # target 250 - budget 100 - confirmed 22.40 = 127.60
        assert plan["remaining_confirmed_gap"] == 127.60, f"got {plan['remaining_confirmed_gap']}"

    def test_expected_reduces_only_likely_gap(self, demo, project):
        pid = project["pid"]
        # Snapshot current gaps first
        before = demo.get(f"{API}/hi/funding/goals/{pid}", timeout=30).json()["plan"]
        r = demo.post(f"{API}/hi/funding/savings",
                      json={"project_id": pid, "amount": 15, "classification": "expected"}, timeout=30)
        assert r.status_code == 200
        plan = r.json()["plan"]
        assert plan["expected"] == 15.0
        # confirmed_gap unchanged, likely_gap should be less than confirmed_gap
        assert plan["remaining_confirmed_gap"] == before["remaining_confirmed_gap"], \
            f"confirmed gap should not change: {before['remaining_confirmed_gap']} -> {plan['remaining_confirmed_gap']}"
        assert plan["remaining_likely_gap"] < plan["remaining_confirmed_gap"], \
            f"likely {plan['remaining_likely_gap']} must be < confirmed {plan['remaining_confirmed_gap']}"

    def test_potential_does_not_reduce_either_gap(self, demo, project):
        pid = project["pid"]
        before = demo.get(f"{API}/hi/funding/goals/{pid}", timeout=30).json()["plan"]
        r = demo.post(f"{API}/hi/funding/savings",
                      json={"project_id": pid, "amount": 50, "classification": "potential"}, timeout=30)
        assert r.status_code == 200
        plan = r.json()["plan"]
        assert plan["potential"] >= 50.0
        assert plan["remaining_confirmed_gap"] == before["remaining_confirmed_gap"], \
            "potential must NOT reduce confirmed gap"
        assert plan["remaining_likely_gap"] == before["remaining_likely_gap"], \
            "potential must NOT reduce likely gap"

    def test_opportunistic_accepted_but_not_counted(self, demo, project):
        pid = project["pid"]
        before = demo.get(f"{API}/hi/funding/goals/{pid}", timeout=30).json()["plan"]
        r = demo.post(f"{API}/hi/funding/savings",
                      json={"project_id": pid, "amount": 30, "classification": "opportunistic"}, timeout=30)
        assert r.status_code == 200
        plan = r.json()["plan"]
        assert plan["opportunistic"] >= 30.0
        # Must never reduce either gap
        assert plan["remaining_confirmed_gap"] == before["remaining_confirmed_gap"]
        assert plan["remaining_likely_gap"] == before["remaining_likely_gap"]

    def test_invalid_classification_400(self, demo, project):
        pid = project["pid"]
        r = demo.post(f"{API}/hi/funding/savings",
                      json={"project_id": pid, "amount": 10, "classification": "bogus"}, timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


# ---------- Cost-reduction engine ----------
class TestCostReduction:
    def test_cost_reduction_returns_all_option_kinds(self, demo, project):
        pid = project["pid"]
        r = demo.get(f"{API}/hi/funding/cost-reduction/{pid}", timeout=30)
        assert r.status_code == 200, r.text[:200]
        opts = r.json()["options"]
        kinds = {o["kind"] for o in opts}
        # Material -> best_value_alternative (expected) + community_used (potential)
        # Tool -> owned_or_toolshare (expected)
        # Always -> phase_scope (potential)
        for k in ("best_value_alternative", "community_used", "owned_or_toolshare", "phase_scope"):
            assert k in kinds, f"missing option kind {k} in {kinds}"
        # Classification correctness
        by_kind = {o["kind"]: o for o in opts}
        assert by_kind["best_value_alternative"]["classification"] == "expected"
        assert by_kind["community_used"]["classification"] == "potential"
        assert by_kind["owned_or_toolshare"]["classification"] == "expected"
        assert by_kind["phase_scope"]["classification"] == "potential"

    def test_apply_owned_toolshare_reduces_requirement_cost(self, demo, project):
        pid = project["pid"]
        tool_rid = project["tool_rid"]
        # Get current tool cost from orchestrator project bundle
        b = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        req = next((x for x in b.get("requirements", []) if x["id"] == tool_rid), None)
        assert req is not None, "tool requirement not found on project"
        before_cost = float(req["cost_estimate"])
        assert before_cost == 22.0

        # Apply owned_or_toolshare for 22 -> should reduce requirement's cost
        r = demo.post(f"{API}/hi/funding/cost-reduction/apply",
                      json={"project_id": pid, "kind": "owned_or_toolshare",
                            "label": "Use owned basin wrench", "saving_estimate": 22.0,
                            "classification": "expected", "requirement_id": tool_rid}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        applied = r.json()["applied"]
        assert applied["classification"] == "expected"
        assert applied["amount"] == 22.0
        # Verify requirement cost was reduced
        b2 = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        req2 = next((x for x in b2.get("requirements", []) if x["id"] == tool_rid), None)
        assert req2 is not None
        new_cost = float(req2["cost_estimate"])
        assert new_cost == 0.0, f"expected tool cost 0 after full toolshare offset, got {new_cost}"


# ---------- Orchestrator integration ----------
class TestOrchestratorEvents:
    def test_events_include_funding_and_savings_and_alt(self, demo, project):
        pid = project["pid"]
        r = demo.get(f"{API}/hi/orchestrator/projects/{pid}/events", timeout=30)
        assert r.status_code == 200
        types = [e["type"] for e in r.json()["events"]]
        assert "PROJECT_FUNDING_TARGET_SET" in types
        assert "SAVINGS_REWARD_CONFIRMED" in types
        assert "PROJECT_COST_ALTERNATIVE_FOUND" in types


# ---------- Wallet ----------
class TestWallet:
    def test_wallet_shape_and_no_revenue(self, demo):
        r = demo.get(f"{API}/hi/funding/wallet", timeout=30)
        assert r.status_code == 200
        j = r.json()
        for k in ("month_confirmed", "lifetime_confirmed", "pending", "active_goals"):
            assert k in j, f"wallet missing {k}"
        # Must never expose internal revenue
        forbidden = {"internal_revenue", "internal_revenue_amount", "revenue", "reward_amount"}
        assert not (forbidden & set(j.keys())), f"wallet exposes revenue: {j.keys()}"
        assert j["lifetime_confirmed"] >= 22.40


# ---------- Authorization ----------
class TestAuthorization:
    def test_cross_user_get_plan_404(self, other_user, project):
        pid = project["pid"]
        r = other_user.get(f"{API}/hi/funding/goals/{pid}", timeout=30)
        assert r.status_code == 404, f"expected 404 cross-user, got {r.status_code}"

    def test_cross_user_post_savings_404(self, other_user, project):
        pid = project["pid"]
        r = other_user.post(f"{API}/hi/funding/savings",
                            json={"project_id": pid, "amount": 5, "classification": "confirmed"}, timeout=30)
        assert r.status_code == 404, f"expected 404 cross-user, got {r.status_code}: {r.text[:200]}"


# ---------- Admin ----------
class TestAdmin:
    def test_admin_dashboard(self, admin):
        r = admin.get(f"{API}/hi/admin/funding/dashboard", timeout=30)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        for k in ("confirmed_customer_savings", "cost_reduction_savings", "active_goals",
                  "completion_rate", "internal_revenue"):
            assert k in j, f"dashboard missing {k}"
        assert j["internal_revenue"] == 0.0

    def test_admin_config_providers(self, admin):
        r = admin.get(f"{API}/hi/admin/funding/config", timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "config" in j and "providers" in j
        providers = {p["key"]: p for p in j["providers"]}
        assert providers["kard"]["phase"] == 3
        assert providers["benefithub"]["phase"] == 4
        assert providers["affiliates"]["phase"] == 2

    def test_admin_put_config_persists(self, admin):
        # Toggle conservative_forecast off and kard_enabled true, then revert
        put1 = admin.put(f"{API}/hi/admin/funding/config",
                         json={"enabled": True, "conservative_forecast": False, "kard_enabled": True}, timeout=30)
        assert put1.status_code == 200, put1.text[:200]
        # Fetch back
        got = admin.get(f"{API}/hi/admin/funding/config", timeout=30).json()["config"]
        assert got["conservative_forecast"] is False
        assert got["kard_enabled"] is True
        # Revert
        admin.put(f"{API}/hi/admin/funding/config",
                  json={"conservative_forecast": True, "kard_enabled": False}, timeout=30)
        got2 = admin.get(f"{API}/hi/admin/funding/config", timeout=30).json()["config"]
        assert got2["conservative_forecast"] is True
        assert got2["kard_enabled"] is False
