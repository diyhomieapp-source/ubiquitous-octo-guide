"""
Iteration 90 — Docs 33/35/36 delta tests:
- Doc 35 §15 auth: token_version rotation via /api/auth/logout-all
- Doc 35 §8 granular AI privacy controls (allow_home_context, allow_project_photos,
  allow_documents, ai_personalization) via /api/hi/privacy/ai-controls, enforced in Homie chat.
- Doc 33 support: safety_concern category → critical + safety_note + safety escalation;
  context-first Homie handoff summary auto-attached for related_entity_type='gr_issue'.
- Doc 36 §5 release AI benchmark library: /api/hi/admin/release/ai-cases includes 9 doc36_benchmark cases.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"

created_ticket_ids: list[str] = []


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ============================================================ Doc 35 §15 auth
class TestAuthTokenVersion:
    def test_login_and_me(self):
        token = _login(DEMO_EMAIL, DEMO_PASSWORD)
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(token), timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me["email"].lower() == DEMO_EMAIL.lower()

    def test_logout_all_bumps_token_version(self):
        # Token A
        token_a = _login(DEMO_EMAIL, DEMO_PASSWORD)
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(token_a), timeout=30)
        assert r.status_code == 200

        # logout-all with A → returns token B + message
        r = requests.post(f"{BASE_URL}/api/auth/logout-all", headers=_auth(token_a), timeout=30)
        assert r.status_code == 200, f"logout-all failed: {r.status_code} {r.text}"
        body = r.json()
        assert "access_token" in body and body["access_token"], "logout-all missing new access_token"
        assert body.get("token_type") == "bearer"
        assert "message" in body and body["message"]
        token_b = body["access_token"]
        assert token_b != token_a

        # Token A must now be invalid (401)
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(token_a), timeout=30)
        assert r.status_code == 401, f"expected 401 for old token A, got {r.status_code}"

        # Token B works (200)
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(token_b), timeout=30)
        assert r.status_code == 200, f"expected 200 for new token B, got {r.status_code}"

        # Fresh login → token C works
        token_c = _login(DEMO_EMAIL, DEMO_PASSWORD)
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(token_c), timeout=30)
        assert r.status_code == 200


# ============================================================ Doc 35 §8 AI privacy controls
class TestAiPrivacyControls:
    def test_get_returns_six_booleans(self):
        token = _login(DEMO_EMAIL, DEMO_PASSWORD)
        r = requests.get(f"{BASE_URL}/api/hi/privacy/ai-controls", headers=_auth(token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        required = ["ai_training_opt_in", "analytics_opt_in", "allow_home_context",
                    "allow_project_photos", "allow_documents", "ai_personalization"]
        for k in required:
            assert k in body, f"missing key {k}"
            assert isinstance(body[k], bool), f"{k} is not bool"

    def test_put_persists_and_homie_chat_still_works(self):
        token = _login(DEMO_EMAIL, DEMO_PASSWORD)

        # 1) PUT allow_home_context:false
        r = requests.put(f"{BASE_URL}/api/hi/privacy/ai-controls",
                         headers=_auth(token), json={"allow_home_context": False}, timeout=30)
        assert r.status_code == 200, f"put ai-controls: {r.status_code} {r.text}"
        body = r.json()
        assert body["allow_home_context"] is False

        # verify GET persisted
        r = requests.get(f"{BASE_URL}/api/hi/privacy/ai-controls", headers=_auth(token), timeout=30)
        assert r.status_code == 200
        assert r.json()["allow_home_context"] is False

        # 2) Create a Homie chat conversation
        r = requests.post(f"{BASE_URL}/api/hi/chat/conversations", headers=_auth(token), json={}, timeout=60)
        assert r.status_code in (200, 201), f"create conversation: {r.status_code} {r.text}"
        conv = r.json()
        cid = conv.get("conversation", {}).get("id") or conv.get("id")
        assert cid, f"no conversation id in {conv}"

        # 3) Send a message → verify chat doesn't crash while home context is withheld
        r = requests.post(f"{BASE_URL}/api/hi/chat/conversations/{cid}/message",
                          headers=_auth(token),
                          json={"text": "What color paint would work in my living room?"}, timeout=90)
        assert r.status_code == 200, f"message with privacy off failed: {r.status_code} {r.text}"
        j = r.json()
        assert "assistant" in j
        assert j["assistant"].get("text"), "assistant reply empty"

        # 4) RESET allow_home_context:true (cleanup)
        r = requests.put(f"{BASE_URL}/api/hi/privacy/ai-controls",
                         headers=_auth(token), json={"allow_home_context": True}, timeout=30)
        assert r.status_code == 200
        assert r.json()["allow_home_context"] is True


# ============================================================ Doc 33 support tickets
class TestSupportSafetyAndHandoff:
    def test_safety_concern_ticket_is_critical_with_safety_note(self):
        token = _login(DEMO_EMAIL, DEMO_PASSWORD)
        payload = {
            "category": "safety_concern",
            "subject": "TEST_iter90 I see sparks from an outlet",
            "description": "TEST_iter90 There are sparks and a burning smell coming from the outlet in my kitchen.",
        }
        r = requests.post(f"{BASE_URL}/api/hi/help/tickets", headers=_auth(token), json=payload, timeout=30)
        assert r.status_code == 200, f"safety ticket create: {r.status_code} {r.text}"
        body = r.json()
        t = body["ticket"]
        created_ticket_ids.append(t["id"])
        assert t["category"] == "safety_concern"
        assert t["priority"] == "critical", f"expected critical, got {t['priority']}"
        assert body["ticket"].get("safety_note"), "safety_note missing on response"
        assert "emergency" in body["ticket"]["safety_note"].lower() or "danger" in body["ticket"]["safety_note"].lower()

    def test_gr_issue_context_attaches_homie_summary(self):
        token = _login(DEMO_EMAIL, DEMO_PASSWORD)
        # find a real gr_issue for demo user directly via Mongo (endpoint list variety is high)
        issue_id = None
        try:
            from pymongo import MongoClient
            mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
            db_name = os.environ.get("DB_NAME", "diyhomie")
            client = MongoClient(mongo_url)
            db = client[db_name]
            u = db.users.find_one({"email": {"$regex": f"^{DEMO_EMAIL}$", "$options": "i"}}, {"id": 1})
            if u:
                issue = db.gr_issues.find_one({"user_id": u["id"]}, {"id": 1})
                if issue:
                    issue_id = issue["id"]
        except Exception as e:
            pytest.skip(f"Mongo lookup failed: {e}")

        if not issue_id:
            pytest.skip("No gr_issue found for demo user to test homie_summary attachment")

        payload = {
            "category": "technical_bug",
            "subject": "TEST_iter90 Homie handoff for project",
            "description": "TEST_iter90 I have a question about the plan I got for my project.",
            "context": {"related_entity_type": "gr_issue", "related_entity_id": issue_id},
        }
        r = requests.post(f"{BASE_URL}/api/hi/help/tickets", headers=_auth(token), json=payload, timeout=30)
        assert r.status_code == 200, f"handoff ticket create: {r.status_code} {r.text}"
        t = r.json()["ticket"]
        created_ticket_ids.append(t["id"])
        ctx = t.get("context") or {}
        hs = ctx.get("homie_summary")
        assert hs is not None, f"homie_summary missing; context={ctx}"
        for k in ("project", "category", "phase", "evidence_items"):
            assert k in hs, f"homie_summary missing {k}"


# ============================================================ Doc 36 §5 AI benchmark library
class TestDoc36BenchmarkLibrary:
    def test_admin_ai_cases_has_9_doc36_cases(self):
        admin_token = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        r = requests.get(f"{BASE_URL}/api/hi/admin/release/ai-cases", headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200, f"ai-cases: {r.status_code} {r.text}"
        cases = r.json().get("cases", [])
        doc36 = [c for c in cases if c.get("source") == "doc36_benchmark"]
        assert len(doc36) >= 9, f"expected >=9 doc36_benchmark cases, got {len(doc36)}"
        # Sanity checks for specific inputs
        inputs = " || ".join(c.get("user_input", "").lower() for c in doc36)
        assert "damp" in inputs and "drywall" in inputs, "wet drywall case missing"
        assert "breaker panel" in inputs, "drill near wiring case missing"
        assert "ignore your safety rules" in inputs, "prompt injection case missing"


# ============================================================ Cleanup
@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    # Delete any TEST_ tickets we created
    if not created_ticket_ids:
        return
    try:
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "diyhomie")
        client = MongoClient(mongo_url)
        db = client[db_name]
        res_t = db.sup_tickets.delete_many({"id": {"$in": created_ticket_ids}})
        res_m = db.sup_messages.delete_many({"support_ticket_id": {"$in": created_ticket_ids}})
        print(f"CLEANUP: deleted {res_t.deleted_count} sup_tickets, {res_m.deleted_count} sup_messages")
    except Exception as e:
        print(f"CLEANUP failed: {e}")
