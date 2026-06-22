"""
Tests for HOME MEMORY (agentic recall) feature on DIYhomie backend.

Validated scenarios (see review_request):
  1. Memory accumulates server-side after guide build + adapt.
  2. New project in SAME room returns intake.remembers=true.
  3. Generated guide for the second same-room project reflects past memory.
  4. First-ever project in a fresh account returns remembers=false.
  5. Cross-room isolation: kitchen project does NOT pull bathroom memories.
  6. No regression on guide/intake/adapt/ask + home_memory hidden from /auth/me.
"""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL")
            or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"

GUIDE_TIMEOUT = 120
INTAKE_TIMEOUT = 60
ADAPT_TIMEOUT = 60
ASK_TIMEOUT = 60


# ---------- helpers ----------
def _register(suffix: str) -> tuple[str, dict]:
    ts = int(time.time() * 1000)
    email = f"TEST_mem_{suffix}_{ts}@diyhomie.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "Test1234", "name": f"Mem {suffix}"},
                      timeout=20)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _start_project(token: str, title: str) -> str:
    r = requests.post(f"{API}/projects", headers=_h(token),
                      json={"title": title, "location": "10001"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _intake(token: str, pid: str) -> dict:
    r = requests.post(f"{API}/projects/{pid}/intake", headers=_h(token),
                      timeout=INTAKE_TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _build_guide(token: str, pid: str, context: dict | None = None) -> dict:
    body = {"context": context} if context else {}
    r = requests.post(f"{API}/projects/{pid}/guide", headers=_h(token),
                      json=body, timeout=GUIDE_TIMEOUT)
    assert r.status_code == 200, f"guide build failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _adapt(token: str, pid: str, problem: str) -> dict:
    r = requests.post(f"{API}/projects/{pid}/adapt", headers=_h(token),
                      json={"problem": problem}, timeout=ADAPT_TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _ask(token: str, pid: str, message: str) -> dict:
    r = requests.post(f"{API}/projects/{pid}/ask", headers=_h(token),
                      json={"message": message}, timeout=ASK_TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _me(token: str) -> dict:
    r = requests.get(f"{API}/auth/me", headers=_h(token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- tests ----------

# Negative case: brand-new account, first intake → remembers=false
def test_first_project_first_intake_no_memory():
    token, _ = _register("first")
    pid = _start_project(token, "Replace my toilet")
    res = _intake(token, pid)
    assert "questions" in res, res
    assert res.get("remembers") is False, f"Expected remembers=false on fresh user, got {res}"


# Auth/me does NOT expose home_memory
def test_public_user_excludes_home_memory():
    token, _ = _register("public")
    me = _me(token)
    assert "home_memory" not in me, f"home_memory must NOT be in public user payload: {me.keys()}"
    # Build a guide → memory pushed server-side
    pid = _start_project(token, "Replace my toilet")
    _intake(token, pid)
    _build_guide(token, pid, {"model": "American Standard Cadet 3"})
    me2 = _me(token)
    assert "home_memory" not in me2, f"home_memory STILL must not leak after build: {me2.keys()}"


# Full memory accumulation + recall + cross-room isolation in one user session
@pytest.mark.timeout(900)
def test_memory_accumulates_recalls_and_isolates_by_room():
    token, user = _register("flow")

    # --- Project 1: bathroom — Replace my toilet ---
    p1 = _start_project(token, "Replace my toilet")
    intake1 = _intake(token, p1)
    assert intake1.get("remembers") is False, "first project ever should not remember"

    g1 = _build_guide(token, p1, {"model": "American Standard Cadet 3",
                                  "surface": "ceramic tile"})
    assert g1.get("guide") is not None
    assert len(g1.get("steps", [])) >= 4

    # adapt with a memorable problem
    a1 = _adapt(token, p1, "I had to reroute the drain line to the left of the original flange")
    assert "reply" in a1 and "project" in a1

    # --- Project 2: SAME room (bathroom) — should remember ---
    p2 = _start_project(token, "Fix the bathroom sink plumbing")
    intake2 = _intake(token, p2)
    assert intake2.get("remembers") is True, (
        f"Project 2 in SAME room (bathroom) MUST return remembers=true, got {intake2}"
    )

    g2 = _build_guide(token, p2)
    assert g2.get("guide") is not None
    # Qualitative check: guide acknowledges past bathroom plumbing context.
    blob = " ".join([
        (g2["guide"].get("overview") or ""),
        " ".join(g2["guide"].get("safety_warnings") or []),
        " ".join(s.get("instruction", "") for s in g2.get("steps", [])),
        " ".join(s.get("title", "") for s in g2.get("steps", [])),
        str(g2["guide"].get("code_alert") or ""),
        " ".join(g2["guide"].get("troubleshooting") or []),
        " ".join(g2["guide"].get("common_mistakes") or []),
    ]).lower()
    # The model should at least mention drain / reroute / past / previous / toilet
    keywords = ["drain", "reroute", "rerouted", "previous", "prior", "past", "earlier",
                "toilet", "existing", "already"]
    hits = [k for k in keywords if k in blob]
    assert hits, (
        "Project 2's guide should acknowledge prior bathroom plumbing memory; "
        f"no relevant keywords found in:\n{blob[:600]}"
    )

    # --- Project 3: DIFFERENT room (kitchen) — should NOT remember bathroom ---
    p3 = _start_project(token, "Replace a kitchen faucet")
    intake3 = _intake(token, p3)
    # First kitchen project: relevant_memories filters by detected room. The
    # detect_room('Replace a kitchen faucet') resolves to 'kitchen'. There are
    # no kitchen-room memories yet, so remembers MUST be false.
    assert intake3.get("remembers") is False, (
        f"Kitchen project must NOT surface bathroom memory: {intake3}"
    )


# Regression: all four core endpoints still return 200 after memory feature
@pytest.mark.timeout(600)
def test_regression_all_endpoints_still_200():
    token, _ = _register("regress")
    pid = _start_project(token, "Replace my toilet")

    r_intake = requests.post(f"{API}/projects/{pid}/intake", headers=_h(token),
                             timeout=INTAKE_TIMEOUT)
    assert r_intake.status_code == 200, r_intake.text

    r_guide = requests.post(f"{API}/projects/{pid}/guide", headers=_h(token),
                            json={"context": {"model": "TOTO Drake II"}},
                            timeout=GUIDE_TIMEOUT)
    assert r_guide.status_code == 200, r_guide.text

    r_ask = requests.post(f"{API}/projects/{pid}/ask", headers=_h(token),
                          json={"message": "Any tips before I start?"},
                          timeout=ASK_TIMEOUT)
    assert r_ask.status_code == 200, r_ask.text

    r_adapt = requests.post(f"{API}/projects/{pid}/adapt", headers=_h(token),
                            json={"problem": "The supply line is leaking at the valve"},
                            timeout=ADAPT_TIMEOUT)
    assert r_adapt.status_code == 200, r_adapt.text

    # Final /auth/me still clean
    me = _me(token)
    assert "home_memory" not in me
