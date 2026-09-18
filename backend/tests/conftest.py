"""
Shared pytest configuration (security remediation DIYHOMIE-EM-02).

- Test credentials come from environment variables (or backend/.env.test,
  git-ignored) — never from literals in test files.
- TEST_BASE_URL defaults to the local backend. Tests refuse to run against a
  non-local host unless ALLOW_REMOTE_TESTS=1 is set explicitly.
"""
import os

from dotenv import load_dotenv

_HERE = os.path.dirname(__file__)
# git-ignored local test env (values), then example defaults
load_dotenv(os.path.join(_HERE, "..", ".env.test"))

os.environ.setdefault("TEST_BASE_URL", "http://localhost:8001")
os.environ.setdefault("EXPO_PUBLIC_BACKEND_URL", os.environ["TEST_BASE_URL"])

_ALLOWED_LOCAL = ("localhost", "127.0.0.1", "0.0.0.0")


def _host(url: str) -> str:
    return url.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0]


def pytest_configure(config):
    base = os.environ.get("TEST_BASE_URL", "")
    if _host(base) not in _ALLOWED_LOCAL and os.environ.get("ALLOW_REMOTE_TESTS") != "1":
        raise SystemExit(
            f"Refusing to run tests against non-local TEST_BASE_URL ({base}). "
            "Set ALLOW_REMOTE_TESTS=1 to override (never point tests at production)."
        )
    for var in ("TEST_USER_PASSWORD", "TEST_ADMIN_PASSWORD"):
        if not os.environ.get(var):
            raise SystemExit(f"{var} is not set — create backend/.env.test (see .env.test.example).")
