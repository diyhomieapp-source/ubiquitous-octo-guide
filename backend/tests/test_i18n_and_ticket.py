"""
Backend tests for the new i18n + support ticket feature.

Covers:
1. POST /api/auth/register creates a fresh user.
2. PUT /api/profile {language:"Spanish"} persists and is returned by GET /api/auth/me.
3. POST /api/support/ticket returns 200 + id (and rejects unauthenticated).
4. AI guide in language=Spanish returns Spanish text in overview/steps.
5. AI guide with language=English (default) still returns English text.

Reuses requests.Session per test class to be quick.
"""
import os
import time
import re
import pytest
import requests

def _load_base_url() -> str:
    for k in ("EXPO_PUBLIC_BACKEND_URL", "EXPO_BACKEND_URL"):
        v = os.environ.get(k)
        if v:
            return v
    # Fallback: parse frontend/.env directly (tests run outside expo runtime).
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found")

BASE_URL = _load_base_url()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

# A handful of Spanish stop-words / function words that almost any Spanish prose contains.
ES_TOKENS = re.compile(r"\b(el|la|los|las|de|del|para|con|una|uno|que|y|en|por|al|se)\b", re.IGNORECASE)
# English-only stop words (avoid Spanish overlap like "a" / "no" / "es" / "un").
EN_TOKENS = re.compile(r"\b(the|and|with|you|your|this|that|will|for|from|are|use)\b", re.IGNORECASE)


def _register(session: requests.Session, tag: str) -> dict:
    ts = int(time.time() * 1000)
    email = f"TEST_i18n_{tag}_{ts}@diyhomie.com"
    r = session.post(f"{API}/auth/register",
                     json={"email": email, "password": "Test1234", "name": "I18n Tester"},
                     timeout=30)
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token and "user" in data, f"unexpected register response: {data}"
    session.headers.update({"Authorization": f"Bearer {token}"})
    return data


# ============================================================ profile language
class TestProfileLanguage:
    def test_register_then_set_spanish_persists(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _register(s, "profile")

        # default language should be unset / None
        me0 = s.get(f"{API}/auth/me", timeout=15)
        assert me0.status_code == 200
        assert me0.json().get("language") in (None, "", "English")

        # Set Spanish
        r = s.put(f"{API}/profile", json={"language": "Spanish"}, timeout=15)
        assert r.status_code == 200, f"PUT /profile failed: {r.status_code} {r.text}"

        # Verify via /auth/me GET (persistence check)
        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200
        assert me.json().get("language") == "Spanish"

    def test_switch_back_to_english_persists(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _register(s, "switch")

        assert s.put(f"{API}/profile", json={"language": "Spanish"}, timeout=15).status_code == 200
        assert s.put(f"{API}/profile", json={"language": "English"}, timeout=15).status_code == 200

        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.json().get("language") == "English"


# ============================================================ support ticket
class TestSupportTicket:
    def test_submit_ticket_returns_id(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _register(s, "ticket")
        r = s.post(f"{API}/support/ticket",
                   json={"category": "Bug",
                         "subject": "TEST_subject_lang",
                         "message": "TEST: ticket submission from backend test."},
                   timeout=20)
        assert r.status_code == 200, f"ticket failed: {r.status_code} {r.text}"
        body = r.json()
        assert "id" in body and len(body["id"]) >= 8
        assert body.get("status") == "open"

    def test_ticket_requires_auth(self):
        anon = requests.Session()
        anon.headers.update({"Content-Type": "application/json"})
        r = anon.post(f"{API}/support/ticket",
                      json={"category": "Bug", "subject": "no auth", "message": "no auth"},
                      timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# ============================================================ AI guide in language
def _build_guide(s: requests.Session, title: str) -> dict:
    proj = s.post(f"{API}/projects", json={"title": title, "location": "Austin, TX"}, timeout=30)
    assert proj.status_code == 200, f"create project failed: {proj.status_code} {proj.text}"
    pid = proj.json()["id"]
    # Generate guide — can take 15-30s for OpenAI fallback
    g = s.post(f"{API}/projects/{pid}/guide", json={}, timeout=120)
    assert g.status_code == 200, f"guide failed: {g.status_code} {g.text[:400]}"
    payload = g.json()
    # Endpoint returns full project doc: {guide: {overview, ...}, steps: [...]}
    return {"overview": (payload.get("guide") or {}).get("overview", ""),
            "steps": payload.get("steps") or []}


class TestGuideLanguage:
    @pytest.mark.timeout(180)
    def test_guide_in_spanish(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _register(s, "guide_es")
        assert s.put(f"{API}/profile", json={"language": "Spanish"}, timeout=15).status_code == 200

        guide = _build_guide(s, "Reemplazar un grifo de bano")
        overview = (guide.get("overview") or "").strip()
        steps = guide.get("steps") or []
        assert overview, f"no overview in guide: {guide}"
        assert steps, "no steps in guide"
        sample = overview + " " + " ".join((st.get("instruction") or "") + " " + (st.get("title") or "")
                                            for st in steps[:5])
        es_hits = len(ES_TOKENS.findall(sample))
        en_hits = len(EN_TOKENS.findall(sample))
        print(f"[ES guide] es_hits={es_hits} en_hits={en_hits} sample[:200]={sample[:200]!r}")
        # Allow some english (DIYhomie, brand names) but Spanish must dominate
        assert es_hits >= 5, f"too few Spanish tokens ({es_hits}). sample={sample[:300]}"
        assert es_hits > en_hits, (
            f"AI output appears NOT in Spanish (en_hits={en_hits} >= es_hits={es_hits}). "
            f"sample={sample[:400]}"
        )

    @pytest.mark.timeout(180)
    def test_guide_in_english_default(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        _register(s, "guide_en")
        # No PUT /profile -> language remains None/English
        guide = _build_guide(s, "Replace a bathroom faucet")
        overview = (guide.get("overview") or "").strip()
        steps = guide.get("steps") or []
        assert overview and steps
        sample = overview + " " + " ".join((st.get("instruction") or "") + " " + (st.get("title") or "")
                                            for st in steps[:5])
        en_hits = len(EN_TOKENS.findall(sample))
        es_hits = len(ES_TOKENS.findall(sample))
        print(f"[EN guide] en_hits={en_hits} es_hits={es_hits} sample[:200]={sample[:200]!r}")
        assert en_hits >= 5, f"too few English tokens: {en_hits}. sample={sample[:300]}"
        assert en_hits > es_hits, f"default guide not in English. sample={sample[:400]}"
