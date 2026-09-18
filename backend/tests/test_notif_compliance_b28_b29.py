"""B28 (Notification Orchestration) + B29 (Compliance Engine) — backend tests."""
import os
import pytest
import requests
import uuid

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

USER = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")}

# Known seeded projects from context
HAZARD_PROJECT_ID = "81b05bdd-37ba-4904-ae93-1df6d708931d"  # load-bearing wall + electrical
COSMETIC_PROJECT_ID = "fcb04490-d23d-4ec4-83c0-97f7fd19b1d4"  # paint living room


def _login(payload):
    r = requests.post(f"{API}/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_tok():
    return _login(USER)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN)


def h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ============================================================= B28 USER FLOWS
class TestB28UserInbox:
    def test_send_test_notification(self, user_tok):
        r = requests.post(f"{API}/hi/notifications/test", headers=h(user_tok), json={"category": "product"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "result" in data
        deliveries = data["result"].get("deliveries", [])
        suppressed = data["result"].get("suppressed", [])
        # Either fresh in_app delivered or deduped (already delivered in the past 24h)
        delivered = any(d["channel"] == "in_app" and d["status"] == "delivered" for d in deliveries)
        deduped = any(s.get("reason") == "duplicate" and s.get("channel") == "in_app" for s in suppressed)
        assert delivered or deduped, data

    def test_inbox_returns_items_and_unread_count(self, user_tok):
        r = requests.get(f"{API}/hi/notifications/inbox", headers=h(user_tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data
        assert "unread_count" in data
        assert isinstance(data["unread_count"], int)
        assert data["unread_count"] >= 1  # at least the test we just sent
        # verify no mongodb _id leak
        for it in data["items"]:
            assert "_id" not in it

    def test_unread_count_endpoint(self, user_tok):
        r = requests.get(f"{API}/hi/notifications/unread-count", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        assert "unread_count" in r.json()

    def test_mark_read(self, user_tok):
        inbox = requests.get(f"{API}/hi/notifications/inbox", headers=h(user_tok), timeout=30).json()
        assert inbox["items"], "no inbox items to mark read"
        # find an unread item
        unread = next((it for it in inbox["items"] if not it.get("read_at")), inbox["items"][0])
        iid = unread["id"]
        r = requests.post(f"{API}/hi/notifications/inbox/{iid}/read", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_read_all(self, user_tok):
        r = requests.post(f"{API}/hi/notifications/inbox/read-all", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        # verify unread count is 0
        c = requests.get(f"{API}/hi/notifications/unread-count", headers=h(user_tok), timeout=30).json()
        assert c["unread_count"] == 0

    def test_open_returns_deep_link_and_access(self, user_tok):
        # send a fresh test to have something to open
        requests.post(f"{API}/hi/notifications/test", headers=h(user_tok), json={"category": "account"}, timeout=30)
        inbox = requests.get(f"{API}/hi/notifications/inbox", headers=h(user_tok), timeout=30).json()
        assert inbox["items"], "no items to open"
        iid = inbox["items"][0]["id"]
        r = requests.post(f"{API}/hi/notifications/inbox/{iid}/open", headers=h(user_tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "deep_link" in data
        # item has no related entity → access:true
        assert data.get("access") is True

    def test_archive(self, user_tok):
        # send a fresh one, then archive it
        requests.post(f"{API}/hi/notifications/test", headers=h(user_tok), json={"category": "account"}, timeout=30)
        inbox = requests.get(f"{API}/hi/notifications/inbox", headers=h(user_tok), timeout=30).json()
        iid = inbox["items"][0]["id"]
        r = requests.post(f"{API}/hi/notifications/inbox/{iid}/archive", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        # verify no longer in default inbox listing
        inbox2 = requests.get(f"{API}/hi/notifications/inbox", headers=h(user_tok), timeout=30).json()
        assert not any(it["id"] == iid for it in inbox2["items"])


class TestB28Preferences:
    def test_get_preferences_matrix(self, user_tok):
        r = requests.get(f"{API}/hi/notifications/preferences", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "matrix" in d and "safety" in d["matrix"] and "in_app" in d["matrix"]["safety"]
        assert d.get("essential") == ["safety", "billing", "account"]
        assert "quiet_hours" in d and "start" in d["quiet_hours"]
        # marketing_consent defaults false (or currently false from setup)
        # (we don't strict-check false because other tests may toggle later)
        assert "marketing_consent" in d

    def test_cannot_disable_safety(self, user_tok):
        r = requests.put(f"{API}/hi/notifications/preferences", headers=h(user_tok),
                         json={"category": "safety", "channel": "in_app", "enabled": False}, timeout=30)
        assert r.status_code == 400, r.text

    def test_marketing_without_consent_suppressed(self, user_tok):
        # ensure consent OFF first
        requests.post(f"{API}/hi/notifications/preferences/marketing-consent", headers=h(user_tok), json={"enabled": False}, timeout=30)
        r = requests.post(f"{API}/hi/notifications/test", headers=h(user_tok), json={"category": "marketing"}, timeout=30)
        assert r.status_code == 200
        res = r.json()["result"]
        # deliveries empty (or none for in_app), suppressed contains user_opt_out
        assert not any(d["channel"] == "in_app" and d["status"] == "delivered" for d in res.get("deliveries", []))
        assert any(s.get("reason") == "user_opt_out" for s in res.get("suppressed", []))

    def test_marketing_with_consent_delivers(self, user_tok):
        r = requests.post(f"{API}/hi/notifications/preferences/marketing-consent", headers=h(user_tok), json={"enabled": True}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("marketing_consent") is True
        r2 = requests.post(f"{API}/hi/notifications/test", headers=h(user_tok), json={"category": "marketing"}, timeout=30)
        assert r2.status_code == 200
        res = r2.json()["result"]
        # Either delivered fresh, OR deduped (already delivered recently). NOT user_opt_out.
        delivered = any(d["channel"] == "in_app" and d["status"] == "delivered" for d in res.get("deliveries", []))
        suppressions = res.get("suppressed", [])
        # user_opt_out means consent still off — that would be a real failure
        assert not any(s.get("reason") == "user_opt_out" for s in suppressions), res
        deduped = any(s.get("reason") == "duplicate" for s in suppressions)
        assert delivered or deduped, res
        # cleanup — turn back off
        requests.post(f"{API}/hi/notifications/preferences/marketing-consent", headers=h(user_tok), json={"enabled": False}, timeout=30)


# ============================================================= B28 ADMIN
class TestB28Admin:
    def test_non_admin_forbidden(self, user_tok):
        for path in ["/hi/admin/notifications/dashboard", "/hi/admin/notifications/templates", "/hi/admin/notifications/settings"]:
            r = requests.get(f"{API}{path}", headers=h(user_tok), timeout=30)
            assert r.status_code == 403, f"{path} returned {r.status_code}"

    def test_dashboard(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/notifications/dashboard", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for key in ("total_deliveries", "by_status", "by_category", "open_rate", "suppressions", "failed", "settings"):
            assert key in d, f"missing {key}"

    def test_templates_seeded(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/notifications/templates", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200
        temps = r.json()["templates"]
        assert len(temps) >= 10, f"expected >=10 seeded templates, got {len(temps)}"

    def test_create_draft_template(self, admin_tok):
        key = f"TEST_template_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/hi/admin/notifications/templates", headers=h(admin_tok),
                          json={"template_key": key, "category": "product",
                                "title_template": "TEST title",
                                "body_template": "TEST body"}, timeout=30)
        assert r.status_code == 200, r.text
        t = r.json()["template"]
        assert t["status"] == "draft"
        assert t["requires_approval"] is False
        # non-approval template can go active from draft directly
        r2 = requests.put(f"{API}/hi/admin/notifications/templates/{t['id']}/status", headers=h(admin_tok),
                          json={"status": "active"}, timeout=30)
        assert r2.status_code == 200, r2.text

    def test_marketing_template_requires_approval(self, admin_tok):
        key = f"TEST_mkt_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/hi/admin/notifications/templates", headers=h(admin_tok),
                          json={"template_key": key, "category": "marketing",
                                "title_template": "TEST", "body_template": "TEST"}, timeout=30)
        assert r.status_code == 200
        t = r.json()["template"]
        assert t["requires_approval"] is True
        # draft → active directly should 409
        r2 = requests.put(f"{API}/hi/admin/notifications/templates/{t['id']}/status", headers=h(admin_tok),
                          json={"status": "active"}, timeout=30)
        assert r2.status_code == 409, r2.text
        # approve then activate should succeed
        r3 = requests.put(f"{API}/hi/admin/notifications/templates/{t['id']}/status", headers=h(admin_tok),
                          json={"status": "approved"}, timeout=30)
        assert r3.status_code == 200
        r4 = requests.put(f"{API}/hi/admin/notifications/templates/{t['id']}/status", headers=h(admin_tok),
                          json={"status": "active"}, timeout=30)
        assert r4.status_code == 200

    def test_cannot_disable_safety_category(self, admin_tok):
        r = requests.put(f"{API}/hi/admin/notifications/categories", headers=h(admin_tok),
                         json={"category": "safety", "enabled": False}, timeout=30)
        assert r.status_code == 400

    def test_settings_update(self, admin_tok):
        r = requests.put(f"{API}/hi/admin/notifications/settings", headers=h(admin_tok),
                         json={"pause_nonessential": True}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("pause_nonessential") is True
        # restore
        requests.put(f"{API}/hi/admin/notifications/settings", headers=h(admin_tok),
                     json={"pause_nonessential": False}, timeout=30)

    def test_retry_delivery_404_on_bogus(self, admin_tok):
        r = requests.post(f"{API}/hi/admin/notifications/deliveries/nonexistent-id/retry",
                          headers=h(admin_tok), timeout=30)
        assert r.status_code == 404


# ============================================================= B29 USER
class TestB29User:
    def test_categories(self, user_tok):
        r = requests.get(f"{API}/hi/compliance/categories", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "work_categories" in d and "electrical" in d["work_categories"]
        assert "assessment_levels" in d and "professional_review_recommended" in d["assessment_levels"]

    def test_set_and_get_jurisdiction(self, user_tok):
        r = requests.put(f"{API}/hi/compliance/jurisdiction", headers=h(user_tok),
                         json={"country": "US", "state_or_region": "TX", "city": "Austin", "postal_code": "78701"}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["verification_status"] == "user_entered"
        assert j["city"] == "Austin"
        r2 = requests.get(f"{API}/hi/compliance/jurisdiction", headers=h(user_tok), timeout=30)
        assert r2.status_code == 200
        assert r2.json()["jurisdiction"]["city"] == "Austin"
        assert r2.json()["has_verified_local_data"] is False

    def _find_or_create_project(self, tok, title, category):
        # try to find a project matching title
        r = requests.get(f"{API}/hi/projects", headers=h(tok), timeout=30)
        if r.status_code == 200:
            projs = r.json() if isinstance(r.json(), list) else r.json().get("projects", [])
            for p in projs:
                if title.lower() in (p.get("title") or "").lower():
                    return p["id"]
        # create one
        r = requests.post(f"{API}/hi/projects", headers=h(tok),
                          json={"title": title, "project_category": category, "scope": title}, timeout=30)
        if r.status_code in (200, 201):
            return r.json().get("id") or r.json().get("project", {}).get("id")
        return None

    def test_assess_hazard_project(self, user_tok):
        pid = HAZARD_PROJECT_ID
        # Check if project exists — if not, fall back to lookup/create
        r = requests.get(f"{API}/hi/projects/{pid}", headers=h(user_tok), timeout=30)
        if r.status_code != 200:
            pid = self._find_or_create_project(user_tok, "Remove load-bearing wall and add electrical circuit", "renovation")
            if not pid:
                pytest.skip("Cannot find or create hazard project")
        r = requests.post(f"{API}/hi/compliance/assess", headers=h(user_tok),
                          json={"project_id": pid}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["assessment"]["assessment_level"] == "professional_review_recommended", d["assessment"]
        wc = d["assessment"]["work_categories"]
        assert "electrical" in wc and "structural" in wc, wc
        assert d["professional_escalation"]["recommended"] is True
        assert len(d["professional_escalation"]["reasons"]) > 0
        assert len(d["rules"]) > 0
        for rl in d["rules"]:
            assert rl.get("source_reference")
            assert rl.get("source_date")
        # checklist includes the 4 standard questions
        chk_titles = [c["title"] for c in d["checklist"]]
        for q in ["Is a permit required for this scope of work?",
                  "Are inspections required during or after the project?",
                  "Are licensed contractors required for any portion?",
                  "Are there local setback, drainage, or HOA requirements?"]:
            assert q in chk_titles, f"missing question: {q}"
        assert "does not have verified local requirements" in d["assessment"]["summary"]

    def test_assess_cosmetic_project(self, user_tok):
        pid = COSMETIC_PROJECT_ID
        r = requests.get(f"{API}/hi/projects/{pid}", headers=h(user_tok), timeout=30)
        if r.status_code != 200:
            pid = self._find_or_create_project(user_tok, "Paint the living room", "cosmetic")
            if not pid:
                pytest.skip("Cannot find or create cosmetic project")
        r = requests.post(f"{API}/hi/compliance/assess", headers=h(user_tok),
                          json={"project_id": pid}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["assessment"]["assessment_level"] == "general_guidance", d["assessment"]
        assert d["professional_escalation"]["recommended"] is False

    def test_get_assessment(self, user_tok):
        pid = HAZARD_PROJECT_ID
        r = requests.get(f"{API}/hi/compliance/assessments/{pid}", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("assessment") is not None
        assert len(d.get("checklist", [])) > 0

    def test_checklist_status(self, user_tok):
        # get an item id
        d = requests.get(f"{API}/hi/compliance/assessments/{HAZARD_PROJECT_ID}", headers=h(user_tok), timeout=30).json()
        item_id = d["checklist"][0]["id"]
        r = requests.post(f"{API}/hi/compliance/checklist/{item_id}/status", headers=h(user_tok),
                          json={"status": "completed"}, timeout=30)
        assert r.status_code == 200, r.text

    def test_mark_verified(self, user_tok):
        d = requests.get(f"{API}/hi/compliance/assessments/{HAZARD_PROJECT_ID}", headers=h(user_tok), timeout=30).json()
        aid = d["assessment"]["id"]
        r = requests.post(f"{API}/hi/compliance/assessments/{aid}/verified", headers=h(user_tok), timeout=30)
        assert r.status_code == 200

    def test_package_create_and_status(self, user_tok):
        r = requests.post(f"{API}/hi/compliance/package", headers=h(user_tok),
                          json={"project_id": HAZARD_PROJECT_ID, "included_entities": {}}, timeout=30)
        assert r.status_code == 200, r.text
        pkg = r.json()["package"]
        assert pkg["status"] == "draft"
        # preliminary label
        assert any("PRELIMINARY" in lbl for lbl in pkg["labels"])
        # address excluded by default
        assert pkg["included_entities"]["address_included"] is False
        pid = pkg["id"]
        r2 = requests.get(f"{API}/hi/compliance/package/{HAZARD_PROJECT_ID}", headers=h(user_tok), timeout=30)
        assert r2.status_code == 200 and r2.json()["package"]["id"] == pid
        r3 = requests.put(f"{API}/hi/compliance/package/{pid}/status", headers=h(user_tok),
                          json={"status": "ready"}, timeout=30)
        assert r3.status_code == 200

    def test_report_flag(self, user_tok):
        r = requests.post(f"{API}/hi/compliance/report", headers=h(user_tok),
                          json={"reason": "TEST_flag reason"}, timeout=30)
        assert r.status_code == 200


# ============================================================= B29 ADMIN
class TestB29Admin:
    def test_non_admin_forbidden(self, user_tok):
        for path in ["/hi/admin/compliance/dashboard", "/hi/admin/compliance/rules", "/hi/admin/compliance/flags"]:
            r = requests.get(f"{API}{path}", headers=h(user_tok), timeout=30)
            assert r.status_code == 403, f"{path} → {r.status_code}"

    def test_dashboard(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/compliance/dashboard", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("assessments_by_level", "rules_by_status", "expired_rules", "open_flags", "settings"):
            assert k in d

    def test_seeded_rules(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/compliance/rules", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200
        rules = r.json()["rules"]
        active = [rl for rl in rules if rl["status"] == "active"]
        assert len(active) >= 10, f"expected >=10 active seeded rules, got {len(active)}"

    def test_create_rule_and_status_gating(self, admin_tok):
        # Draft rule WITHOUT source_date
        r = requests.post(f"{API}/hi/admin/compliance/rules", headers=h(admin_tok),
                          json={"project_category": "electrical", "rule_type": "permit_inquiry",
                                "title": "TEST no-date rule", "guidance": "TEST guidance",
                                "source_reference": "TEST source"}, timeout=30)
        assert r.status_code == 200, r.text
        rid = r.json()["rule"]["id"]
        # Can't go active without source_date
        r2 = requests.put(f"{API}/hi/admin/compliance/rules/{rid}/status", headers=h(admin_tok),
                          json={"status": "active"}, timeout=30)
        assert r2.status_code == 409, r2.text

        # New rule WITH source_date
        r = requests.post(f"{API}/hi/admin/compliance/rules", headers=h(admin_tok),
                          json={"project_category": "electrical", "rule_type": "permit_inquiry",
                                "title": "TEST dated rule", "guidance": "TEST guidance",
                                "source_reference": "TEST source", "source_date": "2025-06-01"}, timeout=30)
        assert r.status_code == 200
        rid2 = r.json()["rule"]["id"]
        r3 = requests.put(f"{API}/hi/admin/compliance/rules/{rid2}/status", headers=h(admin_tok),
                          json={"status": "active"}, timeout=30)
        assert r3.status_code == 200, r3.text
        # archive both for cleanup
        requests.put(f"{API}/hi/admin/compliance/rules/{rid}/status", headers=h(admin_tok), json={"status": "archived"}, timeout=30)
        requests.put(f"{API}/hi/admin/compliance/rules/{rid2}/status", headers=h(admin_tok), json={"status": "archived"}, timeout=30)

    def test_category_toggle(self, admin_tok):
        r = requests.put(f"{API}/hi/admin/compliance/categories", headers=h(admin_tok),
                         json={"category": "cosmetic_finish", "enabled": True}, timeout=30)
        assert r.status_code == 200

    def test_flags_list_and_resolve(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/compliance/flags", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200
        flags = r.json()["flags"]
        if flags:
            fid = flags[0]["id"]
            r2 = requests.post(f"{API}/hi/admin/compliance/flags/{fid}/resolve", headers=h(admin_tok), timeout=30)
            assert r2.status_code == 200
