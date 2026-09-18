"""Tests for Sheet #13 (Automation & Workflow) and #14 (Home Digital Twin)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin(session):
    r = session.post(f"{API}/auth/login",
                     json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="session")
def user_std(session):
    email = f"TEST_hp_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = session.post(f"{API}/auth/register",
                     json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": "HomeTester"},
                     timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["access_token"], "user": d["user"]}


def h(who):
    return {"Authorization": f"Bearer {who['token']}", "Content-Type": "application/json"}


# ========================= Automation (#13) =========================
class TestAutomationMeta:
    def test_meta_shape(self, session, admin):
        r = session.get(f"{API}/admin/automations/meta", headers=h(admin), timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert "triggers" in b and len(b["triggers"]) >= 4
        assert "actions" in b and len(b["actions"]) >= 5
        assert "recipes" in b and len(b["recipes"]) >= 1
        keys = {t["key"] for t in b["triggers"]}
        assert {"signup", "project_completed", "subscription_started", "referral_completed"} <= keys

    def test_meta_admin_gated(self, session, user_std):
        r = session.get(f"{API}/admin/automations/meta", headers=h(user_std), timeout=10)
        assert r.status_code == 403


class TestAutomationCRUD:
    @pytest.fixture(scope="class")
    def rule(self, session, admin):
        payload = {
            "name": "TEST_auto_reward_5th",
            "trigger": "project_completed",
            "conditions": [{"field": "projects_completed", "op": "gte", "value": 5}],
            "actions": [{"type": "award_credits", "amount": 25}],
            "enabled": True,
        }
        r = session.post(f"{API}/admin/automations", headers=h(admin), json=payload, timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["name"] == "TEST_auto_reward_5th"
        assert b["trigger"] == "project_completed"
        assert b["enabled"] is True
        assert b["runs"] == 0
        assert "id" in b
        assert "_id" not in b
        yield b
        # cleanup
        session.delete(f"{API}/admin/automations/{b['id']}", headers=h(admin), timeout=10)

    def test_list_contains_rule(self, session, admin, rule):
        r = session.get(f"{API}/admin/automations", headers=h(admin), timeout=10)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["rules"]]
        assert rule["id"] in ids

    def test_toggle_off_and_on(self, session, admin, rule):
        r = session.patch(f"{API}/admin/automations/{rule['id']}/toggle",
                          headers=h(admin), json={"enabled": False}, timeout=10)
        assert r.status_code == 200
        # verify
        lst = session.get(f"{API}/admin/automations", headers=h(admin), timeout=10).json()["rules"]
        cur = next(x for x in lst if x["id"] == rule["id"])
        assert cur["enabled"] is False
        session.patch(f"{API}/admin/automations/{rule['id']}/toggle",
                      headers=h(admin), json={"enabled": True}, timeout=10)

    def test_test_run_fires_and_logs(self, session, admin, rule):
        r = session.post(f"{API}/admin/automations/{rule['id']}/test",
                         headers=h(admin), timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["tested"] is True
        assert b["fired"] is True  # sample data has projects_completed=5
        assert b["log"] is not None
        assert b["log"]["rule_id"] == rule["id"]
        assert b["log"]["test"] is True
        assert b["log"]["success"] is True
        # confirm the log now appears in logs list
        logs = session.get(f"{API}/admin/automations/logs", headers=h(admin), timeout=10).json()["logs"]
        assert any(l["rule_id"] == rule["id"] for l in logs)

    def test_bad_trigger_400(self, session, admin):
        r = session.post(f"{API}/admin/automations", headers=h(admin),
                         json={"name": "bad", "trigger": "nope", "conditions": [], "actions": []},
                         timeout=10)
        assert r.status_code == 400

    def test_admin_only(self, session, user_std):
        r = session.get(f"{API}/admin/automations", headers=h(user_std), timeout=10)
        assert r.status_code == 403
        r2 = session.post(f"{API}/admin/automations", headers=h(user_std),
                          json={"name": "x", "trigger": "signup", "conditions": [], "actions": []},
                          timeout=10)
        assert r2.status_code == 403

    def test_delete_removes(self, session, admin):
        # create then delete separately (don't consume the class fixture)
        r = session.post(f"{API}/admin/automations", headers=h(admin),
                         json={"name": "TEST_delme", "trigger": "signup",
                               "conditions": [], "actions": [{"type": "log"}], "enabled": True},
                         timeout=10)
        rid = r.json()["id"]
        rd = session.delete(f"{API}/admin/automations/{rid}", headers=h(admin), timeout=10)
        assert rd.status_code == 200
        # verify absent
        lst = session.get(f"{API}/admin/automations", headers=h(admin), timeout=10).json()["rules"]
        assert rid not in [x["id"] for x in lst]


# ========================= Home Digital Twin (#14) =========================
class TestHomeProfile:
    def test_get_home_admin_populated(self, session, admin):
        r = session.get(f"{API}/home", headers=h(admin), timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        for k in ("rooms", "systems", "stats", "years", "log", "room_types", "system_types"):
            assert k in b, f"missing {k}"
        stats = b["stats"]
        for k in ("projects_completed", "money_saved_cents", "invested_cents",
                  "total_hours", "years_active", "rooms", "systems"):
            assert k in stats
        # admin has a completed project → timeline populated
        assert stats["projects_completed"] >= 1
        assert len(b["log"]) >= 1
        # Room / system type catalogs present
        assert "Kitchen" in b["room_types"]
        assert "HVAC" in b["system_types"]

    def test_get_home_new_user_empty(self, session, user_std):
        r = session.get(f"{API}/home", headers=h(user_std), timeout=10)
        assert r.status_code == 200
        b = r.json()
        assert b["rooms"] == []
        assert b["systems"] == []
        assert b["stats"]["projects_completed"] == 0
        assert b["stats"]["rooms"] == 0

    def test_add_and_delete_room(self, session, user_std):
        r = session.post(f"{API}/home/rooms", headers=h(user_std),
                         json={"name": "TEST_Kitchen", "type": "Kitchen", "notes": "big"},
                         timeout=10)
        assert r.status_code == 200, r.text
        room = r.json()
        assert room["name"] == "TEST_Kitchen"
        assert room["type"] == "Kitchen"
        rid = room["id"]
        # verify persistence
        hm = session.get(f"{API}/home", headers=h(user_std), timeout=10).json()
        assert any(x["id"] == rid for x in hm["rooms"])
        assert hm["stats"]["rooms"] >= 1
        # delete
        rd = session.delete(f"{API}/home/rooms/{rid}", headers=h(user_std), timeout=10)
        assert rd.status_code == 200
        hm2 = session.get(f"{API}/home", headers=h(user_std), timeout=10).json()
        assert not any(x["id"] == rid for x in hm2["rooms"])

    def test_add_and_delete_system(self, session, user_std):
        r = session.post(f"{API}/home/systems", headers=h(user_std),
                         json={"name": "TEST_HVAC Trane", "type": "HVAC",
                               "install_year": 2019, "warranty": "10yr"},
                         timeout=10)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["name"] == "TEST_HVAC Trane"
        assert s["install_year"] == 2019
        sid = s["id"]
        hm = session.get(f"{API}/home", headers=h(user_std), timeout=10).json()
        assert any(x["id"] == sid for x in hm["systems"])
        rd = session.delete(f"{API}/home/systems/{sid}", headers=h(user_std), timeout=10)
        assert rd.status_code == 200

    def test_year_review_admin(self, session, admin):
        # admin has a completed project in 2026 per E1 note
        hm = session.get(f"{API}/home", headers=h(admin), timeout=10).json()
        years = hm.get("years") or []
        if not years:
            pytest.skip("Admin has no year buckets — completed project timeline is empty")
        yr = years[0]
        r = session.get(f"{API}/home/year-review/{yr}", headers=h(admin), timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["year"] == yr
        assert b["projects"] >= 1
        for k in ("money_saved_cents", "invested_cents", "hours", "top_skills", "highlights"):
            assert k in b

    def test_year_review_no_data(self, session, user_std):
        r = session.get(f"{API}/home/year-review/1999", headers=h(user_std), timeout=10)
        assert r.status_code == 200
        b = r.json()
        assert b["year"] == 1999
        assert b["projects"] == 0

    def test_home_auth_required(self, session):
        r = session.get(f"{API}/home", timeout=10)
        assert r.status_code in (401, 403)
