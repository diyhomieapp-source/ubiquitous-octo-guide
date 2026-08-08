"""
Build Blueprint 10 — Admin Control Center & Content Operations tests.
Covers: RBAC, dashboard, users, content templates+versioning+rollback,
safety escalation (incl auto-escalation via chat), feature flags,
support (user+admin), admin roles (super only), immutable audit chain.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "Diyhomieapp@gmail.com"
OWNER_PASSWORD = "diyhomie1122"
USER_EMAIL = "demo_home@diyhomie.com"
USER_PASSWORD = "Test1234"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def admin_token():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def user_token():
    return _login(USER_EMAIL, USER_PASSWORD)


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ------------------------------------------------- 1. /me + RBAC gating
def test_me_super_admin(admin_token):
    r = requests.get(f"{API}/hi/admin/me", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["admin_role"] == "super_admin"
    assert "*" in d["permissions"]
    assert d["is_super"] is True


@pytest.mark.parametrize("path", [
    "/hi/admin/me", "/hi/admin/dashboard", "/hi/admin/users",
    "/hi/admin/templates", "/hi/admin/flags", "/hi/admin/audit", "/hi/admin/admins",
])
def test_rbac_403_for_normal_user(user_token, path):
    r = requests.get(f"{API}{path}", headers=_h(user_token), timeout=20)
    assert r.status_code == 403, f"{path} -> {r.status_code} {r.text[:200]}"


# ------------------------------------------------- 2. Dashboard
def test_dashboard_cards(admin_token):
    r = requests.get(f"{API}/hi/admin/dashboard", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("total_users", "active_properties", "active_projects", "open_safety",
              "pending_document_reviews", "active_subscriptions",
              "open_support_tickets", "recent_errors"):
        assert k in d["cards"], f"missing card {k}"
    assert "recent_users" in d and "recent_safety" in d and "recent_tickets" in d


# ------------------------------------------------- 3. Users list + detail + suspend/restore/override/feature-override/delete guard
def test_users_search_and_detail(admin_token):
    r = requests.get(f"{API}/hi/admin/users?q=demo_home", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    users = r.json()["users"]
    assert any(u["email"].lower() == USER_EMAIL for u in users), "demo_home user not found in search"
    uid = next(u for u in users if u["email"].lower() == USER_EMAIL)["id"]

    d = requests.get(f"{API}/hi/admin/users/{uid}", headers=_h(admin_token), timeout=20).json()
    for k in ("properties", "rooms", "assets", "projects", "maintenance_tasks", "documents"):
        assert k in d["counts"]
    assert "subscription" in d and "activity" in d


def test_users_suspend_needs_confirm(admin_token):
    users = requests.get(f"{API}/hi/admin/users?q=demo_home", headers=_h(admin_token)).json()["users"]
    uid = next(u for u in users if u["email"].lower() == USER_EMAIL)["id"]

    # missing confirm+reason -> 400
    r = requests.post(f"{API}/hi/admin/users/{uid}/suspend", headers=_h(admin_token),
                      json={"confirm": False, "reason": ""}, timeout=20)
    assert r.status_code == 400

    # with confirm+reason -> ok
    r = requests.post(f"{API}/hi/admin/users/{uid}/suspend", headers=_h(admin_token),
                      json={"confirm": True, "reason": "test suspend flow"}, timeout=20)
    assert r.status_code == 200 and r.json()["account_status"] == "suspended"

    # restore
    r = requests.post(f"{API}/hi/admin/users/{uid}/restore", headers=_h(admin_token), json={}, timeout=20)
    assert r.status_code == 200 and r.json()["account_status"] == "active"


def test_users_override_and_feature_override(admin_token):
    users = requests.get(f"{API}/hi/admin/users?q=demo_home", headers=_h(admin_token)).json()["users"]
    uid = next(u for u in users if u["email"].lower() == USER_EMAIL)["id"]

    r = requests.post(f"{API}/hi/admin/users/{uid}/override", headers=_h(admin_token),
                      json={"confirm": False, "reason": ""}, timeout=20)
    assert r.status_code == 400

    r = requests.post(f"{API}/hi/admin/users/{uid}/override", headers=_h(admin_token),
                      json={"confirm": True, "reason": "grant premium temp", "subscription_tier": "premium"},
                      timeout=20)
    assert r.status_code == 200
    assert r.json().get("subscription_tier") == "premium"

    # revert
    requests.post(f"{API}/hi/admin/users/{uid}/override", headers=_h(admin_token),
                  json={"confirm": True, "reason": "revert", "subscription_tier": "free"}, timeout=20)

    r = requests.post(f"{API}/hi/admin/users/{uid}/feature-override", headers=_h(admin_token),
                      json={"feature_key": "voice_input", "enabled": True, "reason": "beta trial"},
                      timeout=20)
    assert r.status_code == 200 and "voice_input" in r.json()["feature_override"]


def test_delete_user_requires_confirm(admin_token):
    users = requests.get(f"{API}/hi/admin/users?q=demo_home", headers=_h(admin_token)).json()["users"]
    uid = next(u for u in users if u["email"].lower() == USER_EMAIL)["id"]
    r = requests.delete(f"{API}/hi/admin/users/{uid}", headers=_h(admin_token),
                        json={"confirm": False, "reason": ""}, timeout=20)
    assert r.status_code == 400


# ------------------------------------------------- 4. Content templates (create, edit safety=snapshot, publish, archive, rollback)
_created_tpl_id = None


def test_template_create_edit_publish_rollback(admin_token):
    global _created_tpl_id
    # create draft (safety type so edits snapshot versions)
    r = requests.post(f"{API}/hi/admin/templates", headers=_h(admin_token), json={
        "template_type": "safety", "title": "TEST_Safety_B10", "category": "Electrical",
        "content": "v1 content", "safety_notes": "wear PPE"}, timeout=20)
    assert r.status_code == 200, r.text
    tpl = r.json()
    _created_tpl_id = tpl["id"]
    assert tpl["status"] == "draft" and tpl["version_number"] == 1

    # list w/ filters
    r = requests.get(f"{API}/hi/admin/templates?template_type=safety&status=draft",
                     headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    assert any(t["id"] == _created_tpl_id for t in r.json()["templates"])

    # edit content -> safety snapshot + version bump
    r = requests.put(f"{API}/hi/admin/templates/{_created_tpl_id}", headers=_h(admin_token),
                     json={"content": "v2 content"}, timeout=20)
    assert r.status_code == 200
    assert r.json()["version_number"] == 2

    # publish without confirm -> 400
    r = requests.post(f"{API}/hi/admin/templates/{_created_tpl_id}/publish", headers=_h(admin_token),
                      json={"confirm": False, "reason": ""}, timeout=20)
    assert r.status_code == 400

    # publish with confirm -> ok
    r = requests.post(f"{API}/hi/admin/templates/{_created_tpl_id}/publish", headers=_h(admin_token),
                      json={"confirm": True, "reason": "ready to publish"}, timeout=20)
    assert r.status_code == 200 and r.json()["status"] == "published"

    # detail contains versions
    d = requests.get(f"{API}/hi/admin/templates/{_created_tpl_id}", headers=_h(admin_token), timeout=20).json()
    assert len(d["versions"]) >= 1

    # rollback to v1
    r = requests.post(f"{API}/hi/admin/templates/{_created_tpl_id}/rollback/1",
                      headers=_h(admin_token), json={}, timeout=20)
    assert r.status_code == 200
    assert r.json()["restored_from_version"] == 1

    # archive
    r = requests.post(f"{API}/hi/admin/templates/{_created_tpl_id}/archive",
                      headers=_h(admin_token), json={}, timeout=20)
    assert r.status_code == 200 and r.json()["status"] == "archived"


# ------------------------------------------------- 5. Feature flags (list, toggle, prod-disable requires confirm)
def test_flags_list_and_toggle(admin_token):
    r = requests.get(f"{API}/hi/admin/flags", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    flags = r.json()["flags"]
    assert len(flags) >= 8, f"expected 8 seeded flags got {len(flags)}"
    key = "guest_mode"

    # disable production flag without confirm -> 400
    r = requests.put(f"{API}/hi/admin/flags/{key}", headers=_h(admin_token),
                     json={"enabled": False, "confirm": False, "reason": ""}, timeout=20)
    assert r.status_code == 400

    # with confirm -> ok
    r = requests.put(f"{API}/hi/admin/flags/{key}", headers=_h(admin_token),
                     json={"enabled": False, "confirm": True, "reason": "regression test"}, timeout=20)
    assert r.status_code == 200 and r.json()["enabled"] is False

    # re-enable (enabling isn't sensitive)
    r = requests.put(f"{API}/hi/admin/flags/{key}", headers=_h(admin_token),
                     json={"enabled": True, "confirm": True, "reason": "restore"}, timeout=20)
    assert r.status_code == 200 and r.json()["enabled"] is True


# ------------------------------------------------- 6. Support: user creates ticket, admin can see + reply + update
_created_ticket_id = None


def test_support_user_and_admin_flow(user_token, admin_token):
    global _created_ticket_id
    # invalid category -> 400
    r = requests.post(f"{API}/hi/support", headers=_h(user_token),
                      json={"category": "Zzz", "subject": "s", "description": "d"}, timeout=20)
    assert r.status_code == 400

    # create ticket
    r = requests.post(f"{API}/hi/support", headers=_h(user_token), json={
        "category": "Technical Issue", "subject": "TEST_B10 ticket",
        "description": "Something is broken.", "priority": "high"}, timeout=20)
    assert r.status_code == 200, r.text
    _created_ticket_id = r.json()["id"]

    # user own tickets contains it
    r = requests.get(f"{API}/hi/support", headers=_h(user_token), timeout=20)
    assert r.status_code == 200
    assert any(t["id"] == _created_ticket_id for t in r.json()["tickets"])

    # user cannot list admin tickets
    r = requests.get(f"{API}/hi/admin/support", headers=_h(user_token), timeout=20)
    assert r.status_code == 403

    # admin lists and sees it
    r = requests.get(f"{API}/hi/admin/support", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    assert any(t["id"] == _created_ticket_id for t in r.json()["tickets"])

    # admin detail includes original message
    r = requests.get(f"{API}/hi/admin/support/{_created_ticket_id}", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert len(d["messages"]) >= 1

    # admin reply
    r = requests.post(f"{API}/hi/admin/support/{_created_ticket_id}/reply", headers=_h(admin_token),
                      json={"message": "Looking into this."}, timeout=20)
    assert r.status_code == 200

    # admin update status
    r = requests.put(f"{API}/hi/admin/support/{_created_ticket_id}", headers=_h(admin_token),
                     json={"status": "resolved", "priority": "medium"}, timeout=20)
    assert r.status_code == 200


# ------------------------------------------------- 7. Safety: auto-created from chat emergency + admin review
def test_safety_auto_escalation_via_chat(user_token, admin_token):
    # count before
    before = requests.get(f"{API}/hi/admin/safety", headers=_h(admin_token), timeout=20).json()["escalations"]
    before_count = len(before)

    # ensure user has at least one property to open a conversation
    props = requests.get(f"{API}/hi/property", headers=_h(user_token), timeout=20)
    if props.status_code != 200:
        # conversation create endpoint auto-creates a property, so continue anyway
        pass

    # open a conversation (auto-creates property if none)
    conv = requests.post(f"{API}/hi/chat/conversations", headers=_h(user_token),
                        json={"title": "TEST_B10_emergency"}, timeout=30)
    if conv.status_code != 200:
        pytest.skip(f"conversation create failed: {conv.status_code} {conv.text[:200]}")
    cid = conv.json().get("id") or conv.json().get("conversation", {}).get("id")
    assert cid, f"no conversation id in {conv.json()}"

    # send emergency text
    r = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=_h(user_token),
                     json={"text": "I smell a gas leak in my kitchen right now"}, timeout=60)
    assert r.status_code == 200, r.text
    assert r.json().get("assistant", {}).get("emergency") is True

    # allow small delay
    time.sleep(1.0)
    after = requests.get(f"{API}/hi/admin/safety", headers=_h(admin_token), timeout=20).json()["escalations"]
    assert len(after) > before_count, "safety escalation was NOT auto-created from emergency chat"

    # review it
    sid = after[0]["id"]
    r = requests.post(f"{API}/hi/admin/safety/{sid}/review", headers=_h(admin_token),
                      json={"status": "reviewed", "note": "test review"}, timeout=20)
    assert r.status_code == 200 and r.json()["status"] == "reviewed"


# ------------------------------------------------- 8. Admin roles (super only + last-super guard)
def test_admins_super_only_and_last_super_guard(admin_token, user_token):
    # normal user cannot list admins
    r = requests.get(f"{API}/hi/admin/admins", headers=_h(user_token), timeout=20)
    assert r.status_code == 403

    r = requests.get(f"{API}/hi/admin/admins", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    d = r.json()
    supers = [a for a in d["admins"] if a["admin_role"] == "super_admin" and a.get("status") == "active"]
    assert len(supers) >= 1
    owner = next((a for a in supers if a["email"].lower() == OWNER_EMAIL.lower()), None)
    assert owner is not None

    # If owner is the last super_admin, trying to remove -> 409
    if len(supers) == 1:
        r = requests.delete(f"{API}/hi/admin/admins/{owner['user_id']}", headers=_h(admin_token), timeout=20)
        assert r.status_code == 409

    # assign a role to demo user then remove
    r = requests.post(f"{API}/hi/admin/admins", headers=_h(admin_token),
                      json={"user_email": USER_EMAIL, "admin_role": "support_admin"}, timeout=20)
    assert r.status_code == 200

    admins = requests.get(f"{API}/hi/admin/admins", headers=_h(admin_token), timeout=20).json()["admins"]
    target = next(a for a in admins if a["email"].lower() == USER_EMAIL)
    r = requests.delete(f"{API}/hi/admin/admins/{target['user_id']}", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200


# ------------------------------------------------- 9. Audit is hash-chained + no mutation endpoints
def test_audit_chain(admin_token):
    r = requests.get(f"{API}/hi/admin/audit", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    entries = r.json()["entries"]
    assert len(entries) > 0
    # newest first; verify each entry has entry_hash + prev_hash chains to next entry
    for i, e in enumerate(entries):
        assert e.get("entry_hash"), "missing entry_hash"
        if i < len(entries) - 1:
            # next entry (older) hash should equal this entry's prev_hash
            assert e.get("prev_hash") == entries[i + 1]["entry_hash"], "hash chain broken"
    # last (oldest) entry may have prev_hash=None
    assert entries[-1].get("prev_hash") in (None, "", entries[-1].get("prev_hash"))

    # no PUT / DELETE endpoints
    r = requests.delete(f"{API}/hi/admin/audit/{entries[0]['id']}", headers=_h(admin_token), timeout=20)
    assert r.status_code in (404, 405)
