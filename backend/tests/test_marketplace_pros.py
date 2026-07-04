"""
Sheet #18 - Marketplace & Pro Service Integration
Covers: /pros list/filter/search, /pros/{id}, /pros/apply,
        /projects/{id}/handoff, /projects/{id}/pro-suggestion,
        /admin/pros CRUD, extended /pro-referrals with pro_id/project_summary.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"


# --- helpers ---

def _login(session: requests.Session, email: str, password: str) -> str:
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


def _register(session: requests.Session) -> tuple[str, str, str]:
    email = f"TEST_pros_{uuid.uuid4().hex[:8]}@diyhomie.com"
    password = "Test1234"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "TEST Pros"},
        timeout=15,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return email, password, tok


@pytest.fixture(scope="module")
def user_ctx():
    s = requests.Session()
    email, password, tok = _register(s)
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    yield {"session": s, "email": email, "token": tok}


@pytest.fixture(scope="module")
def admin_ctx():
    s = requests.Session()
    tok = _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    yield {"session": s, "token": tok}


# --- 1. Public directory (auth-gated) ---

class TestProsDirectory:
    def test_list_pros_returns_seeded_six(self, user_ctx):
        r = user_ctx["session"].get(f"{API}/pros")
        assert r.status_code == 200
        data = r.json()
        assert "pros" in data and "trades" in data
        # 6 seeded verified+active pros baseline (partners created via apply are not verified so hidden)
        assert len(data["pros"]) >= 6
        # every pro has expected public shape and no _id leak
        for p in data["pros"]:
            for k in ("id", "name", "trades", "specialties", "location", "rating", "verified"):
                assert k in p, f"missing {k} in {p}"
            assert "_id" not in p
            assert p["verified"] is True
        # trades list drives filter chips
        assert isinstance(data["trades"], list) and len(data["trades"]) >= 5

    def test_list_pros_filter_by_trade(self, user_ctx):
        r = user_ctx["session"].get(f"{API}/pros", params={"trade": "Electrical"})
        assert r.status_code == 200
        pros = r.json()["pros"]
        assert len(pros) >= 1
        assert all("Electrical" in p["trades"] for p in pros)

    def test_list_pros_search_q(self, user_ctx):
        # Search by specialty seeded on BrightSpark Electric
        r = user_ctx["session"].get(f"{API}/pros", params={"q": "EV chargers"})
        assert r.status_code == 200
        pros = r.json()["pros"]
        assert len(pros) >= 1
        assert any("BrightSpark" in p["name"] for p in pros)

    def test_list_pros_requires_auth(self):
        r = requests.get(f"{API}/pros", timeout=10)
        assert r.status_code in (401, 403)

    def test_get_pro_by_id_and_404(self, user_ctx):
        r = user_ctx["session"].get(f"{API}/pros")
        pid = r.json()["pros"][0]["id"]
        d = user_ctx["session"].get(f"{API}/pros/{pid}")
        assert d.status_code == 200
        assert d.json()["id"] == pid
        assert "_id" not in d.json()
        # unknown
        m = user_ctx["session"].get(f"{API}/pros/no-such-id")
        assert m.status_code == 404


# --- 2. Partner onboarding (apply) ---

class TestProApply:
    def test_apply_creates_pending_partner(self, user_ctx, admin_ctx):
        name = f"TEST_Apply_{uuid.uuid4().hex[:6]}"
        payload = {
            "name": name,
            "trades": ["Plumbing", "General Contractor"],
            "specialties": ["Water heaters"],
            "location": "Austin, TX",
            "bio": "Test bio for pytest",
            "phone": "555-0100",
            "email": "test-apply@example.com",
        }
        r = requests.post(f"{API}/pros/apply", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        pid = body["id"]

        # not listed publicly (verified=false, active=false)
        pub = user_ctx["session"].get(f"{API}/pros")
        assert not any(p["id"] == pid for p in pub.json()["pros"])

        # visible to admin
        adm = admin_ctx["session"].get(f"{API}/admin/pros")
        assert adm.status_code == 200
        items = adm.json()["items"]
        found = next((x for x in items if x["id"] == pid), None)
        assert found is not None
        assert found["verified"] is False
        assert found["active"] is False
        assert found["name"] == name

        # cleanup
        admin_ctx["session"].delete(f"{API}/admin/pros/{pid}")


# --- 3. Deep handoff + pro-suggestion (contextual banner) ---

class TestProjectHandoffAndSuggestion:
    @pytest.fixture(scope="class")
    def risky_project_id(self, user_ctx):
        # Create a project whose title triggers RISKY_KEYWORDS
        r = user_ctx["session"].post(
            f"{API}/projects",
            json={"title": "Upgrade electrical panel", "difficulty": "hard"},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        yield pid
        user_ctx["session"].delete(f"{API}/projects/{pid}")

    @pytest.fixture(scope="class")
    def safe_project_id(self, user_ctx):
        r = user_ctx["session"].post(
            f"{API}/projects",
            json={"title": "Paint a room", "difficulty": "easy"},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        yield pid
        user_ctx["session"].delete(f"{API}/projects/{pid}")

    def test_pro_suggestion_true_for_risky_title(self, user_ctx, risky_project_id):
        r = user_ctx["session"].get(f"{API}/projects/{risky_project_id}/pro-suggestion")
        assert r.status_code == 200
        body = r.json()
        assert body["suggest"] is True
        assert body["reason"]  # non-empty string
        assert body["suggested_trade"] == "Electrical"

    def test_pro_suggestion_false_for_safe_title(self, user_ctx, safe_project_id):
        r = user_ctx["session"].get(f"{API}/projects/{safe_project_id}/pro-suggestion")
        assert r.status_code == 200
        body = r.json()
        assert body["suggest"] is False

    def test_handoff_returns_summary(self, user_ctx, risky_project_id):
        r = user_ctx["session"].get(f"{API}/projects/{risky_project_id}/handoff")
        assert r.status_code == 200
        body = r.json()
        assert "summary" in body and isinstance(body["summary"], str)
        assert "Upgrade electrical panel" in body["summary"]
        assert body["project_title"] == "Upgrade electrical panel"
        assert "materials" in body

    def test_handoff_404_for_unknown(self, user_ctx):
        r = user_ctx["session"].get(f"{API}/projects/no-such-project/handoff")
        assert r.status_code == 404


# --- 4. Pro-referral with pro_id + project_summary deep handoff ---

class TestProReferralWithHandoff:
    def test_create_referral_with_pro_id_records_pro_name(self, user_ctx, admin_ctx):
        pros = user_ctx["session"].get(f"{API}/pros").json()["pros"]
        target = next((p for p in pros if "Electrical" in p["trades"]), pros[0])
        payload = {
            "trade": "Electrical",
            "issue": "TEST panel upgrade — 200A service to house",
            "location": "Austin, TX",
            "urgency": "planning",
            "pro_id": target["id"],
            "project_summary": "Project: Upgrade electrical panel\nCode note: permit required.",
        }
        r = user_ctx["session"].post(f"{API}/pro-referrals", json=payload)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead["pro_id"] == target["id"]
        assert lead["pro_name"] == target["name"]
        assert "panel" in (lead.get("project_summary") or "")

        # admin can see it with pro_name populated
        adm = admin_ctx["session"].get(f"{API}/admin/pro-leads")
        assert adm.status_code == 200
        items = adm.json()["items"]
        found = next((x for x in items if x["id"] == lead["id"]), None)
        assert found is not None
        assert found["pro_name"] == target["name"]
        assert found["project_summary"]


# --- 5. Admin partner CRUD ---

class TestAdminPartners:
    def test_admin_list_pros(self, admin_ctx):
        r = admin_ctx["session"].get(f"{API}/admin/pros")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 6
        for p in items:
            assert "_id" not in p

    def test_admin_gated_403_for_standard_user(self, user_ctx):
        r = user_ctx["session"].get(f"{API}/admin/pros")
        assert r.status_code in (401, 403)
        r2 = user_ctx["session"].get(f"{API}/admin/pro-leads")
        assert r2.status_code in (401, 403)

    def test_admin_toggle_verify_and_active_then_delete(self, admin_ctx, user_ctx):
        # create a fresh partner via admin
        payload = {
            "name": f"TEST_AdminPartner_{uuid.uuid4().hex[:6]}",
            "trades": ["Plumbing"], "specialties": ["Leaks"],
            "location": "Austin, TX", "bio": "b", "email": "a@b.com",
            "verified": False, "active": False, "rating": 4.5,
        }
        r = admin_ctx["session"].post(f"{API}/admin/pros", json=payload)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        # verify=true + active=true
        upd = {**payload, "verified": True, "active": True}
        pu = admin_ctx["session"].patch(f"{API}/admin/pros/{pid}", json=upd)
        assert pu.status_code == 200
        assert pu.json()["verified"] is True
        assert pu.json()["active"] is True

        # now shows in public /pros
        pub = user_ctx["session"].get(f"{API}/pros")
        assert any(p["id"] == pid for p in pub.json()["pros"])

        # hide
        upd2 = {**upd, "active": False}
        admin_ctx["session"].patch(f"{API}/admin/pros/{pid}", json=upd2)
        pub2 = user_ctx["session"].get(f"{API}/pros")
        assert not any(p["id"] == pid for p in pub2.json()["pros"])

        # delete
        d = admin_ctx["session"].delete(f"{API}/admin/pros/{pid}")
        assert d.status_code == 200
