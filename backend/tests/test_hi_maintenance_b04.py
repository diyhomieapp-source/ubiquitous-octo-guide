"""
Backend tests for Home Intelligence Blueprint 04 — Maintenance Intelligence
Endpoints under /api/hi/maintenance/*.

Covers:
- home dashboard (score, due_now/due_soon/seasonal/season)
- tasks CRUD (create/list/detail/edit/reschedule/skip/complete recurring rollover/pause/resume/archive)
- calendar counts
- seasonal grouping
- AI suggestions generate/list/accept/dismiss (Emergent LLM gpt-4o)
- 401 gating
"""
import os
import time
import uuid
from datetime import date, timedelta
import requests
import pytest

BASE_URL = (os.environ.get("EXPO_BACKEND_URL")
            or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 60


def _register(suffix: str):
    ts = int(time.time() * 1000)
    email = f"TEST_hi_maint_{suffix}_{ts}_{uuid.uuid4().hex[:6]}@diyhomie.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": f"Maint {suffix}"},
                      timeout=TIMEOUT)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def token():
    tok, _ = _register("base")
    return tok


# ---------- Module: /home
class TestHome:
    def test_home_empty_returns_score_100(self):
        tok, _ = _register("home_empty")
        r = requests.get(f"{API}/hi/maintenance/home", headers=_h(tok), timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("due_now", "due_soon", "completed_recently", "seasonal", "season", "home_care_score"):
            assert k in body, f"missing {k}"
        assert body["home_care_score"] == 100  # no activity yet
        assert body["season"] in ("Spring", "Summer", "Fall", "Winter")


# ---------- Module: /tasks CRUD
class TestTasksCRUD:
    def test_create_task_with_occurrence_and_get_detail(self, token):
        due = (date.today() + timedelta(days=3)).isoformat()
        payload = {"title": "TEST HVAC filter", "category": "HVAC",
                   "priority": "high", "frequency_type": "quarterly",
                   "due_date": due, "season": "Summer"}
        r = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(token), json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["title"] == "TEST HVAC filter"
        assert created["frequency_type"] == "quarterly"
        assert created["priority"] == "high"
        assert created["season"] == "Summer"
        assert created["computed_status"] in ("due", "upcoming")
        tid = created["id"]

        # Detail should have task + checklist + occurrences[1]
        d = requests.get(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(token), timeout=TIMEOUT)
        assert d.status_code == 200
        detail = d.json()
        assert detail["task"]["id"] == tid
        assert isinstance(detail["checklist"], list)
        assert len(detail["occurrences"]) == 1
        assert detail["occurrences"][0]["status"] == "upcoming"

    def test_create_missing_title_400(self, token):
        r = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(token),
                          json={"title": "  ", "due_date": date.today().isoformat()}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_edit_task(self, token):
        due = (date.today() + timedelta(days=10)).isoformat()
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(token),
                          json={"title": "TEST edit-me", "due_date": due,
                                "priority": "low", "frequency_type": "annual"},
                          timeout=TIMEOUT).json()
        tid = c["id"]
        r = requests.put(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(token),
                         json={"title": "TEST edited", "priority": "high",
                               "frequency_type": "custom", "custom_interval_days": 45},
                         timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["title"] == "TEST edited"
        assert u["priority"] == "high"
        assert u["frequency_type"] == "custom"
        assert u["custom_interval_days"] == 45

    def test_list_tasks_and_tab_filters(self, token):
        # Ensure at least one due-ish + one upcoming task
        past = (date.today() - timedelta(days=2)).isoformat()
        future = (date.today() + timedelta(days=45)).isoformat()
        requests.post(f"{API}/hi/maintenance/tasks", headers=_h(token),
                      json={"title": "TEST overdue lawn", "due_date": past,
                            "frequency_type": "monthly"}, timeout=TIMEOUT)
        requests.post(f"{API}/hi/maintenance/tasks", headers=_h(token),
                      json={"title": "TEST future paint", "due_date": future,
                            "frequency_type": "annual"}, timeout=TIMEOUT)

        r = requests.get(f"{API}/hi/maintenance/tasks", headers=_h(token), timeout=TIMEOUT)
        assert r.status_code == 200
        all_tasks = r.json()["tasks"]
        assert any(t["computed_status"] == "overdue" for t in all_tasks)
        assert any(t["computed_status"] == "upcoming" for t in all_tasks)

        due = requests.get(f"{API}/hi/maintenance/tasks?tab=due", headers=_h(token), timeout=TIMEOUT).json()["tasks"]
        assert all(t["computed_status"] in ("due", "overdue") for t in due)
        upc = requests.get(f"{API}/hi/maintenance/tasks?tab=upcoming", headers=_h(token), timeout=TIMEOUT).json()["tasks"]
        assert all(t["computed_status"] == "upcoming" for t in upc)


# ---------- Module: complete/skip/reschedule/pause/archive
class TestLifecycle:
    def test_complete_recurring_rolls_forward(self):
        tok, _ = _register("complete")
        due = (date.today() - timedelta(days=1)).isoformat()
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                          json={"title": "TEST monthly filter", "frequency_type": "monthly",
                                "due_date": due}, timeout=TIMEOUT).json()
        tid = c["id"]
        r = requests.post(f"{API}/hi/maintenance/tasks/{tid}/complete", headers=_h(tok),
                          json={"notes": "done"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["recurring"] is True
        assert body["next_due"] > due

        # New occurrence should exist
        d = requests.get(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(tok), timeout=TIMEOUT).json()
        occ = d["occurrences"]
        assert any(o["status"] == "completed" for o in occ)
        assert any(o["status"] == "upcoming" for o in occ)
        assert d["task"]["status"] == "active"

    def test_complete_one_time_marks_completed(self):
        tok, _ = _register("once")
        due = date.today().isoformat()
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                          json={"title": "TEST one-time", "frequency_type": "one_time",
                                "due_date": due}, timeout=TIMEOUT).json()
        tid = c["id"]
        r = requests.post(f"{API}/hi/maintenance/tasks/{tid}/complete", headers=_h(tok),
                          json={}, timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["recurring"] is False
        d = requests.get(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(tok), timeout=TIMEOUT).json()
        assert d["task"]["status"] == "completed"

    def test_skip_recurring_advances(self):
        tok, _ = _register("skip")
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                          json={"title": "TEST skip me", "frequency_type": "monthly",
                                "due_date": date.today().isoformat()}, timeout=TIMEOUT).json()
        tid = c["id"]
        r = requests.post(f"{API}/hi/maintenance/tasks/{tid}/skip", headers=_h(tok), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["next_due"] is not None

    def test_reschedule(self):
        tok, _ = _register("resched")
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                          json={"title": "TEST resched", "frequency_type": "one_time",
                                "due_date": date.today().isoformat()}, timeout=TIMEOUT).json()
        tid = c["id"]
        new = (date.today() + timedelta(days=20)).isoformat()
        r = requests.post(f"{API}/hi/maintenance/tasks/{tid}/reschedule", headers=_h(tok),
                          json={"due_date": new}, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["due_date"] == new
        d = requests.get(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(tok), timeout=TIMEOUT).json()
        assert d["task"]["due_date"] == new
        assert d["occurrences"][0]["scheduled_date"] == new

    def test_pause_and_resume(self):
        tok, _ = _register("pause")
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                          json={"title": "TEST pause", "frequency_type": "monthly",
                                "due_date": date.today().isoformat()}, timeout=TIMEOUT).json()
        tid = c["id"]
        p = requests.put(f"{API}/hi/maintenance/tasks/{tid}/pause", headers=_h(tok), timeout=TIMEOUT)
        assert p.status_code == 200
        d = requests.get(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(tok), timeout=TIMEOUT).json()
        assert d["task"]["status"] == "paused"
        p2 = requests.put(f"{API}/hi/maintenance/tasks/{tid}/pause?resume=true", headers=_h(tok), timeout=TIMEOUT)
        assert p2.status_code == 200
        d2 = requests.get(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(tok), timeout=TIMEOUT).json()
        assert d2["task"]["status"] == "active"

    def test_archive_hides_from_list_but_keeps_history(self):
        tok, _ = _register("archive")
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                          json={"title": "TEST arch", "frequency_type": "one_time",
                                "due_date": date.today().isoformat()}, timeout=TIMEOUT).json()
        tid = c["id"]
        r = requests.delete(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(tok), timeout=TIMEOUT)
        assert r.status_code == 200
        lst = requests.get(f"{API}/hi/maintenance/tasks", headers=_h(tok), timeout=TIMEOUT).json()["tasks"]
        assert tid not in [t["id"] for t in lst]
        # detail still works
        d = requests.get(f"{API}/hi/maintenance/tasks/{tid}", headers=_h(tok), timeout=TIMEOUT)
        assert d.status_code == 200
        assert d.json()["task"]["status"] == "archived"


# ---------- Module: calendar + seasonal
class TestCalendarSeasonal:
    def test_calendar_counts(self):
        tok, _ = _register("cal")
        due = (date.today() + timedelta(days=5)).isoformat()
        requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                      json={"title": "TEST cal", "frequency_type": "one_time",
                            "due_date": due}, timeout=TIMEOUT)
        r = requests.get(f"{API}/hi/maintenance/calendar", headers=_h(tok), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert "counts_by_day" in body and "occurrences" in body
        assert body["counts_by_day"].get(due, 0) >= 1

    def test_seasonal_groups(self):
        tok, _ = _register("season")
        requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                      json={"title": "TEST spring", "frequency_type": "annual",
                            "due_date": date.today().isoformat(), "season": "Spring"},
                      timeout=TIMEOUT)
        r = requests.get(f"{API}/hi/maintenance/seasonal", headers=_h(tok), timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["season_now"] in ("Spring", "Summer", "Fall", "Winter")
        assert set(body["groups"].keys()) == {"Spring", "Summer", "Fall", "Winter"}
        assert any(t["title"] == "TEST spring" for t in body["groups"]["Spring"])


# ---------- Module: AI suggestions
class TestAISuggestions:
    def test_generate_and_list_and_accept_and_dismiss(self):
        tok, u = _register("ai")
        # Seed an asset so suggestions are grounded (uses hi_properties auto-create + hi/rooms/assets endpoints)
        # Ensure property exists via /home
        requests.get(f"{API}/hi/maintenance/home", headers=_h(tok), timeout=TIMEOUT)
        # Fetch property_id via hi/properties (if endpoint exists) — else create asset via home_intelligence add asset endpoint
        # Try generate directly (works even with 0 assets, per code)
        g = requests.post(f"{API}/hi/maintenance/suggestions/generate", headers=_h(tok), timeout=TIMEOUT)
        assert g.status_code == 200, g.text
        body = g.json()
        assert "generated" in body and "suggestions" in body
        # LLM may return 0-6; can't guarantee non-zero. If zero, skip accept/dismiss checks.
        if not body["suggestions"]:
            pytest.skip("LLM returned 0 suggestions (non-deterministic; endpoint returned 200 with valid schema)")

        # list
        lst = requests.get(f"{API}/hi/maintenance/suggestions", headers=_h(tok), timeout=TIMEOUT)
        assert lst.status_code == 200
        pending = lst.json()["suggestions"]
        assert len(pending) >= 1
        s0 = pending[0]
        # Accept first
        a = requests.post(f"{API}/hi/maintenance/suggestions/{s0['id']}/accept", headers=_h(tok), timeout=TIMEOUT)
        assert a.status_code == 200
        ab = a.json()
        assert ab["ok"] is True and ab["task_id"]
        # Verify task created
        td = requests.get(f"{API}/hi/maintenance/tasks/{ab['task_id']}", headers=_h(tok), timeout=TIMEOUT).json()
        assert td["task"]["source"] == "ai_suggested"

        # Dismiss second if exists
        if len(pending) >= 2:
            s1 = pending[1]
            d = requests.post(f"{API}/hi/maintenance/suggestions/{s1['id']}/dismiss", headers=_h(tok), timeout=TIMEOUT)
            assert d.status_code == 200

        # Confirm accepted/dismissed no longer in pending list
        lst2 = requests.get(f"{API}/hi/maintenance/suggestions", headers=_h(tok), timeout=TIMEOUT).json()["suggestions"]
        ids2 = [s["id"] for s in lst2]
        assert s0["id"] not in ids2

    def test_dismiss_missing_404(self, token):
        r = requests.post(f"{API}/hi/maintenance/suggestions/does-not-exist/dismiss",
                          headers=_h(token), timeout=TIMEOUT)
        assert r.status_code == 404


# ---------- Module: home score reflects activity
class TestHomeScore:
    def test_score_after_complete_and_overdue(self):
        tok, _ = _register("score")
        # 1 overdue + complete one to have completed occurrence
        past = (date.today() - timedelta(days=2)).isoformat()
        requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                      json={"title": "TEST overdue", "frequency_type": "one_time",
                            "due_date": past}, timeout=TIMEOUT)
        c = requests.post(f"{API}/hi/maintenance/tasks", headers=_h(tok),
                          json={"title": "TEST tocomplete", "frequency_type": "one_time",
                                "due_date": date.today().isoformat()}, timeout=TIMEOUT).json()
        requests.post(f"{API}/hi/maintenance/tasks/{c['id']}/complete", headers=_h(tok),
                      json={}, timeout=TIMEOUT)
        h = requests.get(f"{API}/hi/maintenance/home", headers=_h(tok), timeout=TIMEOUT).json()
        # 1 completed / (1 completed + 1 overdue) = 50
        assert 40 <= h["home_care_score"] <= 60, h


# ---------- Module: auth
class TestAuth:
    @pytest.mark.parametrize("method,path,body", [
        ("GET", "/hi/maintenance/home", None),
        ("GET", "/hi/maintenance/tasks", None),
        ("POST", "/hi/maintenance/tasks", {"title": "x", "due_date": "2026-01-01"}),
        ("GET", "/hi/maintenance/tasks/abc", None),
        ("PUT", "/hi/maintenance/tasks/abc", {"title": "x"}),
        ("POST", "/hi/maintenance/tasks/abc/complete", {}),
        ("POST", "/hi/maintenance/tasks/abc/skip", None),
        ("POST", "/hi/maintenance/tasks/abc/reschedule", {"due_date": "2026-01-01"}),
        ("PUT", "/hi/maintenance/tasks/abc/pause", None),
        ("DELETE", "/hi/maintenance/tasks/abc", None),
        ("GET", "/hi/maintenance/calendar", None),
        ("GET", "/hi/maintenance/seasonal", None),
        ("POST", "/hi/maintenance/suggestions/generate", None),
        ("GET", "/hi/maintenance/suggestions", None),
        ("POST", "/hi/maintenance/suggestions/abc/accept", None),
        ("POST", "/hi/maintenance/suggestions/abc/dismiss", None),
    ])
    def test_requires_auth(self, method, path, body):
        r = requests.request(method, f"{API}{path}", json=body, timeout=TIMEOUT)
        assert r.status_code in (401, 403), f"{method} {path} -> {r.status_code}"
