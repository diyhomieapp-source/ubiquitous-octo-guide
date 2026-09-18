"""
Backend tests for Build Docs 7 (Readiness), 8 (Pro Handoff), 9 (Voice),
11 (Property Brain), 12 (Command Center).

Covers happy paths + cross-user isolation + admin gating.
"""
import os
import time
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

DEMO = ("demo_home@diyhomie.com", __import__("os").environ.get("TEST_USER_PASSWORD", ""))
ADMIN = ("Diyhomieapp@gmail.com", __import__("os").environ.get("TEST_ADMIN_PASSWORD", ""))

# Seeded issue with a plan+BOM from prior session (per main agent)
KNOWN_ISSUE = "72625ba1-7c0b-4686-b3e0-512bedc5cda1"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_token():
    return _login(*DEMO)


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


def H(t):
    return {"Authorization": f"Bearer {t}"}


# ==================== Doc 7 — Readiness ====================
class TestReadiness:
    def test_get_readiness_issue(self, user_token):
        r = requests.get(f"{BASE}/api/hi/readiness/issues/{KNOWN_ISSUE}", headers=H(user_token), timeout=30)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert "has_plan" in j
        assert "issue" in j and j["issue"]["id"] == KNOWN_ISSUE

    def test_generate_bom_if_needed(self, user_token, request):
        g = requests.get(f"{BASE}/api/hi/readiness/issues/{KNOWN_ISSUE}", headers=H(user_token), timeout=30).json()
        bom = g.get("bom") or {}
        items = bom.get("items") or []
        if not items:
            r = requests.post(f"{BASE}/api/hi/readiness/issues/{KNOWN_ISSUE}/generate",
                              headers=H(user_token), timeout=90)
            assert r.status_code == 200, r.text[:400]
            j = r.json()
            bom = j.get("bom") or {}
            items = bom.get("items") or []
            assert items, "no BOM items generated"
            assert "readiness_pct" in (j.get("summary") or {})
            assert "cost_assumptions" in bom
            assert "procurement" in j
        else:
            j = g
        assert "summary" in j and "readiness_pct" in j["summary"]
        request.config._rd_item_id = items[0]["id"]
        request.config._rd_item_name = items[0]["name"]

    def test_item_status_cycle(self, user_token, request):
        iid = getattr(request.config, "_rd_item_id", None)
        assert iid, "no item id from prior test"
        for status in ("will_buy", "have_it", "need_verification"):
            r = requests.post(f"{BASE}/api/hi/readiness/items/{iid}/status",
                              json={"status": status}, headers=H(user_token), timeout=15)
            assert r.status_code == 200, f"{status}: {r.text[:300]}"
        # invalid status
        r = requests.post(f"{BASE}/api/hi/readiness/items/{iid}/status",
                          json={"status": "invalid_x"}, headers=H(user_token), timeout=15)
        assert r.status_code == 400

    def test_compat_ask(self, user_token, request):
        name = getattr(request.config, "_rd_item_name", "wire nut")
        r = requests.post(f"{BASE}/api/hi/readiness/issues/{KNOWN_ISSUE}/ask",
                          json={"question": f"Can I substitute a smaller {name}?", "item_name": name},
                          headers=H(user_token), timeout=45)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["verdict"] in ("compatible", "not_compatible", "verify_first", "depends")
        assert "answer" in j
        assert "what_to_verify" in j

    def test_admin_signals_gated(self, user_token, admin_token):
        r1 = requests.get(f"{BASE}/api/hi/admin/readiness/signals", headers=H(user_token), timeout=15)
        assert r1.status_code in (401, 403)
        r2 = requests.get(f"{BASE}/api/hi/admin/readiness/signals", headers=H(admin_token), timeout=15)
        assert r2.status_code == 200
        j = r2.json()
        assert "bom_count" in j and "total_items" in j and "status_breakdown" in j


# ==================== Doc 8 — Pro Handoff ====================
class TestHandoffPro:
    def test_escalation(self, user_token, request):
        r = requests.get(f"{BASE}/api/hi/handoff-pro/issues/{KNOWN_ISSUE}/escalation",
                         headers=H(user_token), timeout=30)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert "escalation" in j
        assert j["escalation"]["state"] in ("diy_appropriate", "diy_with_caution", "professional_recommended", "professional_required")
        assert isinstance(j["escalation"].get("trade_categories"), list)
        request.config._brief_state = j["escalation"]["state"]

    def test_create_brief_and_share(self, user_token, request):
        r = requests.post(f"{BASE}/api/hi/handoff-pro/issues/{KNOWN_ISSUE}/brief",
                          json={"homeowner_note": "TEST_ auto brief"},
                          headers=H(user_token), timeout=90)
        assert r.status_code == 200, r.text[:400]
        brief = r.json()["brief"]
        assert brief["version"] >= 1
        assert "sections" in brief and "safety_flags" in brief["sections"]
        assert isinstance(brief.get("questions_to_ask"), list) and len(brief["questions_to_ask"]) >= 1
        request.config._bid = brief["id"]

        # share
        s = requests.post(f"{BASE}/api/hi/handoff-pro/briefs/{brief['id']}/share",
                         headers=H(user_token), timeout=20)
        assert s.status_code == 200, s.text[:300]
        token = s.json()["share"]["token"]
        request.config._share_token = token

        # public GET (NO auth)
        p = requests.get(f"{BASE}/api/hi/handoff-pro/shared/{token}", timeout=20)
        assert p.status_code == 200, p.text[:300]
        pj = p.json()
        assert pj.get("shared") is True and "brief" in pj

    def test_revoke_share(self, user_token, request):
        bid = request.config._bid
        token = request.config._share_token
        d = requests.delete(f"{BASE}/api/hi/handoff-pro/briefs/{bid}/share",
                            headers=H(user_token), timeout=15)
        assert d.status_code == 200
        # public GET now 404
        p = requests.get(f"{BASE}/api/hi/handoff-pro/shared/{token}", timeout=15)
        assert p.status_code == 404

    def test_findings_creates_followup(self, user_token):
        r = requests.post(f"{BASE}/api/hi/handoff-pro/issues/{KNOWN_ISSUE}/findings",
                          json={"summary": "TEST_ Pro found loose connection",
                                "diagnosis": "Loose wire", "followup_needed": True},
                          headers=H(user_token), timeout=20)
        assert r.status_code == 200, r.text[:300]

    def test_scope_compare(self, user_token):
        r = requests.post(f"{BASE}/api/hi/handoff-pro/issues/{KNOWN_ISSUE}/scope-compare",
                          json={"pro_scope_text": "Replace outlet, test grounding, inspect breaker."},
                          headers=H(user_token), timeout=60)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["alignment"] in ("aligned", "partially_aligned", "unclear")

    def test_continue_monitoring(self, user_token):
        r = requests.post(f"{BASE}/api/hi/handoff-pro/issues/{KNOWN_ISSUE}/continue",
                          json={"action": "monitoring", "note": "TEST_ watching"},
                          headers=H(user_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["action"] == "monitoring"

    def test_cross_user_404(self, user_token):
        # register a fresh user
        email = f"TEST_ph_{int(time.time())}@diyhomie.com"
        reg = requests.post(f"{BASE}/api/auth/register",
                            json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": "T"}, timeout=20)
        if reg.status_code not in (200, 201):
            pytest.skip("register unavailable")
        tok = reg.json().get("access_token") or _login(email, __import__("os").environ.get("TEST_USER_PASSWORD", ""))
        r = requests.get(f"{BASE}/api/hi/handoff-pro/issues/{KNOWN_ISSUE}/escalation",
                         headers=H(tok), timeout=15)
        assert r.status_code == 404


# ==================== Doc 9 — Voice ====================
class TestVoice:
    def test_tts_returns_url_and_serves_audio(self, user_token):
        r = requests.post(f"{BASE}/api/hi/voice/tts",
                          json={"text": "Hello from DIYhomie test.", "speed": 1.0},
                          headers=H(user_token), timeout=45)
        assert r.status_code == 200, r.text[:300]
        url = r.json()["url"]
        assert url.startswith("/api/hi/voice/tts/") and url.endswith(".mp3")
        # public audio fetch (no auth)
        a = requests.get(f"{BASE}{url}", timeout=30)
        assert a.status_code == 200
        assert a.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(a.content) > 1000

    def test_simplify(self, user_token):
        # need a session
        s = requests.post(f"{BASE}/api/hi/voice/sessions",
                          json={"interaction_mode": "mixed"}, headers=H(user_token), timeout=20)
        assert s.status_code == 200
        sid = s.json()["session"]["id"]
        r = requests.post(f"{BASE}/api/hi/voice/sessions/{sid}/simplify",
                          json={"text": "The circuit breaker interrupts current when amperage exceeds its rated capacity."},
                          headers=H(user_token), timeout=45)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j.get("spoken") and j.get("full_text")

    def test_ask_still_works(self, user_token):
        s = requests.post(f"{BASE}/api/hi/voice/sessions",
                          json={"interaction_mode": "text"}, headers=H(user_token), timeout=15).json()["session"]
        r = requests.post(f"{BASE}/api/hi/voice/sessions/{s['id']}/ask",
                          json={"text": "What is a stud finder?"}, headers=H(user_token), timeout=60)
        assert r.status_code == 200
        assert "response" in r.json()


# ==================== Doc 11 — Property Brain ====================
class TestBrain:
    def test_summary(self, user_token):
        r = requests.get(f"{BASE}/api/hi/brain/summary", headers=H(user_token), timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        for k in ("completeness", "confirmed_records", "unknowns", "next_best_detail"):
            assert k in j, f"missing {k}"

    def test_profile_renter_toggle_and_report(self, user_token):
        # switch to renter
        r = requests.put(f"{BASE}/api/hi/brain/profile", json={"occupancy_role": "renter"},
                         headers=H(user_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("renter_mode") is True
        assert j.get("renter_boundary")
        # renter report
        rr = requests.get(f"{BASE}/api/hi/brain/renter-report", headers=H(user_token), timeout=15)
        assert rr.status_code == 200
        assert "report_text" in rr.json()
        # reset to owner
        back = requests.put(f"{BASE}/api/hi/brain/profile", json={"occupancy_role": "owner"},
                            headers=H(user_token), timeout=15)
        assert back.status_code == 200

    def test_profile_property_type_region(self, user_token):
        r = requests.put(f"{BASE}/api/hi/brain/profile",
                         json={"property_type": "single_family", "region": "Austin, TX"},
                         headers=H(user_token), timeout=15)
        assert r.status_code == 200

    def test_facts_add_and_action(self, user_token):
        a = requests.post(f"{BASE}/api/hi/brain/facts",
                          json={"label": "TEST_ Water heater year", "value": "2015"},
                          headers=H(user_token), timeout=15)
        assert a.status_code == 200
        fid = a.json()["fact"]["id"]
        # correct
        c = requests.post(f"{BASE}/api/hi/brain/facts/{fid}/action",
                          json={"action": "correct", "corrected_value": "2016"},
                          headers=H(user_token), timeout=15)
        assert c.status_code == 200
        # mark_outdated on a new fact
        b = requests.post(f"{BASE}/api/hi/brain/facts",
                          json={"label": "TEST_ Panel amps", "value": "100"},
                          headers=H(user_token), timeout=15).json()["fact"]
        o = requests.post(f"{BASE}/api/hi/brain/facts/{b['id']}/action",
                          json={"action": "mark_outdated"}, headers=H(user_token), timeout=15)
        assert o.status_code == 200
        rem = requests.post(f"{BASE}/api/hi/brain/facts/{b['id']}/action",
                            json={"action": "remove"}, headers=H(user_token), timeout=15)
        assert rem.status_code == 200

    def test_context_request_flow(self, user_token):
        # Find a water/plumbing issue for the demo user
        r = requests.get(f"{BASE}/api/hi/brain/context-request?issue_id={KNOWN_ISSUE}",
                         headers=H(user_token), timeout=15)
        assert r.status_code == 200
        # May be None if not applicable — the endpoint should still return valid JSON
        assert "request" in r.json()


# ==================== Doc 12 — Command Center ====================
class TestCommand:
    def test_dashboard(self, user_token, request):
        r = requests.get(f"{BASE}/api/hi/command/dashboard", headers=H(user_token), timeout=30)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        for k in ("do_next", "top_priorities", "portfolio", "summary", "recent_activity", "preferences"):
            assert k in j, f"missing {k}"
        assert len(j["top_priorities"]) <= 3
        # portfolio grouped by 7 states
        assert len(j["portfolio"].keys()) == 7
        # find a non-safety item key for defer/dismiss
        request.config._deferable = None
        for p in [j.get("do_next")] + (j.get("top_priorities") or []):
            if p and not str(p.get("id", "")).startswith("safety:") and p.get("kind") != "safety":
                request.config._deferable = p
                break

    def test_resume(self, user_token):
        r = requests.get(f"{BASE}/api/hi/command/resume/{KNOWN_ISSUE}", headers=H(user_token), timeout=15)
        assert r.status_code == 200
        assert "briefing" in r.json()

    def test_defer_and_safety_409(self, user_token, request):
        # safety item -> 409
        s = requests.post(f"{BASE}/api/hi/command/items/action",
                          json={"item_key": "safety:test-safety", "action": "defer"},
                          headers=H(user_token), timeout=15)
        assert s.status_code == 409

        item = getattr(request.config, "_deferable", None)
        if item:
            key = item.get("id") or item.get("item_key") or f"issue:{item.get('issue_id')}"
            d = requests.post(f"{BASE}/api/hi/command/items/action",
                              json={"item_key": key, "action": "defer"},
                              headers=H(user_token), timeout=15)
            assert d.status_code == 200

    def test_prefs_focus_validation(self, user_token):
        good = requests.put(f"{BASE}/api/hi/command/preferences",
                           json={"focus": "safety", "hide_completed": True},
                           headers=H(user_token), timeout=15)
        assert good.status_code == 200
        bad = requests.put(f"{BASE}/api/hi/command/preferences",
                           json={"focus": "invalid_focus"}, headers=H(user_token), timeout=15)
        assert bad.status_code == 400
        # reset
        requests.put(f"{BASE}/api/hi/command/preferences",
                     json={"focus": "balanced", "hide_completed": False},
                     headers=H(user_token), timeout=15)
