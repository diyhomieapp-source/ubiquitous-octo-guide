"""
Backend tests for /api/maintenance/* (Home Maintenance Scheduler).

Covers:
 - POST /api/maintenance/generate (idempotency, ~20 added on first call)
 - GET  /api/maintenance/tasks    (sorted overdue->due_soon->upcoming, with status)
 - GET  /api/maintenance/summary  (totals, budget, spent_ytd, on_track)
 - POST /api/maintenance/tasks    (custom create)
 - PUT  /api/maintenance/tasks/{id}
 - POST /api/maintenance/tasks/{id}/complete  (recurring roll-forward + spent++)
 - POST .../complete on a 'once' task removes it.
 - DELETE /api/maintenance/tasks/{id}
 - 401 without token on all endpoints
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = (os.environ.get("EXPO_BACKEND_URL")
            or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"

TIMEOUT = 30


# ---------- helpers ----------
def _register(suffix: str) -> tuple[str, dict]:
    ts = int(time.time() * 1000)
    email = f"TEST_maint_{suffix}_{ts}_{uuid.uuid4().hex[:6]}@diyhomie.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "Test1234", "name": f"Maint {suffix}"},
                      timeout=TIMEOUT)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_token():
    token, _ = _register("base")
    return token


# ---------- tests ----------

# Module: /maintenance/generate
class TestGenerate:
    def test_generate_first_run_adds_about_20_tasks(self):
        token, _ = _register("gen")
        r = requests.post(f"{API}/maintenance/generate", headers=_h(token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "added" in body
        # Spec says ~20. Allow >=18.
        assert body["added"] >= 18, f"expected ~20 added, got {body}"
        assert body["added"] <= 30

        # Verify persistence via GET
        r2 = requests.get(f"{API}/maintenance/tasks", headers=_h(token), timeout=TIMEOUT)
        assert r2.status_code == 200
        tasks = r2.json()
        assert len(tasks) == body["added"]

    def test_generate_is_idempotent(self):
        token, _ = _register("idem")
        r1 = requests.post(f"{API}/maintenance/generate", headers=_h(token), timeout=TIMEOUT)
        assert r1.status_code == 200
        first_added = r1.json()["added"]
        assert first_added >= 18

        r2 = requests.post(f"{API}/maintenance/generate", headers=_h(token), timeout=TIMEOUT)
        assert r2.status_code == 200
        assert r2.json()["added"] == 0, "Second call should add 0 (idempotent)"

        # Confirm no duplicates
        tasks = requests.get(f"{API}/maintenance/tasks", headers=_h(token), timeout=TIMEOUT).json()
        titles = [t["title"] for t in tasks]
        assert len(titles) == len(set(titles)), "Duplicate task titles found"
        assert len(tasks) == first_added


# Module: /maintenance/tasks (list)
class TestTasksList:
    def test_tasks_status_and_sort_order(self, user_token):
        # Generate plan
        requests.post(f"{API}/maintenance/generate", headers=_h(user_token), timeout=TIMEOUT)
        r = requests.get(f"{API}/maintenance/tasks", headers=_h(user_token), timeout=TIMEOUT)
        assert r.status_code == 200
        tasks = r.json()
        assert len(tasks) >= 18

        order_map = {"overdue": 0, "due_soon": 1, "upcoming": 2}
        # ensure each has expected fields
        for t in tasks:
            for k in ("id", "title", "category", "frequency", "est_cost_cents", "next_due", "status"):
                assert k in t, f"missing {k} in task {t}"
            assert t["status"] in order_map

        ranks = [order_map[t["status"]] for t in tasks]
        assert ranks == sorted(ranks), f"Tasks not sorted by status priority: {ranks}"


# Module: /maintenance/summary
class TestSummary:
    def test_summary_shape_and_values(self, user_token):
        # Ensure plan generated
        requests.post(f"{API}/maintenance/generate", headers=_h(user_token), timeout=TIMEOUT)
        r = requests.get(f"{API}/maintenance/summary", headers=_h(user_token), timeout=TIMEOUT)
        assert r.status_code == 200
        s = r.json()
        for k in ("total", "overdue", "due_this_month", "annual_budget_cents",
                  "spent_ytd_cents", "on_track"):
            assert k in s, f"summary missing {k}: {s}"
        assert isinstance(s["total"], int) and s["total"] >= 18
        assert isinstance(s["annual_budget_cents"], int) and s["annual_budget_cents"] > 0
        assert isinstance(s["on_track"], bool)


# Module: /maintenance/tasks CRUD (custom)
class TestCustomCRUD:
    def test_create_update_delete_custom_task(self):
        token, _ = _register("crud")
        # CREATE
        payload = {
            "title": "TEST Custom mow lawn",
            "category": "Lawn & Garden",
            "frequency": "monthly",
            "est_cost_cents": 2500,
            "notes": "front + back",
        }
        r = requests.post(f"{API}/maintenance/tasks", headers=_h(token), json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["title"] == payload["title"]
        assert created["frequency"] == "monthly"
        assert created["est_cost_cents"] == 2500
        assert created["status"] in ("overdue", "due_soon", "upcoming")
        tid = created["id"]

        # GET verifies persistence
        tasks = requests.get(f"{API}/maintenance/tasks", headers=_h(token), timeout=TIMEOUT).json()
        ids = [t["id"] for t in tasks]
        assert tid in ids

        # UPDATE
        upd = {**payload, "title": "TEST Custom mow lawn UPDATED", "est_cost_cents": 3000,
               "frequency": "quarterly"}
        r2 = requests.put(f"{API}/maintenance/tasks/{tid}", headers=_h(token), json=upd, timeout=TIMEOUT)
        assert r2.status_code == 200, r2.text
        u = r2.json()
        assert u["title"] == upd["title"]
        assert u["est_cost_cents"] == 3000
        assert u["frequency"] == "quarterly"

        # GET to verify update
        tasks2 = requests.get(f"{API}/maintenance/tasks", headers=_h(token), timeout=TIMEOUT).json()
        match = next(t for t in tasks2 if t["id"] == tid)
        assert match["title"] == upd["title"]
        assert match["est_cost_cents"] == 3000

        # DELETE
        rd = requests.delete(f"{API}/maintenance/tasks/{tid}", headers=_h(token), timeout=TIMEOUT)
        assert rd.status_code == 200
        tasks3 = requests.get(f"{API}/maintenance/tasks", headers=_h(token), timeout=TIMEOUT).json()
        assert tid not in [t["id"] for t in tasks3]

    def test_update_nonexistent_returns_404(self):
        token, _ = _register("upd404")
        bad_id = "nonexistent-id-xyz"
        r = requests.put(f"{API}/maintenance/tasks/{bad_id}", headers=_h(token),
                         json={"title": "x", "frequency": "annual"}, timeout=TIMEOUT)
        assert r.status_code == 404


# Module: /maintenance/tasks/{id}/complete
class TestComplete:
    def test_complete_recurring_rolls_forward_and_spent_increases(self):
        token, _ = _register("complete")
        # Create a recurring task with a non-zero cost.
        # Force original next_due to a past date so post-complete due rolls to a clearly different date.
        from datetime import date, timedelta
        past_due = (date.today() - timedelta(days=5)).isoformat()
        payload = {"title": "TEST Recurring filter", "category": "HVAC",
                   "frequency": "monthly", "est_cost_cents": 1500, "next_due": past_due}
        created = requests.post(f"{API}/maintenance/tasks", headers=_h(token),
                                json=payload, timeout=TIMEOUT).json()
        tid = created["id"]
        original_due = created["next_due"]
        assert original_due == past_due
        assert created["status"] == "overdue"

        # Summary before
        s_before = requests.get(f"{API}/maintenance/summary", headers=_h(token), timeout=TIMEOUT).json()

        # Complete
        r = requests.post(f"{API}/maintenance/tasks/{tid}/complete",
                          headers=_h(token), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("completed") is True
        assert "task" in body, "Recurring complete must return updated task"
        new_due = body["task"]["next_due"]
        assert new_due != original_due, "next_due should roll forward"
        assert new_due > original_due  # ISO date strings compare lexicographically

        # Verify persistence: task still exists with last_done set
        tasks = requests.get(f"{API}/maintenance/tasks", headers=_h(token), timeout=TIMEOUT).json()
        match = next((t for t in tasks if t["id"] == tid), None)
        assert match is not None, "Recurring task should still exist after complete"
        assert match.get("last_done") is not None
        assert match["next_due"] == new_due

        # Summary after: spent_ytd_cents should have increased by 1500
        s_after = requests.get(f"{API}/maintenance/summary", headers=_h(token), timeout=TIMEOUT).json()
        assert s_after["spent_ytd_cents"] == s_before["spent_ytd_cents"] + 1500, \
            f"spent_ytd_cents should increase by 1500: before={s_before}, after={s_after}"

    def test_complete_once_task_removes_it(self):
        token, _ = _register("once")
        payload = {"title": "TEST One-time fix", "category": "Other",
                   "frequency": "once", "est_cost_cents": 500}
        created = requests.post(f"{API}/maintenance/tasks", headers=_h(token),
                                json=payload, timeout=TIMEOUT).json()
        tid = created["id"]
        r = requests.post(f"{API}/maintenance/tasks/{tid}/complete",
                          headers=_h(token), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body.get("removed") is True

        # Verify GONE
        tasks = requests.get(f"{API}/maintenance/tasks", headers=_h(token), timeout=TIMEOUT).json()
        assert tid not in [t["id"] for t in tasks], "Once task should be deleted after completion"

    def test_complete_nonexistent_returns_404(self):
        token, _ = _register("comp404")
        r = requests.post(f"{API}/maintenance/tasks/abc-does-not-exist/complete",
                          headers=_h(token), timeout=TIMEOUT)
        assert r.status_code == 404


# Module: auth gating
class TestAuthRequired:
    @pytest.mark.parametrize("method,path,body", [
        ("POST", "/maintenance/generate", None),
        ("GET", "/maintenance/tasks", None),
        ("GET", "/maintenance/summary", None),
        ("POST", "/maintenance/tasks", {"title": "x", "frequency": "annual"}),
        ("PUT", "/maintenance/tasks/abc", {"title": "x", "frequency": "annual"}),
        ("POST", "/maintenance/tasks/abc/complete", None),
        ("DELETE", "/maintenance/tasks/abc", None),
    ])
    def test_endpoints_require_auth(self, method, path, body):
        r = requests.request(method, f"{API}{path}", json=body, timeout=TIMEOUT)
        assert r.status_code in (401, 403), \
            f"{method} {path} should require auth, got {r.status_code}: {r.text[:200]}"
