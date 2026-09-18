"""Blueprint 20 — Home Knowledge Graph & Document Intelligence.

Verifies: seeded global retrieval + citations, entity + relationships/assertions,
contribute privacy isolation (share_public=false stays private, share_public=true
goes to admin review not global), admin dashboard/review-queue/publish/reject/archive,
lineage, versions/rollback, sources CRUD, admin auth guards (401/403).
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

USER_EMAIL = "demo_home@diyhomie.com"
USER_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {email} → {r.status_code} {r.text}"
    return r.json()["access_token"], r.json()["user"]


@pytest.fixture(scope="session")
def user_auth():
    t, u = _login(USER_EMAIL, USER_PASS)
    return {"token": t, "user": u, "headers": {"Authorization": f"Bearer {t}"}}


@pytest.fixture(scope="session")
def admin_auth():
    t, u = _login(ADMIN_EMAIL, ADMIN_PASS)
    return {"token": t, "user": u, "headers": {"Authorization": f"Bearer {t}"}}


# Try to obtain a second user (for isolation test). Fall back to admin as "other".
@pytest.fixture(scope="session")
def other_user_auth(admin_auth):
    email = f"TEST_kg_other_{uuid.uuid4().hex[:8]}@example.com"
    pw = __import__("os").environ.get("TEST_USER_PASSWORD", "") + "!"
    reg = requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "TEST KG Other"}, timeout=30)
    if reg.status_code in (200, 201):
        j = reg.json()
        return {"token": j["access_token"], "user": j["user"], "headers": {"Authorization": f"Bearer {j['access_token']}"}}
    # Otherwise use admin as the "different-user" (still different from demo_home)
    return admin_auth


# ------------------------------------------------------------- retrieval
class TestRetrieval:
    def test_retrieve_paint_returns_seeded_global_with_citations(self, user_auth):
        r = requests.post(f"{API}/hi/knowledge/retrieve",
                          json={"query": "how to paint a wall"},
                          headers=user_auth["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["query"] == "how to paint a wall"
        assert j["count"] >= 1
        titles = [rr["canonical_name"] for rr in j["results"]]
        assert any("Paint" in t or "paint" in t.lower() for t in titles), titles
        # Every result must expose visibility + source_references
        for rr in j["results"]:
            assert rr["visibility"] == "global"
            assert isinstance(rr.get("source_references"), list)
        # At least one result must carry a source_reference with a title
        assert any(rr.get("source_references") and rr["source_references"][0].get("title")
                   for rr in j["results"])
        # And carry assertions on the procedure or warning
        assert any(rr.get("assertions") for rr in j["results"])

    def test_retrieve_requires_auth(self):
        r = requests.post(f"{API}/hi/knowledge/retrieve", json={"query": "paint"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_get_entity_returns_relationships_and_source(self, user_auth):
        r = requests.post(f"{API}/hi/knowledge/retrieve",
                          json={"query": "paint wall"},
                          headers=user_auth["headers"], timeout=30)
        assert r.status_code == 200
        proc = next((rr for rr in r.json()["results"] if rr["entity_type"] == "procedure"), None)
        assert proc, "seeded procedure not returned"
        eid = proc["entity_id"]
        r2 = requests.get(f"{API}/hi/knowledge/entity/{eid}", headers=user_auth["headers"], timeout=30)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["entity"]["id"] == eid
        rel_types = {x["relationship_type"] for x in d["relationships"]}
        assert {"requires_material", "requires_tool", "governed_by_warning"}.issubset(rel_types), rel_types
        assert d["source"] and d["source"]["title"]
        assert isinstance(d["assertions"], list)


# ------------------------------------------------------------- contribute privacy
class TestContributePrivacy:
    def test_private_contribution_not_global(self, user_auth):
        title = f"TEST_KG_private_{uuid.uuid4().hex[:8]}"
        body = {"title": title, "entity_type": "procedure",
                "description": "TEST private procedure only for demo_home privacyisolationsecret",
                "share_public": False}
        r = requests.post(f"{API}/hi/knowledge/contribute", json=body, headers=user_auth["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["entity"]["status"] == "draft"
        assert j["entity"]["visibility"] == "private_user"
        assert j["submitted_for_review"] is False
        # Retrievable by owner
        r2 = requests.post(f"{API}/hi/knowledge/retrieve",
                           json={"query": "privacyisolationsecret"},
                           headers=user_auth["headers"], timeout=30)
        titles = [x["canonical_name"] for x in r2.json()["results"]]
        assert title in titles, f"owner cannot retrieve own private entity: {titles}"

    def test_private_entity_isolated_from_other_user(self, user_auth, other_user_auth):
        secret = f"PRIVSECRET{uuid.uuid4().hex[:6]}".lower()
        title = f"TEST_KG_iso_{uuid.uuid4().hex[:8]}"
        body = {"title": title, "entity_type": "procedure",
                "description": f"private entity with unique token {secret}",
                "share_public": False}
        r = requests.post(f"{API}/hi/knowledge/contribute", json=body, headers=user_auth["headers"], timeout=30)
        assert r.status_code == 200
        eid = r.json()["entity"]["id"]

        # Other user retrieval must NOT include it
        r2 = requests.post(f"{API}/hi/knowledge/retrieve",
                           json={"query": secret},
                           headers=other_user_auth["headers"], timeout=30)
        assert r2.status_code == 200
        titles = [x["canonical_name"] for x in r2.json()["results"]]
        assert title not in titles, f"PRIVACY LEAK: other user saw private entity {title}: {titles}"

        # Other user GET entity must be 403 or 404
        r3 = requests.get(f"{API}/hi/knowledge/entity/{eid}", headers=other_user_auth["headers"], timeout=30)
        assert r3.status_code in (403, 404), f"privacy leak on GET entity: {r3.status_code}"

    def test_share_public_goes_to_review_not_global(self, user_auth, other_user_auth):
        secret = f"REVIEWSECRET{uuid.uuid4().hex[:6]}".lower()
        title = f"TEST_KG_rev_{uuid.uuid4().hex[:8]}"
        body = {"title": title, "entity_type": "procedure",
                "description": f"submitted for review with token {secret}",
                "share_public": True}
        r = requests.post(f"{API}/hi/knowledge/contribute", json=body, headers=user_auth["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["submitted_for_review"] is True
        assert j["entity"]["status"] == "review"

        # Other user retrieval (global scope) must NOT see it — it isn't published yet.
        r2 = requests.post(f"{API}/hi/knowledge/retrieve",
                           json={"query": secret, "visibility_scope": "global"},
                           headers=other_user_auth["headers"], timeout=30)
        assert r2.status_code == 200
        titles = [x["canonical_name"] for x in r2.json()["results"]]
        assert title not in titles, f"in-review entity leaked as global: {titles}"


# ------------------------------------------------------------- admin
class TestAdmin:
    def test_admin_auth_guards(self, user_auth):
        # No token → 401/403
        r = requests.get(f"{API}/hi/admin/knowledge/dashboard", timeout=30)
        assert r.status_code in (401, 403)
        # Non-admin token → 403
        r2 = requests.get(f"{API}/hi/admin/knowledge/dashboard", headers=user_auth["headers"], timeout=30)
        assert r2.status_code == 403, f"non-admin got {r2.status_code}"

    def test_dashboard_counts(self, admin_auth):
        r = requests.get(f"{API}/hi/admin/knowledge/dashboard", headers=admin_auth["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("entities", "published", "in_review", "private", "sources", "relationships", "assertions"):
            assert k in j and isinstance(j[k], int)
        assert j["published"] >= 4  # seeded

    def test_review_queue_and_publish_flow(self, user_auth, admin_auth, other_user_auth):
        secret = f"PUBLISHSECRET{uuid.uuid4().hex[:6]}".lower()
        title = f"TEST_KG_pub_{uuid.uuid4().hex[:8]}"
        cr = requests.post(f"{API}/hi/knowledge/contribute",
                           json={"title": title, "entity_type": "procedure",
                                 "description": f"desc with token {secret}",
                                 "share_public": True},
                           headers=user_auth["headers"], timeout=30)
        assert cr.status_code == 200
        eid = cr.json()["entity"]["id"]
        base_version = cr.json()["entity"]["version_number"]

        # Queue includes it
        rq = requests.get(f"{API}/hi/admin/knowledge/review-queue", headers=admin_auth["headers"], timeout=30)
        assert rq.status_code == 200
        assert any(e["id"] == eid for e in rq.json()["entities"])

        # Publish
        rp = requests.post(f"{API}/hi/admin/knowledge/entities/{eid}/review",
                           json={"action": "publish"}, headers=admin_auth["headers"], timeout=30)
        assert rp.status_code == 200, rp.text
        pub = rp.json()
        assert pub["status"] == "published"
        assert pub["visibility"] == "global"
        assert pub["version_number"] == base_version + 1

        # Now retrievable globally by another user
        rr = requests.post(f"{API}/hi/knowledge/retrieve",
                           json={"query": secret, "visibility_scope": "global"},
                           headers=other_user_auth["headers"], timeout=30)
        titles = [x["canonical_name"] for x in rr.json()["results"]]
        assert title in titles, f"published entity not globally retrievable: {titles}"

        # Versions + rollback
        rv = requests.get(f"{API}/hi/admin/knowledge/entities/{eid}/versions", headers=admin_auth["headers"], timeout=30)
        assert rv.status_code == 200
        versions = rv.json()["versions"]
        assert len(versions) >= 1
        vnum = versions[-1]["version_number"]
        rb = requests.post(f"{API}/hi/admin/knowledge/entities/{eid}/rollback/{vnum}",
                           headers=admin_auth["headers"], timeout=30)
        assert rb.status_code == 200, rb.text

        # Lineage
        rl = requests.get(f"{API}/hi/admin/knowledge/entities/{eid}/lineage", headers=admin_auth["headers"], timeout=30)
        assert rl.status_code == 200, rl.text
        d = rl.json()
        assert d["entity"]["id"] == eid
        assert "source" in d and "assertions" in d and "excerpts" in d

    def test_reject_sends_back_to_private(self, user_auth, admin_auth):
        title = f"TEST_KG_rej_{uuid.uuid4().hex[:8]}"
        cr = requests.post(f"{API}/hi/knowledge/contribute",
                           json={"title": title, "entity_type": "procedure",
                                 "description": "rejection test payload",
                                 "share_public": True},
                           headers=user_auth["headers"], timeout=30)
        eid = cr.json()["entity"]["id"]
        rr = requests.post(f"{API}/hi/admin/knowledge/entities/{eid}/review",
                           json={"action": "reject"}, headers=admin_auth["headers"], timeout=30)
        assert rr.status_code == 200
        j = rr.json()
        assert j["status"] == "draft"
        assert j["visibility"] == "private_user"

    def test_archive_action(self, user_auth, admin_auth):
        title = f"TEST_KG_arc_{uuid.uuid4().hex[:8]}"
        cr = requests.post(f"{API}/hi/knowledge/contribute",
                           json={"title": title, "entity_type": "procedure",
                                 "description": "archive test payload",
                                 "share_public": True},
                           headers=user_auth["headers"], timeout=30)
        eid = cr.json()["entity"]["id"]
        rr = requests.post(f"{API}/hi/admin/knowledge/entities/{eid}/review",
                           json={"action": "archive"}, headers=admin_auth["headers"], timeout=30)
        assert rr.status_code == 200
        assert rr.json()["status"] == "archived"

    def test_create_source(self, admin_auth):
        title = f"TEST_KG_src_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/hi/admin/knowledge/sources",
                          json={"source_type": "approved_template", "title": title,
                                "reliability_rank": 82},
                          headers=admin_auth["headers"], timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["title"] == title
        assert s["reliability_rank"] == 82
        # Verify persistence
        r2 = requests.get(f"{API}/hi/admin/knowledge/sources", headers=admin_auth["headers"], timeout=30)
        assert r2.status_code == 200
        assert any(x["id"] == s["id"] for x in r2.json()["sources"])
