"""Backend tests for Sheet #26 — Neighborhood Community & Peer Project Exchange.

Covers:
- Opt-in flow and /auth/me reflection of neighborhood_optin/neighborhood_tag.
- /neighborhood overview (impact, feed, neighbors[] with trusted).
- Posts CRUD + kind filter + removal of hidden internal fields.
- Offer flow (cross-user): self-offer 400, duplicate 400, author vs non-author visibility.
- Contact reveal privacy (mutual reveal only; third user never sees emails; non-author 403).
- Resolve (only author, others 403).
- Flag idempotent.
- Admin moderation: flags list, remove hides post, dismiss clears flags. 403 for non-admin.
"""
import os
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
    or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
)
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = "diyhomie1122"
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = "Test1234"

CITY = "Austin, TX"


# ------------------------------------------------------------------ helpers
def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(api, email, password):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _register_neighbor(api, city=CITY):
    """Create a fresh user, set location to Austin, TX, and opt them in."""
    email = f"TEST_nb_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "Test1234", "name": f"TEST_NB {uuid.uuid4().hex[:4]}"},
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    # set location
    rp = api.put(f"{BASE_URL}/api/profile", json={"location": city}, headers=_h(token))
    assert rp.status_code == 200, rp.text
    # opt in
    rj = api.post(f"{BASE_URL}/api/neighborhood/join", json={"optin": True}, headers=_h(token))
    assert rj.status_code == 200, rj.text
    return email, token


# ------------------------------------------------------------------ fixtures
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api):
    return _login(api, ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="session")
def demo_token(api):
    token = _login(api, DEMO_EMAIL, DEMO_PASS)
    # ensure demo is opted in and located in Austin (idempotent)
    api.put(f"{BASE_URL}/api/profile", json={"location": CITY}, headers=_h(token))
    api.post(f"{BASE_URL}/api/neighborhood/join", json={"optin": True}, headers=_h(token))
    return token


@pytest.fixture(scope="session")
def user_a(api):
    """A fresh Austin neighbor (author of help posts)."""
    email, token = _register_neighbor(api)
    return {"email": email, "token": token}


@pytest.fixture(scope="session")
def user_b(api):
    """A fresh Austin neighbor (offerer)."""
    email, token = _register_neighbor(api)
    return {"email": email, "token": token}


@pytest.fixture(scope="session")
def user_c(api):
    """A third fresh Austin neighbor (must never see contact emails)."""
    email, token = _register_neighbor(api)
    return {"email": email, "token": token}


# ------------------------------------------------------------------ 1. opt-in flow
class TestOptInFlow:
    def test_join_reflects_in_me(self, api, demo_token):
        # ensure opted in
        r = api.post(
            f"{BASE_URL}/api/neighborhood/join",
            json={"optin": True},
            headers=_h(demo_token),
        )
        assert r.status_code == 200
        data = r.json()
        assert data["optin"] is True
        assert data["neighborhood_tag"] and data["neighborhood_tag"].lower().startswith("austin")

        me = api.get(f"{BASE_URL}/api/auth/me", headers=_h(demo_token))
        assert me.status_code == 200
        body = me.json()
        assert body["neighborhood_optin"] is True
        assert body["neighborhood_tag"].lower().startswith("austin")

    def test_join_without_location_400(self, api):
        # register a brand new user, do NOT set location, try to join → 400
        email = f"TEST_noloc_{uuid.uuid4().hex[:6]}@diyhomie.com"
        r = api.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "Test1234", "name": "TEST_NoLoc"},
        )
        assert r.status_code == 200
        token = r.json()["access_token"]
        rj = api.post(
            f"{BASE_URL}/api/neighborhood/join",
            json={"optin": True},
            headers=_h(token),
        )
        assert rj.status_code == 400
        assert "location" in rj.text.lower() or "profile" in rj.text.lower()

        # me should reflect optin False + empty tag (since no location)
        me = api.get(f"{BASE_URL}/api/auth/me", headers=_h(token))
        assert me.status_code == 200
        assert me.json()["neighborhood_optin"] is False
        assert me.json()["neighborhood_tag"] == ""


# ------------------------------------------------------------------ 2. overview shape
class TestOverview:
    def test_overview_shape_for_opted_in(self, api, demo_token):
        r = api.get(f"{BASE_URL}/api/neighborhood", headers=_h(demo_token))
        assert r.status_code == 200
        d = r.json()
        for k in ("optin", "has_location", "neighborhood_tag", "impact", "feed", "neighbors"):
            assert k in d, f"missing {k}"
        assert d["optin"] is True
        assert d["has_location"] is True
        assert d["neighborhood_tag"].lower().startswith("austin")
        assert isinstance(d["feed"], list)
        assert isinstance(d["neighbors"], list)
        # impact must have the four counters when opted in
        im = d["impact"]
        assert im is not None
        for k in ("members", "homes_month", "saved_total_cents", "total_projects"):
            assert k in im
            assert isinstance(im[k], int)
        assert im["members"] >= 1
        # neighbors items must expose 'trusted' bool
        if d["neighbors"]:
            n0 = d["neighbors"][0]
            assert isinstance(n0.get("trusted"), bool)
            assert "name" in n0

    def test_overview_shape_for_no_location_user(self, api):
        # brand-new user with no location, no opt-in
        email = f"TEST_ovnoloc_{uuid.uuid4().hex[:6]}@diyhomie.com"
        r = api.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "Test1234", "name": "TEST_OvNoLoc"},
        )
        token = r.json()["access_token"]
        rr = api.get(f"{BASE_URL}/api/neighborhood", headers=_h(token))
        assert rr.status_code == 200
        d = rr.json()
        assert d["optin"] is False
        assert d["has_location"] is False
        assert d["impact"] is None
        assert d["feed"] == []
        assert d["neighbors"] == []


# ------------------------------------------------------------------ 3. posts CRUD + kind filter
class TestPostsCRUD:
    def test_create_and_filter_by_kind(self, api, user_a):
        token = user_a["token"]
        created_ids = {}
        for kind in ("help", "qa", "spotlight"):
            r = api.post(
                f"{BASE_URL}/api/neighborhood/posts",
                json={"kind": kind, "title": f"TEST_{kind}_{uuid.uuid4().hex[:6]}", "body": f"body-{kind}"},
                headers=_h(token),
            )
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["kind"] == kind
            assert d["is_mine"] is True
            # public shape must NOT leak internal fields
            for internal in ("user_id", "neighborhood_key", "removed", "flags"):
                assert internal not in d, f"internal field {internal} leaked: {d}"
            created_ids[kind] = d["id"]

        # filter by kind returns only that kind
        for kind, pid in created_ids.items():
            r = api.get(f"{BASE_URL}/api/neighborhood/posts?kind={kind}", headers=_h(token))
            assert r.status_code == 200
            rows = r.json()
            kinds_returned = {p["kind"] for p in rows}
            assert kinds_returned == {kind}, f"filter leak: got {kinds_returned}"
            assert any(p["id"] == pid for p in rows)
            for p in rows:
                for internal in ("user_id", "neighborhood_key", "removed", "flags"):
                    assert internal not in p, f"internal field {internal} leaked in list: {p}"

    def test_invalid_kind_400(self, api, user_a):
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts",
            json={"kind": "garbage", "title": "TEST_bad_kind"},
            headers=_h(user_a["token"]),
        )
        assert r.status_code == 400

    def test_empty_title_400(self, api, user_a):
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts",
            json={"kind": "help", "title": "   "},
            headers=_h(user_a["token"]),
        )
        assert r.status_code == 400


# ------------------------------------------------------------------ 4. offer flow (cross-user)
@pytest.fixture(scope="module")
def help_post_id(api, user_a):
    r = api.post(
        f"{BASE_URL}/api/neighborhood/posts",
        json={"kind": "help", "title": f"TEST_help_{uuid.uuid4().hex[:6]}", "body": "borrow a drill"},
        headers=_h(user_a["token"]),
    )
    assert r.status_code == 200
    return r.json()["id"]


class TestOfferFlow:
    def test_author_cannot_offer_on_own_post(self, api, user_a, help_post_id):
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts/{help_post_id}/offer",
            json={"body": "me"},
            headers=_h(user_a["token"]),
        )
        assert r.status_code == 400

    def test_neighbor_can_offer(self, api, user_b, help_post_id):
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts/{help_post_id}/offer",
            json={"body": "I have one you can borrow Sat AM"},
            headers=_h(user_b["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_duplicate_offer_400(self, api, user_b, help_post_id):
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts/{help_post_id}/offer",
            json={"body": "again"},
            headers=_h(user_b["token"]),
        )
        assert r.status_code == 400

    def test_author_sees_offer_count_and_offers(self, api, user_a, help_post_id):
        r = api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_a["token"]))
        assert r.status_code == 200
        posts = {p["id"]: p for p in r.json()}
        p = posts[help_post_id]
        assert p["offer_count"] >= 1
        assert len(p["offers"]) == p["offer_count"]
        # Author sees offers but emails should be None (not revealed yet)
        for o in p["offers"]:
            assert o["contact_shared"] is False
            assert o["author_email"] is None
            assert o["offerer_email"] is None

    def test_non_author_never_sees_emails_before_reveal(self, api, user_c, help_post_id):
        r = api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_c["token"]))
        assert r.status_code == 200
        posts = {p["id"]: p for p in r.json()}
        p = posts[help_post_id]
        # Non-author must see NO emails
        for o in p["offers"]:
            assert o["author_email"] is None
            assert o["offerer_email"] is None


# ------------------------------------------------------------------ 5. contact reveal privacy
class TestContactReveal:
    def test_non_author_reveal_403(self, api, user_b, user_a, help_post_id):
        # user_b (offerer) tries to reveal — should be 403 (only author)
        # find their own offer_id
        posts = api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_a["token"])).json()
        p = next(x for x in posts if x["id"] == help_post_id)
        offer_id = p["offers"][0]["id"]
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts/{help_post_id}/reveal/{offer_id}",
            headers=_h(user_b["token"]),
        )
        assert r.status_code == 403

    def test_author_reveal_shares_email_only_to_two_parties(self, api, user_a, user_b, user_c, help_post_id):
        # get offer_id
        posts = api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_a["token"])).json()
        p = next(x for x in posts if x["id"] == help_post_id)
        offer_id = p["offers"][0]["id"]

        # author reveals
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts/{help_post_id}/reveal/{offer_id}",
            headers=_h(user_a["token"]),
        )
        assert r.status_code == 200

        # Author (A) sees offerer_email
        pa = next(x for x in api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_a["token"])).json() if x["id"] == help_post_id)
        oa = next(o for o in pa["offers"] if o["id"] == offer_id)
        assert oa["contact_shared"] is True
        assert oa["offerer_email"] == user_b["email"].lower()
        # author viewing their own post — author_email in the offer maps to the post author (A)
        assert oa["author_email"] == user_a["email"].lower()

        # Offerer (B) sees author_email
        pb = next(x for x in api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_b["token"])).json() if x["id"] == help_post_id)
        ob = next(o for o in pb["offers"] if o["id"] == offer_id)
        assert ob["contact_shared"] is True
        assert ob["author_email"] == user_a["email"].lower()
        assert ob["offerer_email"] == user_b["email"].lower()

        # THIRD user (C) must NEVER see any email
        pc = next(x for x in api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_c["token"])).json() if x["id"] == help_post_id)
        oc = next(o for o in pc["offers"] if o["id"] == offer_id)
        assert oc["contact_shared"] is True
        assert oc["author_email"] is None, f"third-user email leak: {oc}"
        assert oc["offerer_email"] is None, f"third-user email leak: {oc}"


# ------------------------------------------------------------------ 6. resolve
class TestResolve:
    def test_non_author_resolve_403(self, api, user_b, help_post_id):
        r = api.post(f"{BASE_URL}/api/neighborhood/posts/{help_post_id}/resolve", headers=_h(user_b["token"]))
        assert r.status_code == 403

    def test_author_resolve_ok(self, api, user_a, help_post_id):
        r = api.post(f"{BASE_URL}/api/neighborhood/posts/{help_post_id}/resolve", headers=_h(user_a["token"]))
        assert r.status_code == 200
        # verify persisted
        p = next(x for x in api.get(f"{BASE_URL}/api/neighborhood/posts?kind=help", headers=_h(user_a["token"])).json() if x["id"] == help_post_id)
        assert p["resolved"] is True


# ------------------------------------------------------------------ 7. flag idempotency
class TestFlag:
    def test_flag_and_idempotent(self, api, user_a, user_c):
        # user_a authors a spotlight; user_c flags twice
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts",
            json={"kind": "spotlight", "title": f"TEST_flag_{uuid.uuid4().hex[:6]}", "body": "flag me"},
            headers=_h(user_a["token"]),
        )
        assert r.status_code == 200
        pid = r.json()["id"]

        r1 = api.post(f"{BASE_URL}/api/neighborhood/posts/{pid}/flag", json={"reason": "test"}, headers=_h(user_c["token"]))
        assert r1.status_code == 200
        assert r1.json().get("ok") is True

        r2 = api.post(f"{BASE_URL}/api/neighborhood/posts/{pid}/flag", json={"reason": "again"}, headers=_h(user_c["token"]))
        assert r2.status_code == 200
        assert r2.json().get("already") is True


# ------------------------------------------------------------------ 8. admin moderation
class TestAdminModeration:
    def test_non_admin_flags_403(self, api, demo_token):
        r = api.get(f"{BASE_URL}/api/admin/neighborhood/flags", headers=_h(demo_token))
        assert r.status_code == 403

    def test_admin_flags_list_and_remove_and_dismiss(self, api, admin_token, user_a, user_c):
        # create a flagged post
        r = api.post(
            f"{BASE_URL}/api/neighborhood/posts",
            json={"kind": "spotlight", "title": f"TEST_mod_{uuid.uuid4().hex[:6]}", "body": "mod"},
            headers=_h(user_a["token"]),
        )
        pid = r.json()["id"]
        rf = api.post(f"{BASE_URL}/api/neighborhood/posts/{pid}/flag", json={"reason": "abuse"}, headers=_h(user_c["token"]))
        assert rf.status_code == 200

        rl = api.get(f"{BASE_URL}/api/admin/neighborhood/flags", headers=_h(admin_token))
        assert rl.status_code == 200
        rows = rl.json()
        assert any(x["id"] == pid for x in rows), "flagged post not in admin flags list"
        row = next(x for x in rows if x["id"] == pid)
        assert row["flag_count"] >= 1
        assert row["neighborhood"].lower().startswith("austin")

        # dismiss clears flags
        rd = api.post(f"{BASE_URL}/api/admin/neighborhood/posts/{pid}/dismiss", headers=_h(admin_token))
        assert rd.status_code == 200
        rl2 = api.get(f"{BASE_URL}/api/admin/neighborhood/flags", headers=_h(admin_token))
        assert not any(x["id"] == pid for x in rl2.json()), "post still in flags after dismiss"

        # create another and remove it → should be hidden from public list
        r2 = api.post(
            f"{BASE_URL}/api/neighborhood/posts",
            json={"kind": "spotlight", "title": f"TEST_remove_{uuid.uuid4().hex[:6]}", "body": "removeme"},
            headers=_h(user_a["token"]),
        )
        pid2 = r2.json()["id"]
        rr = api.post(f"{BASE_URL}/api/admin/neighborhood/posts/{pid2}/remove", headers=_h(admin_token))
        assert rr.status_code == 200
        # user_a should no longer see this post in the public list
        public = api.get(f"{BASE_URL}/api/neighborhood/posts?kind=spotlight", headers=_h(user_a["token"])).json()
        assert not any(x["id"] == pid2 for x in public), "removed post still returned in public list"

    def test_admin_remove_404(self, api, admin_token):
        r = api.post(f"{BASE_URL}/api/admin/neighborhood/posts/does-not-exist/remove", headers=_h(admin_token))
        assert r.status_code == 404
