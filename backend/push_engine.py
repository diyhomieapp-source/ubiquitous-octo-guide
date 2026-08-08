"""
DIYhomie — Emergent managed push notification relay (shared).

Backend-only relay to the Emergent push service (SuprSend passthrough). The app
registers native device tokens here; other engines call send_push() to deliver.
Push only works after the app is deployed + a native build is generated with a
google-services.json (Android) — it will not work in Expo Go / web preview.

NEVER edit EMERGENT_PUSH_KEY in .env — it is 'placeholder' locally and is set by
the deployment pipeline at build time.
"""
import os
import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Callable

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_logger = None
_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)


def configure(logger):
    global _logger
    _logger = logger


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


async def send_push(recipients: list, data: dict, idempotency_key: str = None) -> None:
    """Deliver a push to a list of user IDs. Tokens are resolved by the relay."""
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


def build_router(get_current_user: Callable) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.post("/register-push", status_code=201)
    async def register_push(body: RegisterPushBody):
        resp = await _client.post("/api/v1/push/users/register", json=body.model_dump())
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()
        return {"status": "registered"}

    return router
