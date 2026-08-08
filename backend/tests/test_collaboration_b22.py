"""
Blueprint 22 — Property Collaboration, Roles & Shared Access.
Tests server-side authorization, invite tokens, membership lifecycle, and assignments.
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")

OWNER_EMAIL = "demo_home@diyhomie.com"
OWNER_PASSWORD = "Test1234"
INVITEE_EMAIL = "collab_test@diyhomie.com"
INVITEE_PASSWORD = "Test1234"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def invitee():
    return _login(INVITEE_EMAIL, INVITEE_PASSWORD)


@pytest.fixture(scope="module")
def stranger():
    # register a throwaway user for isolation tests
    email = f"TEST_stranger_{int(time.time())}@diyhomie.com"
    password = "Test1234"
    reg = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": password, "name": "Stranger Test",
    }, timeout=20)
    assert reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}"
    return _login(email, password)


@pytest.fixture(scope="module")
def owned_pid(owner):
    r = requests.get(f"{BASE_URL}/api/hi/collab/owned", headers=_headers(owner["access_token"]), timeout=15)
    assert r.status_code == 200
    props = r.json()["properties"]
    assert len(props) >= 1, "owner has no properties"
    return props[0]["id"]


class TestOwnerInviteFlow:
    def test_owned_lists_properties(self, owner):
        r = requests.get(f"{BASE_URL}/api/hi/collab/owned", headers=_headers(owner["access_token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "properties" in data and len(data["properties"]) >= 1
        p0 = data["properties"][0]
        for k in ("id", "name", "collaborators", "pending_invites"):
            assert k in p0

    def test_create_invite_returns_plaintext_token_once(self, owner, owned_pid):
        r = requests.post(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/invite",
                          headers=_headers(owner["access_token"]),
                          json={"invited_email": INVITEE_EMAIL, "invited_role": "editor"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "invite_token" in d and d["invite_token"]
        assert "accept_path" in d and d["accept_path"].startswith("/home-intel/collab/accept")
        assert d.get("invited_role") == "editor"
        # never expose token hash
        assert "invite_token_hash" not in d
        # save on class for downstream tests
        pytest.invite_token = d["invite_token"]
        pytest.invite_id = d["invite_id"]

    def test_list_invites_hides_hash(self, owner, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/invites",
                         headers=_headers(owner["access_token"]), timeout=15)
        assert r.status_code == 200
        invites = r.json()["invites"]
        assert any(iv["invited_email"] == INVITEE_EMAIL for iv in invites)
        for iv in invites:
            assert "invite_token_hash" not in iv
            assert "invite_token" not in iv


class TestServerSideAuthorization:
    """CRITICAL: non-owners MUST get 403 from owner-only endpoints regardless of UI."""

    def test_invitee_accept_flow(self, invitee, owned_pid):
        token = getattr(pytest, "invite_token", None)
        assert token, "must be created in previous test"
        r = requests.post(f"{BASE_URL}/api/hi/collab/invites/accept",
                          headers=_headers(invitee["access_token"]),
                          json={"invite_token": token}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["property_id"] == owned_pid
        assert d["role"] == "editor"

    def test_shared_with_me_shows_property(self, invitee, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/shared-with-me",
                         headers=_headers(invitee["access_token"]), timeout=15)
        assert r.status_code == 200
        props = r.json()["properties"]
        match = [p for p in props if p["property_id"] == owned_pid]
        assert match, "shared property missing from invitee's shared-with-me"
        assert match[0]["role"] == "editor"

    def test_my_permissions_returns_editor(self, invitee, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/my-permissions",
                         headers=_headers(invitee["access_token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "editor"
        assert d["is_owner"] is False
        assert isinstance(d["permissions"], list) and len(d["permissions"]) > 0

    def test_invitee_cannot_list_invites(self, invitee, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/invites",
                         headers=_headers(invitee["access_token"]), timeout=15)
        assert r.status_code == 403, f"non-owner should be 403, got {r.status_code}: {r.text}"

    def test_invitee_cannot_read_audit(self, invitee, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/audit",
                         headers=_headers(invitee["access_token"]), timeout=15)
        assert r.status_code == 403

    def test_invitee_cannot_invite(self, invitee, owned_pid):
        r = requests.post(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/invite",
                          headers=_headers(invitee["access_token"]),
                          json={"invited_email": "someone@example.com", "invited_role": "viewer"}, timeout=15)
        assert r.status_code == 403

    def test_stranger_no_permissions(self, stranger, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/my-permissions",
                         headers=_headers(stranger["access_token"]), timeout=15)
        assert r.status_code == 403


class TestTokenSecurity:
    def test_garbage_token_rejected(self, invitee):
        r = requests.post(f"{BASE_URL}/api/hi/collab/invites/accept",
                          headers=_headers(invitee["access_token"]),
                          json={"invite_token": "not-a-real-token-abc123"}, timeout=15)
        assert r.status_code == 400
        assert "no longer active" in r.text.lower()

    def test_stranger_cannot_change_role(self, owner, stranger, owned_pid):
        # find invitee's member id via owner's members endpoint
        r = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/members",
                         headers=_headers(owner["access_token"]), timeout=15)
        assert r.status_code == 200
        members = r.json()["members"]
        mine = [m for m in members if m.get("email") == INVITEE_EMAIL]
        assert mine, "invitee member not found"
        mid = mine[0]["id"]
        pytest.member_id = mid

        r2 = requests.put(f"{BASE_URL}/api/hi/collab/members/{mid}/role",
                          headers=_headers(stranger["access_token"]),
                          json={"role": "viewer"}, timeout=15)
        assert r2.status_code in (403, 404)

    def test_owner_can_change_role(self, owner):
        mid = getattr(pytest, "member_id")
        r = requests.put(f"{BASE_URL}/api/hi/collab/members/{mid}/role",
                         headers=_headers(owner["access_token"]),
                         json={"role": "viewer"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["role"] == "viewer"
        # restore to editor for downstream assignment tests
        requests.put(f"{BASE_URL}/api/hi/collab/members/{mid}/role",
                     headers=_headers(owner["access_token"]),
                     json={"role": "editor"}, timeout=15)


class TestAssignments:
    def test_owner_assigns_task(self, owner, invitee, owned_pid):
        r = requests.post(f"{BASE_URL}/api/hi/collab/assign",
                          headers=_headers(owner["access_token"]),
                          json={"property_id": owned_pid,
                                "task_entity_type": "maintenance_task",
                                "task_entity_id": "x-test-task",
                                "assigned_to_user_id": invitee["user"]["id"]}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["assigned_to_user_id"] == invitee["user"]["id"]
        assert d["status"] == "assigned"
        pytest.assignment_id = d["id"]

    def test_invitee_sees_assignment(self, invitee):
        r = requests.get(f"{BASE_URL}/api/hi/collab/my-assignments",
                         headers=_headers(invitee["access_token"]), timeout=15)
        assert r.status_code == 200
        rows = r.json()["assignments"]
        aid = getattr(pytest, "assignment_id")
        assert any(a["id"] == aid for a in rows), "assignment missing"

    def test_invitee_can_accept_assignment(self, invitee):
        aid = getattr(pytest, "assignment_id")
        r = requests.post(f"{BASE_URL}/api/hi/collab/assignments/{aid}/respond",
                          headers=_headers(invitee["access_token"]),
                          json={"status": "accepted"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"


class TestRemovalRevokesAccess:
    def test_owner_removes_member(self, owner):
        mid = getattr(pytest, "member_id")
        r = requests.post(f"{BASE_URL}/api/hi/collab/members/{mid}/remove",
                          headers=_headers(owner["access_token"]), timeout=15)
        assert r.status_code == 200

    def test_shared_with_me_no_longer_lists(self, invitee, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/shared-with-me",
                         headers=_headers(invitee["access_token"]), timeout=15)
        assert r.status_code == 200
        pids = [p["property_id"] for p in r.json()["properties"]]
        assert owned_pid not in pids, "removed member still sees property"

    def test_removed_member_permissions_403(self, invitee, owned_pid):
        r = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/my-permissions",
                         headers=_headers(invitee["access_token"]), timeout=15)
        assert r.status_code == 403


class TestInviteRevoke:
    def test_owner_creates_and_revokes_invite(self, owner, owned_pid):
        r = requests.post(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/invite",
                          headers=_headers(owner["access_token"]),
                          json={"invited_email": f"TEST_revoke_{int(time.time())}@diyhomie.com",
                                "invited_role": "viewer"}, timeout=15)
        assert r.status_code == 200
        iid = r.json()["invite_id"]
        rv = requests.post(f"{BASE_URL}/api/hi/collab/invites/{iid}/revoke",
                           headers=_headers(owner["access_token"]), timeout=15)
        assert rv.status_code == 200
        # verify status is revoked (invite no longer pending)
        li = requests.get(f"{BASE_URL}/api/hi/collab/properties/{owned_pid}/invites",
                          headers=_headers(owner["access_token"]), timeout=15)
        assert li.status_code == 200
        pending_ids = [x["id"] for x in li.json()["invites"]]
        assert iid not in pending_ids
