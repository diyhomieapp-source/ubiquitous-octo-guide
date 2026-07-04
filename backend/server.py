import os
import json
import base64
import uuid
import logging
import re
from pathlib import Path
from datetime import datetime, timezone, timedelta
import secrets
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, EmailStr
import jwt
import httpx
import asyncio
import stripe
from fastapi import Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from urllib.parse import quote
from passlib.context import CryptContext

import email_engine
import affiliate_engine

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---------------------------------------------------------------- config
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
PERPLEXITY_API_KEY = os.environ.get('PERPLEXITY_API_KEY', '').strip()
JWT_SECRET_KEY = os.environ['JWT_SECRET_KEY']
JWT_ALGORITHM = os.environ.get('JWT_ALGORITHM', 'HS256')
TOKEN_EXPIRE_MINUTES = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '43200'))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=True)

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')
WEATHER_API_KEY = os.environ.get('WEATHER_API_KEY', '').strip()
DECOR8_API_KEY = os.environ.get('DECOR8_API_KEY', '').strip()
DECOR8_BASE_URL = "https://api.decor8.ai"
STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '').strip() or STRIPE_API_KEY
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '').strip()
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY
    # The Emergent test proxy is only used for the placeholder test key.
    if "sk_test_emergent" in STRIPE_SECRET_KEY:
        stripe.api_base = "https://integrations.emergentagent.com/stripe"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("diyhomie")

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------------------------------------------------------------- helpers
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name", ""),
        "experience": u.get("experience"),
        "tools": u.get("tools", []),
        "budget": u.get("budget"),
        "pain_point": u.get("pain_point"),
        "expectation": u.get("expectation"),
        "location": u.get("location", ""),
        "language": u.get("language"),
        "credits": u.get("credits", 0),
        "voice_minutes": u.get("voice_minutes", 0),
        "subscription_tier": u.get("subscription_tier", "free"),
        "onboarded": u.get("onboarded", False),
        "is_admin": u.get("is_admin", False),
        "avatar_base64": u.get("avatar_base64"),
        "bio": u.get("bio", ""),
        "share_public": u.get("share_public", False),
    }


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    cred_exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise cred_exc
    except jwt.PyJWTError:
        raise cred_exc
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise cred_exc
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


# ---------------------------------------------------------------- models
class RegisterReq(BaseModel):
    email: EmailStr
    password: str
    name: str = ""
    ref: Optional[str] = None


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class ProfileReq(BaseModel):
    experience: Optional[str] = None
    tools: Optional[List[str]] = None
    budget: Optional[str] = None
    pain_point: Optional[List[str]] = None
    expectation: Optional[str] = None
    location: Optional[str] = None
    language: Optional[str] = None
    onboarded: Optional[bool] = None
    avatar_base64: Optional[str] = None
    bio: Optional[str] = None
    share_public: Optional[bool] = None


class StartProjectReq(BaseModel):
    title: str
    location: str = ""


class StepReq(BaseModel):
    message: str
    mode: str = "text"  # "text" | "voice"


# ---------------------------------------------------------------- AI brain
MASTER_SYSTEM = (
    "You are 'Homie,' an elite Master Contractor and building inspector built into the DIYhomie app. "
    "Your job is to guide the user step-by-step through home improvement, repairs, and landscaping.\n\n"
    "CRITICAL OPERATIONAL RULES:\n"
    "1. ONE STEP AT A TIME: Never output a full guide. Provide exactly ONE actionable step. "
    "Wait for the user to say 'Done', 'Next', or ask a question before providing the next step.\n"
    "2. USER PROFILE ADAPTATION: Adjust vocabulary and tool expectations to the profile. "
    "Experience Level: {experience}. Budget Focus: {budget}. Tools Owned: {tools}. "
    "If a step requires a tool NOT in their list, populate 'missing_tools'.\n"
    "3. LOCAL CODE & GEOLOCATION: The user is located at: {location}. Consider local municipal building codes, "
    "climate zones, and permit requirements. If a permit is required or a code violation is imminent, set 'code_alert'.\n"
    "4. TROUBLESHOOTING MODE: If the user reports a setback (rusted bolt, leaking pipe), halt and solve that setback first.\n"
    "5. CREDIT CONSERVATION: Keep the text_instruction concise (under 25 words), clear and highly actionable.\n"
    "6. STRUCTURED JSON OUTPUT. Respond ONLY with valid JSON (no markdown fences) with EXACTLY these keys:\n"
    "   - 'text_instruction': the single step guide for the homeowner (under 25 words).\n"
    "   - 'visual_description': a highly detailed, literal, mechanical description of the action, specific tools and "
    "product models, written as an accurate image-generation prompt.\n"
    "   - 'missing_tools': array of strings for required tools the user does NOT own (empty array if none).\n"
    "   - 'code_alert': a short string warning about permits/code if relevant, otherwise null.\n"
    "   - 'step_title': a 2-4 word label for this step."
)

STYLE_ANCHOR = (
    "Create a clear, close-up DIY instructional photo of {desc}. "
    "Bright, clean, step-by-step instruction-manual photo style with shallow depth of field. "
    "Maintain absolute visual consistency for the project '{project}'. "
    "Show the exact tools and materials specified. No text overlays, no words, no gibberish on the image."
)


def _strip_json(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?", "", raw).strip()
    raw = re.sub(r"```$", "", raw).strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        raw = m.group(0)
    return json.loads(raw)


def lang_note(profile: dict) -> str:
    lang = (profile or {}).get("language")
    if lang and lang != "English":
        return (
            f"\n\nIMPORTANT: Write ALL output — every string value, title, instruction and "
            f"sentence — in {lang}. Use natural, native {lang} phrasing. Keep JSON keys, "
            f"placeholders and the word 'DIYhomie' in English. Do NOT use any other language."
        )
    return ""


# ---------------------------------------------------------------- home memory (agentic recall)
ROOM_KEYWORDS = {
    "bathroom": ["bathroom", "toilet", "shower", "bathtub", "tub", "vanity"],
    "kitchen": ["kitchen", "dishwasher", "disposal", "range", "oven", "countertop", "backsplash"],
    "basement": ["basement", "sump", "crawl space", "crawlspace"],
    "garage": ["garage", "opener"],
    "bedroom": ["bedroom", "closet"],
    "laundry": ["laundry", "washer", "dryer"],
    "living": ["living room", "den", "family room"],
    "outdoor": ["deck", "fence", "patio", "yard", "gutter", "roof", "siding", "driveway"],
}


def detect_room(text: str) -> str:
    t = (text or "").lower()
    for room, kws in ROOM_KEYWORDS.items():
        if any(k in t for k in kws):
            return room
    return ""


def relevant_memories(profile: dict, title: str, context: dict = None) -> List[dict]:
    mem = profile.get("home_memory") or []
    if not mem:
        return []
    blob = (title or "") + " " + " ".join(str(v) for v in (context or {}).values())
    room = detect_room(blob)
    if room:
        return [m for m in mem if m.get("room") == room][-8:]
    return mem[-4:]  # room unknown → use the most recent projects as light context


def memory_note(profile: dict, title: str, context: dict = None) -> str:
    items = relevant_memories(profile, title, context)
    lines = "\n".join(f"- {m.get('text')}" for m in items if m.get("text"))
    if not lines:
        return ""
    return (
        "\n\nWHAT YOU (HOMIE) ALREADY KNOW ABOUT THIS HOME from the homeowner's past projects — "
        "use it silently to stay consistent (e.g. plumbing/wiring you already rerouted, fixtures "
        "already installed) and only mention it when it actually affects this job:\n" + lines
    )


async def push_memory(user_id: str, current: list, room: str, text: str):
    items = list(current or [])
    items.append({"id": new_id(), "room": room, "text": (text or "")[:240], "created_at": now_iso()})
    items = items[-40:]  # cap so per-user memory never bloats
    await db.users.update_one({"id": user_id}, {"$set": {"home_memory": items}})


async def brain_generate(profile: dict, project_title: str, history: List[dict], user_msg: str) -> dict:
    system = MASTER_SYSTEM.format(
        experience=profile.get("experience") or "Weekend Warrior",
        budget=profile.get("budget") or "Standard",
        tools=", ".join(profile.get("tools") or []) or "None / basic hand tools",
        location=profile.get("location") or "United States",
    ) + lang_note(profile)
    convo = f"Project: {project_title}\n"
    for h in history[-8:]:
        convo += f"{h['role']}: {h['content']}\n"
    convo += f"user: {user_msg}\n\nProvide the next single step now as JSON."

    # Preferred: Perplexity Sonar Pro (live web search)
    if PERPLEXITY_API_KEY:
        try:
            from openai import AsyncOpenAI
            pplx = AsyncOpenAI(api_key=PERPLEXITY_API_KEY, base_url="https://api.perplexity.ai")
            resp = await pplx.chat.completions.create(
                model="sonar-pro",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": convo},
                ],
                max_tokens=900,
            )
            return _strip_json(resp.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Perplexity failed, falling back to LLM: {e}")

    # Fallback: Emergent universal key (OpenAI gpt-4o-mini)
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(), system_message=system).with_model("openai", "gpt-4o-mini")
    out = await chat.send_message(UserMessage(text=convo))
    return _strip_json(out)


async def generate_step_image(visual_description: str, project_title: str) -> Optional[str]:
    try:
        from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration
        prompt = STYLE_ANCHOR.format(desc=visual_description, project=project_title)
        gen = OpenAIImageGeneration(api_key=EMERGENT_LLM_KEY)
        images = await gen.generate_images(prompt=prompt, model="gpt-image-1", number_of_images=1)
        if images:
            return base64.b64encode(images[0]).decode("utf-8")
    except Exception as e:
        logger.error(f"Image generation failed: {e}")
    return None


GUIDE_SYSTEM = (
    "You are 'Homie,' an elite Master Contractor and building inspector inside the DIYhomie app. "
    "Produce a COMPLETE, beginner-friendly structured DIY guide for a homeowner.\n"
    "Adapt to the user profile: Experience {experience}, Budget {budget}, Tools owned: {tools}. "
    "Location: {location} — consider local building codes, permits and climate.\n"
    "Keep language simple, encouraging and easy to read. "
    "Respond ONLY with valid JSON (no markdown fences) with EXACTLY these keys:\n"
    "  'overview': a warm 1-2 sentence intro to the job.\n"
    "  'tools': array of tool names needed.\n"
    "  'materials': array of materials/parts to buy.\n"
    "  'safety_warnings': array of short safety strings.\n"
    "  'code_alert': short permit/code warning string if relevant, otherwise null.\n"
    "  'steps': array of 5-9 objects, each {{'title': 2-4 words, 'instruction': one clear sentence under 25 words, "
    "'visual_description': a literal mechanical description naming the specific tools/parts, written as an image-generation prompt}}.\n"
    "  'common_mistakes': array of short strings.\n"
    "  'troubleshooting': array of short 'problem - fix' strings.\n"
    "  'inspection_checklist': array of short final check items."
)


async def _llm_json(system: str, user_text: str, max_tokens: int = 1800) -> dict:
    if PERPLEXITY_API_KEY:
        try:
            from openai import AsyncOpenAI
            pplx = AsyncOpenAI(api_key=PERPLEXITY_API_KEY, base_url="https://api.perplexity.ai")
            resp = await pplx.chat.completions.create(
                model="sonar-pro",
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user_text}],
                max_tokens=max_tokens,
            )
            return _strip_json(resp.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Perplexity guide failed, falling back: {e}")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(), system_message=system).with_model("openai", "gpt-4o-mini")
    out = await chat.send_message(UserMessage(text=user_text))
    return _strip_json(out)


async def brain_generate_guide(profile: dict, title: str, weather: str = "", context: dict = None) -> dict:
    system = GUIDE_SYSTEM.format(
        experience=profile.get("experience") or "Weekend Warrior",
        budget=profile.get("budget") or "Standard",
        tools=", ".join(profile.get("tools") or []) or "None / basic hand tools",
        location=profile.get("location") or "United States",
    ) + lang_note(profile) + memory_note(profile, title, context)
    user_text = f"Create the full structured DIY guide for this project: '{title}'."
    if context:
        details = "; ".join(f"{k}: {v}" for k, v in context.items() if v)
        if details:
            user_text += (
                f"\nThe homeowner gave these EXACT specifics — use them so the guide is precise, "
                f"not generic: {details}. If a brand and model number are provided, reference THAT "
                "specific product's real installation/repair procedure, parts, rough-in and known quirks. "
                "Adapt tools, materials, measurements and steps to the stated surface, site and material "
                "conditions (e.g. concrete vs. wood subfloor, basement vs. upper floor)."
            )
    if weather:
        user_text += (
            f"\nCurrent local weather: {weather}. If ANY part of this job happens OUTDOORS, "
            "adapt the timing, materials and safety_warnings to these conditions "
            "(e.g. don't paint/seal/pour in rain, high heat or below ~50°F; avoid spraying/sanding in wind). "
            "If the job is fully indoors, ignore the weather."
        )
    return await _llm_json(system, user_text)


async def brain_answer(profile: dict, title: str, question: str) -> str:
    system = (
        "You are Homie, a friendly master contractor helping a homeowner with the project "
        f"'{title}'. Experience: {profile.get('experience') or 'Weekend Warrior'}. "
        f"Location: {profile.get('location') or 'United States'}. "
        "Answer their question in a clear, encouraging, practical way. Keep it under 60 words. "
        "If it's a setback, give the exact fix. Plain text only, no markdown."
    )
    system += lang_note(profile)
    if PERPLEXITY_API_KEY:
        try:
            from openai import AsyncOpenAI
            pplx = AsyncOpenAI(api_key=PERPLEXITY_API_KEY, base_url="https://api.perplexity.ai")
            resp = await pplx.chat.completions.create(
                model="sonar-pro",
                messages=[{"role": "system", "content": system}, {"role": "user", "content": question}],
                max_tokens=300,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"Perplexity answer failed, falling back: {e}")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(), system_message=system).with_model("openai", "gpt-4o-mini")
    return (await chat.send_message(UserMessage(text=question))).strip()


async def brain_intake(profile: dict, title: str) -> dict:
    system = (
        "You are Homie, a master contractor talking to a homeowner who just told you the job they "
        "want to do. Before drafting a plan, ask the 2-4 MOST useful plain-language questions that "
        "would let you write a guide tailored to their EXACT situation instead of a generic one. "
        "Prioritize: the specific brand + model number of the fixture/part involved (if any), the "
        "surface/site/material conditions (e.g. floor type, indoor/outdoor, wall material), and the "
        "single biggest unknown that changes the approach. Keep each question short and friendly, as "
        "if standing next to them. Respond ONLY with valid JSON (no markdown) of the form: "
        '{"questions": [{"key": "model", "question": "...", "placeholder": "...", '
        '"examples": ["...", "..."]}]} with 2 to 4 questions.'
    ) + lang_note(profile) + memory_note(profile, title)
    user_text = f"The homeowner wants to: '{title}'. Ask your clarifying questions now as JSON."
    data = await _llm_json(system, user_text, max_tokens=600)
    qs = data.get("questions") if isinstance(data, dict) else None
    return {"questions": qs[:4]} if isinstance(qs, list) else {"questions": []}


async def brain_adapt(profile: dict, title: str, steps: List[dict], problem: str) -> dict:
    step_lines = "\n".join(f"{s.get('index')}. {s.get('title')}: {s.get('instruction')}" for s in steps)
    system = (
        "You are Homie, a master contractor. The homeowner is in the MIDDLE of a project and just told "
        "you a problem or change. Decide the MINIMAL edits to their existing step list to get them "
        "unstuck — preserve their progress, only touch what's needed. You may REVISE existing steps and/or "
        "INSERT new steps after a given step number. Respond ONLY with valid JSON (no markdown):\n"
        '{"reply": "a short, warm, expert reply under 50 words telling them what you changed and why", '
        '"updates": [{"index": <existing step number>, "title": "2-4 words", "instruction": "one clear sentence", '
        '"visual_description": "literal image-gen prompt naming tools/parts"}], '
        '"inserts": [{"after_index": <step number to insert after, 0 for start>, "title": "...", '
        '"instruction": "...", "visual_description": "..."}]}\n'
        "Use empty arrays when nothing needs changing. Never rewrite the whole list — be surgical."
    ) + lang_note(profile) + memory_note(profile, title)
    user_text = (
        f"Project: '{title}'.\nCurrent steps:\n{step_lines}\n\n"
        f"The homeowner says: \"{problem}\"\n\nReturn the minimal JSON edits now."
    )
    data = await _llm_json(system, user_text, max_tokens=1200)
    if not isinstance(data, dict):
        data = {}
    return {
        "reply": data.get("reply") or "I've tweaked your plan to handle that.",
        "updates": data.get("updates") or [],
        "inserts": data.get("inserts") or [],
    }


async def fetch_weather(q: str) -> Optional[dict]:
    if not WEATHER_API_KEY or not q:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.get(
                "https://api.weatherapi.com/v1/forecast.json",
                params={"key": WEATHER_API_KEY, "q": q, "days": 1, "aqi": "no"},
            )
        if r.status_code != 200:
            logger.warning(f"weather api {r.status_code}: {r.text[:160]}")
            return None
        data = r.json()
        cur = data.get("current", {}) or {}
        loc = data.get("location", {}) or {}
        day = ((data.get("forecast", {}) or {}).get("forecastday") or [{}])[0].get("day", {}) or {}
        return {
            "location": loc.get("name"),
            "region": loc.get("region"),
            "temp_f": cur.get("temp_f"),
            "feelslike_f": cur.get("feelslike_f"),
            "condition": (cur.get("condition") or {}).get("text"),
            "icon": (cur.get("condition") or {}).get("icon"),
            "wind_mph": cur.get("wind_mph"),
            "precip_in": cur.get("precip_in"),
            "humidity": cur.get("humidity"),
            "uv": cur.get("uv"),
            "chance_of_rain": day.get("daily_chance_of_rain", 0),
            "maxtemp_f": day.get("maxtemp_f"),
            "mintemp_f": day.get("mintemp_f"),
        }
    except Exception as e:
        logger.warning(f"fetch_weather error: {e}")
        return None


def weather_advisories(w: Optional[dict]) -> List[dict]:
    """Rule-based do/don't tips for outdoor work."""
    tips: List[dict] = []
    if not w:
        return tips
    temp = w.get("temp_f")
    rain = w.get("chance_of_rain") or 0
    precip = w.get("precip_in") or 0
    wind = w.get("wind_mph") or 0
    uv = w.get("uv") or 0
    hum = w.get("humidity") or 0
    if rain >= 40 or precip > 0:
        tips.append({"level": "warn", "icon": "weather-pouring",
                     "text": f"{rain}% chance of rain today — hold off on exterior paint, stain, sealant or concrete; they need a dry window to cure."})
    if temp is not None and temp >= 85:
        tips.append({"level": "warn", "icon": "thermometer-high",
                     "text": "It's hot — paint and adhesives dry too fast and can streak. Work in shade, early morning or evening, and stay hydrated."})
    if temp is not None and temp <= 50:
        tips.append({"level": "warn", "icon": "snowflake",
                     "text": "It's cold — most paints, caulk and concrete won't cure below 50°F. Check the product's min temperature before starting."})
    if wind >= 15:
        tips.append({"level": "warn", "icon": "weather-windy",
                     "text": f"Windy ({round(wind)} mph) — skip spraying and sanding (overspray and debris travel), and double-check ladder footing."})
    if uv >= 7:
        tips.append({"level": "info", "icon": "weather-sunny-alert",
                     "text": "High UV index — wear sunscreen and take shade breaks on any longer outdoor job."})
    if hum >= 80 and not any(t["level"] == "warn" for t in tips):
        tips.append({"level": "info", "icon": "water-percent",
                     "text": "High humidity — finishes and adhesives dry slower today. Plan extra cure time."})
    if not tips and temp is not None:
        tips.append({"level": "good", "icon": "weather-partly-cloudy",
                     "text": "Great conditions for outdoor work — go for it!"})
    return tips


def weather_context_str(w: Optional[dict]) -> str:
    if not w:
        return ""
    return (f"{w.get('location') or 'your area'}: {w.get('condition')}, {w.get('temp_f')}°F "
            f"(feels {w.get('feelslike_f')}°F), wind {w.get('wind_mph')} mph, "
            f"{w.get('chance_of_rain')}% chance of rain, humidity {w.get('humidity')}%, UV {w.get('uv')}")


def _owned(tool: str, owned_tools: List[str]) -> bool:
    t = tool.lower()
    for ut in owned_tools:
        first = ut.lower().split("/")[0].split()[0] if ut else ""
        if first and (first in t or t in ut.lower()):
            return True
    return False


# ---------------------------------------------------------------- auth routes
@api_router.post("/auth/register")
async def register(req: RegisterReq):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = {
        "id": new_id(),
        "email": req.email.lower(),
        "name": req.name,
        "hashed_password": pwd_context.hash(req.password),
        "experience": None,
        "tools": [],
        "budget": None,
        "pain_point": None,
        "expectation": None,
        "location": "",
        "credits": 60,          # trial credits
        "voice_minutes": 3,
        "subscription_tier": "free",
        "onboarded": False,
        "referral_code": new_id().replace("-", "")[:6].upper(),
        "signup_source": "email",
        "last_login": now_iso(),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    await link_referral(req.ref, user["id"])
    await email_engine.trigger_event("welcome", user)
    try:
        await emit_event("signup", user["id"], {})
    except Exception as e:
        logger.warning(f"automation signup failed: {e}")
    token = create_token(user["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@api_router.post("/auth/login")
async def login(req: LoginReq):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not pwd_context.verify(req.password, user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    token = create_token(user["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


class GoogleAuthReq(BaseModel):
    session_id: str


@api_router.post("/auth/google")
async def google_auth(req: GoogleAuthReq):
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": req.session_id},
            )
    except Exception as e:
        logger.error(f"google session fetch failed: {e}")
        raise HTTPException(status_code=502, detail="Could not reach Google sign-in service")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Google sign-in failed")
    data = r.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="Google sign-in returned no email")
    user = await db.users.find_one({"email": email})
    if not user:
        user = {
            "id": new_id(),
            "email": email,
            "name": data.get("name", ""),
            "picture": data.get("picture", ""),
            "hashed_password": None,
            "auth_provider": "google",
            "experience": None,
            "tools": [],
            "budget": None,
            "pain_point": None,
            "expectation": None,
            "location": "",
            "credits": 60,
            "voice_minutes": 3,
            "subscription_tier": "free",
            "onboarded": False,
            "signup_source": "google",
            "last_login": now_iso(),
            "created_at": now_iso(),
        }
        await db.users.insert_one(user)
    else:
        await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    token = create_token(user["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@api_router.put("/profile")
async def update_profile(req: ProfileReq, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in req.dict().items() if v is not None}
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return public_user(fresh)


# ---------------------------------------------------------------- project routes
@api_router.post("/projects")
async def start_project(req: StartProjectReq, user: dict = Depends(get_current_user)):
    project = {
        "id": new_id(),
        "user_id": user["id"],
        "title": req.title,
        "location": req.location or user.get("location", ""),
        "status": "active",
        "favorite": False,
        "notes": "",
        "guide": None,
        "steps": [],
        "missing_supplies": [],
        "created_at": now_iso(),
        "last_viewed_at": now_iso(),
        "completed_at": None,
    }
    await db.projects.insert_one(project)
    project.pop("_id", None)
    return project


@api_router.get("/projects")
async def list_projects(user: dict = Depends(get_current_user)):
    docs = await db.projects.find({"user_id": user["id"]}, {"_id": 0}).sort("last_viewed_at", -1).to_list(200)
    out = []
    for p in docs:
        steps = p.get("steps", [])
        total = len(steps)
        done = sum(1 for s in steps if s.get("done"))
        out.append({
            "id": p["id"],
            "title": p["title"],
            "status": p.get("status", "active"),
            "favorite": p.get("favorite", False),
            "has_guide": p.get("guide") is not None,
            "total_steps": total,
            "done_steps": done,
            "progress": int((done / total) * 100) if total else 0,
            "created_at": p.get("created_at"),
            "last_viewed_at": p.get("last_viewed_at"),
        })
    return out


class PatchProjectReq(BaseModel):
    favorite: Optional[bool] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    touch: Optional[bool] = None


@api_router.patch("/projects/{project_id}")
async def patch_project(project_id: str, req: PatchProjectReq, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    updates = {}
    if req.favorite is not None:
        updates["favorite"] = req.favorite
    if req.notes is not None:
        updates["notes"] = req.notes
    if req.status is not None:
        updates["status"] = req.status
        if req.status == "completed":
            updates["completed_at"] = now_iso()
    if req.touch:
        updates["last_viewed_at"] = now_iso()
    if updates:
        await db.projects.update_one({"id": project_id}, {"$set": updates})
    fresh = await db.projects.find_one({"id": project_id}, {"_id": 0})
    return fresh


class GuideReq(BaseModel):
    context: Optional[dict] = None


@api_router.post("/projects/{project_id}/intake")
async def project_intake(project_id: str, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        data = await brain_intake(user, project["title"])
    except Exception as e:
        logger.warning(f"intake error: {e}")
        data = {"questions": []}
    data["remembers"] = bool(relevant_memories(user, project["title"]))
    return data


@api_router.post("/projects/{project_id}/guide")
async def build_guide(project_id: str, req: GuideReq = GuideReq(), user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.get("guide"):
        return project
    # First guide ever is free (demo / sandbox conversion moment).
    prior_guides = await db.projects.count_documents({"user_id": user["id"], "guide": {"$ne": None}})
    cost = 0 if prior_guides == 0 else 3
    if user.get("credits", 0) < cost:
        raise HTTPException(status_code=402, detail="Out of credits. Upgrade to continue.")
    context = (req.context if req else None) or project.get("context") or {}
    loc_query = project.get("location") or user.get("location") or ""
    weather = await fetch_weather(loc_query)
    try:
        data = await brain_generate_guide(user, project["title"], weather_context_str(weather), context)
    except Exception as e:
        logger.error(f"guide error: {e}")
        raise HTTPException(status_code=502, detail="Homie could not draft the plan. Try again.")

    raw_steps = data.get("steps", []) or []
    steps = []
    for i, s in enumerate(raw_steps):
        steps.append({
            "id": new_id(),
            "index": i + 1,
            "title": s.get("title", f"Step {i + 1}"),
            "instruction": s.get("instruction", ""),
            "visual_description": s.get("visual_description", ""),
            "image_base64": None,
            "done": False,
        })

    owned = user.get("tools", []) or []
    missing_tools = [t for t in (data.get("tools", []) or []) if not _owned(t, owned)]
    materials = data.get("materials", []) or []
    missing_supplies = []
    for x in missing_tools + materials:
        if x and x not in missing_supplies:
            missing_supplies.append(x)

    guide = {
        "overview": data.get("overview", ""),
        "tools": data.get("tools", []) or [],
        "materials": materials,
        "safety_warnings": data.get("safety_warnings", []) or [],
        "code_alert": data.get("code_alert"),
        "common_mistakes": data.get("common_mistakes", []) or [],
        "troubleshooting": data.get("troubleshooting", []) or [],
        "inspection_checklist": data.get("inspection_checklist", []) or [],
        "owned_tools": owned,
    }
    await db.projects.update_one(
        {"id": project_id},
        {"$set": {"guide": guide, "steps": steps, "missing_supplies": missing_supplies, "context": context, "last_viewed_at": now_iso()}},
    )
    room = detect_room(project["title"] + " " + " ".join(str(v) for v in (context or {}).values()))
    ctx_txt = "; ".join(f"{k}: {v}" for k, v in (context or {}).items() if v)
    await push_memory(user["id"], user.get("home_memory"), room,
                      f"{project['title']}" + (f" — {ctx_txt}" if ctx_txt else ""))
    try:
        await maybe_create_blog_post(project, guide, steps, context)
    except Exception as e:
        logger.warning(f"blog auto-gen skipped: {e}")
    new_credits = user.get("credits", 0) - cost
    await db.users.update_one({"id": user["id"]}, {"$set": {"credits": new_credits}})
    fresh = await db.projects.find_one({"id": project_id}, {"_id": 0})
    return fresh


class StepDoneReq(BaseModel):
    done: bool


@api_router.post("/projects/{project_id}/steps/{step_id}/done")
async def set_step_done(project_id: str, step_id: str, req: StepDoneReq, user: dict = Depends(get_current_user)):
    res = await db.projects.update_one(
        {"id": project_id, "user_id": user["id"], "steps.id": step_id},
        {"$set": {"steps.$.done": req.done, "last_viewed_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Step not found")
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    steps = project.get("steps", [])
    done = sum(1 for s in steps if s.get("done"))
    total = len(steps)
    if total and done == total and project.get("status") != "completed":
        await db.projects.update_one({"id": project_id}, {"$set": {"status": "completed", "completed_at": now_iso()}})
    return {"done_steps": done, "total_steps": total, "progress": int((done / total) * 100) if total else 0}


class AskReq(BaseModel):
    message: str
    mode: str = "text"


@api_router.post("/projects/{project_id}/ask")
async def ask_homie(project_id: str, req: AskReq, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    cost = 2 if req.mode == "voice" else 1
    if user.get("credits", 0) < cost:
        raise HTTPException(status_code=402, detail="Out of credits. Upgrade to continue.")
    try:
        answer = await brain_answer(user, project["title"], req.message)
    except Exception as e:
        logger.error(f"ask error: {e}")
        raise HTTPException(status_code=502, detail="Homie couldn't answer right now. Try again.")
    new_credits = user.get("credits", 0) - cost
    await db.users.update_one({"id": user["id"]}, {"$set": {"credits": new_credits}})
    return {"answer": answer, "credits": new_credits}


class AdaptReq(BaseModel):
    problem: str


@api_router.post("/projects/{project_id}/adapt")
async def adapt_guide(project_id: str, req: AdaptReq, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.get("steps"):
        raise HTTPException(status_code=400, detail="Build a plan first.")
    cost = 1
    if user.get("credits", 0) < cost:
        raise HTTPException(status_code=402, detail="Out of credits. Upgrade to continue.")
    try:
        result = await brain_adapt(user, project["title"], project["steps"], req.problem)
    except Exception as e:
        logger.error(f"adapt error: {e}")
        raise HTTPException(status_code=502, detail="Homie couldn't adjust the plan. Try again.")

    steps = [dict(s) for s in project["steps"]]
    changed_ids = []

    # 1) revise existing steps (match by current index)
    for u in result.get("updates", []):
        try:
            idx = int(u.get("index"))
        except (TypeError, ValueError):
            continue
        for s in steps:
            if s.get("index") == idx:
                if u.get("title"):
                    s["title"] = u["title"]
                if u.get("instruction"):
                    s["instruction"] = u["instruction"]
                if u.get("visual_description"):
                    s["visual_description"] = u["visual_description"]
                    s["image_base64"] = None  # regenerate visual for the new instruction
                changed_ids.append(s["id"])
                break

    # 2) insert new steps after a given index
    for ins in result.get("inserts", []):
        try:
            after = int(ins.get("after_index", 0))
        except (TypeError, ValueError):
            after = len(steps)
        new_step = {
            "id": new_id(),
            "index": 0,
            "title": ins.get("title", "New step"),
            "instruction": ins.get("instruction", ""),
            "visual_description": ins.get("visual_description", ""),
            "image_base64": None,
            "done": False,
            "added": True,
        }
        pos = next((i + 1 for i, s in enumerate(steps) if s.get("index") == after), len(steps))
        steps.insert(pos, new_step)
        changed_ids.append(new_step["id"])

    # renumber
    for i, s in enumerate(steps):
        s["index"] = i + 1

    await db.projects.update_one(
        {"id": project_id},
        {"$set": {"steps": steps, "last_viewed_at": now_iso()}},
    )
    await push_memory(user["id"], user.get("home_memory"), detect_room(project["title"]),
                      f"While '{project['title']}': {req.problem[:160]}")
    new_credits = user.get("credits", 0) - cost
    await db.users.update_one({"id": user["id"]}, {"$set": {"credits": new_credits}})
    fresh = await db.projects.find_one({"id": project_id}, {"_id": 0})
    return {"reply": result.get("reply"), "project": fresh, "changed_ids": changed_ids, "credits": new_credits}


@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@api_router.post("/projects/{project_id}/step")
async def next_step(project_id: str, req: StepReq, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    cost = 2 if req.mode == "voice" else 1
    if user.get("credits", 0) < cost:
        raise HTTPException(status_code=402, detail="Out of credits. Upgrade to continue.")

    history = []
    for s in project.get("steps", []):
        history.append({"role": "assistant", "content": s["text_instruction"]})
        history.append({"role": "user", "content": s.get("user_message", "Next")})

    try:
        data = await brain_generate(user, project["title"], history, req.message)
    except Exception as e:
        logger.error(f"brain_generate error: {e}")
        raise HTTPException(status_code=502, detail="Homie could not reach the knowledge base. Try again.")

    step = {
        "id": new_id(),
        "index": len(project.get("steps", [])) + 1,
        "user_message": req.message,
        "step_title": data.get("step_title", f"Step {len(project.get('steps', [])) + 1}"),
        "text_instruction": data.get("text_instruction", ""),
        "visual_description": data.get("visual_description", ""),
        "missing_tools": data.get("missing_tools", []) or [],
        "code_alert": data.get("code_alert"),
        "image_base64": None,
        "mode": req.mode,
        "created_at": now_iso(),
    }

    # aggregate missing supplies on project
    new_supplies = project.get("missing_supplies", [])
    for t in step["missing_tools"]:
        if t and t not in new_supplies:
            new_supplies.append(t)

    await db.projects.update_one(
        {"id": project_id},
        {"$push": {"steps": step}, "$set": {"missing_supplies": new_supplies}},
    )
    # deduct credits
    new_credits = user.get("credits", 0) - cost
    await db.users.update_one({"id": user["id"]}, {"$set": {"credits": new_credits}})

    return {"step": step, "credits": new_credits, "missing_supplies": new_supplies}


@api_router.post("/projects/{project_id}/step/{step_id}/image")
async def step_image(project_id: str, step_id: str, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    step = next((s for s in project.get("steps", []) if s["id"] == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    if step.get("image_base64"):
        return {"image_base64": step["image_base64"]}

    img = await generate_step_image(step["visual_description"], project["title"])
    if not img:
        raise HTTPException(status_code=502, detail="Image generation failed")
    await db.projects.update_one(
        {"id": project_id, "steps.id": step_id},
        {"$set": {"steps.$.image_base64": img}},
    )
    return {"image_base64": img}


# ---------------------------------------------------------------- supplies (Amazon affiliate)
AMAZON_TAG = "diyhomie-20"


@api_router.get("/projects/{project_id}/supplies")
async def get_supplies(project_id: str, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    guide = project.get("guide", {}) or {}
    owned_tools = user.get("tools", []) or []
    state = project.get("supply_state", {}) or {}
    cfg = await affiliate_engine.ensure_config()
    retailers = affiliate_engine._ordered_retailers(cfg)

    def links_for(name: str):
        return [{"retailer": rk, "label": rc.get("label", rk), "url": affiliate_engine._build_link(rk, rc, name)}
                for rk, rc in retailers]

    def mk(name: str, category: str):
        default_owned = category == "tool" and _owned(name, owned_tools)
        owned = bool(state.get(name, default_owned))
        return {"name": name, "category": category, "owned": owned, "links": links_for(name)}

    materials = [mk(m, "material") for m in (guide.get("materials") or [])]
    tools = [mk(t, "tool") for t in (guide.get("tools") or [])]
    if not materials and not tools:  # fallback for older projects
        materials = [mk(s, "material") for s in project.get("missing_supplies", [])]

    all_items = materials + tools
    total = len(all_items)
    owned_ct = sum(1 for i in all_items if i["owned"])
    readiness = round(owned_ct / total * 100) if total else 0

    remaining = [i["name"] for i in all_items if not i["owned"]]
    bundle_q = "+".join(s.replace(" ", "+") for s in remaining)
    amz = cfg.get("retailers", {}).get("amazon", {})
    tag = amz.get("affiliate_tag") or AMAZON_TAG
    bundle_url = f"https://www.amazon.com/s?k={bundle_q}&tag={tag}" if bundle_q else ""

    return {
        "materials": materials, "tools": tools,
        "readiness": readiness, "owned_count": owned_ct, "total": total,
        "bundle_url": bundle_url, "project_title": project["title"],
    }


class SupplyToggleReq(BaseModel):
    name: str
    owned: bool


@api_router.patch("/projects/{project_id}/supplies")
async def toggle_supply(project_id: str, req: SupplyToggleReq, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.projects.update_one({"id": project_id}, {"$set": {f"supply_state.{req.name}": req.owned}})
    return {"ok": True, "name": req.name, "owned": req.owned}


# ---------------------------------------------------------------- Financial Intelligence (CFO)
async def _finance_config():
    c = await db.finance_config.find_one({"id": "singleton"}, {"_id": 0})
    if not c:
        c = {"id": "singleton", "cash_on_hand_cents": 0}
        await db.finance_config.insert_one(dict(c))
    return c


@api_router.get("/admin/finance/summary")
async def finance_summary(admin: dict = Depends(require_admin)):
    mrr = 0
    tier_counts: dict = {}
    async for u in db.users.find({"subscription_status": "active"}, {"subscription_tier": 1}):
        p = PLAN_TIERS.get(u.get("subscription_tier"))
        if p and p.get("amount"):
            mrr += p["amount"]
            tier_counts[u["subscription_tier"]] = tier_counts.get(u["subscription_tier"], 0) + 1
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    rev_month = 0
    async for tx in db.payment_transactions.find({"fulfilled": True, "created_at": {"$gte": start}}, {"amount": 1}):
        rev_month += tx.get("amount", 0) or 0
    exps = await db.finance_expenses.find({}, {"_id": 0}).to_list(500)
    monthly_exp = sum(e["amount_cents"] for e in exps if e.get("cadence") == "monthly")
    net = mrr - monthly_exp
    margin = round(net / mrr * 100, 1) if mrr else 0.0
    cfg = await _finance_config()
    cash = cfg.get("cash_on_hand_cents", 0)
    runway = round(cash / abs(net), 1) if net < 0 and cash > 0 else None
    paying = sum(tier_counts.values())
    return {
        "mrr": mrr, "revenue_month": rev_month, "monthly_expenses": monthly_exp,
        "net_monthly": net, "margin": margin, "cash_on_hand": cash, "runway_months": runway,
        "tier_counts": tier_counts, "paying_users": paying,
        "total_users": await db.users.count_documents({}),
        "arpu": round(mrr / paying) if paying else 0,
        "expenses": sorted(exps, key=lambda e: e.get("amount_cents", 0), reverse=True),
    }


class ExpenseReq(BaseModel):
    label: str
    amount_cents: int
    cadence: str = "monthly"


@api_router.post("/admin/finance/expenses")
async def add_expense(req: ExpenseReq, admin: dict = Depends(require_admin)):
    doc = {"id": new_id(), "label": req.label[:80], "amount_cents": max(0, req.amount_cents),
           "cadence": "monthly" if req.cadence != "once" else "once", "created_at": now_iso()}
    await db.finance_expenses.insert_one(dict(doc))
    return doc


@api_router.delete("/admin/finance/expenses/{eid}")
async def del_expense(eid: str, admin: dict = Depends(require_admin)):
    await db.finance_expenses.delete_one({"id": eid})
    return {"ok": True}


class CashReq(BaseModel):
    cash_on_hand_cents: int


@api_router.put("/admin/finance/cash")
async def set_cash(req: CashReq, admin: dict = Depends(require_admin)):
    await db.finance_config.update_one({"id": "singleton"}, {"$set": {"cash_on_hand_cents": max(0, req.cash_on_hand_cents)}}, upsert=True)
    return {"ok": True}


# ---------------------------------------------------------------- Homeowner Journey (Achievement & Progression Engine)
SKILL_MAP = {
    "bathroom": ("Bathroom Pro", "shower-head"),
    "kitchen": ("Kitchen Craftsman", "countertop"),
    "outdoor": ("Outdoor Specialist", "tree-outline"),
    "basement": ("Basement Builder", "home-floor-b"),
    "garage": ("Garage Guru", "garage"),
    "laundry": ("Laundry Fixer", "washing-machine"),
    "bedroom": ("Room Refresher", "bed-outline"),
    "living": ("Living-Space Designer", "sofa-outline"),
}


async def brain_completion_story(profile: dict, title: str, context: dict, cost_cents: Optional[int], hours: Optional[float], reflection: str) -> dict:
    """Generate a warm testimonial-style story + estimate what a pro would have charged."""
    system = (
        "You are Homie, celebrating a homeowner who just FINISHED a DIY project. Write a short, "
        "authentic first-person testimonial story of their accomplishment — proud but grounded, no hype. "
        "Also estimate what a licensed professional/contractor would realistically have charged for this "
        "exact job in the US (labor + typical markup), as an integer number of US CENTS. "
        "Pick a short skill tag that best labels the expertise they just demonstrated "
        "(e.g. 'Leak Fixer', 'Deck Specialist', 'Tile Setter', 'Painter'). "
        "Respond ONLY with valid JSON (no markdown) with EXACTLY these keys: "
        '{"story_title": "3-6 word proud headline", '
        '"story": "2-4 sentence first-person story under 60 words", '
        '"pro_cost_cents": <integer US cents a pro would charge>, '
        '"skill_tag": "1-3 word skill label"}'
    ) + lang_note(profile)
    details = "; ".join(f"{k}: {v}" for k, v in (context or {}).items() if v)
    user_text = (
        f"Project finished: '{title}'."
        + (f"\nDetails: {details}." if details else "")
        + (f"\nThey spent about ${(cost_cents or 0)/100:.0f} on materials." if cost_cents else "")
        + (f"\nIt took them about {hours} hours." if hours else "")
        + (f"\nTheir own words: \"{reflection}\"." if reflection else "")
        + "\nWrite the JSON now."
    )
    try:
        data = await _llm_json(system, user_text, max_tokens=500)
    except Exception as e:
        logger.warning(f"completion story failed: {e}")
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {
        "story_title": (data.get("story_title") or f"{title} — Done!")[:80],
        "story": (data.get("story") or "Another project done right. On to the next one.")[:400],
        "pro_cost_cents": int(data.get("pro_cost_cents") or 0),
        "skill_tag": (data.get("skill_tag") or "DIYer")[:32],
    }


def _achievements(entries: List[dict], money_saved: int, helpful_answers: int) -> List[dict]:
    completed = len(entries)
    shared = any(e.get("shared") for e in entries)
    has_before_after = any(e.get("before_photo") and e.get("after_photo") for e in entries)
    defs = [
        {"id": "first_project", "title": "First Project", "icon": "hammer", "desc": "Finished your first DIY project", "earned": completed >= 1},
        {"id": "getting_handy", "title": "Getting Handy", "icon": "tools", "desc": "Completed 3 projects", "earned": completed >= 3},
        {"id": "seasoned_diyer", "title": "Seasoned DIYer", "icon": "medal-outline", "desc": "Completed 5 projects", "earned": completed >= 5},
        {"id": "home_master", "title": "Home Master", "icon": "crown-outline", "desc": "Completed 10 projects", "earned": completed >= 10},
        {"id": "money_saver", "title": "Money Saver", "icon": "cash", "desc": "Saved $500 vs hiring a pro", "earned": money_saved >= 50000},
        {"id": "big_saver", "title": "Big Saver", "icon": "cash-multiple", "desc": "Saved $1,000 vs hiring a pro", "earned": money_saved >= 100000},
        {"id": "storyteller", "title": "Storyteller", "icon": "bullhorn-outline", "desc": "Shared a project with the community", "earned": shared},
        {"id": "before_after", "title": "Before & After", "icon": "image-multiple-outline", "desc": "Posted a before/after transformation", "earned": has_before_after},
        {"id": "community_mentor", "title": "Community Mentor", "icon": "account-heart-outline", "desc": "Gave 3 verified helpful answers", "earned": helpful_answers >= 3},
    ]
    return defs


async def _journey_data(user: dict) -> dict:
    uid = user["id"]
    entries = await db.timeline.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    money_saved = sum(int(e.get("money_saved_cents") or 0) for e in entries)
    total_hours = sum(float(e.get("hours") or 0) for e in entries)
    # skills: aggregate by skill_tag
    skills: dict = {}
    for e in entries:
        tag = e.get("skill_tag") or "DIYer"
        skills[tag] = skills.get(tag, 0) + 1
    helpful_answers = await db.posts.count_documents(
        {"replies": {"$elemMatch": {"user_id": uid, "verified": True}}}
    )
    experiences = await db.community_experiences.count_documents({"user_id": uid})
    achievements = _achievements(entries, money_saved, helpful_answers)
    return {
        "projects_completed": len(entries),
        "money_saved_cents": money_saved,
        "total_hours": round(total_hours, 1),
        "helpful_answers": helpful_answers,
        "community_experiences": experiences,
        "skills": [{"tag": k, "count": v} for k, v in sorted(skills.items(), key=lambda x: -x[1])],
        "achievements": achievements,
        "achievements_earned": sum(1 for a in achievements if a["earned"]),
        "timeline": entries,
    }


class CompleteProjectReq(BaseModel):
    cost_cents: Optional[int] = None
    hours: Optional[float] = None
    rating: Optional[int] = None
    reflection: Optional[str] = ""
    before_photo: Optional[str] = None
    after_photo: Optional[str] = None
    share_community: bool = False


@api_router.post("/projects/{project_id}/complete")
async def complete_project(project_id: str, req: CompleteProjectReq, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if await db.timeline.find_one({"project_id": project_id}):
        raise HTTPException(status_code=400, detail="This project is already in your timeline.")

    # achievements earned BEFORE this completion (to detect the new ones)
    before = await _journey_data(user)
    before_ids = {a["id"] for a in before["achievements"] if a["earned"]}

    context = project.get("context") or {}
    story = await brain_completion_story(
        user, project["title"], context, req.cost_cents, req.hours, (req.reflection or "").strip()
    )
    pro_cost = max(0, story["pro_cost_cents"])
    money_saved = max(0, pro_cost - (req.cost_cents or 0))
    room = detect_room(project["title"] + " " + " ".join(str(v) for v in context.values()))
    skill_label, skill_icon = SKILL_MAP.get(room, (story["skill_tag"], "star-four-points-outline"))

    entry = {
        "id": new_id(),
        "user_id": user["id"],
        "project_id": project_id,
        "title": project["title"],
        "story_title": story["story_title"],
        "story": story["story"],
        "room": room,
        "skill_tag": skill_label,
        "skill_icon": skill_icon,
        "cost_cents": req.cost_cents or 0,
        "pro_cost_cents": pro_cost,
        "money_saved_cents": money_saved,
        "hours": req.hours or 0,
        "rating": req.rating,
        "before_photo": req.before_photo,
        "after_photo": req.after_photo,
        "shared": bool(req.share_community),
        "created_at": now_iso(),
    }
    await db.timeline.insert_one(dict(entry))
    await db.projects.update_one({"id": project_id}, {"$set": {"status": "completed", "completed_at": now_iso()}})

    # Auto-post the accomplishment to the community feed (Sheet #2).
    if req.share_community:
        body = story["story"]
        if money_saved:
            body += f"\n\n💰 Saved about ${money_saved/100:,.0f} vs hiring a pro."
        mine = await db.community_experiences.count_documents({"user_id": user["id"]})
        photos = [p for p in (req.after_photo, req.before_photo) if p][:2]
        exp = {
            "id": new_id(), "project_slug": slugify(project["title"]), "user_id": user["id"],
            "author": user.get("name") or user["email"].split("@")[0],
            "badge": _community_badge(mine + 1), "location": user.get("location", ""),
            "title": story["story_title"], "body": body, "tools": [],
            "cost_cents": req.cost_cents, "minutes": int((req.hours or 0) * 60) or None,
            "cheers": 0, "photos": photos, "seeded": False, "is_completion": True,
            "created_at": now_iso(),
        }
        await db.community_experiences.insert_one(dict(exp))

    after = await _journey_data(user)
    new_achievements = [a for a in after["achievements"] if a["earned"] and a["id"] not in before_ids]
    try:
        await emit_event("project_completed", user["id"], {
            "projects_completed": after["projects_completed"],
            "money_saved_cents": money_saved,
            "cost_cents": req.cost_cents or 0,
            "hours": req.hours or 0,
        })
    except Exception as e:
        logger.warning(f"automation project_completed failed: {e}")
    return {
        "entry": entry,
        "money_saved_cents": money_saved,
        "pro_cost_cents": pro_cost,
        "new_achievements": new_achievements,
        "journey": after,
    }


@api_router.get("/journey")
async def my_journey(user: dict = Depends(get_current_user)):
    data = await _journey_data(user)
    data["name"] = user.get("name") or user["email"].split("@")[0]
    data["avatar_base64"] = user.get("avatar_base64")
    data["bio"] = user.get("bio", "")
    data["share_public"] = user.get("share_public", False)
    data["member_since"] = user.get("created_at")
    return data


@api_router.get("/journey/u/{user_id}")
async def public_journey(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u or not u.get("share_public"):
        raise HTTPException(status_code=404, detail="This homeowner's journey is private.")
    data = await _journey_data(u)
    return {
        "name": u.get("name") or u["email"].split("@")[0],
        "avatar_base64": u.get("avatar_base64"),
        "bio": u.get("bio", ""),
        "member_since": u.get("created_at"),
        "projects_completed": data["projects_completed"],
        "money_saved_cents": data["money_saved_cents"],
        "total_hours": data["total_hours"],
        "skills": data["skills"],
        "achievements": [a for a in data["achievements"] if a["earned"]],
        "timeline": [{k: e.get(k) for k in ("id", "title", "story_title", "story", "skill_tag", "skill_icon", "money_saved_cents", "hours", "after_photo", "created_at")} for e in data["timeline"]],
    }


# ---------------------------------------------------------------- Knowledge Search & Pro Referral (Sheet #12)
def _kw_regex(q: str):
    terms = [re.escape(t) for t in re.findall(r"[a-zA-Z0-9]+", q.lower()) if len(t) > 2 and t not in STOP_WORDS]
    if not terms:
        terms = [re.escape(q.strip())]
    return {"$regex": "|".join(terms), "$options": "i"}


async def _expand_query(q: str) -> dict:
    try:
        system = ("You expand a homeowner's DIY search query to help them find the right guide. "
                  "Return ONLY JSON (no markdown): "
                  '{"related": ["3-6 short related DIY search phrases"], "did_you_mean": "spelling-corrected query or null"}')
        data = await _llm_json(system, f"Query: {q}", max_tokens=200)
        if isinstance(data, dict):
            return {"related": [str(x) for x in (data.get("related") or [])][:6], "did_you_mean": data.get("did_you_mean")}
    except Exception as e:
        logger.warning(f"query expand failed: {e}")
    return {"related": [], "did_you_mean": None}


@api_router.get("/knowledge/search")
async def knowledge_search(q: str, expand: bool = True, user: dict = Depends(get_current_user)):
    q = (q or "").strip()
    if len(q) < 2:
        return {"query": q, "results": [], "related": [], "did_you_mean": None, "counts": {}}
    rx = _kw_regex(q)
    results = []
    async for b in db.blog_posts.find({"published": True, "$or": [{"title": rx}, {"excerpt": rx}, {"keywords": rx}, {"category": rx}]}, {"_id": 0}).limit(20):
        results.append({"type": "guide", "title": b.get("title"), "snippet": (b.get("excerpt") or "")[:160], "route": f"/blog/{b.get('slug')}", "category": b.get("category")})
    async for p in db.community_projects.find({"$or": [{"title": rx}, {"blurb": rx}, {"category": rx}]}, {"_id": 0}).limit(10):
        results.append({"type": "community", "title": p.get("title"), "snippet": (p.get("blurb") or "")[:160], "route": f"/community/{p.get('slug')}", "category": p.get("category")})
    async for e in db.community_experiences.find({"$or": [{"title": rx}, {"body": rx}]}, {"_id": 0}).limit(15):
        results.append({"type": "tip", "title": e.get("title"), "snippet": (e.get("body") or "")[:160], "route": f"/community/{e.get('project_slug')}", "author": e.get("author")})
    async for t in db.community_threads.find({"question": rx}, {"_id": 0}).limit(10):
        reps = t.get("replies") or []
        snip = reps[0].get("body", "")[:160] if reps else "Unanswered — be the first to help."
        results.append({"type": "question", "title": t.get("question"), "snippet": snip, "route": f"/community/{t.get('project_slug')}"})
    counts = {}
    for r in results:
        counts[r["type"]] = counts.get(r["type"], 0) + 1
    exp = await _expand_query(q) if expand else {"related": [], "did_you_mean": None}
    return {"query": q, "results": results[:40], "related": exp["related"], "did_you_mean": exp["did_you_mean"], "counts": counts}


PRO_TRADES = ["Plumbing", "Electrical", "HVAC", "Structural / Framing", "Roofing", "Concrete / Masonry", "General Contractor", "Other"]


@api_router.get("/pro-referrals/trades")
async def pro_trades():
    return {"trades": PRO_TRADES}


class ProLeadReq(BaseModel):
    trade: str
    issue: str
    location: Optional[str] = None
    project_id: Optional[str] = None
    urgency: str = "standard"
    pro_id: Optional[str] = None
    project_summary: Optional[str] = None


@api_router.post("/pro-referrals")
async def create_pro_lead(req: ProLeadReq, user: dict = Depends(get_current_user)):
    pro_name = None
    if req.pro_id:
        pro = await db.pro_partners.find_one({"id": req.pro_id}, {"_id": 0})
        if pro:
            pro_name = pro.get("name")
            await db.pro_partners.update_one({"id": req.pro_id}, {"$inc": {"leads_count": 1}})
    lead = {
        "id": new_id(), "user_id": user["id"],
        "name": user.get("name") or user["email"].split("@")[0], "email": user.get("email"),
        "trade": req.trade[:60], "issue": req.issue.strip()[:1000],
        "location": (req.location or user.get("location") or "").strip(),
        "project_id": req.project_id, "project_summary": (req.project_summary or "")[:2000],
        "pro_id": req.pro_id, "pro_name": pro_name,
        "urgency": req.urgency if req.urgency in ("emergency", "standard", "planning") else "standard",
        "status": "new", "created_at": now_iso(),
    }
    await db.pro_leads.insert_one(dict(lead))
    return lead


@api_router.get("/pro-referrals/me")
async def my_pro_leads(user: dict = Depends(get_current_user)):
    return await db.pro_leads.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api_router.get("/admin/pro-leads")
async def admin_pro_leads(admin: dict = Depends(require_admin)):
    items = await db.pro_leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": items}


class ProLeadPatch(BaseModel):
    status: str


@api_router.patch("/admin/pro-leads/{lead_id}")
async def admin_update_pro_lead(lead_id: str, req: ProLeadPatch, admin: dict = Depends(require_admin)):
    if req.status not in ("new", "contacted", "matched", "closed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await db.pro_leads.update_one({"id": lead_id}, {"$set": {"status": req.status}})
    return {"ok": True}


# ---------------------------------------------------------------- Marketplace & Pro Service (Sheet #18)
RISKY_KEYWORDS = ["electric", "wiring", "panel", "breaker", "gas ", "structural", "load-bearing", "load bearing", "roof", "foundation", "sewer", "furnace", "chimney", "main line"]


def _pro_public(p: dict) -> dict:
    return {k: p.get(k) for k in ("id", "name", "trades", "specialties", "location", "rating", "reviews_count", "verified", "bio", "logo", "website", "phone", "email")}


async def seed_pros():
    if await db.pro_partners.count_documents({}) > 0:
        return
    base = [
        {"name": "Lone Star Plumbing Co.", "trades": ["Plumbing"], "specialties": ["Repipes", "Water heaters", "Leak detection"], "location": "Austin, TX", "rating": 4.9, "reviews_count": 214, "bio": "Licensed, insured plumbers serving Central Texas for 18 years."},
        {"name": "BrightSpark Electric", "trades": ["Electrical"], "specialties": ["Panel upgrades", "EV chargers", "Rewiring"], "location": "Austin, TX", "rating": 4.8, "reviews_count": 167, "bio": "Master electricians. Permitted work, code-compliant, upfront pricing."},
        {"name": "Summit HVAC & Air", "trades": ["HVAC"], "specialties": ["AC install", "Furnace repair", "Duct sealing"], "location": "Round Rock, TX", "rating": 4.7, "reviews_count": 132, "bio": "Same-week HVAC service, financing available."},
        {"name": "Hill Country Roofing", "trades": ["Roofing"], "specialties": ["Storm damage", "Re-roofs", "Inspections"], "location": "Austin, TX", "rating": 4.9, "reviews_count": 98, "bio": "Free roof inspections and insurance claim help."},
        {"name": "Apex General Contractors", "trades": ["General Contractor", "Structural / Framing"], "specialties": ["Additions", "Bathroom remodels", "Load-bearing walls"], "location": "Cedar Park, TX", "rating": 4.6, "reviews_count": 76, "bio": "Full-service remodels and permitted structural work."},
        {"name": "SolidBase Concrete", "trades": ["Concrete / Masonry"], "specialties": ["Driveways", "Patios", "Foundation repair"], "location": "Austin, TX", "rating": 4.7, "reviews_count": 54, "bio": "Flatwork and foundation specialists."},
    ]
    docs = [{**b, "id": new_id(), "verified": True, "active": True, "logo": None, "website": "", "phone": "", "email": "", "payout_cents": 0, "leads_count": 0, "created_at": now_iso()} for b in base]
    await db.pro_partners.insert_many(docs)
    logger.info("pros seeded")


@api_router.get("/pros")
async def list_pros(trade: Optional[str] = None, q: Optional[str] = None, location: Optional[str] = None, user: dict = Depends(get_current_user)):
    query: dict = {"active": True, "verified": True}
    if trade:
        query["trades"] = trade
    if location:
        query["location"] = {"$regex": re.escape(location), "$options": "i"}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"name": rx}, {"specialties": rx}, {"bio": rx}]
    pros = await db.pro_partners.find(query, {"_id": 0}).sort("rating", -1).to_list(100)
    return {"pros": [_pro_public(p) for p in pros], "trades": PRO_TRADES}


@api_router.get("/pros/{pro_id}")
async def get_pro(pro_id: str, user: dict = Depends(get_current_user)):
    p = await db.pro_partners.find_one({"id": pro_id, "active": True}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Pro not found")
    return _pro_public(p)


class ProApplyReq(BaseModel):
    name: str
    trades: List[str] = []
    specialties: List[str] = []
    location: str = ""
    bio: str = ""
    phone: str = ""
    email: str = ""
    website: str = ""


@api_router.post("/pros/apply")
async def apply_pro(req: ProApplyReq):
    partner = {
        "id": new_id(), "name": req.name[:100], "trades": req.trades[:8], "specialties": req.specialties[:12],
        "location": req.location[:80], "bio": req.bio[:600], "phone": req.phone[:40], "email": req.email[:120],
        "website": req.website[:200], "logo": None, "rating": 0, "reviews_count": 0,
        "verified": False, "active": False, "payout_cents": 0, "leads_count": 0, "created_at": now_iso(),
    }
    await db.pro_partners.insert_one(dict(partner))
    return {"ok": True, "id": partner["id"], "message": "Application received — our team will review and verify your listing."}


@api_router.get("/projects/{project_id}/handoff")
async def project_handoff(project_id: str, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    guide = project.get("guide") or {}
    steps = project.get("steps", [])
    done = sum(1 for s in steps if s.get("done"))
    ctx = project.get("context") or {}
    home = await db.home_profiles.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    rooms = home.get("rooms", [])
    materials = guide.get("materials") or []
    mat_names = [m.get("name") if isinstance(m, dict) else str(m) for m in materials][:12]
    lines = [f"Project: {project['title']}"]
    if ctx:
        detail = "; ".join(f"{k}: {v}" for k, v in ctx.items() if v)
        if detail:
            lines.append(f"Details the homeowner provided: {detail}")
    if steps:
        lines.append(f"Progress: {done}/{len(steps)} DIY steps done before deciding to hire out.")
    if mat_names:
        lines.append(f"Materials already scoped: {', '.join(mat_names)}")
    if guide.get("code_alert"):
        lines.append(f"Code note: {guide['code_alert']}")
    if rooms:
        lines.append(f"Home rooms on file: {', '.join(r.get('name', '') for r in rooms[:6])}")
    return {
        "project_title": project["title"],
        "summary": "\n".join(lines),
        "code_alert": guide.get("code_alert"),
        "materials": mat_names,
        "location": user.get("location", ""),
    }


@api_router.get("/projects/{project_id}/pro-suggestion")
async def pro_suggestion(project_id: str, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    guide = project.get("guide") or {}
    steps = project.get("steps", [])
    title = (project.get("title") or "").lower()
    reason = None
    trade = "General Contractor"
    code_alert = guide.get("code_alert") or next((s.get("code_alert") for s in steps if s.get("code_alert")), None)
    if code_alert:
        reason = "This project may need a permit or licensed pro — do it safely."
    elif any(k in title for k in RISKY_KEYWORDS):
        reason = "This type of work is often safest with a licensed pro."
    if "electric" in title or "wiring" in title or "panel" in title:
        trade = "Electrical"
    elif "plumb" in title or "pipe" in title or "leak" in title or "drain" in title:
        trade = "Plumbing"
    elif "roof" in title:
        trade = "Roofing"
    elif "hvac" in title or "furnace" in title or "ac " in title:
        trade = "HVAC"
    return {"suggest": bool(reason), "reason": reason, "suggested_trade": trade}


@api_router.get("/admin/pros")
async def admin_list_pros(admin: dict = Depends(require_admin)):
    items = await db.pro_partners.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": items}


class ProPartnerReq(BaseModel):
    name: str
    trades: List[str] = []
    specialties: List[str] = []
    location: str = ""
    bio: str = ""
    phone: str = ""
    email: str = ""
    website: str = ""
    rating: float = 0
    verified: bool = False
    active: bool = False
    payout_cents: int = 0


@api_router.post("/admin/pros")
async def admin_create_pro(req: ProPartnerReq, admin: dict = Depends(require_admin)):
    p = {**req.dict(), "id": new_id(), "logo": None, "reviews_count": 0, "leads_count": 0, "created_at": now_iso()}
    await db.pro_partners.insert_one(dict(p))
    return {k: v for k, v in p.items() if k != "_id"}


@api_router.patch("/admin/pros/{pro_id}")
async def admin_update_pro(pro_id: str, req: ProPartnerReq, admin: dict = Depends(require_admin)):
    res = await db.pro_partners.update_one({"id": pro_id}, {"$set": req.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pro not found")
    return await db.pro_partners.find_one({"id": pro_id}, {"_id": 0})


@api_router.delete("/admin/pros/{pro_id}")
async def admin_delete_pro(pro_id: str, admin: dict = Depends(require_admin)):
    await db.pro_partners.delete_one({"id": pro_id})
    return {"ok": True}


# ---------------------------------------------------------------- Automation & Workflow Engine (Sheet #9/#13)
AUTOMATION_TRIGGERS = [
    {"key": "signup", "label": "New user signs up", "fields": []},
    {"key": "project_completed", "label": "User completes a project", "fields": ["projects_completed", "money_saved_cents", "cost_cents", "hours"]},
    {"key": "subscription_started", "label": "User starts a paid plan", "fields": ["tier"]},
    {"key": "referral_completed", "label": "A referral converts", "fields": []},
]
AUTOMATION_ACTIONS = [
    {"key": "award_credits", "label": "Award credits", "param": "amount", "param_type": "number"},
    {"key": "add_tag", "label": "Tag the user", "param": "tag", "param_type": "text"},
    {"key": "send_email", "label": "Send email (template)", "param": "template", "param_type": "text"},
    {"key": "webhook", "label": "Call a webhook", "param": "url", "param_type": "text"},
    {"key": "log", "label": "Log event only", "param": None, "param_type": None},
]
AUTOMATION_RECIPES = [
    {"name": "5th project → bonus credits + badge email", "trigger": "project_completed",
     "conditions": [{"field": "projects_completed", "op": "gte", "value": 5}],
     "actions": [{"type": "award_credits", "amount": 50}, {"type": "send_email", "template": "milestone"}, {"type": "add_tag", "tag": "power-user"}]},
    {"name": "Welcome new signups", "trigger": "signup", "conditions": [],
     "actions": [{"type": "award_credits", "amount": 10}, {"type": "add_tag", "tag": "new"}]},
    {"name": "Big saver → testimonial ask", "trigger": "project_completed",
     "conditions": [{"field": "money_saved_cents", "op": "gte", "value": 100000}],
     "actions": [{"type": "add_tag", "tag": "big-saver"}, {"type": "send_email", "template": "testimonial_ask"}]},
    {"name": "New subscriber → thank-you", "trigger": "subscription_started", "conditions": [],
     "actions": [{"type": "add_tag", "tag": "paying"}, {"type": "send_email", "template": "thank_you"}]},
]


def _cond_ok(conditions: list, data: dict) -> bool:
    for c in conditions or []:
        val = data.get(c.get("field"))
        op, target = c.get("op"), c.get("value")
        try:
            if op == "gte" and not (val is not None and float(val) >= float(target)):
                return False
            elif op == "lte" and not (val is not None and float(val) <= float(target)):
                return False
            elif op == "eq" and str(val) != str(target):
                return False
            elif op == "contains" and str(target).lower() not in str(val or "").lower():
                return False
        except (TypeError, ValueError):
            return False
    return True


async def _run_action(action: dict, user: dict, data: dict) -> dict:
    t = action.get("type")
    try:
        if t == "award_credits":
            amt = int(action.get("amount") or 0)
            await db.users.update_one({"id": user["id"]}, {"$inc": {"credits": amt}})
            return {"type": t, "ok": True, "detail": f"+{amt} credits"}
        if t == "add_tag":
            tag = str(action.get("tag") or "").strip()
            if tag:
                await db.users.update_one({"id": user["id"]}, {"$addToSet": {"tags": tag}})
            return {"type": t, "ok": True, "detail": f"tag '{tag}'"}
        if t == "send_email":
            tmpl = str(action.get("template") or "").strip()
            await email_engine.trigger_event(tmpl, user, data)
            note = "queued" if email_engine.keys_present() else "queued (SES keys missing — will send once configured)"
            return {"type": t, "ok": True, "detail": f"email '{tmpl}' {note}"}
        if t == "webhook":
            url = str(action.get("url") or "")
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(url, json={"user_id": user["id"], "email": user.get("email"), "data": data})
            return {"type": t, "ok": True, "detail": f"POST {url[:50]}"}
        return {"type": t, "ok": True, "detail": "logged"}
    except Exception as e:
        return {"type": t, "ok": False, "detail": str(e)[:120]}


async def emit_event(trigger: str, user_id: str, data: dict = None, test_rule: dict = None):
    """Run all enabled automation rules matching a business trigger."""
    data = data or {}
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return []
    rules = [test_rule] if test_rule else await db.automation_rules.find({"trigger": trigger, "enabled": True}, {"_id": 0}).to_list(200)
    fired = []
    for rule in rules:
        if not _cond_ok(rule.get("conditions"), data):
            continue
        results = [await _run_action(a, user, data) for a in rule.get("actions", [])]
        log = {"id": new_id(), "rule_id": rule.get("id"), "rule_name": rule.get("name"),
               "trigger": trigger, "user_email": user.get("email"), "data": data,
               "results": results, "success": all(r["ok"] for r in results),
               "test": bool(test_rule), "created_at": now_iso()}
        await db.automation_logs.insert_one(dict(log))
        if not test_rule:
            await db.automation_rules.update_one({"id": rule["id"]}, {"$inc": {"runs": 1}, "$set": {"last_run": now_iso()}})
        log.pop("_id", None)
        fired.append(log)
    return fired


class RuleReq(BaseModel):
    name: str
    trigger: str
    conditions: List[dict] = []
    actions: List[dict] = []
    enabled: bool = True


@api_router.get("/admin/automations/meta")
async def automation_meta(admin: dict = Depends(require_admin)):
    return {"triggers": AUTOMATION_TRIGGERS, "actions": AUTOMATION_ACTIONS, "recipes": AUTOMATION_RECIPES}


@api_router.get("/admin/automations")
async def list_automations(admin: dict = Depends(require_admin)):
    rules = await db.automation_rules.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"rules": rules}


@api_router.post("/admin/automations")
async def create_automation(req: RuleReq, admin: dict = Depends(require_admin)):
    if req.trigger not in [t["key"] for t in AUTOMATION_TRIGGERS]:
        raise HTTPException(status_code=400, detail="Unknown trigger")
    rule = {"id": new_id(), "name": req.name[:120], "trigger": req.trigger,
            "conditions": req.conditions, "actions": req.actions, "enabled": req.enabled,
            "runs": 0, "last_run": None, "created_at": now_iso()}
    await db.automation_rules.insert_one(dict(rule))
    return rule


@api_router.patch("/admin/automations/{rule_id}")
async def update_automation(rule_id: str, req: RuleReq, admin: dict = Depends(require_admin)):
    patch = {"name": req.name[:120], "trigger": req.trigger, "conditions": req.conditions,
             "actions": req.actions, "enabled": req.enabled}
    res = await db.automation_rules.update_one({"id": rule_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return await db.automation_rules.find_one({"id": rule_id}, {"_id": 0})


class ToggleReq(BaseModel):
    enabled: bool


@api_router.patch("/admin/automations/{rule_id}/toggle")
async def toggle_automation(rule_id: str, req: ToggleReq, admin: dict = Depends(require_admin)):
    await db.automation_rules.update_one({"id": rule_id}, {"$set": {"enabled": req.enabled}})
    return {"ok": True}


@api_router.delete("/admin/automations/{rule_id}")
async def delete_automation(rule_id: str, admin: dict = Depends(require_admin)):
    await db.automation_rules.delete_one({"id": rule_id})
    return {"ok": True}


@api_router.post("/admin/automations/{rule_id}/test")
async def test_automation(rule_id: str, admin: dict = Depends(require_admin)):
    rule = await db.automation_rules.find_one({"id": rule_id}, {"_id": 0})
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    sample = {"projects_completed": 5, "money_saved_cents": 120000, "cost_cents": 5000, "hours": 6, "tier": "pro"}
    fired = await emit_event(rule["trigger"], admin["id"], sample, test_rule=rule)
    return {"tested": True, "fired": bool(fired), "log": fired[0] if fired else None}


@api_router.get("/admin/automations/logs")
async def automation_logs(admin: dict = Depends(require_admin)):
    logs = await db.automation_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"logs": logs}


# ---------------------------------------------------------------- Home Digital Twin & Lifetime Log (Sheet #14)
ROOM_TYPES = ["Kitchen", "Bathroom", "Bedroom", "Living Room", "Basement", "Garage", "Outdoor / Yard", "Laundry", "Attic", "Whole House", "Other"]
SYSTEM_TYPES = ["HVAC", "Water Heater", "Electrical Panel", "Plumbing", "Roof", "Appliance", "Windows / Doors", "Other"]


async def _home_profile(user_id: str) -> dict:
    p = await db.home_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if not p:
        p = {"user_id": user_id, "rooms": [], "systems": []}
        await db.home_profiles.insert_one(dict(p))
    p.setdefault("rooms", [])
    p.setdefault("systems", [])
    return p


def _year(iso: Optional[str]) -> Optional[int]:
    try:
        return int((iso or "")[:4])
    except (ValueError, TypeError):
        return None


@api_router.get("/home")
async def get_home(user: dict = Depends(get_current_user)):
    profile = await _home_profile(user["id"])
    timeline = await db.timeline.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    memory = user.get("home_memory", []) or []

    total_saved = sum(int(e.get("money_saved_cents") or 0) for e in timeline)
    total_invested = sum(int(e.get("cost_cents") or 0) for e in timeline)
    total_hours = sum(float(e.get("hours") or 0) for e in timeline)
    years = sorted({y for y in (_year(e.get("created_at")) for e in timeline) if y}, reverse=True)

    # Lifetime knowledge log: completed projects + home facts (lightweight event log — no blobs)
    log = []
    for e in timeline:
        log.append({
            "kind": "project", "id": e.get("id"), "title": e.get("story_title") or e.get("title"),
            "detail": e.get("title"), "room": e.get("room"), "skill_tag": e.get("skill_tag"),
            "money_saved_cents": e.get("money_saved_cents"), "cost_cents": e.get("cost_cents"),
            "hours": e.get("hours"), "created_at": e.get("created_at"),
        })
    for m in memory:
        log.append({
            "kind": "note", "id": m.get("id"), "title": "Home note",
            "detail": m.get("text"), "room": m.get("room"), "created_at": m.get("created_at"),
        })
    log.sort(key=lambda x: x.get("created_at") or "", reverse=True)

    return {
        "rooms": profile["rooms"], "systems": profile["systems"],
        "stats": {
            "projects_completed": len(timeline),
            "money_saved_cents": total_saved,
            "invested_cents": total_invested,
            "total_hours": round(total_hours, 1),
            "years_active": len(years) or (1 if timeline else 0),
            "rooms": len(profile["rooms"]), "systems": len(profile["systems"]),
        },
        "years": years,
        "log": log[:200],
        "room_types": ROOM_TYPES, "system_types": SYSTEM_TYPES,
    }


class RoomReq(BaseModel):
    name: str
    type: str = "Other"
    notes: Optional[str] = ""


@api_router.post("/home/rooms")
async def add_room(req: RoomReq, user: dict = Depends(get_current_user)):
    await _home_profile(user["id"])
    room = {"id": new_id(), "name": req.name[:60], "type": req.type[:40], "notes": (req.notes or "")[:300], "created_at": now_iso()}
    await db.home_profiles.update_one({"user_id": user["id"]}, {"$push": {"rooms": room}})
    return room


@api_router.delete("/home/rooms/{room_id}")
async def del_room(room_id: str, user: dict = Depends(get_current_user)):
    await db.home_profiles.update_one({"user_id": user["id"]}, {"$pull": {"rooms": {"id": room_id}}})
    return {"ok": True}


class SystemReq(BaseModel):
    name: str
    type: str = "Other"
    install_year: Optional[int] = None
    warranty: Optional[str] = ""
    notes: Optional[str] = ""
    brand: Optional[str] = ""
    model: Optional[str] = ""
    serial: Optional[str] = ""
    purchase_date: Optional[str] = ""
    warranty_expires: Optional[str] = ""
    support_url: Optional[str] = ""
    receipt: Optional[str] = None


@api_router.post("/home/systems")
async def add_system(req: SystemReq, user: dict = Depends(get_current_user)):
    await _home_profile(user["id"])
    sysd = {"id": new_id(), "name": req.name[:60], "type": req.type[:40],
            "install_year": req.install_year, "warranty": (req.warranty or "")[:80],
            "notes": (req.notes or "")[:300], "brand": (req.brand or "")[:60],
            "model": (req.model or "")[:60], "serial": (req.serial or "")[:80],
            "purchase_date": (req.purchase_date or "")[:20], "warranty_expires": (req.warranty_expires or "")[:20],
            "support_url": (req.support_url or "")[:200], "receipt": req.receipt,
            "serviced": {}, "created_at": now_iso()}
    await db.home_profiles.update_one({"user_id": user["id"]}, {"$push": {"systems": sysd}})
    return sysd


# Recommended maintenance intervals (days) per system type — auto-scheduled (Sheet #19)
MAINT_RULES = {
    "HVAC": [("Replace air filter", 90), ("Seasonal HVAC tune-up", 180)],
    "Water Heater": [("Flush the water heater", 365)],
    "Roof": [("Roof & gutter inspection", 365)],
    "Appliance": [("Clean & descale", 180)],
    "Plumbing": [("Check fixtures for leaks", 365)],
    "Electrical Panel": [("Test breakers & inspect panel", 365)],
    "Windows / Doors": [("Re-seal & weatherstrip", 365)],
    "Other": [("General check-up", 365)],
}


def _base_date(sysd: dict) -> datetime:
    pd = sysd.get("purchase_date")
    if pd:
        try:
            return datetime.fromisoformat(pd[:10])
        except ValueError:
            pass
    yr = sysd.get("install_year")
    if yr:
        try:
            return datetime(int(yr), 1, 1)
        except (ValueError, TypeError):
            pass
    try:
        return datetime.fromisoformat((sysd.get("created_at") or now_iso())[:19])
    except ValueError:
        return datetime.utcnow()


@api_router.get("/home/maintenance")
async def home_maintenance(user: dict = Depends(get_current_user)):
    home = await db.home_profiles.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    now = datetime.utcnow()
    items = []
    for s in home.get("systems", []):
        rules = MAINT_RULES.get(s.get("type"), MAINT_RULES["Other"])
        serviced = s.get("serviced", {}) or {}
        for task, interval in rules:
            last = serviced.get(task)
            base = datetime.fromisoformat(last[:19]) if last else _base_date(s)
            due = base + timedelta(days=interval)
            days = (due - now).days
            status = "overdue" if days < 0 else ("soon" if days <= 21 else "ok")
            items.append({
                "system_id": s["id"], "system_name": s["name"], "system_type": s.get("type"),
                "task": task, "interval_days": interval, "due_date": due.date().isoformat(),
                "days_until": days, "status": status,
            })
    items.sort(key=lambda x: x["days_until"])
    # warranty status per system
    warranties = []
    for s in home.get("systems", []):
        we = s.get("warranty_expires")
        if we:
            try:
                exp = datetime.fromisoformat(we[:10])
                d = (exp - now).days
                warranties.append({"system_id": s["id"], "system_name": s["name"], "expires": we[:10],
                                   "days_until": d, "status": "expired" if d < 0 else ("expiring" if d <= 60 else "active")})
            except ValueError:
                pass
    return {
        "items": items,
        "overdue": sum(1 for i in items if i["status"] == "overdue"),
        "soon": sum(1 for i in items if i["status"] == "soon"),
        "warranties": warranties,
    }


class ServicedReq(BaseModel):
    task: str


@api_router.post("/home/systems/{system_id}/serviced")
async def mark_serviced(system_id: str, req: ServicedReq, user: dict = Depends(get_current_user)):
    res = await db.home_profiles.update_one(
        {"user_id": user["id"], "systems.id": system_id},
        {"$set": {f"systems.$.serviced.{req.task}": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="System not found")
    return {"ok": True}


@api_router.delete("/home/systems/{system_id}")
async def del_system(system_id: str, user: dict = Depends(get_current_user)):
    await db.home_profiles.update_one({"user_id": user["id"]}, {"$pull": {"systems": {"id": system_id}}})
    return {"ok": True}


@api_router.get("/home/year-review/{year}")
async def year_review(year: int, user: dict = Depends(get_current_user)):
    timeline = await db.timeline.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    ent = [e for e in timeline if _year(e.get("created_at")) == year]
    skills: dict = {}
    for e in ent:
        t = e.get("skill_tag") or "DIYer"
        skills[t] = skills.get(t, 0) + 1
    return {
        "year": year,
        "projects": len(ent),
        "money_saved_cents": sum(int(e.get("money_saved_cents") or 0) for e in ent),
        "invested_cents": sum(int(e.get("cost_cents") or 0) for e in ent),
        "hours": round(sum(float(e.get("hours") or 0) for e in ent), 1),
        "top_skills": [k for k, _ in sorted(skills.items(), key=lambda x: -x[1])][:3],
        "highlights": [{"title": e.get("story_title") or e.get("title"), "money_saved_cents": e.get("money_saved_cents"), "created_at": e.get("created_at")} for e in ent],
    }


# ---------------------------------------------------------------- Insurance / Resale Home Portfolio (Sheet #24)
async def _portfolio_data(user: dict) -> dict:
    uid = user["id"]
    timeline = await db.timeline.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    home = await db.home_profiles.find_one({"user_id": uid}, {"_id": 0}) or {}
    invested = sum(int(e.get("cost_cents") or 0) for e in timeline)
    saved = sum(int(e.get("money_saved_cents") or 0) for e in timeline)
    hours = sum(float(e.get("hours") or 0) for e in timeline)
    projects = [{
        "title": e.get("title"), "story_title": e.get("story_title"), "story": e.get("story"),
        "room": e.get("room"), "skill_tag": e.get("skill_tag"), "rating": e.get("rating"),
        "cost_cents": e.get("cost_cents"), "money_saved_cents": e.get("money_saved_cents"),
        "hours": e.get("hours"), "before_photo": e.get("before_photo"), "after_photo": e.get("after_photo"),
        "created_at": e.get("created_at"),
    } for e in timeline]
    systems = [{k: s.get(k) for k in ("name", "type", "brand", "model", "serial", "install_year", "purchase_date", "warranty_expires", "warranty")} for s in home.get("systems", [])]
    return {
        "owner": user.get("name") or user["email"].split("@")[0],
        "location": user.get("location", ""),
        "generated_at": now_iso(),
        "totals": {
            "projects": len(timeline),
            "invested_cents": invested,
            "saved_cents": saved,
            "hours": round(hours, 1),
            "systems": len(systems),
            "rooms": len(home.get("rooms", [])),
        },
        "projects": projects,
        "systems": systems,
        "rooms": [{"name": r.get("name"), "type": r.get("type"), "notes": r.get("notes")} for r in home.get("rooms", [])],
    }


@api_router.get("/portfolio")
async def my_portfolio(user: dict = Depends(get_current_user)):
    data = await _portfolio_data(user)
    data["share_token"] = user.get("portfolio_token")
    data["is_public"] = bool(user.get("portfolio_public"))
    return data


class ShareReq(BaseModel):
    public: bool = True


@api_router.post("/portfolio/share")
async def share_portfolio(req: ShareReq, user: dict = Depends(get_current_user)):
    token = user.get("portfolio_token") or secrets.token_urlsafe(9)
    await db.users.update_one({"id": user["id"]}, {"$set": {"portfolio_token": token, "portfolio_public": req.public}})
    return {"share_token": token, "is_public": req.public}


@api_router.get("/portfolio/public/{token}")
async def public_portfolio(token: str):
    u = await db.users.find_one({"portfolio_token": token, "portfolio_public": True}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="This home portfolio is private or does not exist.")
    return await _portfolio_data(u)


# ---------------------------------------------------------------- community (Pro-Earn)
class PostReq(BaseModel):
    title: str
    body: str
    image_base64: Optional[str] = None

class ReplyReq(BaseModel):
    body: str


@api_router.get("/community/posts")
async def list_posts(user: dict = Depends(get_current_user)):
    posts = await db.posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return posts


@api_router.post("/community/posts")
async def create_post(req: PostReq, user: dict = Depends(get_current_user)):
    post = {
        "id": new_id(),
        "user_id": user["id"],
        "author": user.get("name") or user["email"].split("@")[0],
        "title": req.title,
        "body": req.body,
        "image_base64": req.image_base64,
        "replies": [],
        "solved": False,
        "created_at": now_iso(),
    }
    await db.posts.insert_one(post)
    post.pop("_id", None)
    return post


@api_router.post("/community/posts/{post_id}/reply")
async def reply_post(post_id: str, req: ReplyReq, user: dict = Depends(get_current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    reply = {
        "id": new_id(),
        "user_id": user["id"],
        "author": user.get("name") or user["email"].split("@")[0],
        "body": req.body,
        "verified": False,
        "created_at": now_iso(),
    }
    await db.posts.update_one({"id": post_id}, {"$push": {"replies": reply}})
    return reply


@api_router.post("/community/posts/{post_id}/verify/{reply_id}")
async def verify_reply(post_id: str, reply_id: str, user: dict = Depends(get_current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the author can verify a solution")
    if post.get("solved"):
        raise HTTPException(status_code=400, detail="Already solved")
    reply = next((r for r in post.get("replies", []) if r["id"] == reply_id), None)
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")

    await db.posts.update_one(
        {"id": post_id, "replies.id": reply_id},
        {"$set": {"solved": True, "replies.$.verified": True}},
    )
    # Pro-Earn payout: 10 text tokens + 2 voice minutes to helper
    helper = await db.users.find_one({"id": reply["user_id"]})
    if helper:
        await db.users.update_one(
            {"id": reply["user_id"]},
            {"$inc": {"credits": 10, "voice_minutes": 2}},
        )
    return {"ok": True, "rewarded_user": reply["author"]}


# ---------------------------------------------------------------- support tickets
class TicketReq(BaseModel):
    category: str
    subject: str
    message: str


@api_router.post("/support/ticket")
async def create_ticket(req: TicketReq, user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user.get("email"),
        "category": req.category,
        "subject": req.subject[:200],
        "message": req.message[:4000],
        "status": "open",
        "created_at": now_iso(),
    }
    await db.support_tickets.insert_one({k: v for k, v in doc.items()})
    return {"id": doc["id"], "status": "open"}


@api_router.get("/support/tickets")
async def my_tickets(user: dict = Depends(get_current_user)):
    docs = await db.support_tickets.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return docs


# ---------------------------------------------------------------- weather (WeatherAPI.com)
@api_router.get("/weather")
async def get_weather(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = (q or user.get("location") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="No location set. Add your ZIP or city in Profile, or allow location access.")
    w = await fetch_weather(query)
    if not w:
        raise HTTPException(status_code=502, detail="Weather is unavailable right now. Try again shortly.")
    return {"weather": w, "advisories": weather_advisories(w)}


# ---------------------------------------------------------------- billing (Stripe — recurring subscriptions)
class SubscribeReq(BaseModel):
    tier: str  # "pro" | "master"


# Server-side plan definitions. NEVER trust prices/amounts from the client.
PLAN_TIERS = {
    "pro": {"name": "DIYhomie Pro", "amount": 1200, "credits": 500, "voice_minutes": 60,
            "lookup_key": "diyhomie_pro_monthly", "label": "Pro"},
    "master": {"name": "DIYhomie Master", "amount": 2900, "credits": 2000, "voice_minutes": 240,
               "lookup_key": "diyhomie_master_monthly", "label": "Master"},
}
STRIPE_PACKAGES = PLAN_TIERS   # backward-compat aliases
TIER_GRANTS = PLAN_TIERS

_PRICE_CACHE: dict = {}


async def ensure_stripe_prices():
    """Idempotently create recurring monthly Products/Prices via lookup_keys."""
    if not STRIPE_SECRET_KEY or "sk_test_emergent" in STRIPE_SECRET_KEY:
        return
    for tier, data in PLAN_TIERS.items():
        try:
            prices = await asyncio.to_thread(
                lambda lk=data["lookup_key"]: stripe.Price.list(lookup_keys=[lk], active=True)
            )
            if prices.data:
                _PRICE_CACHE[tier] = prices.data[0].id
            else:
                product = await asyncio.to_thread(lambda n=data["name"]: stripe.Product.create(name=n))
                price = await asyncio.to_thread(
                    lambda p=product.id, a=data["amount"], lk=data["lookup_key"]: stripe.Price.create(
                        product=p, unit_amount=a, currency="usd",
                        recurring={"interval": "month"}, lookup_key=lk,
                    )
                )
                _PRICE_CACHE[tier] = price.id
        except Exception as e:
            logger.error(f"ensure_stripe_prices[{tier}]: {e}")


async def get_price_id(tier: str) -> Optional[str]:
    if tier in _PRICE_CACHE:
        return _PRICE_CACHE[tier]
    await ensure_stripe_prices()
    return _PRICE_CACHE.get(tier)


class CheckoutReq(BaseModel):
    tier: str            # "pro" | "master"
    origin_url: str      # frontend origin, e.g. https://app.example.com


@api_router.post("/billing/checkout")
async def create_checkout(req: CheckoutReq, user: dict = Depends(get_current_user)):
    plan = PLAN_TIERS.get(req.tier)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid tier")
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Payments not configured")

    # Reuse / create the Stripe customer for this user.
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        try:
            customer = await asyncio.to_thread(
                lambda: stripe.Customer.create(email=user.get("email"), metadata={"user_id": user["id"]})
            )
        except Exception as e:
            logger.error(f"stripe customer error: {e}")
            raise HTTPException(status_code=502, detail="Could not start checkout. Try again.")
        customer_id = customer.id
        await db.users.update_one({"id": user["id"]}, {"$set": {"stripe_customer_id": customer_id}})

    price_id = await get_price_id(req.tier)
    if not price_id:
        raise HTTPException(status_code=502, detail="Plan price unavailable. Try again shortly.")

    host = req.origin_url.rstrip("/")
    try:
        session = await asyncio.to_thread(lambda: stripe.checkout.Session.create(
            customer=customer_id,
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{host}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{host}/paywall",
            metadata={"user_id": user["id"], "tier": req.tier},
            subscription_data={"metadata": {"user_id": user["id"], "tier": req.tier}},
        ))
    except Exception as e:
        logger.error(f"stripe checkout error: {e}")
        raise HTTPException(status_code=502, detail="Could not start checkout. Try again.")

    await db.payment_transactions.insert_one({
        "session_id": session.id,
        "user_id": user["id"],
        "tier": req.tier,
        "mode": "subscription",
        "amount": plan["amount"],
        "currency": "usd",
        "payment_status": "initiated",
        "fulfilled": False,
        "created_at": now_iso(),
    })
    return {"url": session.url, "session_id": session.id}


async def _activate_subscription(user_id: str, tier: str, subscription_id: Optional[str], email_event: Optional[str] = None):
    plan = PLAN_TIERS.get(tier, {})
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "subscription_tier": tier,
            "subscription_status": "active",
            "stripe_subscription_id": subscription_id,
            "credits": plan.get("credits", 0),
            "voice_minutes": plan.get("voice_minutes", 0),
            "onboarded": True,
        }},
    )
    # Referral payouts: reward the person who referred THIS user, and flush any
    # rewards THIS user earned (now that they have a Stripe customer to credit).
    try:
        await grant_referral_reward(user_id)
        await flush_referrer_pending(user_id)
    except Exception as e:
        logger.error(f"referral payout error: {e}")
    # Transactional email (purchase / renewal).
    if email_event:
        fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
        if fresh:
            await email_engine.trigger_event(email_event, fresh)


@api_router.get("/billing/status/{session_id}")
async def billing_status(session_id: str, user: dict = Depends(get_current_user)):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Payments not configured")
    try:
        session = await asyncio.to_thread(lambda: stripe.checkout.Session.retrieve(session_id))
    except Exception as e:
        logger.error(f"stripe status error: {e}")
        raise HTTPException(status_code=502, detail="Could not verify payment.")

    payment_status = session.get("payment_status")
    sess_status = session.get("status")
    sub_id = session.get("subscription")

    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if tx and sess_status == "complete" and not tx.get("fulfilled"):
        await _activate_subscription(tx["user_id"], tx["tier"], sub_id, email_event="purchase")
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"fulfilled": True, "payment_status": payment_status or "paid"}},
        )
    elif tx and payment_status and payment_status != tx.get("payment_status"):
        await db.payment_transactions.update_one(
            {"session_id": session_id}, {"$set": {"payment_status": payment_status}}
        )

    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {"payment_status": payment_status, "status": sess_status, "user": public_user(fresh)}


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Keeps subscription_tier in sync across renewals / cancellations."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
        else:
            event = json.loads(payload)
    except Exception as e:
        logger.error(f"webhook parse error: {e}")
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    etype = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        meta = obj.get("metadata") or {}
        uid, tier = meta.get("user_id"), meta.get("tier")
        if uid and tier:
            await _activate_subscription(uid, tier, obj.get("subscription"))
    elif etype == "invoice.paid":
        sub_id = obj.get("subscription")
        u = await db.users.find_one({"stripe_subscription_id": sub_id})
        if u:
            await _activate_subscription(u["id"], u.get("subscription_tier", "pro"), sub_id, email_event="renewal")
    elif etype in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub_id = obj.get("id")
        await db.users.update_one(
            {"stripe_subscription_id": sub_id},
            {"$set": {"subscription_tier": "free", "subscription_status": "canceled"}},
        )
    return {"status": "ok"}


@api_router.post("/billing/subscribe")
async def subscribe(req: SubscribeReq, user: dict = Depends(get_current_user)):
    grant = PLAN_TIERS.get(req.tier)
    if not grant:
        raise HTTPException(status_code=400, detail="Invalid tier")
    await db.users.update_one(
        {"id": user["id"]},
        {"$inc": {"credits": grant["credits"], "voice_minutes": grant["voice_minutes"]},
         "$set": {"subscription_tier": req.tier}},
    )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return public_user(fresh)


class PortalReq(BaseModel):
    origin_url: str


async def _ensure_customer(user: dict) -> Optional[str]:
    """Return the user's Stripe customer id, creating one if missing."""
    customer_id = user.get("stripe_customer_id")
    if customer_id:
        return customer_id
    if not STRIPE_SECRET_KEY:
        return None
    try:
        customer = await asyncio.to_thread(
            lambda: stripe.Customer.create(email=user.get("email"), metadata={"user_id": user["id"]})
        )
    except Exception as e:
        logger.error(f"stripe customer create error: {e}")
        return None
    await db.users.update_one({"id": user["id"]}, {"$set": {"stripe_customer_id": customer.id}})
    return customer.id


@api_router.post("/billing/customer-portal")
async def customer_portal(req: PortalReq, user: dict = Depends(get_current_user)):
    """Open the Stripe-hosted billing portal so users can manage their card,
    invoices and subscription. Requires the portal to be enabled once in the
    Stripe Dashboard (Settings → Billing → Customer portal)."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Payments not configured")
    customer_id = await _ensure_customer(user)
    if not customer_id:
        raise HTTPException(status_code=502, detail="Could not open billing. Try again.")
    return_url = (req.origin_url or "").rstrip("/") + "/profile"
    try:
        session = await asyncio.to_thread(lambda: stripe.billing_portal.Session.create(
            customer=customer_id, return_url=return_url,
        ))
    except stripe.error.InvalidRequestError as e:
        logger.error(f"stripe portal config error: {e}")
        raise HTTPException(
            status_code=503,
            detail="Billing portal isn't activated yet. The owner must enable it in the Stripe Dashboard (Settings → Billing → Customer portal).",
        )
    except Exception as e:
        logger.error(f"stripe portal error: {e}")
        raise HTTPException(status_code=502, detail="Could not open billing. Try again.")
    return {"url": session.url}


@api_router.get("/billing/summary")
async def billing_summary(user: dict = Depends(get_current_user)):
    tier = user.get("subscription_tier", "free")
    plan = PLAN_TIERS.get(tier)
    out = {
        "tier": tier,
        "tier_label": plan["label"] if plan else "Free",
        "status": user.get("subscription_status", "none" if tier == "free" else "active"),
        "credits": user.get("credits", 0),
        "voice_minutes": user.get("voice_minutes", 0),
        "amount": plan["amount"] if plan else 0,
        "renews_at": None,
        "cancel_at_period_end": False,
        "credit_cents": 0,
        "payments": [],
        "plans": [
            {"tier": k, "label": v["label"], "amount": v["amount"],
             "credits": v["credits"], "voice_minutes": v["voice_minutes"]}
            for k, v in PLAN_TIERS.items()
        ],
        "has_customer": bool(user.get("stripe_customer_id")),
    }
    # Live subscription state (renewal date / cancellation) + referral credit balance.
    if STRIPE_SECRET_KEY and user.get("stripe_subscription_id"):
        try:
            sub = await asyncio.to_thread(lambda: stripe.Subscription.retrieve(user["stripe_subscription_id"]))
            cpe = sub.get("current_period_end")
            if cpe:
                out["renews_at"] = datetime.fromtimestamp(cpe, tz=timezone.utc).isoformat()
            out["cancel_at_period_end"] = bool(sub.get("cancel_at_period_end"))
            out["status"] = sub.get("status") or out["status"]
        except Exception as e:
            logger.warning(f"billing summary sub fetch: {e}")
    if STRIPE_SECRET_KEY and user.get("stripe_customer_id"):
        try:
            cust = await asyncio.to_thread(lambda: stripe.Customer.retrieve(user["stripe_customer_id"]))
            out["credit_cents"] = max(0, -(cust.get("balance") or 0))
        except Exception as e:
            logger.warning(f"billing summary balance: {e}")
    # Recent successful payments.
    txs = await db.payment_transactions.find(
        {"user_id": user["id"], "fulfilled": True}, {"_id": 0, "amount": 1, "tier": 1, "created_at": 1, "currency": 1}
    ).sort("created_at", -1).to_list(12)
    out["payments"] = txs
    return out
REFERRAL_REWARD_CENTS = 500  # $5.00 account credit per converted referral


async def link_referral(code: Optional[str], new_user_id: str):
    if not code:
        return
    referrer = await db.users.find_one({"referral_code": code.strip().upper()})
    if not referrer or referrer["id"] == new_user_id:
        return
    await db.referrals.insert_one({
        "id": new_id(),
        "referrer_id": referrer["id"],
        "referred_id": new_user_id,
        "code": code.strip().upper(),
        "status": "pending",       # pending -> converted (when referred subscribes)
        "reward_granted": False,    # True once $5 actually posted to Stripe
        "created_at": now_iso(),
    })
    await db.users.update_one({"id": new_user_id}, {"$set": {"referred_by": referrer["id"]}})


async def _post_stripe_credit(customer_id: str, referrer_id: str, referred_id: str) -> bool:
    try:
        await asyncio.to_thread(lambda: stripe.Customer.create_balance_transaction(
            customer_id, amount=-REFERRAL_REWARD_CENTS, currency="usd",
            description="DIYhomie referral reward",
            idempotency_key=f"ref_{referrer_id}_{referred_id}",
        ))
        return True
    except Exception as e:
        logger.error(f"stripe referral credit failed: {e}")
        return False


async def grant_referral_reward(referred_user_id: str):
    """Called when `referred_user_id` subscribes — credit whoever referred them."""
    rec = await db.referrals.find_one({"referred_id": referred_user_id, "reward_granted": {"$ne": True}})
    if not rec:
        return
    referrer = await db.users.find_one({"id": rec["referrer_id"]})
    granted = False
    if referrer and referrer.get("stripe_customer_id") and STRIPE_SECRET_KEY:
        granted = await _post_stripe_credit(referrer["stripe_customer_id"], rec["referrer_id"], referred_user_id)
    await db.referrals.update_one({"id": rec["id"]}, {"$set": {
        "status": "converted", "reward_granted": granted,
        "reward_pending": not granted, "converted_at": now_iso(),
    }})


async def flush_referrer_pending(referrer_user_id: str):
    """Called when `referrer_user_id` subscribes — pay out rewards they already earned."""
    referrer = await db.users.find_one({"id": referrer_user_id})
    cust = referrer.get("stripe_customer_id") if referrer else None
    if not cust or not STRIPE_SECRET_KEY:
        return
    pend = await db.referrals.find({"referrer_id": referrer_user_id, "status": "converted",
                                    "reward_granted": {"$ne": True}}).to_list(200)
    for rec in pend:
        if await _post_stripe_credit(cust, referrer_user_id, rec["referred_id"]):
            await db.referrals.update_one({"id": rec["id"]}, {"$set": {"reward_granted": True, "reward_pending": False}})


@api_router.get("/referrals/me")
async def my_referrals(user: dict = Depends(get_current_user)):
    code = user.get("referral_code")
    if not code:
        code = new_id().replace("-", "")[:6].upper()
        await db.users.update_one({"id": user["id"]}, {"$set": {"referral_code": code}})
    recs = await db.referrals.find({"referrer_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    converted = [r for r in recs if r.get("status") == "converted"]
    credit_cents = 0
    if user.get("stripe_customer_id") and STRIPE_SECRET_KEY:
        try:
            cust = await asyncio.to_thread(lambda: stripe.Customer.retrieve(user["stripe_customer_id"]))
            credit_cents = max(0, -(cust.get("balance") or 0))
        except Exception as e:
            logger.warning(f"referral balance fetch: {e}")
    return {
        "code": code,
        "invited": len(recs),
        "converted": len(converted),
        "earned_cents": len(converted) * REFERRAL_REWARD_CENTS,
        "credit_cents": credit_cents,
        "reward_cents": REFERRAL_REWARD_CENTS,
        "is_paid": (user.get("subscription_tier") or "free") != "free",
    }


# ---------------------------------------------------------------- Project Communities (v2)
COMMUNITY_SEED_PATH = ROOT_DIR / "community_seed.json"


class ExperienceReq(BaseModel):
    title: str
    body: str
    tools: List[str] = []
    cost_cents: Optional[int] = None
    minutes: Optional[int] = None
    photos: List[str] = []


class ThreadReq(BaseModel):
    question: str


class ThreadReplyReq(BaseModel):
    body: str


def _community_badge(count: int) -> str:
    if count >= 8:
        return "Master Builder"
    if count >= 3:
        return "Experienced DIYer"
    if count >= 1:
        return "Verified Installer"
    return "Verified Owner"


def _exp_public(e: dict) -> dict:
    return {k: e.get(k) for k in (
        "id", "project_slug", "author", "badge", "location", "title", "body",
        "tools", "cost_cents", "minutes", "cheers", "photos", "created_at", "seeded",
    )}


def _months_ago_iso(m: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=int(m) * 30)).isoformat()


async def seed_community():
    try:
        if not COMMUNITY_SEED_PATH.exists():
            return
        data = json.loads(COMMUNITY_SEED_PATH.read_text())
        for p in data.get("projects", []):
            slug = p["slug"]
            await db.community_projects.update_one(
                {"slug": slug},
                {"$set": {
                    "slug": slug, "title": p["title"], "category": p["category"],
                    "icon": p["icon"], "blurb": p["blurb"], "stats": p["stats"],
                    "top_questions": p.get("top_questions", []),
                    "common_mistakes": p.get("common_mistakes", []),
                    "helpful_tips": p.get("helpful_tips", []),
                }},
                upsert=True,
            )
            for i, e in enumerate(p.get("experiences", [])):
                eid = f"seed_{slug}_{i}"
                await db.community_experiences.update_one(
                    {"id": eid},
                    {"$setOnInsert": {
                        "id": eid, "project_slug": slug, "author": e["author"],
                        "badge": e.get("badge"), "location": e.get("location", ""),
                        "title": e["title"], "body": e["body"], "tools": e.get("tools", []),
                        "cost_cents": e.get("cost_cents"), "minutes": e.get("minutes"),
                        "cheers": e.get("cheers", 0), "photos": [], "seeded": True,
                        "user_id": None, "created_at": _months_ago_iso(e.get("months_ago", 1)),
                    }},
                    upsert=True,
                )
            for i, th in enumerate(p.get("threads", [])):
                tid = f"seed_{slug}_t{i}"
                replies = [{
                    "id": f"{tid}_r{j}", "author": r["author"], "badge": r.get("badge"),
                    "body": r["body"], "user_id": None,
                    "created_at": _months_ago_iso(th.get("months_ago", 1)),
                } for j, r in enumerate(th.get("replies", []))]
                await db.community_threads.update_one(
                    {"id": tid},
                    {"$setOnInsert": {
                        "id": tid, "project_slug": slug, "author": th["author"],
                        "badge": th.get("badge"), "question": th["question"],
                        "replies": replies, "user_id": None, "seeded": True,
                        "created_at": _months_ago_iso(th.get("months_ago", 1)),
                    }},
                    upsert=True,
                )
        logger.info("community seeded")
    except Exception as e:
        logger.error(f"community seed failed: {e}")


@api_router.get("/community/projects")
async def community_projects():
    projects = await db.community_projects.find({}, {"_id": 0}).to_list(200)
    counts: dict = {}
    async for row in db.community_experiences.aggregate(
        [{"$group": {"_id": "$project_slug", "n": {"$sum": 1}}}]
    ):
        counts[row["_id"]] = row["n"]
    for p in projects:
        p["experience_count"] = counts.get(p["slug"], 0)
    projects.sort(key=lambda x: x.get("stats", {}).get("completed", 0), reverse=True)
    return projects


@api_router.get("/community/feed")
async def community_feed(limit: int = 30):
    exps = await db.community_experiences.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    titles = {p["slug"]: p["title"] async for p in db.community_projects.find({}, {"_id": 0, "slug": 1, "title": 1})}
    out = []
    for e in exps:
        d = _exp_public(e)
        d["project_title"] = titles.get(e["project_slug"], "") or e.get("title", "")
        out.append(d)
    return out


@api_router.get("/community/projects/{slug}")
async def community_project_detail(slug: str):
    p = await db.community_projects.find_one({"slug": slug}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Community not found")
    exps = await db.community_experiences.find({"project_slug": slug}, {"_id": 0}).sort("created_at", -1).to_list(300)
    threads = await db.community_threads.find({"project_slug": slug}, {"_id": 0}).sort("created_at", -1).to_list(300)
    p["experiences"] = [_exp_public(e) for e in exps]
    p["threads"] = threads
    p["experience_count"] = len(exps)
    return p


@api_router.post("/community/projects/{slug}/experiences")
async def add_experience(slug: str, req: ExperienceReq, user: dict = Depends(get_current_user)):
    if not await db.community_projects.find_one({"slug": slug}):
        raise HTTPException(status_code=404, detail="Community not found")
    mine = await db.community_experiences.count_documents({"user_id": user["id"]})
    exp = {
        "id": new_id(), "project_slug": slug, "user_id": user["id"],
        "author": user.get("name") or user["email"].split("@")[0],
        "badge": _community_badge(mine + 1),
        "location": user.get("location", ""),
        "title": req.title.strip()[:120], "body": req.body.strip()[:2000],
        "tools": [t.strip() for t in (req.tools or []) if t.strip()][:12],
        "cost_cents": req.cost_cents, "minutes": req.minutes,
        "cheers": 0, "photos": (req.photos or [])[:4], "seeded": False,
        "created_at": now_iso(),
    }
    await db.community_experiences.insert_one(exp)
    return _exp_public(exp)


@api_router.post("/community/experiences/{exp_id}/cheer")
async def cheer_experience(exp_id: str, user: dict = Depends(get_current_user)):
    await db.community_experiences.update_one({"id": exp_id}, {"$inc": {"cheers": 1}})
    e = await db.community_experiences.find_one({"id": exp_id}, {"_id": 0, "cheers": 1})
    if not e:
        raise HTTPException(status_code=404, detail="Not found")
    return {"cheers": e["cheers"]}


@api_router.post("/community/projects/{slug}/threads")
async def add_thread(slug: str, req: ThreadReq, user: dict = Depends(get_current_user)):
    if not await db.community_projects.find_one({"slug": slug}):
        raise HTTPException(status_code=404, detail="Community not found")
    mine = await db.community_experiences.count_documents({"user_id": user["id"]})
    th = {
        "id": new_id(), "project_slug": slug, "user_id": user["id"],
        "author": user.get("name") or user["email"].split("@")[0],
        "badge": _community_badge(mine), "question": req.question.strip()[:300],
        "replies": [], "seeded": False, "created_at": now_iso(),
    }
    await db.community_threads.insert_one(th)
    th.pop("_id", None)
    return th


@api_router.post("/community/threads/{thread_id}/replies")
async def add_thread_reply(thread_id: str, req: ThreadReplyReq, user: dict = Depends(get_current_user)):
    if not await db.community_threads.find_one({"id": thread_id}):
        raise HTTPException(status_code=404, detail="Thread not found")
    mine = await db.community_experiences.count_documents({"user_id": user["id"]})
    reply = {
        "id": new_id(), "user_id": user["id"],
        "author": user.get("name") or user["email"].split("@")[0],
        "badge": _community_badge(mine), "body": req.body.strip()[:1500],
        "created_at": now_iso(),
    }
    await db.community_threads.update_one({"id": thread_id}, {"$push": {"replies": reply}})
    return reply


STOP_WORDS = {"a", "an", "the", "to", "of", "in", "on", "my", "your", "and", "or", "for", "with", "how"}


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:80] or "guide"


def _product_from_context(context: dict) -> str:
    if not context:
        return ""
    for k, v in context.items():
        if v and any(t in k.lower() for t in ("model", "brand", "product", "make")):
            return str(v).strip()
    return ""


def public_blog(p: dict) -> dict:
    return {k: v for k, v in p.items() if k != "_id"}


async def maybe_create_blog_post(project: dict, guide: dict, steps: list, context: dict):
    """Auto-repurpose a finished guide into an anonymized, SEO-optimized blog post.
    First guide for a given task+product becomes the canonical post (no duplicate content)."""
    task = (project.get("title") or "").strip().rstrip(".")
    if not task or not steps:
        return
    product = _product_from_context(context)
    slug = slugify(task + ("-" + product if product else ""))
    if await db.blog_posts.find_one({"slug": slug}, {"_id": 1}):
        return  # canonical post already exists
    room = detect_room(task + " " + product)
    category = (room or "home-repair").replace("_", " ").title()
    overview = (guide.get("overview") or "").strip()
    title_words = [w for w in re.findall(r"[a-zA-Z0-9]+", task.lower()) if w not in STOP_WORDS]
    keywords = list(dict.fromkeys(title_words + (product.lower().split() if product else []) +
                                  ["diy", "how to", "guide", "step by step", "repair", "install", "replace"]))
    h1 = f"How to {task[0].upper() + task[1:]}" if not task.lower().startswith("how ") else task
    if product and product.lower() not in h1.lower():
        h1 = f"{h1} ({product})"
    seo_title = f"{h1} — Step-by-Step DIY Guide | DIYhomie"
    meta = (overview or f"A clear, step-by-step DIY guide to {task.lower()}.")[:155]
    post = {
        "id": new_id(),
        "slug": slug,
        "seo_title": seo_title,
        "h1": h1,
        "title": h1,
        "product": product,
        "category": category,
        "tags": [t for t in [category, product, "DIY"] if t],
        "keywords": keywords[:14],
        "excerpt": (overview or meta)[:220],
        "meta_description": meta,
        "overview": overview,
        "tools": (guide.get("tools") or [])[:14],
        "materials": (guide.get("materials") or [])[:14],
        "safety": (guide.get("safety_warnings") or [])[:8],
        "steps": [{"title": s.get("title", ""), "instruction": s.get("instruction", "")} for s in steps],
        "common_mistakes": (guide.get("common_mistakes") or [])[:8],
        "published": True,
        "views": 0,
        "source_project_id": project.get("id"),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.blog_posts.insert_one(post)
    logger.info(f"blog post created: {slug}")
    # Affiliate widget: store an instant list now, enrich with AI in the background.
    try:
        await db.blog_posts.update_one({"slug": slug}, {"$set": {"shopping_list": affiliate_engine.quick_list(post)}})
        asyncio.create_task(affiliate_engine.generate_and_store(slug, use_ai=True))
    except Exception as e:
        logger.warning(f"affiliate list init: {e}")


@api_router.get("/blog")
async def list_blog(limit: int = 24, offset: int = 0, category: Optional[str] = None, q: Optional[str] = None):
    query: dict = {"published": True}
    if category:
        query["category"] = category
    if q:
        query["$or"] = [{"title": {"$regex": q, "$options": "i"}},
                        {"keywords": {"$regex": q, "$options": "i"}},
                        {"product": {"$regex": q, "$options": "i"}}]
    cur = db.blog_posts.find(query, {"_id": 0, "overview": 0, "steps": 0}).sort("created_at", -1).skip(max(offset, 0)).limit(min(limit, 100))
    posts = await cur.to_list(length=min(limit, 100))
    cats = await db.blog_posts.distinct("category", {"published": True})
    return {"posts": posts, "categories": sorted(cats)}


@api_router.get("/blog/{slug}")
async def get_blog(slug: str):
    post = await db.blog_posts.find_one({"slug": slug, "published": True}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.blog_posts.update_one({"slug": slug}, {"$inc": {"views": 1}})
    return post


def _build_post_html(post: dict, base: str, canonical: str, widget_html: str = "") -> str:
    app_link = f"{base}?ref=blog&utm_source=blog&utm_medium=guide&project={quote(post.get('title',''))}"
    esc = lambda t: (t or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    steps = post.get("steps", [])
    tools = post.get("tools", []) + post.get("materials", [])

    howto = {
        "@context": "https://schema.org", "@type": "HowTo", "name": post.get("h1"),
        "description": post.get("meta_description"),
        "totalTime": "PT1H",
        "tool": [{"@type": "HowToTool", "name": t} for t in post.get("tools", [])],
        "supply": [{"@type": "HowToSupply", "name": m} for m in post.get("materials", [])],
        "step": [{"@type": "HowToStep", "position": i + 1, "name": s.get("title"),
                  "text": s.get("instruction")} for i, s in enumerate(steps)],
    }
    article = {
        "@context": "https://schema.org", "@type": "Article", "headline": post.get("h1"),
        "description": post.get("meta_description"), "author": {"@type": "Organization", "name": "DIYhomie"},
        "publisher": {"@type": "Organization", "name": "DIYhomie"},
        "datePublished": post.get("created_at"), "mainEntityOfPage": canonical,
    }

    css = """
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;line-height:1.6}
.wrap{max-width:740px;margin:0 auto;padding:24px 20px 64px}
header{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;z-index:5}
.logo{width:30px;height:30px;border-radius:7px;background:#FF6A00;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
.brand{font-weight:800;font-size:18px}.brand span{color:#FF6A00}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
.badge{background:#FFF1E6;color:#C75300;font-weight:700;font-size:12px;padding:5px 11px;border-radius:99px}
h1{font-size:30px;line-height:1.2;margin:8px 0 14px}
.lede{font-size:18px;color:#444;margin-bottom:8px}
h2{font-size:21px;margin:30px 0 12px;border-left:4px solid #FF6A00;padding-left:10px}
ul{padding-left:22px;margin:8px 0}li{margin:6px 0}
.step{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #f0f0f0}
.snum{flex:0 0 32px;height:32px;border-radius:99px;background:#FF6A00;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
.stitle{font-weight:700;margin-bottom:3px}
.cta{margin:34px 0;padding:24px;border:2px solid #FF6A00;border-radius:16px;background:#FFF8F2;text-align:center}
.cta h3{font-size:22px;margin-bottom:8px}.cta p{color:#555;margin-bottom:16px}
.btn{display:inline-block;background:#FF6A00;color:#fff;font-weight:800;padding:15px 28px;border-radius:12px;text-decoration:none;font-size:17px}
.share{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}
.share a,.share button{cursor:pointer;border:1px solid #ddd;background:#fff;border-radius:10px;padding:10px 14px;font-weight:700;font-size:14px;color:#333;text-decoration:none}
.safety{background:#FFF4F4;border:1px solid #FFD7D7;border-radius:12px;padding:14px 16px}
footer{margin-top:40px;padding-top:18px;border-top:1px solid #eee;color:#888;font-size:13px}
"""

    def ul(items):
        return "<ul>" + "".join(f"<li>{esc(x)}</li>" for x in items if x) + "</ul>" if items else ""

    steps_html = "".join(
        f'<div class="step"><div class="snum">{i+1}</div><div><div class="stitle">{esc(s.get("title"))}</div>'
        f'<div>{esc(s.get("instruction"))}</div></div></div>' for i, s in enumerate(steps)
    )
    badges = "".join(f'<span class="badge">{esc(b)}</span>' for b in ([post.get("category")] + ([post.get("product")] if post.get("product") else [])))
    share_text = quote(f"{post.get('title')} — free step-by-step DIY guide")
    cta_html = (
        '<div class="cta"><h3>Want this guide built for YOUR exact setup?</h3>'
        '<p>Get it personalized with step-by-step photos, your tools, local code tips, and Homie — your AI master contractor — answering questions live as you work. Free to start.</p>'
        f'<a class="btn" href="{app_link}">Get my personalized guide →</a></div>'
    )
    share_html = (
        '<div class="share">'
        f'<a href="https://twitter.com/intent/tweet?text={share_text}&url={quote(canonical)}" target="_blank" rel="noopener">𝕏 Share</a>'
        f'<a href="https://www.facebook.com/sharer/sharer.php?u={quote(canonical)}" target="_blank" rel="noopener">Facebook</a>'
        f'<a href="https://wa.me/?text={share_text}%20{quote(canonical)}" target="_blank" rel="noopener">WhatsApp</a>'
        f'<a href="https://www.reddit.com/submit?url={quote(canonical)}&title={share_text}" target="_blank" rel="noopener">Reddit</a>'
        f'<a href="mailto:?subject={share_text}&body={quote(canonical)}">Email</a>'
        '<button onclick="navigator.clipboard.writeText(location.href);this.textContent=\'Copied!\'">Copy link</button>'
        '</div>'
    )

    body = (
        f'<header><div class="logo">D</div><div class="brand">DIY<span>homie</span></div></header>'
        f'<div class="wrap"><div class="badges">{badges}</div><h1>{esc(post.get("h1"))}</h1>'
        f'<p class="lede">{esc(post.get("overview"))}</p>'
        f'{share_html}'
        + (f'<h2>What you\'ll need</h2>{ul(tools)}' if tools else '')
        + (f'<h2>Step-by-step</h2>{steps_html}' if steps_html else '')
        + (f'<h2>Stay safe</h2><div class="safety">{ul(post.get("safety"))}</div>' if post.get("safety") else '')
        + (f'<h2>Common mistakes to avoid</h2>{ul(post.get("common_mistakes"))}' if post.get("common_mistakes") else '')
        + widget_html
        + cta_html + share_html
        + '<footer>DIYhomie provides AI-generated DIY guidance for informational purposes and is not a licensed contractor. Always follow local codes and consult a professional for gas, major electrical, or structural work.</footer></div>'
    )

    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{esc(post.get("seo_title"))}</title>'
        f'<meta name="description" content="{esc(post.get("meta_description"))}">'
        f'<meta name="keywords" content="{esc(", ".join(post.get("keywords", [])))}">'
        f'<link rel="canonical" href="{canonical}">'
        '<meta property="og:type" content="article">'
        f'<meta property="og:title" content="{esc(post.get("h1"))}">'
        f'<meta property="og:description" content="{esc(post.get("meta_description"))}">'
        f'<meta property="og:url" content="{canonical}">'
        '<meta property="og:site_name" content="DIYhomie">'
        '<meta name="twitter:card" content="summary_large_image">'
        f'<meta name="twitter:title" content="{esc(post.get("h1"))}">'
        f'<meta name="twitter:description" content="{esc(post.get("meta_description"))}">'
        f'<script type="application/ld+json">{json.dumps(howto)}</script>'
        f'<script type="application/ld+json">{json.dumps(article)}</script>'
        f'<style>{css}</style></head><body>{body}</body></html>'
    )


def public_base(request: Request) -> str:
    # Behind the ingress/TLS proxy: prefer the forwarded public host and force https
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.hostname
    return f"https://{host}/"


@api_router.get("/blog/{slug}/html", response_class=HTMLResponse)
async def blog_html(slug: str, request: Request):
    post = await db.blog_posts.find_one({"slug": slug, "published": True}, {"_id": 0})
    if not post:
        return HTMLResponse("<h1>Guide not found</h1>", status_code=404)
    await db.blog_posts.update_one({"slug": slug}, {"$inc": {"views": 1}})
    base = public_base(request)
    canonical = f"{base}api/blog/{slug}/html"
    widget_html = ""
    try:
        cfg = await affiliate_engine.ensure_config()
        widget_html = affiliate_engine.render_widget_html(affiliate_engine.build_widget_data(post, cfg))
    except Exception as e:
        logger.warning(f"affiliate widget render: {e}")
    return HTMLResponse(_build_post_html(post, base, canonical, widget_html))


@api_router.get("/blog/{slug}/materials")
async def blog_materials(slug: str):
    """Render-ready affiliate widget data for the in-app blog reader."""
    post = await db.blog_posts.find_one({"slug": slug, "published": True}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Not found")
    cfg = await affiliate_engine.ensure_config()
    return affiliate_engine.build_widget_data(post, cfg) or {"categories": []}


@api_router.get("/sitemap.xml", response_class=PlainTextResponse)
async def sitemap(request: Request):
    base = public_base(request)
    slugs = await db.blog_posts.find({"published": True}, {"_id": 0, "slug": 1, "updated_at": 1}).sort("created_at", -1).to_list(length=5000)
    urls = "".join(
        f"<url><loc>{base}api/blog/{s['slug']}/html</loc><lastmod>{(s.get('updated_at') or '')[:10]}</lastmod>"
        f"<changefreq>weekly</changefreq><priority>0.8</priority></url>" for s in slugs
    )
    xml = ('<?xml version="1.0" encoding="UTF-8"?>'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + '</urlset>')
    return PlainTextResponse(xml, media_type="application/xml")


@api_router.get("/robots.txt", response_class=PlainTextResponse)
async def robots(request: Request):
    base = str(request.base_url)
    return PlainTextResponse(f"User-agent: *\nAllow: /\nSitemap: {base}api/sitemap.xml\n")


class FeedbackReq(BaseModel):
    type: str = "feature"  # bug | feature | other
    message: str
    email: Optional[str] = None
    screenshot: Optional[str] = None  # base64 data url (optional)
    platform: Optional[str] = None


@api_router.post("/feedback")
async def submit_feedback(req: FeedbackReq, user: dict = Depends(get_current_user)):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")
    ftype = req.type if req.type in ("bug", "feature", "other") else "other"
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "user_email": req.email or user.get("email"),
        "user_name": user.get("name"),
        "type": ftype,
        "message": req.message.strip()[:4000],
        "screenshot": (req.screenshot or "")[:2_000_000] or None,
        "platform": (req.platform or "")[:60],
        "status": "new",       # new | in_progress | planned | done | declined
        "priority": "medium",  # low | medium | high
        "note": "",
        "created_at": now_iso(),
    }
    await db.feedback.insert_one(dict(doc))
    return {"id": doc["id"], "ok": True}


# ---------------------------------------------------------------- admin workstation
@api_router.get("/admin/overview")
async def admin_overview(admin: dict = Depends(require_admin)):
    async def by_status(coll):
        out = {}
        async for row in db[coll].aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
            out[row["_id"] or "unknown"] = row["n"]
        return out
    tiers = {}
    async for row in db.users.aggregate([{"$group": {"_id": "$subscription_tier", "n": {"$sum": 1}}}]):
        tiers[row["_id"] or "free"] = row["n"]
    paid = sum(v for k, v in tiers.items() if k and k != "free")
    return {
        "counts": {
            "users": await db.users.count_documents({}),
            "projects": await db.projects.count_documents({}),
            "guides": await db.projects.count_documents({"guide": {"$ne": None}}),
            "blog_posts": await db.blog_posts.count_documents({"published": True}),
            "blog_drafts": await db.blog_posts.count_documents({"published": False}),
            "paid_subscribers": paid,
        },
        "tickets": await by_status("support_tickets"),
        "feedback": await by_status("feedback"),
        "tiers": tiers,
        "recent_feedback": await db.feedback.find({}, {"_id": 0, "screenshot": 0}).sort("created_at", -1).limit(5).to_list(5),
        "recent_tickets": await db.support_tickets.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5),
    }


@api_router.get("/admin/feedback")
async def admin_feedback(status: Optional[str] = None, type: Optional[str] = None, admin: dict = Depends(require_admin)):
    q: dict = {}
    if status:
        q["status"] = status
    if type:
        q["type"] = type
    items = await db.feedback.find(q, {"_id": 0, "screenshot": 0}).sort("created_at", -1).limit(300).to_list(300)
    return {"items": items}


class FeedbackUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    note: Optional[str] = None


@api_router.patch("/admin/feedback/{fid}")
async def admin_update_feedback(fid: str, req: FeedbackUpdate, admin: dict = Depends(require_admin)):
    upd = {k: v for k, v in req.dict().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.feedback.update_one({"id": fid}, {"$set": upd})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@api_router.delete("/admin/feedback/{fid}")
async def admin_delete_feedback(fid: str, admin: dict = Depends(require_admin)):
    await db.feedback.delete_one({"id": fid})
    return {"ok": True}


@api_router.get("/admin/tickets")
async def admin_tickets(status: Optional[str] = None, admin: dict = Depends(require_admin)):
    q = {"status": status} if status else {}
    items = await db.support_tickets.find(q, {"_id": 0}).sort("created_at", -1).limit(300).to_list(300)
    return {"items": items}


class TicketUpdate(BaseModel):
    status: Optional[str] = None


@api_router.patch("/admin/tickets/{tid}")
async def admin_update_ticket(tid: str, req: TicketUpdate, admin: dict = Depends(require_admin)):
    if not req.status:
        raise HTTPException(status_code=400, detail="status required")
    res = await db.support_tickets.update_one({"id": tid}, {"$set": {"status": req.status}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


class TicketReplyReq(BaseModel):
    message: str


@api_router.post("/admin/tickets/{tid}/reply")
async def admin_reply_ticket(tid: str, req: TicketReplyReq, admin: dict = Depends(require_admin)):
    """Reply to a support ticket; emails the user (ticket_reply transactional)."""
    ticket = await db.support_tickets.find_one({"id": tid}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    reply = {
        "id": new_id(), "admin_id": admin["id"], "message": req.message[:4000], "created_at": now_iso(),
    }
    await db.support_tickets.update_one(
        {"id": tid},
        {"$push": {"replies": reply}, "$set": {"status": "replied", "last_reply_at": now_iso()}},
    )
    user = await db.users.find_one({"id": ticket.get("user_id")}, {"_id": 0}) if ticket.get("user_id") else None
    if not user and ticket.get("email"):
        user = {"email": ticket["email"], "name": ticket["email"].split("@")[0]}
    if user:
        await email_engine.trigger_event("ticket_reply", user, {
            "ticket_subject": ticket.get("subject", "your request"),
            "reply_message": req.message,
        })
    return {"ok": True, "reply": reply}


@api_router.get("/admin/blog")
async def admin_blog(published: Optional[bool] = None, admin: dict = Depends(require_admin)):
    q = {} if published is None else {"published": published}
    items = await db.blog_posts.find(q, {"_id": 0, "steps": 0}).sort("created_at", -1).limit(300).to_list(300)
    return {"items": items}


class BlogUpdate(BaseModel):
    published: Optional[bool] = None
    title: Optional[str] = None
    excerpt: Optional[str] = None


@api_router.patch("/admin/blog/{slug}")
async def admin_update_blog(slug: str, req: BlogUpdate, admin: dict = Depends(require_admin)):
    upd = {k: v for k, v in req.dict().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    upd["updated_at"] = now_iso()
    res = await db.blog_posts.update_one({"slug": slug}, {"$set": upd})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@api_router.delete("/admin/blog/{slug}")
async def admin_delete_blog(slug: str, admin: dict = Depends(require_admin)):
    await db.blog_posts.delete_one({"slug": slug})
    return {"ok": True}


@api_router.get("/admin/revenue")
async def admin_revenue(admin: dict = Depends(require_admin)):
    by_tier = []
    mrr = 0
    for tier, data in PLAN_TIERS.items():
        count = await db.users.count_documents({"subscription_tier": tier})
        subtotal = count * data["amount"]
        mrr += subtotal
        by_tier.append({
            "tier": tier, "label": data.get("label", tier.title()),
            "count": count, "price_cents": data["amount"], "subtotal_cents": subtotal,
        })
    free_users = await db.users.count_documents({"$or": [{"subscription_tier": "free"}, {"subscription_tier": None}, {"subscription_tier": {"$exists": False}}]})
    return {"currency": "usd", "mrr_cents": mrr, "arr_cents": mrr * 12, "by_tier": by_tier, "free_users": free_users}


def _csv_response(rows: list, header: list, filename: str) -> PlainTextResponse:
    import csv, io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@api_router.get("/admin/feedback/export.csv")
async def export_feedback_csv(admin: dict = Depends(require_admin)):
    items = await db.feedback.find({}, {"_id": 0, "screenshot": 0}).sort("created_at", -1).to_list(10000)
    rows = [[f.get("created_at"), f.get("type"), f.get("status"), f.get("priority"),
             f.get("user_email"), (f.get("message") or "").replace("\n", " "), (f.get("note") or "").replace("\n", " ")]
            for f in items]
    return _csv_response(rows, ["created_at", "type", "status", "priority", "user_email", "message", "note"], "feedback.csv")


@api_router.get("/admin/tickets/export.csv")
async def export_tickets_csv(admin: dict = Depends(require_admin)):
    items = await db.support_tickets.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    rows = [[t.get("created_at"), t.get("category"), t.get("status"), t.get("email"),
             t.get("subject"), (t.get("message") or "").replace("\n", " ")]
            for t in items]
    return _csv_response(rows, ["created_at", "category", "status", "email", "subject", "message"], "tickets.csv")


@api_router.get("/")
async def root():
    return {"message": "DIYhomie API", "brain": "perplexity" if PERPLEXITY_API_KEY else "fallback-openai"}



# ---------------------------------------------------------------- Internal CRM
VENDOR_SEED_PATH = ROOT_DIR / "vendor_seed.json"

CRM_CATEGORY_KEYWORDS = {
    "Plumbing": ["toilet", "faucet", "sink", "drain", "pipe", "water heater", "disposal", "shower", "valve", "leak", "supply line"],
    "HVAC": ["hvac", "furnace", "air condition", " ac ", "thermostat", "filter", "vent", "heat pump", "ductless"],
    "Electrical": ["light", "outlet", "switch", "wiring", "breaker", "ceiling fan", "fixture", "doorbell", "electrical"],
    "Appliance": ["dishwasher", "washer", "dryer", "refrigerator", "fridge", "oven", "microwave", "appliance", "garbage disposal"],
    "Deck & Outdoor": ["deck", "fence", "patio", "outdoor", "stain", "paver", "gutter", "lawn", "shed"],
    "Bathroom": ["bathroom", "vanity", "tile", "tub", "bath", "grout"],
    "Painting": ["paint", "drywall", "primer", "wall"],
}


class CrmNoteReq(BaseModel):
    body: str


class CrmTagsReq(BaseModel):
    tags: List[str]


class CrmContactUpdate(BaseModel):
    phone: Optional[str] = None
    country: Optional[str] = None
    state: Optional[str] = None
    signup_source: Optional[str] = None


class VendorReq(BaseModel):
    company: str
    category: Optional[str] = "Other"
    importance: Optional[str] = "medium"
    website: Optional[str] = ""
    login_url: Optional[str] = ""
    dashboard_url: Optional[str] = ""
    support_url: Optional[str] = ""
    docs_url: Optional[str] = ""
    api_docs_url: Optional[str] = ""
    billing_url: Optional[str] = ""
    monthly_cost_cents: Optional[int] = 0
    annual_cost_cents: Optional[int] = 0
    renewal_date: Optional[str] = ""
    plan_type: Optional[str] = ""
    account_owner: Optional[str] = ""
    email_used: Optional[str] = ""
    support_email: Optional[str] = ""
    phone: Optional[str] = ""
    affiliate_link: Optional[str] = ""
    notes: Optional[str] = ""
    feature_description: Optional[str] = ""
    importance_note: Optional[str] = ""
    doc: Optional[dict] = None


def _days_since(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0
    except Exception:
        return None


def _crm_contact(u: dict, proj: dict, ltv_cents: int, comm: int, notes_count: int) -> dict:
    tier = u.get("subscription_tier") or "free"
    sub_status = u.get("subscription_status") or ("trial" if tier == "free" else "active")
    if sub_status == "canceled":
        membership = "canceled"
        billing = "canceled"
    elif tier == "free":
        membership = "trial"
        billing = "none"
    else:
        membership = "active"
        billing = "active"
    last_login = u.get("last_login")
    last_activity = max([x for x in [last_login, proj.get("last"), u.get("created_at")] if x] or [None]) if (last_login or proj.get("last") or u.get("created_at")) else None
    titles = " ".join(proj.get("titles", []))
    categories = [cat for cat, kws in CRM_CATEGORY_KEYWORDS.items() if any(k in titles for k in kws)]
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name") or "",
        "username": (u["email"].split("@")[0]),
        "phone": u.get("phone") or "",
        "picture": u.get("picture") or "",
        "signup_source": u.get("signup_source") or ("google" if u.get("auth_provider") == "google" else "email"),
        "signup_date": u.get("created_at"),
        "country": u.get("country") or "",
        "state": u.get("state") or "",
        "location": u.get("location") or "",
        "plan": tier,
        "subscription_status": sub_status,
        "membership_status": membership,
        "billing_status": billing,
        "ltv_cents": ltv_cents,
        "projects_created": proj.get("count", 0),
        "projects_completed": proj.get("completed", 0),
        "community_contributions": comm,
        "last_login": last_login,
        "last_activity": last_activity,
        "notes_count": notes_count,
        "tags": u.get("crm_tags") or [],
        "categories": categories,
        "credits": u.get("credits", 0),
        "is_admin": u.get("is_admin", False),
    }


def _crm_segments(c: dict) -> List[str]:
    segs = []
    age = _days_since(c.get("signup_date"))
    inactive = _days_since(c.get("last_activity"))
    if age is not None and age <= 7:
        segs.append("New Users")
    if c["plan"] == "free" and c["membership_status"] == "trial":
        segs.append("Trial Users")
    if c["membership_status"] == "active" and c["plan"] in ("pro", "master"):
        segs.append("Monthly Members")
    if c.get("plan_interval") == "annual":
        segs.append("Annual Members")
    if c["membership_status"] == "canceled":
        segs.append("Canceled Users")
        segs.append("Expired Members")
    if inactive is not None:
        if inactive >= 90:
            segs.append("Inactive 90d+")
        elif inactive >= 60:
            segs.append("Inactive 60d+")
        elif inactive >= 30:
            segs.append("Inactive 30d+")
    if inactive is not None and inactive <= 3 and c["projects_created"] >= 2:
        segs.append("Highly Active")
    if c["community_contributions"] >= 1:
        segs.append("Community Contributors")
    if c["ltv_cents"] >= 2000:
        segs.append("High Value")
    if c["projects_created"] >= 5:
        segs.append("Power Users")
    for cat in c.get("categories", []):
        segs.append(f"{cat} Users")
    return segs


async def _crm_enrich(users: List[dict]) -> List[dict]:
    ids = [u["id"] for u in users]
    proj_map: dict = {}
    async for p in db.projects.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "title": 1, "status": 1, "updated_at": 1, "created_at": 1}):
        m = proj_map.setdefault(p["user_id"], {"count": 0, "completed": 0, "titles": [], "last": None})
        m["count"] += 1
        if p.get("status") == "completed":
            m["completed"] += 1
        if p.get("title"):
            m["titles"].append(p["title"].lower())
        upd = p.get("updated_at") or p.get("created_at")
        if upd and (m["last"] is None or upd > m["last"]):
            m["last"] = upd
    pay_map: dict = {}
    async for t in db.payment_transactions.find({"user_id": {"$in": ids}, "fulfilled": True}, {"_id": 0, "user_id": 1, "amount": 1}):
        pay_map[t["user_id"]] = pay_map.get(t["user_id"], 0) + (t.get("amount") or 0)
    comm_map: dict = {}
    async for e in db.community_experiences.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1}):
        if e.get("user_id"):
            comm_map[e["user_id"]] = comm_map.get(e["user_id"], 0) + 1
    async for th in db.community_threads.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1}):
        if th.get("user_id"):
            comm_map[th["user_id"]] = comm_map.get(th["user_id"], 0) + 1
    note_map: dict = {}
    async for n in db.crm_notes.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1}):
        note_map[n["user_id"]] = note_map.get(n["user_id"], 0) + 1
    out = []
    for u in users:
        c = _crm_contact(u, proj_map.get(u["id"], {}), pay_map.get(u["id"], 0), comm_map.get(u["id"], 0), note_map.get(u["id"], 0))
        c["segments"] = _crm_segments(c)
        out.append(c)
    return out


CRM_SEGMENT_ORDER = [
    "New Users", "Trial Users", "Monthly Members", "Annual Members", "Expired Members",
    "Canceled Users", "Highly Active", "Inactive 30d+", "Inactive 60d+", "Inactive 90d+",
    "Community Contributors", "High Value", "Power Users",
    "Plumbing Users", "HVAC Users", "Electrical Users", "Appliance Users",
    "Bathroom Users", "Deck & Outdoor Users", "Painting Users",
]


async def email_segment_resolver(segment_name):
    """Bridge the CRM smart-segments into the email engine.
    segment_name=None → {segments:[{name,count}]}; else → [{user_id,email,name,plan}]."""
    users = await db.users.find({}, {"_id": 0}).to_list(5000)
    contacts = await _crm_enrich(users)
    if segment_name is None:
        counts: dict = {}
        for c in contacts:
            for s in c["segments"]:
                counts[s] = counts.get(s, 0) + 1
        seglist = [{"name": "All Users", "count": len(contacts)}]
        seglist += [{"name": s, "count": counts.get(s, 0)} for s in CRM_SEGMENT_ORDER]
        return {"segments": seglist}
    sel = contacts if segment_name == "All Users" else [c for c in contacts if segment_name in c["segments"]]
    return [{"user_id": c.get("id"), "email": c.get("email"), "name": c.get("name"), "plan": c.get("plan")} for c in sel]


@api_router.get("/admin/crm/stats")
async def crm_stats(admin: dict = Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "hashed_password": 0}).to_list(10000)
    contacts = await _crm_enrich(users)
    total = len(contacts)
    new_today = sum(1 for c in contacts if (_days_since(c.get("signup_date")) or 999) < 1)
    active7 = sum(1 for c in contacts if (_days_since(c.get("last_activity")) if c.get("last_activity") else 999) is not None and (_days_since(c.get("last_activity")) or 999) <= 7)
    trial = sum(1 for c in contacts if c["membership_status"] == "trial")
    monthly = sum(1 for c in contacts if "Monthly Members" in c["segments"])
    annual = sum(1 for c in contacts if "Annual Members" in c["segments"])
    canceled = sum(1 for c in contacts if c["membership_status"] == "canceled")
    revenue = sum(c["ltv_cents"] for c in contacts)
    paying = sum(1 for c in contacts if c["membership_status"] == "active")
    projects_created = sum(c["projects_created"] for c in contacts)
    projects_completed = sum(c["projects_completed"] for c in contacts)
    contributors = sum(1 for c in contacts if c["community_contributions"] >= 1)
    seg_counts = {s: 0 for s in CRM_SEGMENT_ORDER}
    for c in contacts:
        for s in c["segments"]:
            seg_counts[s] = seg_counts.get(s, 0) + 1
    return {
        "total_users": total, "new_today": new_today, "active_7d": active7,
        "trial_users": trial, "monthly_subscribers": monthly, "annual_subscribers": annual,
        "canceled_users": canceled, "paying_users": paying,
        "revenue_cents": revenue, "avg_ltv_cents": (revenue // total) if total else 0,
        "projects_created": projects_created, "projects_completed": projects_completed,
        "community_contributors": contributors,
        "segments": [{"name": s, "count": seg_counts.get(s, 0)} for s in CRM_SEGMENT_ORDER],
    }


@api_router.get("/admin/crm/contacts")
async def crm_contacts(
    search: Optional[str] = None, segment: Optional[str] = None, tag: Optional[str] = None,
    plan: Optional[str] = None, status: Optional[str] = None, sort: str = "recent",
    page: int = 1, limit: int = 25, admin: dict = Depends(require_admin),
):
    q: dict = {}
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        q["$or"] = [{"email": rx}, {"name": rx}, {"phone": rx}]
    users = await db.users.find(q, {"_id": 0, "hashed_password": 0}).to_list(10000)
    contacts = await _crm_enrich(users)
    if segment:
        contacts = [c for c in contacts if segment in c["segments"]]
    if tag:
        contacts = [c for c in contacts if tag in (c.get("tags") or [])]
    if plan:
        contacts = [c for c in contacts if c["plan"] == plan]
    if status:
        contacts = [c for c in contacts if c["membership_status"] == status]
    if sort == "ltv":
        contacts.sort(key=lambda c: c["ltv_cents"], reverse=True)
    elif sort == "active":
        contacts.sort(key=lambda c: c.get("last_activity") or "", reverse=True)
    elif sort == "name":
        contacts.sort(key=lambda c: (c.get("name") or c["email"]).lower())
    else:
        contacts.sort(key=lambda c: c.get("signup_date") or "", reverse=True)
    total = len(contacts)
    start = max(0, (page - 1) * limit)
    return {"total": total, "page": page, "limit": limit, "contacts": contacts[start:start + limit]}


@api_router.get("/admin/crm/contacts/{user_id}")
async def crm_contact_detail(user_id: str, admin: dict = Depends(require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "hashed_password": 0})
    if not u:
        raise HTTPException(status_code=404, detail="Contact not found")
    enriched = (await _crm_enrich([u]))[0]
    # timeline
    events = []
    if u.get("created_at"):
        events.append({"icon": "account-plus", "label": f"Signed up ({enriched['signup_source']})", "at": u["created_at"]})
    async for p in db.projects.find({"user_id": user_id}, {"_id": 0, "title": 1, "status": 1, "created_at": 1, "completed_at": 1}):
        if p.get("created_at"):
            events.append({"icon": "clipboard-text-outline", "label": f"Started project: {p.get('title', 'Project')}", "at": p["created_at"]})
        if p.get("status") == "completed" and p.get("completed_at"):
            events.append({"icon": "check-decagram", "label": f"Completed: {p.get('title', 'Project')}", "at": p["completed_at"]})
    async for e in db.community_experiences.find({"user_id": user_id}, {"_id": 0, "title": 1, "created_at": 1}):
        events.append({"icon": "account-group", "label": f"Posted experience: {e.get('title', '')}", "at": e.get("created_at")})
    async for t in db.payment_transactions.find({"user_id": user_id, "fulfilled": True}, {"_id": 0, "amount": 1, "tier": 1, "created_at": 1}):
        events.append({"icon": "cash", "label": f"Paid ${(t.get('amount', 0) or 0) // 100} ({t.get('tier', '')})", "at": t.get("created_at")})
    async for f in db.feedback.find({"user_email": u["email"]}, {"_id": 0, "message": 1, "created_at": 1}):
        events.append({"icon": "message-alert-outline", "label": "Submitted feedback", "at": f.get("created_at")})
    if u.get("last_login"):
        events.append({"icon": "login", "label": "Last login", "at": u["last_login"]})
    events = [e for e in events if e.get("at")]
    events.sort(key=lambda e: e["at"], reverse=True)
    notes = await db.crm_notes.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    enriched["timeline"] = events
    enriched["notes"] = notes
    return enriched


@api_router.put("/admin/crm/contacts/{user_id}")
async def crm_update_contact(user_id: str, req: CrmContactUpdate, admin: dict = Depends(require_admin)):
    patch = {k: v for k, v in req.dict().items() if v is not None}
    if not patch:
        return {"ok": True}
    res = await db.users.update_one({"id": user_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"ok": True, "updated": patch}


@api_router.post("/admin/crm/contacts/{user_id}/tags")
async def crm_set_tags(user_id: str, req: CrmTagsReq, admin: dict = Depends(require_admin)):
    tags = sorted({t.strip() for t in req.tags if t.strip()})
    res = await db.users.update_one({"id": user_id}, {"$set": {"crm_tags": tags}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"tags": tags}


@api_router.post("/admin/crm/contacts/{user_id}/notes")
async def crm_add_note(user_id: str, req: CrmNoteReq, admin: dict = Depends(require_admin)):
    if not await db.users.find_one({"id": user_id}):
        raise HTTPException(status_code=404, detail="Contact not found")
    note = {
        "id": new_id(), "user_id": user_id, "body": req.body.strip()[:2000],
        "author": admin.get("name") or admin.get("email"), "created_at": now_iso(),
    }
    await db.crm_notes.insert_one(note)
    note.pop("_id", None)
    return note


@api_router.delete("/admin/crm/notes/{note_id}")
async def crm_delete_note(note_id: str, admin: dict = Depends(require_admin)):
    await db.crm_notes.delete_one({"id": note_id})
    return {"ok": True}


# ---------------------------------------------------------------- Vendor / Subscription DB
async def seed_vendors():
    try:
        if not VENDOR_SEED_PATH.exists():
            return
        data = json.loads(VENDOR_SEED_PATH.read_text())
        for v in data.get("vendors", []):
            key = v.get("seed_key")
            await db.vendors.update_one(
                {"seed_key": key},
                {"$setOnInsert": {
                    "id": new_id(), "seed_key": key,
                    "company": v["company"], "category": v.get("category", "Other"),
                    "importance": v.get("importance", "medium"),
                    "website": v.get("website", ""), "login_url": v.get("login_url", ""),
                    "dashboard_url": v.get("dashboard_url", ""), "support_url": v.get("support_url", ""),
                    "docs_url": v.get("docs_url", ""), "api_docs_url": v.get("api_docs_url", ""),
                    "billing_url": v.get("billing_url", ""),
                    "monthly_cost_cents": v.get("monthly_cost_cents", 0), "annual_cost_cents": v.get("annual_cost_cents", 0),
                    "renewal_date": v.get("renewal_date", ""), "plan_type": v.get("plan_type", ""),
                    "account_owner": v.get("account_owner", ""), "email_used": v.get("email_used", ""),
                    "support_email": v.get("support_email", ""), "phone": v.get("phone", ""),
                    "affiliate_link": v.get("affiliate_link", ""), "notes": v.get("notes", ""),
                    "feature_description": v.get("feature_description", ""), "importance_note": v.get("importance_note", ""),
                    "doc": v.get("doc", {}), "active": True, "created_at": now_iso(),
                }},
                upsert=True,
            )
        logger.info("vendors seeded")
    except Exception as e:
        logger.error(f"vendor seed failed: {e}")


@api_router.get("/admin/vendors")
async def list_vendors(search: Optional[str] = None, category: Optional[str] = None, admin: dict = Depends(require_admin)):
    q: dict = {}
    if category:
        q["category"] = category
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        q["$or"] = [{"company": rx}, {"category": rx}, {"feature_description": rx}, {"notes": rx}]
    vendors = await db.vendors.find(q, {"_id": 0}).sort("company", 1).to_list(500)
    return vendors


@api_router.get("/admin/vendors/stats")
async def vendor_stats(admin: dict = Depends(require_admin)):
    vendors = await db.vendors.find({}, {"_id": 0}).to_list(500)
    monthly = sum(v.get("monthly_cost_cents", 0) or 0 for v in vendors)
    annual_from_monthly = monthly * 12
    annual_direct = sum(v.get("annual_cost_cents", 0) or 0 for v in vendors)
    critical = sum(1 for v in vendors if v.get("importance") == "critical")
    cats: dict = {}
    for v in vendors:
        cats[v.get("category", "Other")] = cats.get(v.get("category", "Other"), 0) + 1
    upcoming = []
    for v in vendors:
        d = _days_since(v.get("renewal_date"))
        if d is not None and -1 <= -d <= 30:  # renewal within next 30 days
            upcoming.append({"company": v["company"], "renewal_date": v.get("renewal_date")})
    return {
        "total": len(vendors), "monthly_spend_cents": monthly,
        "annual_spend_cents": annual_direct + annual_from_monthly,
        "critical": critical,
        "categories": [{"name": k, "count": v} for k, v in sorted(cats.items())],
        "upcoming_renewals": upcoming,
    }


@api_router.post("/admin/vendors")
async def create_vendor(req: VendorReq, admin: dict = Depends(require_admin)):
    v = req.dict()
    v["id"] = new_id()
    v["active"] = True
    v["created_at"] = now_iso()
    v["doc"] = v.get("doc") or {}
    await db.vendors.insert_one(dict(v))
    v.pop("_id", None)
    return v


@api_router.put("/admin/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, req: VendorReq, admin: dict = Depends(require_admin)):
    patch = req.dict()
    patch["doc"] = patch.get("doc") or {}
    res = await db.vendors.update_one({"id": vendor_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    v = await db.vendors.find_one({"id": vendor_id}, {"_id": 0})
    return v


@api_router.delete("/admin/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, admin: dict = Depends(require_admin)):
    await db.vendors.delete_one({"id": vendor_id})
    return {"ok": True}


# ---------------------------------------------------------------- Decor8 Paint Visualizer
DECOR8_ENDPOINTS = {
    "wall": "/change_wall_color",
    "cabinet": "/change_kitchen_cabinets_color",
}
VISUALIZE_COST = 4


class VisualizeReq(BaseModel):
    image_base64: str
    feature_type: str = "wall"  # wall | cabinet | flooring | exterior
    color_hex: Optional[str] = None
    color_name: Optional[str] = None
    room_type: str = "livingroom"
    prompt: Optional[str] = None
    project_id: Optional[str] = None


@api_router.post("/visualize")
async def visualize_finish(req: VisualizeReq, user: dict = Depends(get_current_user)):
    if not DECOR8_API_KEY:
        raise HTTPException(status_code=503, detail="Paint visualizer is not configured.")
    img = (req.image_base64 or "").strip()
    if not img:
        raise HTTPException(status_code=400, detail="Please upload a photo first.")
    if not (img.startswith("data:image") or img.startswith("http")):
        img = f"data:image/jpeg;base64,{img}"

    feature = req.feature_type if req.feature_type in ("wall", "cabinet", "flooring", "exterior") else "wall"
    # First visualization ever is free (conversion moment), then charge credits.
    prior = await db.visualizations.count_documents({"user_id": user["id"]})
    cost = 0 if prior == 0 else VISUALIZE_COST
    if user.get("credits", 0) < cost:
        raise HTTPException(status_code=402, detail="Out of credits. Upgrade to keep visualizing.")

    if feature in ("wall", "cabinet"):
        if not req.color_hex or not req.color_hex.startswith("#"):
            raise HTTPException(status_code=400, detail="Pick a color first.")
        endpoint = DECOR8_ENDPOINTS[feature]
        if feature == "wall":
            payload: dict = {"input_image_url": img, "wall_color_hex_code": req.color_hex, "color_hex": req.color_hex, "room_type": req.room_type}
        else:
            payload = {"input_image_url": img, "cabinet_color_hex_code": req.color_hex, "color_hex": req.color_hex, "room_type": "kitchen"}
    else:
        # flooring / exterior -> prompt-based design endpoint
        endpoint = "/generate_designs_for_room"
        if req.prompt:
            prompt = req.prompt
        elif feature == "flooring":
            prompt = f"replace the flooring with {req.color_name or 'new'} flooring, keep everything else the same"
        else:
            prompt = f"repaint the exterior walls/siding {req.color_name or req.color_hex or 'a new color'}, keep everything else the same"
        payload = {"input_image_url": img, "prompt": prompt, "room_type": req.room_type, "design_style": "modern"}

    headers = {"Authorization": f"Bearer {DECOR8_API_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=90.0) as http_client:
            resp = await http_client.post(f"{DECOR8_BASE_URL}{endpoint}", json=payload, headers=headers)
    except Exception as e:
        logger.error(f"decor8 request failed: {e}")
        raise HTTPException(status_code=504, detail="Visualizer timed out. Try again.")

    if resp.status_code != 200:
        logger.error(f"decor8 {resp.status_code}: {resp.text[:300]}")
        if resp.status_code == 422:
            raise HTTPException(status_code=422, detail="That photo or color didn't work — try a clearer room photo.")
        if resp.status_code == 429:
            raise HTTPException(status_code=429, detail="Visualizer is busy. Try again in a moment.")
        raise HTTPException(status_code=502, detail="Visualizer error. Try again.")

    try:
        body = resp.json()
        info = body.get("info", {}) or {}
        if info.get("images"):
            result_url = info["images"][0]["url"]
        else:
            result_url = info.get("url") or body.get("url")
        if not result_url:
            raise ValueError("no url")
    except Exception:
        logger.error(f"decor8 unexpected response: {resp.text[:300]}")
        raise HTTPException(status_code=502, detail="Visualizer returned no image.")

    rec = {
        "id": new_id(), "user_id": user["id"], "feature_type": feature,
        "color_hex": req.color_hex, "color_name": req.color_name, "room_type": req.room_type,
        "result_url": result_url, "project_id": req.project_id, "created_at": now_iso(),
    }
    await db.visualizations.insert_one(dict(rec))
    rec.pop("_id", None)
    new_credits = user.get("credits", 0) - cost
    await db.users.update_one({"id": user["id"]}, {"$set": {"credits": new_credits}})
    rec["credits"] = new_credits
    rec["cost"] = cost
    return rec


@api_router.get("/visualize/history")
async def visualize_history(limit: int = 20, user: dict = Depends(get_current_user)):
    items = await db.visualizations.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return items


# ---------------------------------------------------------------- Home Maintenance Scheduler
FREQ_PER_YEAR = {"monthly": 12, "quarterly": 4, "biannual": 2, "seasonal": 2, "annual": 1, "once": 0}
FREQ_DAYS = {"monthly": 30, "quarterly": 91, "biannual": 182, "seasonal": 182, "annual": 365, "once": 0}

MAINTENANCE_TEMPLATE = [
    {"title": "Replace HVAC air filter", "category": "HVAC", "frequency": "monthly", "est_cost_cents": 1500, "offset_days": 10},
    {"title": "Clean garbage disposal", "category": "Appliances", "frequency": "monthly", "est_cost_cents": 0, "offset_days": 18},
    {"title": "Test smoke & CO detectors", "category": "Safety", "frequency": "quarterly", "est_cost_cents": 0, "offset_days": 7},
    {"title": "Test GFCI outlets", "category": "Electrical", "frequency": "quarterly", "est_cost_cents": 0, "offset_days": 25},
    {"title": "Clean range hood filter", "category": "Appliances", "frequency": "quarterly", "est_cost_cents": 0, "offset_days": 35},
    {"title": "Fertilize & treat lawn", "category": "Lawn & Garden", "frequency": "seasonal", "est_cost_cents": 4000, "offset_days": 21},
    {"title": "HVAC tune-up (heating/cooling)", "category": "HVAC", "frequency": "biannual", "est_cost_cents": 12000, "offset_days": 45},
    {"title": "Clean gutters & downspouts", "category": "Exterior", "frequency": "biannual", "est_cost_cents": 0, "offset_days": 60},
    {"title": "Clean refrigerator coils", "category": "Appliances", "frequency": "biannual", "est_cost_cents": 0, "offset_days": 70},
    {"title": "Replace water filters", "category": "Plumbing", "frequency": "biannual", "est_cost_cents": 4000, "offset_days": 30},
    {"title": "Inspect & re-caulk bathrooms", "category": "Plumbing", "frequency": "biannual", "est_cost_cents": 1000, "offset_days": 80},
    {"title": "Flush water heater", "category": "Plumbing", "frequency": "annual", "est_cost_cents": 0, "offset_days": 90},
    {"title": "Inspect roof & flashing", "category": "Exterior", "frequency": "annual", "est_cost_cents": 0, "offset_days": 110},
    {"title": "Clean dryer vent", "category": "Safety", "frequency": "annual", "est_cost_cents": 0, "offset_days": 55},
    {"title": "Test sump pump", "category": "Plumbing", "frequency": "annual", "est_cost_cents": 0, "offset_days": 100},
    {"title": "Reseal windows & exterior doors", "category": "Exterior", "frequency": "annual", "est_cost_cents": 2500, "offset_days": 120},
    {"title": "Service garage door", "category": "Other", "frequency": "annual", "est_cost_cents": 0, "offset_days": 130},
    {"title": "Check & recharge fire extinguisher", "category": "Safety", "frequency": "annual", "est_cost_cents": 0, "offset_days": 140},
    {"title": "Deep clean & inspect deck", "category": "Exterior", "frequency": "annual", "est_cost_cents": 3000, "offset_days": 150},
    {"title": "Winterize outdoor faucets", "category": "Seasonal", "frequency": "annual", "est_cost_cents": 0, "offset_days": 75},
]


class MaintTaskReq(BaseModel):
    title: str
    category: Optional[str] = "Other"
    frequency: str = "annual"
    est_cost_cents: Optional[int] = 0
    next_due: Optional[str] = None
    notes: Optional[str] = None


def _today():
    return datetime.now(timezone.utc).date()


def _task_status(next_due: Optional[str]) -> str:
    if not next_due:
        return "upcoming"
    try:
        d = datetime.fromisoformat(next_due).date()
    except Exception:
        return "upcoming"
    delta = (d - _today()).days
    if delta < 0:
        return "overdue"
    if delta <= 30:
        return "due_soon"
    return "upcoming"


def _maint_public(t: dict) -> dict:
    out = {k: t.get(k) for k in ("id", "title", "category", "frequency", "est_cost_cents", "next_due", "last_done", "notes", "source", "created_at")}
    out["status"] = _task_status(t.get("next_due"))
    return out


@api_router.post("/maintenance/generate")
async def maintenance_generate(user: dict = Depends(get_current_user)):
    existing = {t["title"] async for t in db.maintenance_tasks.find({"user_id": user["id"]}, {"_id": 0, "title": 1})}
    today = _today()
    added = 0
    for tpl in MAINTENANCE_TEMPLATE:
        if tpl["title"] in existing:
            continue
        due = (today + timedelta(days=tpl["offset_days"])).isoformat()
        await db.maintenance_tasks.insert_one({
            "id": new_id(), "user_id": user["id"], "title": tpl["title"], "category": tpl["category"],
            "frequency": tpl["frequency"], "est_cost_cents": tpl["est_cost_cents"], "next_due": due,
            "last_done": None, "notes": "", "source": "template", "created_at": now_iso(),
        })
        added += 1
    return {"added": added}


@api_router.get("/maintenance/tasks")
async def maintenance_tasks(user: dict = Depends(get_current_user)):
    tasks = await db.maintenance_tasks.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    pub = [_maint_public(t) for t in tasks]
    order = {"overdue": 0, "due_soon": 1, "upcoming": 2}
    pub.sort(key=lambda t: (order.get(t["status"], 3), t.get("next_due") or "9999"))
    return pub


@api_router.get("/maintenance/summary")
async def maintenance_summary(user: dict = Depends(get_current_user)):
    tasks = await db.maintenance_tasks.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    overdue = due_month = 0
    annual_budget = 0
    for t in tasks:
        st = _task_status(t.get("next_due"))
        if st == "overdue":
            overdue += 1
        elif st == "due_soon":
            due_month += 1
        annual_budget += (t.get("est_cost_cents") or 0) * FREQ_PER_YEAR.get(t.get("frequency", "annual"), 1)
    year = _today().year
    spent = 0
    async for c in db.maintenance_log.find({"user_id": user["id"]}, {"_id": 0, "cost_cents": 1, "date": 1}):
        if (c.get("date") or "").startswith(str(year)):
            spent += c.get("cost_cents") or 0
    return {
        "total": len(tasks), "overdue": overdue, "due_this_month": due_month,
        "annual_budget_cents": annual_budget, "spent_ytd_cents": spent,
        "on_track": overdue == 0,
    }


@api_router.post("/maintenance/tasks")
async def maintenance_add(req: MaintTaskReq, user: dict = Depends(get_current_user)):
    freq = req.frequency if req.frequency in FREQ_DAYS else "annual"
    due = req.next_due or (_today() + timedelta(days=FREQ_DAYS.get(freq, 365) or 30)).isoformat()
    task = {
        "id": new_id(), "user_id": user["id"], "title": req.title.strip()[:120], "category": req.category or "Other",
        "frequency": freq, "est_cost_cents": req.est_cost_cents or 0, "next_due": due,
        "last_done": None, "notes": (req.notes or "").strip()[:500], "source": "custom", "created_at": now_iso(),
    }
    await db.maintenance_tasks.insert_one(dict(task))
    return _maint_public(task)


@api_router.put("/maintenance/tasks/{task_id}")
async def maintenance_update(task_id: str, req: MaintTaskReq, user: dict = Depends(get_current_user)):
    patch = {
        "title": req.title.strip()[:120], "category": req.category or "Other",
        "frequency": req.frequency if req.frequency in FREQ_DAYS else "annual",
        "est_cost_cents": req.est_cost_cents or 0, "notes": (req.notes or "").strip()[:500],
    }
    if req.next_due:
        patch["next_due"] = req.next_due
    res = await db.maintenance_tasks.find_one_and_update({"id": task_id, "user_id": user["id"]}, {"$set": patch}, return_document=ReturnDocument.AFTER)
    if not res:
        raise HTTPException(status_code=404, detail="Task not found")
    return _maint_public(res)


@api_router.post("/maintenance/tasks/{task_id}/complete")
async def maintenance_complete(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.maintenance_tasks.find_one({"id": task_id, "user_id": user["id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    today = _today()
    await db.maintenance_log.insert_one({
        "id": new_id(), "user_id": user["id"], "task_id": task_id, "title": t["title"],
        "cost_cents": t.get("est_cost_cents") or 0, "date": today.isoformat(),
    })
    freq = t.get("frequency", "annual")
    if freq == "once":
        await db.maintenance_tasks.delete_one({"id": task_id})
        return {"completed": True, "removed": True}
    next_due = (today + timedelta(days=FREQ_DAYS.get(freq, 365))).isoformat()
    res = await db.maintenance_tasks.find_one_and_update(
        {"id": task_id}, {"$set": {"last_done": today.isoformat(), "next_due": next_due}}, return_document=ReturnDocument.AFTER)
    return {"completed": True, "task": _maint_public(res)}


@api_router.delete("/maintenance/tasks/{task_id}")
async def maintenance_delete(task_id: str, user: dict = Depends(get_current_user)):
    await db.maintenance_tasks.delete_one({"id": task_id, "user_id": user["id"]})
    return {"ok": True}


# ---------------------------------------------------------------- Local Code Check (Perplexity, location-aware)
CODE_KEYWORDS = [
    "deck", "footing", "foundation", "electrical", "wiring", "outlet", "gfci", "breaker", "panel",
    "circuit", "subpanel", "conduit", "plumbing", "drain", "vent", "gas", "water heater", "structural",
    "beam", "joist", "span", "egress", "stair", "railing", "handrail", "permit", "setback", "fence",
    "retaining wall", "load bearing", "roof", "framing", "septic", "grading", "frost", "amperage", "rewire",
]


def project_needs_code(text: Optional[str]) -> bool:
    if not text:
        return False
    t = text.lower()
    return any(k in t for k in CODE_KEYWORDS)


class CodeCheckReq(BaseModel):
    query: str
    location: Optional[str] = None
    project_id: Optional[str] = None


CODE_DISCLAIMER = "AI-assisted estimate from live sources. Always confirm with your local building department before you pour concrete, cut wires, or run pipe — and pull required permits."


@api_router.post("/code-check")
async def code_check(req: CodeCheckReq, user: dict = Depends(get_current_user)):
    location = (req.location or user.get("location") or "").strip()
    if not location:
        raise HTTPException(status_code=400, detail="Add your city or ZIP in Profile (or enable location) so we can check your local code.")
    query = (req.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Ask a code question.")

    system = (
        "You are a master municipal building inspector assistant. The user is located in {loc}. "
        "FIRST, search the web to identify exactly which version/cycle of the International Residential Code (IRC), "
        "International Building Code (IBC), National Electrical Code (NEC), and/or plumbing code (UPC/IPC) this specific "
        "municipality has adopted. SECOND, search for local municipal amendments, city ordinances, frost-line depth, and "
        "permit/inspection requirements for THIS exact city. THEN answer the user's question with the EXACT regulation that "
        "applies to their local laws — be specific with numbers (depths, sizes, spacing, amperage). Cite official city/county "
        "code sources. If the municipality can't be pinned down, give the most likely applicable state/IRC default and mark "
        "confidence lower. Respond in STRICT JSON only, no prose: "
        '{{"code_basis": "e.g. 2021 IRC + City of Austin amendments", "answer": "clear DIYer explanation with exact numbers", '
        '"requirements": ["short bullet", "short bullet"], "permit_required": true, "confidence": "high|medium|low"}}'
    ).format(loc=location)

    if not PERPLEXITY_API_KEY:
        raise HTTPException(status_code=503, detail="Code lookup is not configured.")

    citations: list = []
    try:
        from openai import AsyncOpenAI
        pplx = AsyncOpenAI(api_key=PERPLEXITY_API_KEY, base_url="https://api.perplexity.ai")
        resp = await pplx.chat.completions.create(
            model="sonar-pro",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": query}],
            max_tokens=900,
        )
        content = resp.choices[0].message.content
        cit = getattr(resp, "citations", None)
        if not cit:
            try:
                cit = resp.model_dump().get("citations")
            except Exception:
                cit = None
        citations = cit or []
        parsed = _strip_json(content)
    except Exception as e:
        logger.error(f"code-check failed: {e}")
        raise HTTPException(status_code=502, detail="Couldn't reach the code library. Try again in a moment.")

    if not isinstance(parsed, dict):
        parsed = {"answer": str(parsed), "code_basis": "", "requirements": [], "permit_required": None, "confidence": "low"}

    result = {
        "location": location,
        "query": query,
        "code_basis": parsed.get("code_basis", ""),
        "answer": parsed.get("answer", ""),
        "requirements": parsed.get("requirements", []) or [],
        "permit_required": parsed.get("permit_required"),
        "confidence": parsed.get("confidence", "medium"),
        "citations": [c for c in citations if isinstance(c, str)][:8],
        "disclaimer": CODE_DISCLAIMER,
    }
    try:
        await db.code_checks.insert_one({
            "id": new_id(), "user_id": user["id"], "project_id": req.project_id,
            **result, "created_at": now_iso(),
        })
    except Exception:
        pass
    return result


app.include_router(api_router)

# Built-in autoresponder / email engine (separate module to keep server.py lean).
email_engine.configure(db, logger, email_segment_resolver)
app.include_router(email_engine.build_admin_router(require_admin))
app.include_router(email_engine.build_public_router())

# Intelligent affiliate product widget engine (blog monetization).
affiliate_engine.configure(db, logger, _llm_json)
app.include_router(affiliate_engine.build_admin_router(require_admin))

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup_stripe_prices():
    try:
        await ensure_stripe_prices()
    except Exception as e:
        logger.error(f"startup stripe price init failed: {e}")


@app.on_event("startup")
async def _ensure_indexes():
    try:
        await db.users.create_index("email")
        await db.users.create_index("id")
        await db.projects.create_index([("user_id", 1), ("updated_at", -1)])
        await db.projects.create_index("id")
        await db.blog_posts.create_index([("published", 1), ("created_at", -1)])
        await db.blog_posts.create_index("slug")
        await db.feedback.create_index([("status", 1), ("created_at", -1)])
        await db.support_tickets.create_index([("status", 1), ("created_at", -1)])
        await db.referrals.create_index("referrer_id")
        await db.referrals.create_index("code")
        await db.community_projects.create_index("slug")
        await db.community_experiences.create_index([("project_slug", 1), ("created_at", -1)])
        await db.community_experiences.create_index("id")
        await db.community_experiences.create_index("user_id")
        await db.community_threads.create_index([("project_slug", 1), ("created_at", -1)])
        await db.community_threads.create_index("id")
        await db.crm_notes.create_index([("user_id", 1), ("created_at", -1)])
        await db.users.create_index("crm_tags")
        await db.vendors.create_index("id")
        await db.vendors.create_index("category")
        logger.info("indexes ensured")
    except Exception as e:
        logger.warning(f"index ensure: {e}")


@app.on_event("startup")
async def _startup_seed_community():
    await seed_community()
    await seed_vendors()
    await seed_pros()


@app.on_event("startup")
async def _startup_email_engine():
    await email_engine.seed_templates()
    asyncio.create_task(email_engine.scheduler_loop())


@app.on_event("startup")
async def _seed_admin():
    """Idempotently ensure the owner account exists and has admin rights."""
    email = (os.environ.get("ADMIN_EMAIL") or "").lower().strip()
    pwd = os.environ.get("ADMIN_PASSWORD") or ""
    if not email or not pwd:
        return
    try:
        existing = await db.users.find_one({"email": email})
        if existing:
            if not existing.get("is_admin"):
                await db.users.update_one({"email": email}, {"$set": {"is_admin": True}})
                logger.info(f"admin rights granted to existing user {email}")
        else:
            await db.users.insert_one({
                "id": new_id(), "email": email, "name": "Admin",
                "hashed_password": pwd_context.hash(pwd),
                "experience": None, "tools": [], "budget": None, "pain_point": None,
                "expectation": None, "location": "", "credits": 9999, "voice_minutes": 9999,
                "subscription_tier": "master", "onboarded": True, "is_admin": True,
                "created_at": now_iso(),
            })
            logger.info(f"admin account seeded: {email}")
    except Exception as e:
        logger.error(f"admin seed failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
