"""Tests for the Project Handoffs (Shopping List & Home Report).

Namespace: /api/hi/handoff/*
Verifies:
 - Shopping totals math (materials + tools -> to_buy_total, grand_total)
 - mark-purchased toggle moves an item's cost from to_buy_total to owned_total
 - Home Report shape (before completion completed=false; after completion completed=true and share_text present)
 - Per-user 404 isolation on both shopping and report
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = "Test1234"


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
def other_user():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_handoff_{uuid.uuid4().hex[:10]}@diyhomie.com"
    pw = "Test1234"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "full_name": "TEST Handoff"}, timeout=30)
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
    """Fresh orchestrator project with a material ($180) and a tool ($22) requirement."""
    r = demo.post(f"{API}/hi/orchestrator/projects",
                  json={"intent_text": "replace kitchen faucet"}, timeout=30)
    assert r.status_code == 200, f"create project failed: {r.status_code} {r.text[:200]}"
    pid = r.json()["project"]["id"]
    m = demo.post(f"{API}/hi/orchestrator/projects/{pid}/requirements",
                  json={"kind": "material", "name": "Faucet", "quantity": 1, "cost_estimate": 180}, timeout=30)
    assert m.status_code == 200, f"add material failed: {m.status_code} {m.text[:200]}"
    material_rid = m.json()["requirement"]["id"]
    t = demo.post(f"{API}/hi/orchestrator/projects/{pid}/requirements",
                  json={"kind": "tool", "name": "Basin wrench", "cost_estimate": 22}, timeout=30)
    assert t.status_code == 200
    tool_rid = t.json()["requirement"]["id"]
    return {"pid": pid, "material_rid": material_rid, "tool_rid": tool_rid}


# ---------- Shopping Handoff ----------
class TestShoppingHandoff:
    def test_shopping_totals_initial(self, demo, project):
        pid = project["pid"]
        r = demo.get(f"{API}/hi/handoff/shopping/{pid}", timeout=30)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j["project_id"] == pid
        assert j["count"] == 2, f"expected 2 items, got {j['count']}"
        assert len(j["items"]) == 2
        assert j["to_buy_total"] == 202.0, f"to_buy_total should be 202, got {j['to_buy_total']}"
        assert j["owned_total"] == 0.0
        assert j["grand_total"] == 202.0
        # Every item defaults to need_to_buy
        for it in j["items"]:
            assert it["owned"] is False
            assert it["status"] == "need_to_buy"
            assert "estimate" in it and "name" in it and "kind" in it
        # Faucet should have quantity 1
        faucet = next(it for it in j["items"] if it["name"] == "Faucet")
        assert faucet["quantity"] == 1
        assert faucet["estimate"] == 180.0

    def test_mark_purchased_moves_to_owned(self, demo, project):
        pid = project["pid"]
        rid = project["material_rid"]
        r = demo.post(f"{API}/hi/handoff/shopping/{pid}/items/{rid}/purchased?purchased=true", timeout=30)
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("ok") is True

        # Re-fetch and verify totals shifted
        j = demo.get(f"{API}/hi/handoff/shopping/{pid}", timeout=30).json()
        assert j["owned_total"] == 180.0, f"owned_total should be 180, got {j['owned_total']}"
        assert j["to_buy_total"] == 22.0, f"to_buy_total should be 22, got {j['to_buy_total']}"
        assert j["grand_total"] == 202.0
        faucet = next(it for it in j["items"] if it["id"] == rid)
        assert faucet["owned"] is True
        assert faucet["status"] == "owned"

    def test_mark_purchased_toggle_back(self, demo, project):
        pid = project["pid"]
        rid = project["material_rid"]
        # Toggle back to not-owned
        r = demo.post(f"{API}/hi/handoff/shopping/{pid}/items/{rid}/purchased?purchased=false", timeout=30)
        assert r.status_code == 200
        j = demo.get(f"{API}/hi/handoff/shopping/{pid}", timeout=30).json()
        assert j["to_buy_total"] == 202.0
        assert j["owned_total"] == 0.0

    def test_shopping_cross_user_404(self, other_user, project):
        pid = project["pid"]
        r = other_user.get(f"{API}/hi/handoff/shopping/{pid}", timeout=30)
        assert r.status_code == 404, f"expected 404 for cross-user, got {r.status_code}"

    def test_mark_purchased_cross_user_404(self, other_user, project):
        pid = project["pid"]
        rid = project["material_rid"]
        r = other_user.post(f"{API}/hi/handoff/shopping/{pid}/items/{rid}/purchased?purchased=true", timeout=30)
        assert r.status_code == 404


# ---------- Home Report ----------
class TestHomeReport:
    def test_report_incomplete_project(self, demo, project):
        pid = project["pid"]
        r = demo.get(f"{API}/hi/handoff/report/{pid}", timeout=30)
        assert r.status_code == 200, r.text[:200]
        rep = r.json().get("report")
        assert rep, "missing report envelope"
        # Required keys
        for k in ("title", "project_type", "materials_used", "tools_used",
                  "approx_cost", "confirmed_savings", "tasks_completed",
                  "known_limitations", "share_text", "completed"):
            assert k in rep, f"report missing key {k}"
        assert rep["completed"] is False, "non-completed project must have completed=false"
        assert "Faucet" in rep["materials_used"]
        assert "Basin wrench" in rep["tools_used"]
        assert isinstance(rep["share_text"], str) and len(rep["share_text"]) > 0
        assert rep["title"] in rep["share_text"]
        # approx_cost should be around 202 (may be less if the toggle test already applied cost reductions, but here nothing reduced)
        assert rep["approx_cost"] > 0

    def test_report_after_completion(self, demo, project):
        pid = project["pid"]
        # Resolve any open risks/holds first
        bundle = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        for rk in bundle.get("risks", []) or []:
            demo.post(f"{API}/hi/orchestrator/risks/{rk['id']}/resolve", timeout=30)
        # Complete every task
        bundle = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
        for t in bundle.get("tasks", []) or []:
            if t["status"] != "complete":
                demo.put(f"{API}/hi/orchestrator/tasks/{t['id']}", json={"action": "complete"}, timeout=30)
        # Complete project
        c = demo.post(f"{API}/hi/orchestrator/projects/{pid}/complete", timeout=30)
        # If safety holds prevent completion, try to resolve then retry once
        if c.status_code != 200:
            bundle = demo.get(f"{API}/hi/orchestrator/projects/{pid}", timeout=30).json()
            for rk in bundle.get("risks", []) or []:
                demo.post(f"{API}/hi/orchestrator/risks/{rk['id']}/resolve", timeout=30)
            c = demo.post(f"{API}/hi/orchestrator/projects/{pid}/complete", timeout=30)
        assert c.status_code == 200, f"could not complete project: {c.status_code} {c.text[:300]}"

        # Now the report should reflect completed=True
        r = demo.get(f"{API}/hi/handoff/report/{pid}", timeout=30)
        assert r.status_code == 200
        rep = r.json()["report"]
        assert rep["completed"] is True, f"expected completed=true, got {rep['completed']}"
        assert rep["share_text"], "share_text must be present"
        assert "Completed" in rep["share_text"]
        assert rep["title"] in rep["share_text"]

    def test_report_cross_user_404(self, other_user, project):
        pid = project["pid"]
        r = other_user.get(f"{API}/hi/handoff/report/{pid}", timeout=30)
        assert r.status_code == 404
