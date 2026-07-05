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


def _neighborhood_key(location: str) -> str:
    """Derive an anonymized grouping key from a user's location (city/ZIP).
    Never uses street-level data — only the primary city/ZIP token."""
    loc = (location or "").strip().lower()
    if not loc:
        return ""
    primary = loc.split(",")[0].strip()
    return " ".join(primary.split())


def _neighborhood_tag(location: str) -> str:
    """Human-friendly, anonymized neighborhood label (e.g. 'East Austin', 'ZIP 78701')."""
    key = _neighborhood_key(location)
    if not key:
        return ""
    if key.replace("-", "").replace(" ", "").isdigit():
        return f"ZIP {key}"
    return key.title()


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
        "neighborhood_optin": u.get("neighborhood_optin", False),
        "neighborhood_tag": _neighborhood_tag(u.get("location", "")),
        "is_pro": u.get("is_pro", False),
        "pro_id": u.get("pro_id"),
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


# ================================================================ B2B / Contractor & Professional Services Suite (Sheet #28)
PRO_JOB_STATUSES = ["draft", "proposal_sent", "approved", "in_progress", "completed", "cancelled"]
INVOICE_KINDS = {"deposit", "progress", "final"}
PLATFORM_FEE_PCT = 0.08  # DIYhomie platform fee on pro invoices


class ProApplyAccountReq(BaseModel):
    name: str
    trades: List[str] = []
    specialties: List[str] = []
    location: str = ""
    bio: str = ""
    phone: str = ""
    website: str = ""
    license_number: str = ""
    insurance: str = ""
    portfolio: List[str] = []  # base64 images


class LineItem(BaseModel):
    label: str
    amount_cents: int = 0


class ProposalReq(BaseModel):
    line_items: List[LineItem] = []
    note: str = ""


class JobReq(BaseModel):
    client_email: str
    title: str
    description: str = ""


class MessageReq(BaseModel):
    body: str


class InvoiceReq(BaseModel):
    label: str
    amount_cents: int
    kind: str = "progress"


class ReviewReq(BaseModel):
    rating: int = 5
    text: str = ""


class OriginReq(BaseModel):
    origin_url: str = ""


async def get_pro_profile(user: dict = Depends(get_current_user)) -> dict:
    prof = await db.pro_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not prof or prof.get("status") != "verified":
        raise HTTPException(status_code=403, detail="Verified pro account required.")
    prof["_user"] = user
    return prof


def _pro_profile_public(p: dict) -> dict:
    return {
        "id": p["id"], "name": p.get("name"), "trades": p.get("trades", []),
        "specialties": p.get("specialties", []), "location": p.get("location", ""),
        "bio": p.get("bio", ""), "status": p.get("status"),
        "license_number": p.get("license_number", ""), "insurance": p.get("insurance", ""),
        "phone": p.get("phone", ""), "website": p.get("website", ""),
        "portfolio": p.get("portfolio", []),
        "rating": round(p.get("rating", 0), 1), "reviews_count": p.get("reviews_count", 0),
        "jobs_completed": p.get("jobs_completed", 0),
        "trusted": bool(p.get("jobs_completed", 0) >= 3 and p.get("rating", 0) >= 4.5),
        "stripe_account_id": p.get("stripe_account_id"),
        "charges_enabled": bool(p.get("charges_enabled")),
        "payouts_enabled": bool(p.get("payouts_enabled")),
    }


def _job_public(j: dict, viewer_id: str) -> dict:
    return {
        "id": j["id"], "title": j["title"], "description": j.get("description", ""),
        "status": j["status"], "pro_name": j.get("pro_name"), "client_email": j.get("client_email"),
        "is_pro_side": j["pro_user_id"] == viewer_id,
        "proposal": j.get("proposal"),
        "messages": j.get("messages", []),
        "change_requests": j.get("change_requests", []),
        "review": j.get("review"),
        "created_at": j["created_at"], "updated_at": j.get("updated_at", j["created_at"]),
    }


# ---- pro account lifecycle
@api_router.post("/pro/apply")
async def pro_apply(req: ProApplyAccountReq, user: dict = Depends(get_current_user)):
    existing = await db.pro_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    doc = {
        "user_id": user["id"], "name": req.name[:100] or user.get("name", ""),
        "trades": req.trades[:8], "specialties": req.specialties[:12],
        "location": req.location[:80] or user.get("location", ""), "bio": req.bio[:600],
        "phone": req.phone[:40], "website": req.website[:200],
        "license_number": req.license_number[:60], "insurance": req.insurance[:120],
        "portfolio": (req.portfolio or [])[:8], "email": user.get("email", ""),
        "status": "pending", "updated_at": now_iso(),
    }
    if existing:
        if existing.get("status") == "banned":
            raise HTTPException(status_code=403, detail="This account cannot re-apply. Contact support.")
        await db.pro_profiles.update_one({"user_id": user["id"]}, {"$set": doc})
        prof = await db.pro_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    else:
        doc.update({"id": new_id(), "stripe_account_id": None, "charges_enabled": False,
                    "payouts_enabled": False, "rating": 0.0, "reviews_count": 0,
                    "jobs_completed": 0, "created_at": now_iso()})
        await db.pro_profiles.insert_one(dict(doc))
        prof = doc
    await emit_event("pro_applied", user["id"], {"trades": req.trades})
    return {"ok": True, "status": prof["status"], "message": "Application received — our team will verify your credentials shortly."}


@api_router.get("/pro/me")
async def pro_me(user: dict = Depends(get_current_user)):
    prof = await db.pro_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not prof:
        return {"has_account": False}
    jobs = await db.pro_jobs.find({"pro_user_id": user["id"]}, {"_id": 0}).to_list(500)
    active = [j for j in jobs if j["status"] in ("approved", "in_progress", "proposal_sent")]
    completed = [j for j in jobs if j["status"] == "completed"]
    paid_cur = db.pro_invoices.aggregate([
        {"$match": {"pro_user_id": user["id"], "status": "paid"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_cents"}}},
    ])
    paid_row = await paid_cur.to_list(1)
    revenue = int(paid_row[0]["total"]) if paid_row else 0
    outstanding_cur = db.pro_invoices.aggregate([
        {"$match": {"pro_user_id": user["id"], "status": "sent"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_cents"}}},
    ])
    out_row = await outstanding_cur.to_list(1)
    outstanding = int(out_row[0]["total"]) if out_row else 0
    return {
        "has_account": True,
        "profile": _pro_profile_public(prof),
        "stats": {
            "active_jobs": len(active), "completed_jobs": len(completed),
            "revenue_cents": revenue, "outstanding_cents": outstanding,
            "rating": round(prof.get("rating", 0), 1), "reviews_count": prof.get("reviews_count", 0),
        },
    }


# ---- Stripe Connect (Express) onboarding for pros
@api_router.post("/pro/connect/onboard")
async def pro_connect_onboard(req: OriginReq, prof: dict = Depends(get_pro_profile)):
    if not STRIPE_SECRET_KEY or "sk_test_emergent" in STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments not configured on this environment.")
    acct_id = prof.get("stripe_account_id")
    try:
        if not acct_id:
            account = await asyncio.to_thread(lambda: stripe.Account.create(
                type="express",
                email=prof.get("email"),
                capabilities={"card_payments": {"requested": True}, "transfers": {"requested": True}},
                business_type="individual",
                metadata={"pro_user_id": prof["user_id"], "pro_id": prof["id"]},
            ))
            acct_id = account.id
            await db.pro_profiles.update_one({"user_id": prof["user_id"]}, {"$set": {"stripe_account_id": acct_id}})
        host = (req.origin_url or "").rstrip("/") or "https://diyhomie.app"
        link = await asyncio.to_thread(lambda: stripe.AccountLink.create(
            account=acct_id,
            refresh_url=f"{host}/pro/payouts?refresh=1",
            return_url=f"{host}/pro/payouts?done=1",
            type="account_onboarding",
        ))
        return {"url": link.url}
    except Exception as e:
        logger.error(f"connect onboard error: {e}")
        raise HTTPException(status_code=502, detail="Could not start payout setup. Try again.")


@api_router.get("/pro/connect/status")
async def pro_connect_status(prof: dict = Depends(get_pro_profile)):
    acct_id = prof.get("stripe_account_id")
    if not acct_id or not STRIPE_SECRET_KEY or "sk_test_emergent" in STRIPE_SECRET_KEY:
        return {"onboarded": False, "charges_enabled": False, "payouts_enabled": False}
    try:
        account = await asyncio.to_thread(lambda: stripe.Account.retrieve(acct_id))
        ce, pe = bool(account.charges_enabled), bool(account.payouts_enabled)
        await db.pro_profiles.update_one({"user_id": prof["user_id"]}, {"$set": {"charges_enabled": ce, "payouts_enabled": pe}})
        return {"onboarded": ce and pe, "charges_enabled": ce, "payouts_enabled": pe}
    except Exception as e:
        logger.error(f"connect status error: {e}")
        return {"onboarded": False, "charges_enabled": False, "payouts_enabled": False}


# ---- pro jobs
@api_router.post("/pro/jobs")
async def create_job(req: JobReq, prof: dict = Depends(get_pro_profile)):
    client = await db.users.find_one({"email": req.client_email.lower().strip()}, {"_id": 0, "id": 1})
    job = {
        "id": new_id(), "pro_user_id": prof["user_id"], "pro_id": prof["id"], "pro_name": prof.get("name"),
        "client_email": req.client_email.lower().strip()[:120], "client_user_id": (client or {}).get("id"),
        "title": req.title.strip()[:140], "description": req.description.strip()[:2000],
        "status": "draft", "proposal": None, "messages": [], "change_requests": [], "review": None,
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.pro_jobs.insert_one(dict(job))
    return _job_public(job, prof["user_id"])


@api_router.get("/pro/jobs")
async def list_pro_jobs(prof: dict = Depends(get_pro_profile)):
    jobs = await db.pro_jobs.find({"pro_user_id": prof["user_id"]}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return [_job_public(j, prof["user_id"]) for j in jobs]


async def _load_job_for_user(job_id: str, user: dict) -> dict:
    j = await db.pro_jobs.find_one({"id": job_id}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Job not found.")
    is_pro = j["pro_user_id"] == user["id"]
    is_client = j.get("client_user_id") == user["id"] or j.get("client_email") == user.get("email", "").lower()
    if not (is_pro or is_client):
        raise HTTPException(status_code=403, detail="Not your job.")
    return j


@api_router.get("/pro/jobs/{job_id}")
async def get_job(job_id: str, user: dict = Depends(get_current_user)):
    j = await _load_job_for_user(job_id, user)
    invoices = await db.pro_invoices.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    inv_out = [{k: v for k, v in i.items()} for i in invoices]
    data = _job_public(j, user["id"])
    data["invoices"] = inv_out
    return data


@api_router.post("/pro/jobs/{job_id}/proposal")
async def set_proposal(job_id: str, req: ProposalReq, prof: dict = Depends(get_pro_profile)):
    j = await db.pro_jobs.find_one({"id": job_id, "pro_user_id": prof["user_id"]}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Job not found.")
    items = [{"label": li.label[:120], "amount_cents": max(0, int(li.amount_cents))} for li in req.line_items]
    total = sum(i["amount_cents"] for i in items)
    proposal = {"line_items": items, "total_cents": total, "note": req.note[:1000], "sent_at": now_iso()}
    await db.pro_jobs.update_one({"id": job_id}, {"$set": {"proposal": proposal, "status": "proposal_sent", "updated_at": now_iso()}})
    if j.get("client_user_id"):
        await emit_event("pro_proposal_sent", j["client_user_id"], {"job": j["title"], "total_cents": total})
        await push_notification(j["client_user_id"], title="New proposal from your pro",
                                body=f"{prof.get('name','Your pro')} sent a proposal for “{j['title']}”.",
                                ntype="project", meta={"job_id": job_id})
    return {"ok": True}


@api_router.patch("/pro/jobs/{job_id}/status")
async def update_job_status(job_id: str, status: str, prof: dict = Depends(get_pro_profile)):
    if status not in PRO_JOB_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status.")
    j = await db.pro_jobs.find_one({"id": job_id, "pro_user_id": prof["user_id"]}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Job not found.")
    await db.pro_jobs.update_one({"id": job_id}, {"$set": {"status": status, "updated_at": now_iso()}})
    if status == "completed":
        await db.pro_profiles.update_one({"user_id": prof["user_id"]}, {"$inc": {"jobs_completed": 1}})
    return {"ok": True}


@api_router.post("/pro/jobs/{job_id}/message")
async def job_message(job_id: str, req: MessageReq, user: dict = Depends(get_current_user)):
    j = await _load_job_for_user(job_id, user)
    role = "pro" if j["pro_user_id"] == user["id"] else "client"
    msg = {"id": new_id(), "from_role": role, "from_name": (user.get("name") or "").split(" ")[0] or role,
           "body": req.body.strip()[:1500], "at": now_iso()}
    await db.pro_jobs.update_one({"id": job_id}, {"$push": {"messages": msg}, "$set": {"updated_at": now_iso()}})
    return msg


# ---- invoices
@api_router.post("/pro/jobs/{job_id}/invoices")
async def create_invoice(job_id: str, req: InvoiceReq, prof: dict = Depends(get_pro_profile)):
    j = await db.pro_jobs.find_one({"id": job_id, "pro_user_id": prof["user_id"]}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Job not found.")
    if req.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero.")
    inv = {
        "id": new_id(), "job_id": job_id, "pro_user_id": prof["user_id"],
        "client_email": j.get("client_email"), "client_user_id": j.get("client_user_id"),
        "label": req.label.strip()[:120] or "Invoice",
        "amount_cents": int(req.amount_cents), "kind": req.kind if req.kind in INVOICE_KINDS else "progress",
        "status": "draft", "stripe_session_id": None, "paid_at": None, "created_at": now_iso(),
    }
    await db.pro_invoices.insert_one(dict(inv))
    return {k: v for k, v in inv.items()}


@api_router.post("/pro/invoices/{invoice_id}/send")
async def send_invoice(invoice_id: str, prof: dict = Depends(get_pro_profile)):
    inv = await db.pro_invoices.find_one({"id": invoice_id, "pro_user_id": prof["user_id"]}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    await db.pro_invoices.update_one({"id": invoice_id}, {"$set": {"status": "sent"}})
    if inv.get("client_user_id"):
        await emit_event("pro_invoice_sent", inv["client_user_id"], {"amount_cents": inv["amount_cents"]})
        await push_notification(inv["client_user_id"], title="New invoice from your pro",
                                body=f"Invoice “{inv.get('label','Invoice')}” is ready to pay.",
                                ntype="project", meta={"job_id": inv.get("job_id")})
    return {"ok": True}


# ---- client portal
@api_router.get("/client/jobs")
async def client_jobs(user: dict = Depends(get_current_user)):
    email = user.get("email", "").lower()
    jobs = await db.pro_jobs.find(
        {"$or": [{"client_user_id": user["id"]}, {"client_email": email}], "status": {"$ne": "draft"}},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(500)
    return [_job_public(j, user["id"]) for j in jobs]


@api_router.post("/client/jobs/{job_id}/approve")
async def client_approve(job_id: str, user: dict = Depends(get_current_user)):
    j = await _load_job_for_user(job_id, user)
    if j["pro_user_id"] == user["id"]:
        raise HTTPException(status_code=403, detail="Only the client can approve.")
    if not j.get("proposal"):
        raise HTTPException(status_code=400, detail="No proposal to approve yet.")
    await db.pro_jobs.update_one({"id": job_id}, {"$set": {"status": "approved", "updated_at": now_iso(),
                                                            "proposal.approved_at": now_iso()}})
    await emit_event("pro_proposal_approved", j["pro_user_id"], {"job": j["title"]})
    await push_notification(j["pro_user_id"], title="Proposal approved 🎉",
                            body=f"Your client approved “{j['title']}”. Time to get to work!",
                            ntype="project", meta={"job_id": job_id})
    return {"ok": True}


@api_router.post("/client/jobs/{job_id}/change-request")
async def client_change_request(job_id: str, req: MessageReq, user: dict = Depends(get_current_user)):
    j = await _load_job_for_user(job_id, user)
    if j["pro_user_id"] == user["id"]:
        raise HTTPException(status_code=403, detail="Only the client can request changes.")
    cr = {"id": new_id(), "body": req.body.strip()[:1000], "at": now_iso(), "status": "open"}
    await db.pro_jobs.update_one({"id": job_id}, {"$push": {"change_requests": cr}, "$set": {"updated_at": now_iso()}})
    await emit_event("pro_change_request", j["pro_user_id"], {"job": j["title"]})
    await push_notification(j["pro_user_id"], title="Client requested a change",
                            body=f"New change request on “{j['title']}”.", ntype="project", meta={"job_id": job_id})
    return cr


@api_router.post("/client/jobs/{job_id}/review")
async def client_review(job_id: str, req: ReviewReq, user: dict = Depends(get_current_user)):
    j = await _load_job_for_user(job_id, user)
    if j["pro_user_id"] == user["id"]:
        raise HTTPException(status_code=403, detail="Only the client can leave a review.")
    if j["status"] != "completed":
        raise HTTPException(status_code=400, detail="You can review after the job is completed.")
    rating = max(1, min(5, int(req.rating)))
    review = {"rating": rating, "text": req.text.strip()[:600], "at": now_iso()}
    await db.pro_jobs.update_one({"id": job_id}, {"$set": {"review": review, "updated_at": now_iso()}})
    # recompute pro rating
    prof = await db.pro_profiles.find_one({"user_id": j["pro_user_id"]}, {"_id": 0})
    if prof:
        cur = prof.get("reviews_count", 0)
        avg = prof.get("rating", 0.0)
        new_count = cur + 1
        new_avg = (avg * cur + rating) / new_count
        await db.pro_profiles.update_one({"user_id": j["pro_user_id"]}, {"$set": {"rating": new_avg, "reviews_count": new_count}})
    return {"ok": True}


@api_router.post("/client/invoices/{invoice_id}/pay")
async def pay_invoice(invoice_id: str, req: OriginReq, user: dict = Depends(get_current_user)):
    inv = await db.pro_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    if inv.get("client_user_id") not in (user["id"], None) and inv.get("client_email") != user.get("email", "").lower():
        raise HTTPException(status_code=403, detail="Not your invoice.")
    if inv["status"] == "paid":
        raise HTTPException(status_code=400, detail="Already paid.")
    prof = await db.pro_profiles.find_one({"user_id": inv["pro_user_id"]}, {"_id": 0})
    acct_id = (prof or {}).get("stripe_account_id")
    if not STRIPE_SECRET_KEY or "sk_test_emergent" in STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments not configured on this environment.")
    if not acct_id or not prof.get("charges_enabled"):
        raise HTTPException(status_code=400, detail="This pro hasn't finished setting up payouts yet.")
    host = (req.origin_url or "").rstrip("/") or "https://diyhomie.app"
    fee = int(inv["amount_cents"] * PLATFORM_FEE_PCT)
    try:
        session = await asyncio.to_thread(lambda: stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {"currency": "usd", "unit_amount": inv["amount_cents"],
                               "product_data": {"name": f"{inv.get('label','Invoice')} — {prof.get('name','Pro')}"}},
                "quantity": 1,
            }],
            payment_intent_data={"application_fee_amount": fee, "transfer_data": {"destination": acct_id}},
            customer_email=user.get("email"),
            metadata={"pro_invoice_id": inv["id"], "pro_user_id": inv["pro_user_id"]},
            success_url=f"{host}/jobs/{inv['job_id']}?paid=1",
            cancel_url=f"{host}/jobs/{inv['job_id']}",
        ))
    except Exception as e:
        logger.error(f"pro invoice checkout error: {e}")
        raise HTTPException(status_code=502, detail="Could not start payment. Try again.")
    await db.pro_invoices.update_one({"id": inv["id"]}, {"$set": {"stripe_session_id": session.id}})
    return {"checkout_url": session.url}


# ---- admin pro-account vetting
@api_router.get("/admin/pro-accounts")
async def admin_pro_accounts(admin: dict = Depends(require_admin)):
    rows = await db.pro_profiles.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_pro_profile_public(r) | {"user_id": r["user_id"], "email": r.get("email"), "created_at": r.get("created_at")} for r in rows]


@api_router.post("/admin/pro-accounts/{pro_user_id}/verify")
async def admin_verify_pro(pro_user_id: str, admin: dict = Depends(require_admin)):
    prof = await db.pro_profiles.find_one({"user_id": pro_user_id}, {"_id": 0})
    if not prof:
        raise HTTPException(status_code=404, detail="Pro account not found.")
    await db.pro_profiles.update_one({"user_id": pro_user_id}, {"$set": {"status": "verified", "updated_at": now_iso()}})
    await db.users.update_one({"id": pro_user_id}, {"$set": {"is_pro": True, "pro_id": prof["id"]}})
    # publish/refresh a marketplace directory listing
    await db.pro_partners.update_one(
        {"linked_pro_id": prof["id"]},
        {"$set": {"id": prof.get("directory_id") or new_id(), "linked_pro_id": prof["id"],
                  "name": prof.get("name"), "trades": prof.get("trades", []), "specialties": prof.get("specialties", []),
                  "location": prof.get("location", ""), "bio": prof.get("bio", ""), "phone": prof.get("phone", ""),
                  "email": prof.get("email", ""), "website": prof.get("website", ""), "logo": None,
                  "rating": prof.get("rating", 0), "reviews_count": prof.get("reviews_count", 0),
                  "verified": True, "active": True, "payout_cents": 0, "leads_count": 0}},
        upsert=True,
    )
    await emit_event("pro_verified", pro_user_id, {})
    return {"ok": True}


@api_router.post("/admin/pro-accounts/{pro_user_id}/ban")
async def admin_ban_pro(pro_user_id: str, admin: dict = Depends(require_admin)):
    prof = await db.pro_profiles.find_one({"user_id": pro_user_id}, {"_id": 0})
    if not prof:
        raise HTTPException(status_code=404, detail="Pro account not found.")
    await db.pro_profiles.update_one({"user_id": pro_user_id}, {"$set": {"status": "banned", "updated_at": now_iso()}})
    await db.users.update_one({"id": pro_user_id}, {"$set": {"is_pro": False}})
    await db.pro_partners.update_one({"linked_pro_id": prof["id"]}, {"$set": {"active": False, "verified": False}})
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
    {"key": "notify", "label": "Send in-app notification", "param": "message", "param_type": "text"},
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
        if t == "notify":
            msg = str(action.get("message") or "You have an update from DIYhomie.").strip()
            await push_notification(user["id"], title="DIYhomie", body=msg, ntype="system", priority="normal")
            return {"type": t, "ok": True, "detail": "notification sent"}
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


# ================================================================ Real Estate / Listing Mode (Sheet #34)
DISCLOSURE_RULES = {
    "electrical": "Electrical work performed — disclose scope & any permits pulled.",
    "plumbing": "Plumbing work performed — disclose repairs/replacements & leaks history.",
    "roof": "Roofing work — disclose age, repairs & any warranty transfer.",
    "hvac": "HVAC system serviced/replaced — provide install date & warranty.",
    "structural": "Structural / framing work — disclose permits & engineer sign-off if any.",
    "foundation": "Foundation work — disclose repairs & transferable warranty.",
    "window": "Window/door replacements — note energy ratings & warranty.",
    "water": "Water intrusion / waterproofing addressed — disclose prior moisture issues.",
}


def _diy_pro_label(e: dict) -> str:
    return "Pro" if (e.get("pro_job_id") or e.get("source") == "pro") else "DIY"


def _improvement_confidence(e: dict) -> str:
    has_photo = bool(e.get("after_photo") or e.get("before_photo"))
    has_cost = bool(e.get("cost_cents"))
    if has_photo and has_cost:
        return "documented"
    if has_photo or has_cost:
        return "partial"
    return "self-reported"


def _disclosure_checklist(projects: list, systems: list) -> list:
    text = " ".join([(p.get("title") or "") + " " + (p.get("skill_tag") or "") for p in projects]).lower()
    text += " " + " ".join([(s.get("type") or "") + " " + (s.get("name") or "") for s in systems]).lower()
    out = []
    for key, msg in DISCLOSURE_RULES.items():
        if key in text:
            out.append({"key": key, "requirement": msg})
    return out


async def _realestate_ai_summary(data: dict) -> dict:
    projects = data.get("projects", [])
    if not projects:
        return {"summary": "No logged improvements yet — complete projects to build a resale-ready record.", "estimate_cents": 0, "roi_pct": 0}
    lines = []
    for p in projects[:25]:
        yr = (p.get("created_at") or "")[:4]
        lines.append(f"- {p.get('story_title') or p.get('title')} ({yr}) · ${int((p.get('cost_cents') or 0)/100)} materials · {p.get('room') or 'home'}")
    invested = data["totals"]["invested_cents"]
    system = ("You are a real-estate value analyst for home improvements. Given a homeowner's logged projects, "
              "write a concise buyer-facing 'What's been improved?' summary (2-3 sentences) and estimate the net "
              "market value added. Be conservative and always frame estimates as approximate. Return JSON: "
              "{'summary': str, 'estimate_cents': int (estimated resale value added in US cents), 'roi_pct': int (percent return vs materials invested)}.")
    user_text = f"Materials invested total: ${invested/100:.0f}\nProjects:\n" + "\n".join(lines)
    data_out = await _llm_json(system, user_text, max_tokens=500)
    est = int(data_out.get("estimate_cents") or 0)
    if est <= 0:  # heuristic fallback
        est = int(invested * 1.6)
    roi = int(data_out.get("roi_pct") or (round(100 * (est - invested) / invested) if invested else 0))
    return {"summary": data_out.get("summary") or "Multiple documented improvements increase this home's appeal and value.",
            "estimate_cents": est, "roi_pct": roi}


async def _realestate_report(user: dict) -> dict:
    data = await _portfolio_data(user)
    timeline = await db.timeline.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    improvements = []
    for e in timeline:
        improvements.append({
            "title": e.get("story_title") or e.get("title"),
            "room": e.get("room"), "skill_tag": e.get("skill_tag"),
            "cost_cents": e.get("cost_cents") or 0, "created_at": e.get("created_at"),
            "label": _diy_pro_label(e), "confidence": _improvement_confidence(e),
            "after_photo": e.get("after_photo"),
        })
    # cache AI summary keyed by project count to avoid recompute cost
    cache = user.get("realestate_ai") or {}
    if cache.get("count") == len(timeline) and cache.get("summary"):
        ai = {"summary": cache["summary"], "estimate_cents": cache.get("estimate_cents", 0), "roi_pct": cache.get("roi_pct", 0)}
    else:
        ai = await _realestate_ai_summary(data)
        await db.users.update_one({"id": user["id"]}, {"$set": {"realestate_ai": {**ai, "count": len(timeline)}}})
    return {
        **data,
        "improvements": improvements,
        "diy_count": sum(1 for i in improvements if i["label"] == "DIY"),
        "pro_count": sum(1 for i in improvements if i["label"] == "Pro"),
        "ai_summary": ai["summary"],
        "value_add": {"estimate_cents": ai["estimate_cents"], "roi_pct": ai["roi_pct"],
                      "disclaimer": "Estimated value-add is an AI approximation, not an appraisal. Consult a licensed appraiser/agent."},
        "disclosure_checklist": _disclosure_checklist(data["projects"], data["systems"]),
    }


@api_router.get("/realestate/report")
async def realestate_report(user: dict = Depends(get_current_user)):
    report = await _realestate_report(user)
    report["share_token"] = user.get("portfolio_token")
    report["is_public"] = bool(user.get("portfolio_public"))
    return report


@api_router.post("/realestate/share")
async def realestate_share(req: ShareReq, user: dict = Depends(get_current_user)):
    token = user.get("portfolio_token") or secrets.token_urlsafe(9)
    await db.users.update_one({"id": user["id"]}, {"$set": {"portfolio_token": token, "portfolio_public": req.public}})
    return {"share_token": token, "is_public": req.public}


@api_router.get("/realestate/public/{token}")
async def realestate_public(token: str):
    u = await db.users.find_one({"portfolio_token": token, "portfolio_public": True}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="This home report is private or does not exist.")
    return await _realestate_report(u)


# ================================================================ Sustainability & Circular Economy (Sheet #35)
# category -> (waste lbs diverted, CO2 kg avoided) per typical listing — conservative estimates
ECO_FACTORS = {
    "Lumber & Wood": (40, 30), "Flooring & Tile": (55, 45), "Paint & Finishes": (12, 18),
    "Doors & Windows": (70, 60), "Fixtures & Lighting": (15, 20), "Appliances": (120, 90),
    "Hardware & Fasteners": (5, 4), "Drywall & Insulation": (35, 28), "Plumbing": (18, 15),
    "Electrical": (10, 12), "Landscaping & Masonry": (60, 25), "Other": (20, 15),
}
ECO_CATEGORIES = list(ECO_FACTORS.keys())
CONDITIONS = ["New / unopened", "Like new", "Good", "Fair — usable"]
FULFILLMENTS = ["Local pickup", "Can deliver", "In exchange for help"]

# Curated green-product catalog with certifications for the Eco Finder
GREEN_CERTS = ["ENERGY STAR", "GREENGUARD Gold", "Low-VOC", "FSC Certified", "WaterSense", "Recycled Content"]
GREEN_CATALOG = [
    {"name": "Low-VOC Interior Paint", "match": ["paint", "primer", "wall", "finish"], "category": "Paint & Finishes", "certs": ["Low-VOC", "GREENGUARD Gold"], "blurb": "Near-zero fumes, safer indoor air."},
    {"name": "FSC-Certified Framing Lumber", "match": ["lumber", "2x4", "stud", "board", "wood", "framing"], "category": "Lumber & Wood", "certs": ["FSC Certified"], "blurb": "Responsibly sourced wood."},
    {"name": "Reclaimed Hardwood Flooring", "match": ["floor", "hardwood", "plank", "tile"], "category": "Flooring & Tile", "certs": ["Recycled Content", "FSC Certified"], "blurb": "Salvaged character wood — diverts waste."},
    {"name": "ENERGY STAR LED Fixtures", "match": ["light", "bulb", "fixture", "lamp", "led"], "category": "Fixtures & Lighting", "certs": ["ENERGY STAR"], "blurb": "Up to 90% less energy than incandescent."},
    {"name": "WaterSense Low-Flow Faucet", "match": ["faucet", "sink", "plumb", "tap", "shower"], "category": "Plumbing", "certs": ["WaterSense"], "blurb": "Cuts water use ~20% with no pressure loss."},
    {"name": "Recycled-Content Insulation", "match": ["insulation", "drywall", "attic", "wall"], "category": "Drywall & Insulation", "certs": ["Recycled Content", "GREENGUARD Gold"], "blurb": "Made from recycled fiber, great R-value."},
    {"name": "ENERGY STAR Appliance", "match": ["appliance", "fridge", "washer", "dryer", "dishwasher", "hvac"], "category": "Appliances", "certs": ["ENERGY STAR"], "blurb": "Lower utility bills, qualifies for rebates."},
    {"name": "Reclaimed Doors & Windows", "match": ["door", "window"], "category": "Doors & Windows", "certs": ["Recycled Content"], "blurb": "Salvage-yard finds, unique & affordable."},
]

RESTORE_DIRECTORY = [
    {"name": "Habitat for Humanity ReStore", "type": "Donation resale", "note": "Building materials & appliances — proceeds fund local housing."},
    {"name": "Local C&D Recycling Center", "type": "Recycling", "note": "Construction & demolition debris drop-off."},
    {"name": "Freecycle / Buy Nothing Group", "type": "Community give", "note": "Free local reuse network."},
]


def _eco_for(category: str) -> dict:
    w, c = ECO_FACTORS.get(category, ECO_FACTORS["Other"])
    return {"waste_lbs": w, "co2_kg": c}


def _listing_public(l: dict, owner: bool = False) -> dict:
    out = {
        "id": l["id"], "type": l["type"], "category": l["category"], "title": l["title"],
        "description": l.get("description", ""), "condition": l.get("condition"),
        "price_cents": l.get("price_cents", 0), "is_donation": l.get("price_cents", 0) == 0,
        "fulfillment": l.get("fulfillment"), "region": _neighborhood_tag(l.get("neighborhood_key", "")),
        "image_base64": l.get("image_base64"), "status": l.get("status", "active"),
        "owner_name": _anon_name(l.get("owner_name")), "eco": l.get("eco", {}),
        "claims": len(l.get("claim_ids", [])), "created_at": l.get("created_at"), "is_owner": owner,
    }
    return out


class ListingReq(BaseModel):
    type: str = "offer"          # offer | request
    category: str = "Other"
    title: str
    description: str = ""
    condition: Optional[str] = None
    price_cents: int = 0          # 0 = free / donation
    fulfillment: str = "Local pickup"
    image_base64: Optional[str] = None


@api_router.get("/circular/meta")
async def circular_meta(user: dict = Depends(get_current_user)):
    return {"categories": ECO_CATEGORIES, "conditions": CONDITIONS, "fulfillments": FULFILLMENTS,
            "certs": GREEN_CERTS, "restore_directory": RESTORE_DIRECTORY}


@api_router.get("/circular/listings")
async def circular_listings(type: Optional[str] = None, category: Optional[str] = None,
                            user: dict = Depends(get_current_user)):
    q: dict = {"status": "active"}
    if type in ("offer", "request"):
        q["type"] = type
    if category:
        q["category"] = category
    rows = await db.material_listings.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"listings": [_listing_public(l, owner=l["user_id"] == user["id"]) for l in rows]}


@api_router.get("/circular/mine")
async def circular_mine(user: dict = Depends(get_current_user)):
    rows = await db.material_listings.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"listings": [_listing_public(l, owner=True) for l in rows]}


@api_router.post("/circular/listings")
async def create_listing(req: ListingReq, user: dict = Depends(get_current_user)):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title is required.")
    doc = {
        "id": new_id(), "user_id": user["id"], "owner_name": user.get("name") or user["email"].split("@")[0],
        "type": req.type if req.type in ("offer", "request") else "offer",
        "category": req.category if req.category in ECO_CATEGORIES else "Other",
        "title": req.title.strip()[:120], "description": req.description.strip()[:1000],
        "condition": req.condition, "price_cents": max(0, req.price_cents),
        "fulfillment": req.fulfillment, "image_base64": (req.image_base64 or None),
        "neighborhood_key": _neighborhood_key(user.get("location", "")),
        "eco": _eco_for(req.category), "status": "active", "claim_ids": [], "created_at": now_iso(),
    }
    await db.material_listings.insert_one(dict(doc))
    return _listing_public(doc, owner=True)


@api_router.post("/circular/listings/{listing_id}/claim")
async def claim_listing(listing_id: str, user: dict = Depends(get_current_user)):
    l = await db.material_listings.find_one({"id": listing_id, "status": "active"}, {"_id": 0})
    if not l:
        raise HTTPException(status_code=404, detail="Listing not found or closed.")
    if l["user_id"] == user["id"]:
        raise HTTPException(status_code=400, detail="You can't claim your own listing.")
    if user["id"] in l.get("claim_ids", []):
        return {"ok": True, "already": True}
    await db.material_listings.update_one({"id": listing_id}, {"$addToSet": {"claim_ids": user["id"]}})
    verb = "wants" if l["type"] == "offer" else "can help with"
    await push_notification(l["user_id"], title="Someone's interested 🤝",
                            body=f"A neighbor {verb} “{l['title']}”. Open Materials Exchange to connect.",
                            ntype="social", meta={"listing_id": listing_id})
    return {"ok": True, "contact": "Owner notified — they'll connect once they accept. Contact stays private until both agree."}


@api_router.post("/circular/listings/{listing_id}/close")
async def close_listing(listing_id: str, user: dict = Depends(get_current_user)):
    l = await db.material_listings.find_one({"id": listing_id, "user_id": user["id"]}, {"_id": 0})
    if not l:
        raise HTTPException(status_code=404, detail="Listing not found.")
    await db.material_listings.update_one({"id": listing_id}, {"$set": {"status": "completed", "completed_at": now_iso()}})
    # award eco impact + loyalty for a completed give/exchange (offers only)
    if l["type"] == "offer":
        await award_loyalty_credits(user["id"], 15, f"circular_give:{listing_id}", {"title": l["title"]})
    return {"ok": True}


@api_router.get("/circular/impact")
async def circular_impact(user: dict = Depends(get_current_user)):
    completed = await db.material_listings.find(
        {"user_id": user["id"], "type": "offer", "status": "completed"}, {"_id": 0}).to_list(500)
    waste = sum(l.get("eco", {}).get("waste_lbs", 0) for l in completed)
    co2 = sum(l.get("eco", {}).get("co2_kg", 0) for l in completed)
    donations = [l for l in completed if l.get("price_cents", 0) == 0]
    # simple tax write-off estimate: donated items ~ $25 avg fair value each (IRS thrift-value style, disclaimer)
    writeoff_cents = len(donations) * 2500
    active = await db.material_listings.count_documents({"user_id": user["id"], "status": "active"})

    # regional leaderboard of top givers
    key = _neighborhood_key(user.get("location", ""))
    board = []
    if key:
        agg = await db.material_listings.aggregate([
            {"$match": {"neighborhood_key": key, "type": "offer", "status": "completed"}},
            {"$group": {"_id": "$user_id", "name": {"$first": "$owner_name"},
                        "gives": {"$sum": 1}, "waste": {"$sum": "$eco.waste_lbs"}}},
            {"$sort": {"gives": -1}}, {"$limit": 20},
        ]).to_list(20)
        for i, a in enumerate(agg):
            board.append({"rank": i + 1, "name": (user.get("name") if a["_id"] == user["id"] else _anon_name(a.get("name"))),
                          "is_me": a["_id"] == user["id"], "gives": a["gives"], "waste_lbs": a["waste"]})
    return {
        "totals": {"gives": len(completed), "waste_lbs": waste, "co2_kg": co2,
                   "writeoff_cents": writeoff_cents, "active_listings": active},
        "writeoff_note": "Estimated donation fair-value for informational purposes only — keep receipts and consult a tax advisor.",
        "region": _neighborhood_tag(user.get("location", "")) if key else None,
        "leaderboard": board, "restore_directory": RESTORE_DIRECTORY,
    }


@api_router.get("/circular/eco-alternatives")
async def eco_alternatives(query: str = "", user: dict = Depends(get_current_user)):
    q = (query or "").lower()
    matches = []
    for item in GREEN_CATALOG:
        score = sum(1 for m in item["match"] if m in q) if q else 0
        if score > 0 or not q:
            matches.append({**{k: v for k, v in item.items() if k != "match"}, "_score": score})
    matches.sort(key=lambda x: x["_score"], reverse=True)
    for m in matches:
        m.pop("_score", None)
    return {"query": query, "alternatives": matches[:8] if q else matches}


# ================================================================ Neighborhood Bulk Buying (Sheet #36)
BULK_CATEGORIES = ["Lumber & Wood", "Mulch & Soil", "Fencing", "Concrete & Masonry", "Roofing",
                   "Paint & Stain", "Flooring & Tile", "Gravel & Aggregate", "Tools & Equipment", "Other"]
# discount tiers by number of committed participants
BULK_TIERS = [{"min": 2, "pct": 5}, {"min": 4, "pct": 15}, {"min": 6, "pct": 25}]


def _bulk_tier(participants: int) -> dict:
    current = {"min": 1, "pct": 0}
    nxt = None
    for i, t in enumerate(BULK_TIERS):
        if participants >= t["min"]:
            current = t
            nxt = BULK_TIERS[i + 1] if i + 1 < len(BULK_TIERS) else None
        elif nxt is None:
            nxt = t
            break
    return {"pct": current["pct"], "next": nxt}


def _bulk_public(d: dict, uid: str) -> dict:
    parts = d.get("participants", [])
    n = len(parts)
    tier = _bulk_tier(n)
    mine = next((p for p in parts if p["user_id"] == uid), None)
    unit_cents = int(d["price_full_cents"] * (100 - tier["pct"]) / 100)
    return {
        "id": d["id"], "title": d["title"], "category": d["category"], "item": d.get("item", ""),
        "unit": d.get("unit", "unit"), "price_full_cents": d["price_full_cents"],
        "unit_price_cents": unit_cents, "discount_pct": tier["pct"], "next_tier": tier["next"],
        "participants": n, "target": d.get("target", BULK_TIERS[-1]["min"]),
        "total_qty": sum(p.get("qty", 1) for p in parts),
        "region": _neighborhood_tag(d.get("neighborhood_key", "")), "ends_at": d.get("ends_at"),
        "status": d.get("status", "open"), "creator_name": _anon_name(d.get("creator_name")),
        "is_creator": d["creator_id"] == uid, "my_qty": mine.get("qty") if mine else 0, "joined": bool(mine),
        "created_at": d.get("created_at"),
    }


class BulkReq(BaseModel):
    title: str
    category: str = "Other"
    item: str = ""
    unit: str = "unit"
    price_full_cents: int
    window_days: int = 30


@api_router.get("/bulk/meta")
async def bulk_meta(user: dict = Depends(get_current_user)):
    return {"categories": BULK_CATEGORIES, "tiers": BULK_TIERS}


@api_router.get("/bulk/deals")
async def bulk_deals(user: dict = Depends(get_current_user)):
    now = now_iso()
    # auto-expire
    await db.bulk_deals.update_many({"status": "open", "ends_at": {"$lt": now}}, {"$set": {"status": "locked"}})
    key = _neighborhood_key(user.get("location", ""))
    rows = await db.bulk_deals.find({"status": {"$in": ["open", "locked"]}}, {"_id": 0}).sort("created_at", -1).to_list(200)
    rows = [d for d in rows if (not d.get("neighborhood_key")) or d.get("neighborhood_key") == key or d["creator_id"] == user["id"]]
    return {"deals": [_bulk_public(d, user["id"]) for d in rows]}


@api_router.post("/bulk/deals")
async def create_bulk_deal(req: BulkReq, user: dict = Depends(get_current_user)):
    if not req.title.strip() or req.price_full_cents <= 0:
        raise HTTPException(status_code=400, detail="Title and a valid unit price are required.")
    ends = (datetime.now(timezone.utc) + timedelta(days=max(1, min(90, req.window_days)))).isoformat()
    doc = {
        "id": new_id(), "creator_id": user["id"], "creator_name": user.get("name") or user["email"].split("@")[0],
        "title": req.title.strip()[:120], "category": req.category if req.category in BULK_CATEGORIES else "Other",
        "item": req.item.strip()[:300], "unit": req.unit.strip()[:20] or "unit",
        "price_full_cents": req.price_full_cents, "target": BULK_TIERS[-1]["min"],
        "neighborhood_key": _neighborhood_key(user.get("location", "")),
        "participants": [{"user_id": user["id"], "name": doc_name(user), "qty": 1}],
        "status": "open", "ends_at": ends, "created_at": now_iso(),
    }
    await db.bulk_deals.insert_one(dict(doc))
    return _bulk_public(doc, user["id"])


def doc_name(user: dict) -> str:
    return user.get("name") or user["email"].split("@")[0]


class JoinBulkReq(BaseModel):
    qty: int = 1


@api_router.post("/bulk/deals/{deal_id}/join")
async def join_bulk_deal(deal_id: str, req: JoinBulkReq, user: dict = Depends(get_current_user)):
    d = await db.bulk_deals.find_one({"id": deal_id, "status": "open"}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found or no longer open.")
    parts = [p for p in d.get("participants", []) if p["user_id"] != user["id"]]
    parts.append({"user_id": user["id"], "name": doc_name(user), "qty": max(1, req.qty)})
    await db.bulk_deals.update_one({"id": deal_id}, {"$set": {"participants": parts}})
    if d["creator_id"] != user["id"]:
        await push_notification(d["creator_id"], title="New neighbor joined your bulk buy 🛒",
                                body=f"“{d['title']}” now has {len(parts)} participants — bigger discount unlocking!",
                                ntype="social", meta={"deal_id": deal_id})
    d["participants"] = parts
    return _bulk_public(d, user["id"])


@api_router.post("/bulk/deals/{deal_id}/leave")
async def leave_bulk_deal(deal_id: str, user: dict = Depends(get_current_user)):
    d = await db.bulk_deals.find_one({"id": deal_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found.")
    parts = [p for p in d.get("participants", []) if p["user_id"] != user["id"]]
    await db.bulk_deals.update_one({"id": deal_id}, {"$set": {"participants": parts}})
    return {"ok": True}


@api_router.post("/bulk/deals/{deal_id}/close")
async def close_bulk_deal(deal_id: str, user: dict = Depends(get_current_user)):
    d = await db.bulk_deals.find_one({"id": deal_id, "creator_id": user["id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found or you're not the organizer.")
    await db.bulk_deals.update_one({"id": deal_id}, {"$set": {"status": "fulfilled", "fulfilled_at": now_iso()}})
    tier = _bulk_tier(len(d.get("participants", [])))
    for p in d.get("participants", []):
        await push_notification(p["user_id"], title="Bulk buy confirmed ✅",
                                body=f"“{d['title']}” locked in at {tier['pct']}% off. The organizer will coordinate pickup/delivery.",
                                ntype="system", meta={"deal_id": deal_id})
    await award_loyalty_credits(user["id"], 20, f"bulk_organized:{deal_id}", {"title": d["title"]})
    return {"ok": True, "discount_pct": tier["pct"]}


# ================================================================ AR & Avatar Personalization (Sheet #38)
PREF_OPTIONS = {
    "avatar_gender": ["Neutral", "Woman", "Man"],
    "avatar_look": ["Friendly", "Seasoned Pro", "Designer", "Coach"],
    "avatar_gear": ["Tool belt", "Hard hat", "Safety vest", "Casual"],
    "avatar_skin": ["#F2D3B3", "#E5B98D", "#C68642", "#8D5524", "#5C3A21"],
    "voice": ["Calm", "Enthusiastic", "Contractor", "Pro Explainer"],
    "verbosity": ["Minimal", "Balanced", "Detailed"],
    "overlay_palette": ["High Contrast", "Warm", "Cool", "Colorblind-safe"],
    "highlight_style": ["Arrow", "Circle", "Zone glow", "Pointer"],
    "text_size": ["Small", "Medium", "Large", "Extra Large"],
    "cue_speed": ["Slow", "Normal", "Fast"],
    "theme": ["Dark", "Light", "Toolbox", "Blueprint"],
    "notification_sound": ["Subtle", "Energetic", "Silent"],
}

DEFAULT_PREFS = {
    "avatar_gender": "Neutral", "avatar_look": "Friendly", "avatar_gear": "Tool belt", "avatar_skin": "#E5B98D",
    "voice": "Calm", "verbosity": "Balanced", "jit_coaching": True,
    "overlay_palette": "High Contrast", "highlight_style": "Arrow", "text_size": "Medium", "cue_speed": "Normal",
    "theme": "Dark", "notification_sound": "Subtle", "preset": None,
}

PREF_PRESETS = {
    "trusted_foreman": {"label": "Trusted Foreman", "icon": "account-hard-hat",
        "prefs": {"avatar_look": "Seasoned Pro", "avatar_gear": "Hard hat", "voice": "Contractor", "verbosity": "Balanced", "theme": "Toolbox", "highlight_style": "Zone glow"}},
    "diy_hero": {"label": "My DIY Hero", "icon": "star-face",
        "prefs": {"avatar_look": "Friendly", "avatar_gear": "Casual", "voice": "Enthusiastic", "verbosity": "Detailed", "theme": "Dark", "notification_sound": "Energetic"}},
    "safety_first": {"label": "Safety-First Mode", "icon": "shield-check",
        "prefs": {"avatar_gear": "Safety vest", "voice": "Pro Explainer", "verbosity": "Detailed", "overlay_palette": "High Contrast", "highlight_style": "Circle", "text_size": "Large", "cue_speed": "Slow", "jit_coaching": True}},
    "silent": {"label": "Silent Mode", "icon": "volume-off",
        "prefs": {"voice": "Calm", "verbosity": "Minimal", "jit_coaching": False, "notification_sound": "Silent", "cue_speed": "Fast"}},
}


def _merged_prefs(user: dict) -> dict:
    return {**DEFAULT_PREFS, **(user.get("preferences") or {})}


@api_router.get("/preferences")
async def get_preferences(user: dict = Depends(get_current_user)):
    return {
        "preferences": _merged_prefs(user),
        "options": PREF_OPTIONS,
        "presets": [{"id": k, "label": v["label"], "icon": v["icon"]} for k, v in PREF_PRESETS.items()],
    }


@api_router.put("/preferences")
async def update_preferences(payload: dict, user: dict = Depends(get_current_user)):
    prefs = _merged_prefs(user)
    for k, v in payload.items():
        if k == "jit_coaching":
            prefs[k] = bool(v)
        elif k in PREF_OPTIONS and v in PREF_OPTIONS[k]:
            prefs[k] = v
            prefs["preset"] = None  # manual edits clear preset
    await db.users.update_one({"id": user["id"]}, {"$set": {"preferences": prefs}})
    return {"preferences": prefs}


@api_router.post("/preferences/preset/{preset_id}")
async def apply_preset(preset_id: str, user: dict = Depends(get_current_user)):
    preset = PREF_PRESETS.get(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found.")
    prefs = {**_merged_prefs(user), **preset["prefs"], "preset": preset_id}
    await db.users.update_one({"id": user["id"]}, {"$set": {"preferences": prefs}})
    return {"preferences": prefs}


@api_router.post("/preferences/reset")
async def reset_preferences(user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"preferences": dict(DEFAULT_PREFS)}})
    return {"preferences": dict(DEFAULT_PREFS)}


# ================================================================ Contractor Licensing & Credential Checker (Sheet #40)
CREDENTIAL_TYPES = ["Contractor License", "Trade License", "Liability Insurance",
                    "Workers' Comp", "Certification", "Surety Bond"]
CRED_EXPIRING_DAYS = 30


def _cred_status(c: dict) -> str:
    exp = c.get("expires_at")
    if exp:
        try:
            d = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            if d < now:
                return "expired"
            if (d - now).days <= CRED_EXPIRING_DAYS and c.get("status") == "verified":
                return "expiring"
        except Exception:
            pass
    return c.get("status", "pending")


def _cred_public(c: dict) -> dict:
    return {
        "id": c["id"], "type": c.get("type"), "number": c.get("number", ""),
        "issuer": c.get("issuer", ""), "specialty": c.get("specialty", ""),
        "expires_at": c.get("expires_at"), "status": _cred_status(c),
        "has_doc": bool(c.get("doc_base64")), "verified_at": c.get("verified_at"),
        "note": c.get("note", ""), "created_at": c.get("created_at"),
    }


async def _pro_compliance(pro_user_id: str) -> dict:
    creds = await db.pro_credentials.find({"pro_user_id": pro_user_id}, {"_id": 0}).to_list(50)
    statuses = [_cred_status(c) for c in creds]
    verified = [c for c, s in zip(creds, statuses) if s in ("verified", "expiring")]
    licensed = any("License" in (c.get("type") or "") for c in verified)
    insured = any("Insurance" in (c.get("type") or "") for c in verified)
    if "expired" in statuses:
        overall = "action_required"
    elif "expiring" in statuses:
        overall = "expiring_soon"
    elif verified:
        overall = "compliant"
    elif creds:
        overall = "under_review"
    else:
        overall = "not_submitted"
    return {"overall": overall, "licensed": licensed, "insured": insured,
            "verified_count": len(verified), "total": len(creds)}


class CredentialReq(BaseModel):
    type: str
    number: str = ""
    issuer: str = ""
    specialty: str = ""
    expires_at: Optional[str] = None
    doc_base64: Optional[str] = None


@api_router.get("/pro/credentials")
async def list_credentials(user: dict = Depends(get_current_user)):
    prof = await db.pro_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not prof:
        raise HTTPException(status_code=403, detail="Apply as a pro to manage credentials.")
    creds = await db.pro_credentials.find({"pro_user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"credentials": [_cred_public(c) for c in creds],
            "compliance": await _pro_compliance(user["id"]),
            "types": CREDENTIAL_TYPES}


@api_router.post("/pro/credentials")
async def add_credential(req: CredentialReq, user: dict = Depends(get_current_user)):
    prof = await db.pro_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not prof:
        raise HTTPException(status_code=403, detail="Apply as a pro before submitting credentials.")
    if req.type not in CREDENTIAL_TYPES:
        raise HTTPException(status_code=400, detail="Invalid credential type.")
    doc = {
        "id": new_id(), "pro_user_id": user["id"], "pro_name": prof.get("name") or user.get("name"),
        "pro_email": user.get("email"), "type": req.type, "number": req.number.strip()[:60],
        "issuer": req.issuer.strip()[:100], "specialty": req.specialty.strip()[:80],
        "expires_at": req.expires_at, "doc_base64": req.doc_base64, "status": "pending",
        "created_at": now_iso(),
    }
    await db.pro_credentials.insert_one(dict(doc))
    return {"ok": True, "credential": _cred_public(doc)}


@api_router.delete("/pro/credentials/{cred_id}")
async def delete_credential(cred_id: str, user: dict = Depends(get_current_user)):
    await db.pro_credentials.delete_one({"id": cred_id, "pro_user_id": user["id"]})
    return {"ok": True}


@api_router.get("/admin/credentials")
async def admin_credentials(status: Optional[str] = None, admin: dict = Depends(require_admin)):
    creds = await db.pro_credentials.find({}, {"_id": 0, "doc_base64": 0}).sort("created_at", -1).to_list(500)
    out = []
    for c in creds:
        pub = _cred_public(c)
        pub["pro_name"] = c.get("pro_name")
        pub["pro_email"] = c.get("pro_email")
        pub["pro_user_id"] = c.get("pro_user_id")
        if not status or pub["status"] == status:
            out.append(pub)
    counts = {"pending": 0, "expiring": 0, "expired": 0, "verified": 0}
    for c in creds:
        s = _cred_status(c)
        counts[s] = counts.get(s, 0) + 1
    return {"credentials": out, "counts": counts}


class CredDecisionReq(BaseModel):
    status: str          # verified | rejected
    note: str = ""


@api_router.patch("/admin/credentials/{cred_id}")
async def admin_decide_credential(cred_id: str, req: CredDecisionReq, admin: dict = Depends(require_admin)):
    if req.status not in ("verified", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'verified' or 'rejected'.")
    c = await db.pro_credentials.find_one({"id": cred_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Credential not found.")
    upd = {"status": req.status, "note": req.note[:300], "verified_at": now_iso() if req.status == "verified" else None}
    await db.pro_credentials.update_one({"id": cred_id}, {"$set": upd})
    title = "Credential verified ✅" if req.status == "verified" else "Credential needs attention"
    body = (f"Your {c.get('type')} was verified — your Verified Pro badge is active."
            if req.status == "verified" else
            f"Your {c.get('type')} couldn't be verified. {req.note or 'Please re-submit valid documentation.'}")
    await push_notification(c["pro_user_id"], title=title, body=body, ntype="system", meta={"credential_id": cred_id})
    return {"ok": True, "compliance": await _pro_compliance(c["pro_user_id"])}



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


# ---------------------------------------------------------------- Neighborhood Network & Peer Exchange (Sheet #26)
NEIGHBOR_KINDS = {"help", "qa", "spotlight"}


class NeighborJoinReq(BaseModel):
    optin: bool = True


class NeighborPostReq(BaseModel):
    kind: str  # help | qa | spotlight
    title: str
    body: str = ""
    image_base64: Optional[str] = None


class NeighborOfferReq(BaseModel):
    body: str = ""


class NeighborFlagReq(BaseModel):
    reason: str = ""


def _first_name(u: dict) -> str:
    return (u.get("name") or u.get("email", "").split("@")[0] or "Neighbor").split(" ")[0]


async def _trusted_score(uid: str) -> int:
    """Verified contributions used for the Trusted Neighbor badge."""
    shared = await db.timeline.count_documents({"user_id": uid, "shared": True})
    resolved_helps = await db.neighborhood_posts.count_documents(
        {"resolved": True, "offers.user_id": uid, "removed": {"$ne": True}}
    )
    return int(shared) + int(resolved_helps)


def _sanitize_post(p: dict, viewer_id: str, author_map: dict) -> dict:
    """Strip internal fields and only reveal contact when mutually opted-in."""
    author_email = author_map.get(p["user_id"], "")
    offers_out = []
    for o in p.get("offers", []):
        shared = bool(o.get("contact_shared"))
        can_see = viewer_id in (p["user_id"], o["user_id"])
        offers_out.append({
            "id": o["id"], "author": o["author"], "body": o.get("body", ""),
            "created_at": o["created_at"], "contact_shared": shared,
            # contact revealed only to the two parties AND only after author approval
            "author_email": (author_email if shared and can_see else None),
            "offerer_email": (author_map.get(o["user_id"]) if shared and can_see else None),
            "is_mine": o["user_id"] == viewer_id,
        })
    return {
        "id": p["id"], "kind": p["kind"], "title": p["title"], "body": p.get("body", ""),
        "image_base64": p.get("image_base64"),
        "author": p.get("author"), "is_mine": p["user_id"] == viewer_id,
        "resolved": bool(p.get("resolved")), "promoted_global": bool(p.get("promoted_global")),
        "offer_count": len(p.get("offers", [])), "offers": offers_out,
        "flagged": any(f.get("user_id") == viewer_id for f in p.get("flags", [])),
        "created_at": p["created_at"],
    }


@api_router.post("/neighborhood/join")
async def neighborhood_join(req: NeighborJoinReq, user: dict = Depends(get_current_user)):
    key = _neighborhood_key(user.get("location", ""))
    if req.optin and not key:
        raise HTTPException(status_code=400, detail="Add your city or ZIP in Profile first so we can find your neighborhood.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"neighborhood_optin": req.optin}})
    return {"optin": req.optin, "neighborhood_tag": _neighborhood_tag(user.get("location", ""))}


@api_router.get("/neighborhood")
async def neighborhood_overview(user: dict = Depends(get_current_user)):
    key = _neighborhood_key(user.get("location", ""))
    tag = _neighborhood_tag(user.get("location", ""))
    optin = bool(user.get("neighborhood_optin"))
    if not optin or not key:
        return {"optin": optin, "has_location": bool(key), "neighborhood_tag": tag,
                "impact": None, "feed": [], "neighbors": []}

    members = await db.users.find({"neighborhood_optin": True}, {"_id": 0, "id": 1, "name": 1, "email": 1, "location": 1}).to_list(2000)
    members = [m for m in members if _neighborhood_key(m.get("location", "")) == key]
    member_ids = [m["id"] for m in members]

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    homes_month = await db.timeline.count_documents({"user_id": {"$in": member_ids}, "created_at": {"$gte": cutoff}})
    saved_cur = db.timeline.aggregate([
        {"$match": {"user_id": {"$in": member_ids}}},
        {"$group": {"_id": None, "saved": {"$sum": "$money_saved_cents"}, "n": {"$sum": 1}}},
    ])
    saved_row = await saved_cur.to_list(1)
    saved_total = int(saved_row[0]["saved"]) if saved_row else 0
    total_projects = int(saved_row[0]["n"]) if saved_row else 0

    # local project feed — recent completed projects by opted-in neighbors
    feed_rows = await db.timeline.find(
        {"user_id": {"$in": member_ids}}, {"_id": 0}
    ).sort("created_at", -1).to_list(40)
    name_by_id = {m["id"]: _first_name(m) for m in members}
    feed = [{
        "id": r.get("id") or r.get("project_id"),
        "author": name_by_id.get(r["user_id"], "Neighbor"),
        "is_mine": r["user_id"] == user["id"],
        "title": r.get("story_title") or r.get("title"),
        "skill_tag": r.get("skill_tag"),
        "money_saved_cents": r.get("money_saved_cents") or 0,
        "photo": r.get("after_photo") or r.get("before_photo"),
        "created_at": r.get("created_at"),
    } for r in feed_rows][:20]

    # neighbors + trusted badges (top contributors)
    neighbors = []
    for m in members:
        score = await _trusted_score(m["id"])
        neighbors.append({"name": _first_name(m), "trusted": score >= 3, "contributions": score, "is_mine": m["id"] == user["id"]})
    neighbors.sort(key=lambda x: -x["contributions"])

    return {
        "optin": True, "has_location": True, "neighborhood_tag": tag,
        "impact": {
            "members": len(members),
            "homes_month": homes_month,
            "saved_total_cents": saved_total,
            "total_projects": total_projects,
        },
        "feed": feed,
        "neighbors": neighbors[:12],
    }


@api_router.get("/neighborhood/posts")
async def neighborhood_posts(kind: Optional[str] = None, user: dict = Depends(get_current_user)):
    key = _neighborhood_key(user.get("location", ""))
    if not user.get("neighborhood_optin") or not key:
        return []
    q: dict = {"neighborhood_key": key, "removed": {"$ne": True}}
    if kind and kind in NEIGHBOR_KINDS:
        q["kind"] = kind
    rows = await db.neighborhood_posts.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)

    # lazy auto-promotion: unanswered Q&A older than 12h promotes to the global feed
    promo_cut = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
    for r in rows:
        if r["kind"] == "qa" and not r.get("promoted_global") and not r.get("offers") and r["created_at"] < promo_cut:
            await db.neighborhood_posts.update_one({"id": r["id"]}, {"$set": {"promoted_global": True}})
            r["promoted_global"] = True

    author_map = {}
    ids = {r["user_id"] for r in rows} | {o["user_id"] for r in rows for o in r.get("offers", [])}
    async for u in db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "email": 1}):
        author_map[u["id"]] = u.get("email", "")
    return [_sanitize_post(r, user["id"], author_map) for r in rows]


@api_router.post("/neighborhood/posts")
async def neighborhood_create_post(req: NeighborPostReq, user: dict = Depends(get_current_user)):
    key = _neighborhood_key(user.get("location", ""))
    if not user.get("neighborhood_optin") or not key:
        raise HTTPException(status_code=403, detail="Join your neighborhood first.")
    if req.kind not in NEIGHBOR_KINDS:
        raise HTTPException(status_code=400, detail="Invalid post type.")
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Add a short title.")
    post = {
        "id": new_id(), "neighborhood_key": key, "kind": req.kind,
        "user_id": user["id"], "author": _first_name(user),
        "title": req.title.strip()[:140], "body": req.body.strip()[:2000],
        "image_base64": req.image_base64,
        "offers": [], "resolved": False, "flags": [], "removed": False,
        "promoted_global": False, "created_at": now_iso(),
    }
    await db.neighborhood_posts.insert_one(dict(post))
    author_map = {user["id"]: user.get("email", "")}
    return _sanitize_post(post, user["id"], author_map)


@api_router.post("/neighborhood/posts/{post_id}/offer")
async def neighborhood_offer(post_id: str, req: NeighborOfferReq, user: dict = Depends(get_current_user)):
    post = await db.neighborhood_posts.find_one({"id": post_id, "removed": {"$ne": True}}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    if post["user_id"] == user["id"]:
        raise HTTPException(status_code=400, detail="You can't respond to your own post.")
    if any(o["user_id"] == user["id"] for o in post.get("offers", [])):
        raise HTTPException(status_code=400, detail="You already offered to help.")
    offer = {"id": new_id(), "user_id": user["id"], "author": _first_name(user),
             "body": req.body.strip()[:1000], "contact_shared": False, "created_at": now_iso()}
    await db.neighborhood_posts.update_one({"id": post_id}, {"$push": {"offers": offer}})
    await push_notification(post["user_id"], title="A neighbor offered to help 🤝",
                            body=f"{_first_name(user)} responded to “{post['title']}”.",
                            ntype="social", meta={"post_id": post_id})
    return {"ok": True}


@api_router.post("/neighborhood/posts/{post_id}/reveal/{offer_id}")
async def neighborhood_reveal(post_id: str, offer_id: str, user: dict = Depends(get_current_user)):
    """Author explicitly approves sharing contact with a specific helper (mutual reveal)."""
    post = await db.neighborhood_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    if post["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the author can share contact.")
    if not any(o["id"] == offer_id for o in post.get("offers", [])):
        raise HTTPException(status_code=404, detail="Offer not found.")
    await db.neighborhood_posts.update_one(
        {"id": post_id, "offers.id": offer_id}, {"$set": {"offers.$.contact_shared": True}}
    )
    return {"ok": True}


@api_router.post("/neighborhood/posts/{post_id}/resolve")
async def neighborhood_resolve(post_id: str, user: dict = Depends(get_current_user)):
    post = await db.neighborhood_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    if post["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the author can resolve this.")
    await db.neighborhood_posts.update_one({"id": post_id}, {"$set": {"resolved": True}})
    return {"ok": True}


@api_router.post("/neighborhood/posts/{post_id}/flag")
async def neighborhood_flag(post_id: str, req: NeighborFlagReq, user: dict = Depends(get_current_user)):
    post = await db.neighborhood_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    if any(f.get("user_id") == user["id"] for f in post.get("flags", [])):
        return {"ok": True, "already": True}
    flag = {"user_id": user["id"], "reason": req.reason.strip()[:300], "created_at": now_iso()}
    await db.neighborhood_posts.update_one({"id": post_id}, {"$push": {"flags": flag}})
    return {"ok": True}


# ---- admin moderation
@api_router.get("/admin/neighborhood/flags")
async def admin_neighborhood_flags(admin: dict = Depends(require_admin)):
    rows = await db.neighborhood_posts.find(
        {"flags.0": {"$exists": True}, "removed": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return [{
        "id": r["id"], "kind": r["kind"], "title": r["title"], "body": r.get("body", ""),
        "author": r.get("author"), "neighborhood": _neighborhood_tag(r["neighborhood_key"]),
        "flag_count": len(r.get("flags", [])), "flags": r.get("flags", []),
        "created_at": r["created_at"],
    } for r in rows]


@api_router.post("/admin/neighborhood/posts/{post_id}/remove")
async def admin_neighborhood_remove(post_id: str, admin: dict = Depends(require_admin)):
    res = await db.neighborhood_posts.update_one({"id": post_id}, {"$set": {"removed": True, "removed_at": now_iso()}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Post not found.")
    return {"ok": True}


@api_router.post("/admin/neighborhood/posts/{post_id}/dismiss")
async def admin_neighborhood_dismiss(post_id: str, admin: dict = Depends(require_admin)):
    """Clear flags without removing (false alarm)."""
    res = await db.neighborhood_posts.update_one({"id": post_id}, {"$set": {"flags": []}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Post not found.")
    return {"ok": True}


# ================================================================ Disaster Response & Emergency Support (Sheet #30)
EMERGENCY_SCENARIOS = [
    {"key": "flood_water", "label": "Water / Flooding", "icon": "water", "trade": "Plumbing"},
    {"key": "burst_pipe", "label": "Burst Pipe / Leak", "icon": "pipe-leak", "trade": "Plumbing"},
    {"key": "fire_smoke", "label": "Fire / Smoke", "icon": "fire", "trade": "General Contractor"},
    {"key": "storm_roof", "label": "Storm / Roof Damage", "icon": "weather-hurricane", "trade": "Roofing"},
    {"key": "electrical", "label": "Electrical Hazard", "icon": "flash-alert", "trade": "Electrical"},
    {"key": "gas_leak", "label": "Gas / Smell", "icon": "gas-cylinder", "trade": "HVAC"},
    {"key": "structural", "label": "Structural Damage", "icon": "home-alert", "trade": "General Contractor"},
    {"key": "other", "label": "Other Emergency", "icon": "alert-octagon", "trade": "General Contractor"},
]
_SCEN_MAP = {s["key"]: s for s in EMERGENCY_SCENARIOS}

EMERGENCY_SYSTEM = (
    "You are 'Homie,' a calm emergency home-triage expert. A homeowner has an URGENT hazard. "
    "SAFETY IS THE ONLY PRIORITY — never suggest buying products or upsell during triage. "
    "Give clear, calm, immediately actionable steps a scared non-expert can follow right now.\n"
    "Location: {location}.\n"
    "Respond ONLY with valid JSON (no markdown) with EXACTLY these keys:\n"
    "  'severity': one of 'call_911' | 'urgent' | 'caution'.\n"
    "  'call_authority': short string if they must call 911/gas company/utility NOW, else null.\n"
    "  'headline': one short reassuring sentence telling them the first thing to do.\n"
    "  'immediate_steps': array of 4-7 short imperative safety steps in order (e.g. 'Shut off the water main').\n"
    "  'do_not': array of 3-5 short 'do NOT ...' warnings.\n"
    "  'temp_fix': array of 2-4 short safe temporary-mitigation steps (only if safe).\n"
    "  'document': array of 3-4 short steps to document damage for insurance (photos/video/notes).\n"
    "  'when_to_call_pro': one short sentence on when to stop and call a professional."
)


class TriageReq(BaseModel):
    scenario: str
    description: str = ""
    photo_base64: Optional[str] = None


@api_router.get("/emergency/scenarios")
async def emergency_scenarios(user: dict = Depends(get_current_user)):
    return {"scenarios": [{"key": s["key"], "label": s["label"], "icon": s["icon"]} for s in EMERGENCY_SCENARIOS]}


@api_router.post("/emergency/triage")
async def emergency_triage(req: TriageReq, user: dict = Depends(get_current_user)):
    scen = _SCEN_MAP.get(req.scenario, _SCEN_MAP["other"])
    system = EMERGENCY_SYSTEM.format(location=user.get("location") or "United States") + lang_note(user)
    user_text = (
        f"EMERGENCY TYPE: {scen['label']}.\n"
        f"What the homeowner reports: {req.description or '(no extra detail given)'}\n"
        "Generate the emergency triage guide now."
    )
    try:
        guide = await _llm_json(system, user_text, max_tokens=1200)
    except Exception as e:
        logger.error(f"emergency triage error: {e}")
        guide = {
            "severity": "urgent",
            "call_authority": "If anyone is in danger, call 911 now.",
            "headline": "Get everyone to safety first, then protect the home.",
            "immediate_steps": ["Move people and pets to a safe area.", "Shut off the affected utility if you can do so safely.", "Avoid the hazard area."],
            "do_not": ["Do not risk your safety for belongings."],
            "temp_fix": [], "document": ["Take photos and video of all damage for insurance."],
            "when_to_call_pro": "Call a licensed professional as soon as the area is safe.",
        }
    event = {
        "id": new_id(), "user_id": user["id"], "scenario": scen["key"], "scenario_label": scen["label"],
        "description": req.description[:1000], "photo_base64": req.photo_base64,
        "guide": guide, "suggested_trade": scen["trade"], "created_at": now_iso(),
    }
    await db.emergency_events.insert_one(dict(event))
    # log to the home twin timeline for insurance / FEMA records
    try:
        await db.timeline.insert_one({
            "id": new_id(), "user_id": user["id"], "type": "emergency",
            "story_title": f"⚠️ Emergency logged: {scen['label']}",
            "story": (req.description or scen["label"])[:500],
            "after_photo": req.photo_base64, "money_saved_cents": 0, "shared": False,
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning(f"emergency timeline log failed: {e}")
    await emit_event("emergency_reported", user["id"], {"scenario": scen["key"]})
    await push_notification(user["id"], title=f"Emergency logged: {scen['label']}",
                            body="Your triage steps are saved to your home records for insurance.",
                            ntype="safety", priority="urgent", meta={"event_id": event["id"]})
    return {
        "id": event["id"], "scenario": scen["key"], "scenario_label": scen["label"],
        "guide": guide, "suggested_trade": scen["trade"],
    }


@api_router.get("/emergency/events")
async def emergency_events(user: dict = Depends(get_current_user)):
    rows = await db.emergency_events.find({"user_id": user["id"]}, {"_id": 0, "photo_base64": 0}).sort("created_at", -1).to_list(100)
    return rows


# ================================================================ Notification, Alert & Messaging Center (Sheet #32)
NOTIF_TYPES = {"project", "safety", "social", "promo", "system"}
NOTIF_DEFAULT_PREFS = {"project": True, "safety": True, "social": True, "promo": True, "system": True, "dnd": False}


async def push_notification(user_id: str, title: str, body: str, ntype: str = "system",
                            priority: str = "normal", meta: dict = None) -> Optional[dict]:
    """Create an in-app notification, honoring the user's type preferences.
    Safety + urgent messages always deliver (override toggles/DND)."""
    if ntype not in NOTIF_TYPES:
        ntype = "system"
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "notif_prefs": 1})
    if user is None:
        return None
    prefs = {**NOTIF_DEFAULT_PREFS, **((user or {}).get("notif_prefs") or {})}
    override = priority == "urgent" or ntype == "safety"
    if not override and not prefs.get(ntype, True):
        return None  # user opted out of this category
    doc = {
        "id": new_id(), "user_id": user_id, "type": ntype, "title": title[:140],
        "body": body[:500], "priority": priority if priority in ("urgent", "normal", "low") else "normal",
        "meta": meta or {}, "read": False, "created_at": now_iso(),
    }
    await db.notifications.insert_one(dict(doc))
    return doc


class NotifPrefsReq(BaseModel):
    project: bool = True
    safety: bool = True
    social: bool = True
    promo: bool = True
    system: bool = True
    dnd: bool = False


@api_router.get("/notifications")
async def list_notifications(filter: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {"user_id": user["id"]}
    if filter and filter in NOTIF_TYPES:
        q["type"] = filter
    items = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # urgent first, then newest
    items.sort(key=lambda n: (0 if n.get("priority") == "urgent" and not n.get("read") else 1, ))
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"items": items, "unread_count": unread}


@api_router.get("/notifications/unread-count")
async def notif_unread_count(user: dict = Depends(get_current_user)):
    return {"unread_count": await db.notifications.count_documents({"user_id": user["id"], "read": False})}


@api_router.post("/notifications/{notif_id}/read")
async def notif_mark_read(notif_id: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": notif_id, "user_id": user["id"]}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True}


@api_router.post("/notifications/read-all")
async def notif_read_all(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True}


@api_router.delete("/notifications/{notif_id}")
async def notif_delete(notif_id: str, user: dict = Depends(get_current_user)):
    await db.notifications.delete_one({"id": notif_id, "user_id": user["id"]})
    return {"ok": True}


@api_router.get("/notifications/preferences")
async def notif_get_prefs(user: dict = Depends(get_current_user)):
    return {**NOTIF_DEFAULT_PREFS, **(user.get("notif_prefs") or {})}


@api_router.put("/notifications/preferences")
async def notif_set_prefs(req: NotifPrefsReq, user: dict = Depends(get_current_user)):
    prefs = req.model_dump()
    await db.users.update_one({"id": user["id"]}, {"$set": {"notif_prefs": prefs}})
    return prefs


# ---- admin broadcast
class BroadcastReq(BaseModel):
    title: str
    body: str
    priority: str = "normal"
    ntype: str = "system"
    segment: str = "all"  # all | pro | paying | tag:<tag>


@api_router.post("/admin/notifications/broadcast")
async def admin_broadcast(req: BroadcastReq, admin: dict = Depends(require_admin)):
    q: dict = {}
    seg = req.segment or "all"
    if seg == "pro":
        q = {"is_pro": True}
    elif seg == "paying":
        q = {"subscription_tier": {"$in": ["pro", "master"]}}
    elif seg.startswith("tag:"):
        q = {"tags": seg.split(":", 1)[1]}
    users = await db.users.find(q, {"_id": 0, "id": 1}).to_list(50000)
    ntype = req.ntype if req.ntype in NOTIF_TYPES else "system"
    priority = req.priority if req.priority in ("urgent", "normal", "low") else "normal"
    campaign_id = new_id()
    sent = 0
    for u in users:
        # push_notification enforces per-user preferences (safety/urgent override)
        doc = await push_notification(u["id"], title=req.title, body=req.body, ntype=ntype,
                                      priority=priority, meta={"campaign_id": campaign_id})
        if doc:
            sent += 1
    await db.notif_campaigns.insert_one({
        "id": campaign_id, "title": req.title[:140], "body": req.body[:500], "priority": priority,
        "ntype": ntype, "segment": seg, "recipients": sent, "created_at": now_iso(),
        "created_by": admin.get("email"),
    })
    return {"ok": True, "recipients": sent, "campaign_id": campaign_id}


@api_router.get("/admin/notifications/campaigns")
async def admin_campaigns(admin: dict = Depends(require_admin)):
    rows = await db.notif_campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for r in rows:
        total = r.get("recipients", 0)
        read = await db.notifications.count_documents({"meta.campaign_id": r["id"], "read": True})
        r["read_count"] = read
        r["read_rate"] = round((read / total) * 100, 1) if total else 0.0
    return rows


# ================================================================ Pro/Material Wholesaler & Supplier Suite (Sheet #33)
SUPPLIER_CATEGORIES = ["Lumber", "Building Materials", "Electrical", "Plumbing", "Paint", "Landscaping", "Roofing", "Tools"]
MATERIAL_ORDER_STATUSES = ["rfq", "quoted", "confirmed", "fulfilled", "cancelled"]

SUPPLIER_SEED = [
    {"id": "sup-lonestar", "name": "Lone Star Lumber & Supply", "categories": ["Lumber", "Building Materials"],
     "location": "Austin, TX", "pro_only": True, "hours": "Mon–Sat 6a–6p", "phone": "(512) 555-0142",
     "min_order_cents": 15000, "delivery": True, "pickup": True,
     "blurb": "Regional yard for framing lumber, sheet goods & bulk fasteners. Pro pricing on volume.",
     "products": [
        {"sku": "2X4-8-SPF", "name": "2x4x8 SPF Stud", "unit": "ea", "price_cents": 349},
        {"sku": "OSB-716", "name": "7/16\" OSB Sheathing 4x8", "unit": "sheet", "price_cents": 1899},
        {"sku": "TREX-DECK", "name": "Composite Deck Board 5/4x6x16", "unit": "ea", "price_cents": 2799},
        {"sku": "SCREW-3IN", "name": "Exterior Screws 3\" (5lb)", "unit": "box", "price_cents": 3299}]},
    {"id": "sup-hillcountry", "name": "Hill Country Electrical Wholesale", "categories": ["Electrical"],
     "location": "Austin, TX", "pro_only": True, "hours": "Mon–Fri 7a–5p", "phone": "(512) 555-0177",
     "min_order_cents": 10000, "delivery": True, "pickup": True,
     "blurb": "Contractor-grade wire, breakers, panels & fixtures. Same-day will-call.",
     "products": [
        {"sku": "ROMEX-12-250", "name": "12/2 Romex NM-B 250ft", "unit": "roll", "price_cents": 12999},
        {"sku": "BRK-20A", "name": "20A Single-Pole Breaker", "unit": "ea", "price_cents": 899},
        {"sku": "PANEL-200", "name": "200A Main Load Center", "unit": "ea", "price_cents": 18999}]},
    {"id": "sup-colorworks", "name": "ColorWorks Paint Depot", "categories": ["Paint"],
     "location": "Round Rock, TX", "pro_only": False, "hours": "Daily 7a–7p", "phone": "(512) 555-0199",
     "min_order_cents": 5000, "delivery": True, "pickup": True,
     "blurb": "Bulk interior/exterior paint, primers & sundries with contractor tinting.",
     "products": [
        {"sku": "PAINT-INT-5G", "name": "Interior Eggshell Paint 5-gal", "unit": "pail", "price_cents": 15999},
        {"sku": "PRIMER-5G", "name": "Multi-Surface Primer 5-gal", "unit": "pail", "price_cents": 11999},
        {"sku": "ROLLER-KIT", "name": "Pro Roller & Tray Kit", "unit": "kit", "price_cents": 2499}]},
]


async def seed_suppliers():
    for s in SUPPLIER_SEED:
        exists = await db.suppliers.find_one({"id": s["id"]})
        if exists:
            continue
        prods = s.pop("products", [])
        await db.suppliers.insert_one({**s, "active": True, "verified": True, "stripe_account_id": None, "created_at": now_iso()})
        for p in prods:
            await db.supplier_products.insert_one({
                "id": new_id(), "supplier_id": s["id"], "sku": p["sku"], "name": p["name"],
                "unit": p["unit"], "price_cents": p["price_cents"], "image": None, "created_at": now_iso(),
            })
    logger.info("suppliers seeded")


def _supplier_public(s: dict) -> dict:
    return {
        "id": s["id"], "name": s.get("name"), "categories": s.get("categories", []),
        "location": s.get("location", ""), "pro_only": bool(s.get("pro_only")),
        "hours": s.get("hours", ""), "phone": s.get("phone", ""), "blurb": s.get("blurb", ""),
        "min_order_cents": s.get("min_order_cents", 0), "delivery": bool(s.get("delivery")),
        "pickup": bool(s.get("pickup")), "verified": bool(s.get("verified")),
        "can_pay_online": bool(s.get("stripe_account_id")),
    }


class OrderItem(BaseModel):
    sku: Optional[str] = None
    name: str
    qty: float = 1
    unit: str = "ea"
    grade: Optional[str] = None
    cut_length: Optional[str] = None
    unit_price_cents: int = 0


class MaterialOrderReq(BaseModel):
    supplier_id: str
    project_id: Optional[str] = None
    mode: str = "rfq"  # rfq | order
    fulfillment: str = "delivery"  # delivery | pickup
    items: List[OrderItem] = []
    note: str = ""


@api_router.get("/suppliers")
async def list_suppliers(category: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {"active": True}
    if category and category in SUPPLIER_CATEGORIES:
        q["categories"] = category
    rows = await db.suppliers.find(q, {"_id": 0}).sort("name", 1).to_list(200)
    return {"categories": SUPPLIER_CATEGORIES, "suppliers": [_supplier_public(s) for s in rows]}


@api_router.get("/suppliers/{supplier_id}")
async def supplier_detail(supplier_id: str, user: dict = Depends(get_current_user)):
    s = await db.suppliers.find_one({"id": supplier_id, "active": True}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found.")
    products = await db.supplier_products.find({"supplier_id": supplier_id}, {"_id": 0}).sort("name", 1).to_list(500)
    return {"supplier": _supplier_public(s), "products": products}


@api_router.post("/material-orders")
async def create_material_order(req: MaterialOrderReq, user: dict = Depends(get_current_user)):
    s = await db.suppliers.find_one({"id": req.supplier_id, "active": True}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found.")
    if not req.items:
        raise HTTPException(status_code=400, detail="Add at least one item.")
    items = [{
        "sku": i.sku, "name": i.name[:140], "qty": max(0.0, float(i.qty)), "unit": i.unit[:16],
        "grade": (i.grade or "")[:60], "cut_length": (i.cut_length or "")[:40],
        "unit_price_cents": max(0, int(i.unit_price_cents)),
        "line_cents": int(max(0, int(i.unit_price_cents)) * max(0.0, float(i.qty))),
    } for i in req.items]
    subtotal = sum(i["line_cents"] for i in items)
    mode = req.mode if req.mode in ("rfq", "order") else "rfq"
    order = {
        "id": new_id(), "user_id": user["id"], "supplier_id": s["id"], "supplier_name": s["name"],
        "project_id": req.project_id, "mode": mode,
        "fulfillment": req.fulfillment if req.fulfillment in ("delivery", "pickup") else "delivery",
        "items": items, "subtotal_cents": subtotal, "quoted_cents": None,
        "status": "rfq" if mode == "rfq" else "confirmed", "note": req.note[:1000],
        "events": [{"status": "created", "at": now_iso()}], "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.material_orders.insert_one(dict(order))
    await push_notification(user["id"], title="Order submitted",
                            body=f"Your {'RFQ' if mode=='rfq' else 'order'} to {s['name']} was received.",
                            ntype="project", meta={"order_id": order["id"]})
    await emit_event("material_order_created", user["id"], {"supplier": s["name"], "subtotal_cents": subtotal})
    return {k: v for k, v in order.items()}


@api_router.get("/material-orders")
async def list_material_orders(user: dict = Depends(get_current_user)):
    rows = await db.material_orders.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(300)
    return rows


@api_router.get("/material-orders/{order_id}")
async def material_order_detail(order_id: str, user: dict = Depends(get_current_user)):
    o = await db.material_orders.find_one({"id": order_id, "user_id": user["id"]}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found.")
    return o


@api_router.post("/material-orders/{order_id}/pay")
async def pay_material_order(order_id: str, req: OriginReq, user: dict = Depends(get_current_user)):
    o = await db.material_orders.find_one({"id": order_id, "user_id": user["id"]}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found.")
    amount = o.get("quoted_cents") or o.get("subtotal_cents") or 0
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Awaiting supplier quote before payment.")
    s = await db.suppliers.find_one({"id": o["supplier_id"]}, {"_id": 0})
    acct = (s or {}).get("stripe_account_id")
    if not STRIPE_SECRET_KEY or "sk_test_emergent" in STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments not configured on this environment.")
    if not acct:
        raise HTTPException(status_code=400, detail="This supplier isn't set up for online payment yet — arrange payment directly.")
    host = (req.origin_url or "").rstrip("/") or "https://diyhomie.app"
    fee = int(amount * PLATFORM_FEE_PCT)
    try:
        session = await asyncio.to_thread(lambda: stripe.checkout.Session.create(
            mode="payment", payment_method_types=["card"],
            line_items=[{"price_data": {"currency": "usd", "unit_amount": amount,
                         "product_data": {"name": f"Materials order — {s['name']}"}}, "quantity": 1}],
            payment_intent_data={"application_fee_amount": fee, "transfer_data": {"destination": acct}},
            customer_email=user.get("email"),
            metadata={"material_order_id": o["id"]},
            success_url=f"{host}/orders/{o['id']}?paid=1", cancel_url=f"{host}/orders/{o['id']}",
        ))
    except Exception as e:
        logger.error(f"material order pay error: {e}")
        raise HTTPException(status_code=502, detail="Could not start payment.")
    return {"checkout_url": session.url}


# ---- admin supplier management
class SupplierReq(BaseModel):
    name: str
    categories: List[str] = []
    location: str = ""
    pro_only: bool = True
    hours: str = ""
    phone: str = ""
    blurb: str = ""
    min_order_cents: int = 0
    delivery: bool = True
    pickup: bool = True
    stripe_account_id: Optional[str] = None


@api_router.get("/admin/suppliers")
async def admin_list_suppliers(admin: dict = Depends(require_admin)):
    rows = await db.suppliers.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    out = []
    for s in rows:
        pc = await db.supplier_products.count_documents({"supplier_id": s["id"]})
        oc = await db.material_orders.count_documents({"supplier_id": s["id"]})
        out.append({**_supplier_public(s), "active": bool(s.get("active", True)), "product_count": pc, "order_count": oc})
    return out


@api_router.post("/admin/suppliers")
async def admin_create_supplier(req: SupplierReq, admin: dict = Depends(require_admin)):
    doc = {"id": new_id(), **req.model_dump(), "active": True, "verified": True,
           "created_at": now_iso()}
    await db.suppliers.insert_one(dict(doc))
    return _supplier_public(doc)


@api_router.post("/admin/suppliers/{supplier_id}/products/import")
async def admin_import_products(supplier_id: str, payload: dict, admin: dict = Depends(require_admin)):
    """CSV import: payload {csv: 'sku,name,unit,price'} — one product per line."""
    s = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found.")
    csv_text = (payload.get("csv") or "").strip()
    if not csv_text:
        raise HTTPException(status_code=400, detail="Provide CSV rows: sku,name,unit,price")
    added = 0
    for line in csv_text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 4 or parts[0].lower() == "sku":
            continue
        sku, name, unit, price = parts[0], parts[1], parts[2], parts[3]
        try:
            cents = int(round(float(price.replace("$", "")) * 100))
        except ValueError:
            continue
        await db.supplier_products.insert_one({
            "id": new_id(), "supplier_id": supplier_id, "sku": sku[:60], "name": name[:140],
            "unit": unit[:16] or "ea", "price_cents": cents, "image": None, "created_at": now_iso(),
        })
        added += 1
    return {"ok": True, "added": added}


@api_router.post("/admin/suppliers/{supplier_id}/toggle")
async def admin_toggle_supplier(supplier_id: str, active: bool, admin: dict = Depends(require_admin)):
    res = await db.suppliers.update_one({"id": supplier_id}, {"$set": {"active": active}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Supplier not found.")
    return {"ok": True}


@api_router.get("/admin/material-orders")
async def admin_list_orders(admin: dict = Depends(require_admin)):
    return await db.material_orders.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)


@api_router.patch("/admin/material-orders/{order_id}")
async def admin_update_order(order_id: str, status: str, quoted_cents: Optional[int] = None, admin: dict = Depends(require_admin)):
    if status not in MATERIAL_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status.")
    o = await db.material_orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found.")
    upd: dict = {"status": status, "updated_at": now_iso()}
    if quoted_cents is not None:
        upd["quoted_cents"] = int(quoted_cents)
    await db.material_orders.update_one(
        {"id": order_id},
        {"$set": upd, "$push": {"events": {"status": status, "at": now_iso()}}},
    )
    body = {"quoted": "Your supplier sent a quote — review & pay.", "confirmed": "Your materials order is confirmed.",
            "fulfilled": "Your materials order was fulfilled.", "cancelled": "Your materials order was cancelled."}.get(status)
    if body:
        await push_notification(o["user_id"], title=f"Order update: {o['supplier_name']}", body=body,
                                ntype="project", meta={"order_id": order_id})
    return {"ok": True}


# ================================================================ Loyalty, Rewards & Recognition (Sheet #34)
LOYALTY_TIERS = [
    {"key": "bronze", "label": "Bronze Builder", "min": 0},
    {"key": "silver", "label": "Silver Craftsman", "min": 6},
    {"key": "gold", "label": "Gold Contributor", "min": 18},
    {"key": "platinum", "label": "Platinum Legend", "min": 45},
]

LOYALTY_BADGES = [
    {"key": "first_fix", "label": "First Fix", "icon": "hammer-wrench", "metric": "projects", "threshold": 1, "desc": "Complete your first project"},
    {"key": "project_mentor", "label": "Project Mentor", "icon": "school-outline", "metric": "helps", "threshold": 3, "desc": "Help 3 neighbors finish a project"},
    {"key": "homeowner_legend", "label": "Homeowner Legend", "icon": "crown-outline", "metric": "projects", "threshold": 10, "desc": "Complete 10 projects"},
    {"key": "connector", "label": "Community Connector", "icon": "account-group-outline", "metric": "referrals", "threshold": 3, "desc": "3 invited neighbors start building"},
    {"key": "neighborhood_hero", "label": "Neighborhood Hero", "icon": "shield-star-outline", "metric": "percentile", "threshold": 95, "desc": "Top 5% contributor in your area"},
]

# Reward catalog — redeemable with earned credits. Value-based, never engagement tricks.
LOYALTY_REWARDS = [
    {"id": "guide_unlock", "label": "Unlock a premium expert guide", "cost": 100, "kind": "guide", "icon": "book-lock-open-outline"},
    {"id": "showcase_feature", "label": "Feature your project in the community showcase", "cost": 250, "kind": "showcase", "icon": "star-outline"},
    {"id": "pro_week", "label": "7 days of DIYhomie Pro", "cost": 500, "kind": "subscription", "icon": "rocket-launch-outline"},
    {"id": "donation_ramp", "label": "Donate to “Build a ramp for a neighbor in need”", "cost": 300, "kind": "donation", "icon": "hand-heart-outline"},
]

REFERRAL_LOYALTY_CREDITS = 50  # in-app loyalty credits per verified conversion


async def award_loyalty_credits(user_id: str, amount: int, reason: str, meta: dict = None):
    """Grant in-app loyalty credits with an audit-logged ledger entry."""
    if amount == 0:
        return
    await db.users.update_one({"id": user_id}, {"$inc": {"credits": amount}})
    await db.credit_ledger.insert_one({
        "id": new_id(), "user_id": user_id, "amount": amount, "reason": reason,
        "meta": meta or {}, "created_at": now_iso(),
    })


async def _loyalty_contrib(uid: str) -> dict:
    projects = await db.timeline.count_documents({"user_id": uid})
    helps = await db.neighborhood_posts.count_documents(
        {"resolved": True, "offers.user_id": uid, "removed": {"$ne": True}})
    referrals = await db.referrals.count_documents({"referrer_id": uid, "status": "converted"})
    score = int(projects) * 2 + int(helps) * 3 + int(referrals) * 5
    return {"projects": int(projects), "helps": int(helps), "referrals": int(referrals), "score": score}


def _tier_for(score: int) -> dict:
    current = LOYALTY_TIERS[0]
    nxt = None
    for i, t in enumerate(LOYALTY_TIERS):
        if score >= t["min"]:
            current = t
            nxt = LOYALTY_TIERS[i + 1] if i + 1 < len(LOYALTY_TIERS) else None
    out = {"key": current["key"], "label": current["label"], "min": current["min"]}
    if nxt:
        out["next"] = {"key": nxt["key"], "label": nxt["label"], "remaining": max(0, nxt["min"] - score), "at": nxt["min"]}
    else:
        out["next"] = None
    return out


async def _region_member_ids(key: str) -> List[str]:
    if not key:
        return []
    members = await db.users.find({"neighborhood_optin": True}, {"_id": 0, "id": 1, "location": 1}).to_list(4000)
    return [m["id"] for m in members if _neighborhood_key(m.get("location", "")) == key]


@api_router.get("/loyalty/me")
async def loyalty_me(user: dict = Depends(get_current_user)):
    contrib = await _loyalty_contrib(user["id"])
    tier = _tier_for(contrib["score"])
    key = _neighborhood_key(user.get("location", ""))

    # percentile within region (only meaningful if opted in + enough neighbors)
    percentile = 0
    if key:
        ids = await _region_member_ids(key)
        if user["id"] not in ids:
            ids = ids + [user["id"]]
        if len(ids) >= 2:
            scores = []
            for mid in ids:
                c = await _loyalty_contrib(mid)
                scores.append((mid, c["score"]))
            scores.sort(key=lambda x: x[1])
            rank = next((i for i, (mid, _s) in enumerate(scores) if mid == user["id"]), 0)
            percentile = round((rank / (len(scores) - 1)) * 100) if len(scores) > 1 else 0

    badges = []
    for b in LOYALTY_BADGES:
        if b["metric"] == "percentile":
            earned = percentile >= b["threshold"]
            prog = min(1.0, percentile / b["threshold"]) if b["threshold"] else 0
        else:
            val = contrib.get(b["metric"], 0)
            earned = val >= b["threshold"]
            prog = min(1.0, val / b["threshold"]) if b["threshold"] else 0
        badges.append({**b, "earned": bool(earned), "progress": round(prog, 2)})

    # regional impact metrics (real counts; energy/CO2 are estimates w/ disclaimer)
    impact = None
    if key:
        ids = await _region_member_ids(key)
        if user["id"] not in ids:
            ids = ids + [user["id"]]
        year_cut = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        homes_year = await db.timeline.count_documents({"user_id": {"$in": ids}, "created_at": {"$gte": year_cut}})
        saved_cur = db.timeline.aggregate([
            {"$match": {"user_id": {"$in": ids}}},
            {"$group": {"_id": None, "saved": {"$sum": "$money_saved_cents"}, "n": {"$sum": 1}}},
        ])
        saved_row = await saved_cur.to_list(1)
        saved_cents = int(saved_row[0]["saved"]) if saved_row else 0
        total_projects = int(saved_row[0]["n"]) if saved_row else 0
        impact = {
            "region": _neighborhood_tag(user.get("location", "")),
            "neighbors": len(ids),
            "homes_upgraded_year": int(homes_year),
            "money_saved_cents": saved_cents,
            "time_saved_hours": total_projects * 3,      # ~3 hrs saved per logged project
            "co2_saved_kg": total_projects * 12,          # estimate — energy/waste avoided
            "estimate_note": "Time & CO₂ figures are community estimates, not guarantees.",
        }

    return {
        "contribution": contrib,
        "tier": tier,
        "percentile": percentile,
        "badges": badges,
        "credits": user.get("credits", 0),
        "referral_code": user.get("referral_code"),
        "leaderboard_optin": bool(user.get("leaderboard_optin")),
        "has_location": bool(key),
        "impact": impact,
        "rewards": LOYALTY_REWARDS,
    }


class OptinReq(BaseModel):
    optin: bool = True


@api_router.post("/loyalty/leaderboard/optin")
async def loyalty_leaderboard_optin(req: OptinReq, user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"leaderboard_optin": req.optin}})
    return {"optin": req.optin}


@api_router.get("/loyalty/leaderboard")
async def loyalty_leaderboard(user: dict = Depends(get_current_user)):
    key = _neighborhood_key(user.get("location", ""))
    if not key:
        return {"needs_location": True, "optin": bool(user.get("leaderboard_optin")), "entries": []}
    if not user.get("leaderboard_optin"):
        return {"needs_optin": True, "optin": False, "entries": []}
    # only rank opted-in members in the region
    members = await db.users.find(
        {"leaderboard_optin": True}, {"_id": 0, "id": 1, "name": 1, "location": 1}).to_list(4000)
    members = [m for m in members if _neighborhood_key(m.get("location", "")) == key]
    entries = []
    for m in members:
        c = await _loyalty_contrib(m["id"])
        entries.append({
            "is_me": m["id"] == user["id"],
            "name": (m.get("name") or "Neighbor") if m["id"] == user["id"] else _anon_name(m.get("name")),
            "score": c["score"], "projects": c["projects"], "helps": c["helps"],
            "tier": _tier_for(c["score"])["label"],
        })
    entries.sort(key=lambda x: x["score"], reverse=True)
    for i, e in enumerate(entries):
        e["rank"] = i + 1
    return {"region": _neighborhood_tag(user.get("location", "")), "optin": True, "entries": entries[:50]}


def _anon_name(name: Optional[str]) -> str:
    if not name:
        return "A neighbor"
    parts = name.strip().split()
    first = parts[0]
    last_i = parts[-1][0].upper() + "." if len(parts) > 1 else ""
    return f"{first} {last_i}".strip()


class RedeemReq(BaseModel):
    reward_id: str


@api_router.post("/loyalty/redeem")
async def loyalty_redeem(req: RedeemReq, user: dict = Depends(get_current_user)):
    reward = next((r for r in LOYALTY_REWARDS if r["id"] == req.reward_id), None)
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found.")
    balance = user.get("credits", 0)
    if balance < reward["cost"]:
        raise HTTPException(status_code=402, detail=f"You need {reward['cost'] - balance} more credits to redeem this.")
    await db.users.update_one({"id": user["id"]}, {"$inc": {"credits": -reward["cost"]}})
    await db.credit_ledger.insert_one({
        "id": new_id(), "user_id": user["id"], "amount": -reward["cost"],
        "reason": f"redeem:{reward['id']}", "meta": {"kind": reward["kind"], "label": reward["label"]},
        "created_at": now_iso(),
    })
    grant = {"ok": True}
    if reward["kind"] == "subscription":
        until = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        await db.users.update_one({"id": user["id"]}, {"$set": {"pro_trial_until": until}})
        grant["pro_trial_until"] = until
    elif reward["kind"] == "donation":
        await db.loyalty_donations.insert_one({
            "id": new_id(), "user_id": user["id"], "campaign": "ramp_for_neighbor",
            "credits": reward["cost"], "created_at": now_iso()})
    await push_notification(user["id"], title="Reward redeemed 🎉",
                            body=f"You redeemed: {reward['label']}.", ntype="system",
                            meta={"reward": reward["id"]})
    new_balance = balance - reward["cost"]
    grant["credits"] = new_balance
    grant["message"] = f"Redeemed “{reward['label']}”. {new_balance} credits left."
    return grant


@api_router.get("/loyalty/campaigns")
async def loyalty_campaigns(user: dict = Depends(get_current_user)):
    key = _neighborhood_key(user.get("location", ""))
    rows = await db.loyalty_campaigns.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
    out = []
    for c in rows:
        region_ok = (not c.get("region")) or c.get("region") == key
        if not region_ok:
            continue
        joined = user["id"] in c.get("participant_ids", [])
        out.append({
            "id": c["id"], "title": c["title"], "blurb": c.get("blurb", ""),
            "goal": c.get("goal", 0), "progress": len(c.get("participant_ids", [])),
            "reward_credits": c.get("reward_credits", 0), "icon": c.get("icon", "bullhorn-outline"),
            "region": _neighborhood_tag(c["region"]) if c.get("region") else "Everywhere",
            "ends_at": c.get("ends_at"), "joined": joined,
        })
    return {"campaigns": out}


@api_router.post("/loyalty/campaigns/{campaign_id}/join")
async def loyalty_campaign_join(campaign_id: str, user: dict = Depends(get_current_user)):
    c = await db.loyalty_campaigns.find_one({"id": campaign_id, "active": True}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    if user["id"] in c.get("participant_ids", []):
        return {"ok": True, "joined": True}
    await db.loyalty_campaigns.update_one({"id": campaign_id}, {"$addToSet": {"participant_ids": user["id"]}})
    reward = int(c.get("reward_credits", 0))
    if reward:
        await award_loyalty_credits(user["id"], reward, f"campaign_join:{campaign_id}", {"title": c["title"]})
    await push_notification(user["id"], title=f"You joined: {c['title']}",
                            body="Thanks for stepping up for your community!" + (f" +{reward} credits" if reward else ""),
                            ntype="social", meta={"campaign_id": campaign_id})
    return {"ok": True, "joined": True, "reward_credits": reward}


# ---- admin loyalty
class CampaignReq(BaseModel):
    title: str
    blurb: str = ""
    goal: int = 0
    reward_credits: int = 0
    region: Optional[str] = None   # neighborhood_key or None for everywhere
    icon: str = "bullhorn-outline"
    ends_at: Optional[str] = None


@api_router.get("/admin/loyalty/campaigns")
async def admin_loyalty_campaigns(admin: dict = Depends(require_admin)):
    rows = await db.loyalty_campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for c in rows:
        c["participants"] = len(c.get("participant_ids", []))
        c.pop("participant_ids", None)
    return rows


@api_router.post("/admin/loyalty/campaigns")
async def admin_create_campaign(req: CampaignReq, admin: dict = Depends(require_admin)):
    doc = {"id": new_id(), **req.model_dump(), "active": True, "participant_ids": [], "created_at": now_iso()}
    await db.loyalty_campaigns.insert_one(dict(doc))
    doc.pop("participant_ids", None)
    return doc


@api_router.post("/admin/loyalty/campaigns/{campaign_id}/toggle")
async def admin_toggle_campaign(campaign_id: str, active: bool, admin: dict = Depends(require_admin)):
    res = await db.loyalty_campaigns.update_one({"id": campaign_id}, {"$set": {"active": active}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    return {"ok": True}


@api_router.get("/admin/loyalty/ledger")
async def admin_loyalty_ledger(admin: dict = Depends(require_admin)):
    rows = await db.credit_ledger.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    donations = await db.loyalty_donations.aggregate([
        {"$group": {"_id": "$campaign", "credits": {"$sum": "$credits"}, "count": {"$sum": 1}}}]).to_list(50)
    total_awarded = sum(r["amount"] for r in rows if r["amount"] > 0)
    total_redeemed = -sum(r["amount"] for r in rows if r["amount"] < 0)
    return {"ledger": rows, "totals": {"awarded": total_awarded, "redeemed": total_redeemed},
            "donations": [{"campaign": d["_id"], "credits": d["credits"], "count": d["count"]} for d in donations]}


async def seed_loyalty_campaigns():
    seeds = [
        {"id": "camp-cleanup", "title": "Spring Neighborhood Cleanup Challenge",
         "blurb": "Log a cleanup, yard, or exterior project this month and earn bonus credits.",
         "goal": 25, "reward_credits": 40, "region": None, "icon": "broom", "ends_at": None},
        {"id": "camp-ramp", "title": "Build a Ramp for a Neighbor in Need",
         "blurb": "Pool skills & materials to build accessibility ramps locally. Redeem credits to donate.",
         "goal": 10, "reward_credits": 0, "region": None, "icon": "hand-heart-outline", "ends_at": None},
        {"id": "camp-storm", "title": "Storm Recovery Mutual Aid",
         "blurb": "Neighbors helping neighbors repair storm damage — join to be matched with requests.",
         "goal": 15, "reward_credits": 25, "region": None, "icon": "weather-lightning-rainy", "ends_at": None},
    ]
    for s in seeds:
        exists = await db.loyalty_campaigns.find_one({"id": s["id"]})
        if not exists:
            await db.loyalty_campaigns.insert_one({**s, "active": True, "participant_ids": [], "created_at": now_iso()})
    logger.info("loyalty campaigns seeded")


# ================================================================ Beta / Feature Flags & Structured Feedback (Sheet #39)
FLAG_ROLLOUT_TYPES = ["all", "optin", "user_type", "region", "off"]
USER_TYPE_VALUES = ["pro", "paying", "admin"]


def _flag_on_for_user(flag: dict, user: dict) -> bool:
    if not flag.get("enabled", False):
        return False
    rt = flag.get("rollout_type", "optin")
    val = flag.get("rollout_value")
    if rt == "off":
        return False
    if rt == "all":
        return True
    if rt == "optin":
        return flag["key"] in (user.get("beta_optins") or [])
    if rt == "user_type":
        if val == "pro":
            return bool(user.get("is_pro"))
        if val == "admin":
            return bool(user.get("is_admin"))
        if val == "paying":
            return (user.get("plan") or "free") != "free"
        return False
    if rt == "region":
        return bool(val) and val.lower() in (user.get("location", "").lower() or _neighborhood_key(user.get("location", "")))
    return False


def _flag_public(flag: dict, user: dict) -> dict:
    opted = flag["key"] in (user.get("beta_optins") or [])
    return {
        "key": flag["key"], "label": flag.get("label", flag["key"]),
        "description": flag.get("description", ""), "icon": flag.get("icon", "flask-outline"),
        "rollout_type": flag.get("rollout_type", "optin"),
        "can_optin": flag.get("enabled", False) and flag.get("rollout_type") == "optin",
        "opted_in": opted,
        "enabled_for_me": _flag_on_for_user(flag, user),
    }


@api_router.get("/features")
async def list_features(user: dict = Depends(get_current_user)):
    flags = await db.feature_flags.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # only surface flags the user can interact with (opt-in) or that are on for them
    out = []
    for f in flags:
        pub = _flag_public(f, user)
        if pub["can_optin"] or pub["enabled_for_me"]:
            out.append(pub)
    return {"features": out}


class FlagOptinReq(BaseModel):
    optin: bool = True


@api_router.post("/features/{key}/optin")
async def feature_optin(key: str, req: FlagOptinReq, user: dict = Depends(get_current_user)):
    flag = await db.feature_flags.find_one({"key": key}, {"_id": 0})
    if not flag:
        raise HTTPException(status_code=404, detail="Feature not found.")
    if flag.get("rollout_type") != "optin" or not flag.get("enabled"):
        raise HTTPException(status_code=400, detail="This feature isn't open for opt-in.")
    op = "$addToSet" if req.optin else "$pull"
    await db.users.update_one({"id": user["id"]}, {op: {"beta_optins": key}})
    if req.optin:
        await push_notification(user["id"], title=f"You're in the beta: {flag.get('label', key)}",
                                body="Try it out and tell us what you think — your feedback shapes it.",
                                ntype="system", meta={"feature": key})
    return {"ok": True, "opted_in": req.optin}


class BetaFeedbackReq(BaseModel):
    flag_key: str
    rating: int = 0          # 1-5 (emoji scale)
    useful: Optional[bool] = None
    comment: str = ""


@api_router.post("/beta-feedback")
async def submit_beta_feedback(req: BetaFeedbackReq, user: dict = Depends(get_current_user)):
    tag = "suggestion"
    low = req.comment.lower()
    if any(w in low for w in ["crash", "error", "broke", "bug", "fail"]):
        tag = "bug"
    elif req.rating and req.rating <= 2:
        tag = "friction"
    await db.beta_feedback.insert_one({
        "id": new_id(), "flag_key": req.flag_key, "user_id": user["id"],
        "user_email": user.get("email"), "rating": max(0, min(5, req.rating)),
        "useful": req.useful, "comment": req.comment[:1000], "tag": tag, "created_at": now_iso(),
    })
    return {"ok": True, "tag": tag}


# ---- admin feature flags
class FlagReq(BaseModel):
    key: str
    label: str
    description: str = ""
    icon: str = "flask-outline"
    enabled: bool = False
    rollout_type: str = "optin"
    rollout_value: Optional[str] = None


@api_router.get("/admin/features")
async def admin_list_features(admin: dict = Depends(require_admin)):
    flags = await db.feature_flags.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    out = []
    for f in flags:
        optins = await db.users.count_documents({"beta_optins": f["key"]})
        fb_count = await db.beta_feedback.count_documents({"flag_key": f["key"]})
        out.append({**f, "optin_count": optins, "feedback_count": fb_count})
    return out


@api_router.post("/admin/features")
async def admin_create_feature(req: FlagReq, admin: dict = Depends(require_admin)):
    if req.rollout_type not in FLAG_ROLLOUT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid rollout type.")
    if await db.feature_flags.find_one({"key": req.key}):
        raise HTTPException(status_code=409, detail="A flag with this key already exists.")
    doc = {"id": new_id(), **req.model_dump(), "created_at": now_iso()}
    await db.feature_flags.insert_one(dict(doc))
    return doc


@api_router.patch("/admin/features/{key}")
async def admin_update_feature(key: str, payload: dict, admin: dict = Depends(require_admin)):
    allowed = {k: v for k, v in payload.items() if k in ("label", "description", "icon", "enabled", "rollout_type", "rollout_value")}
    if "rollout_type" in allowed and allowed["rollout_type"] not in FLAG_ROLLOUT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid rollout type.")
    res = await db.feature_flags.update_one({"key": key}, {"$set": allowed})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Feature not found.")
    return {"ok": True}


@api_router.delete("/admin/features/{key}")
async def admin_delete_feature(key: str, admin: dict = Depends(require_admin)):
    await db.feature_flags.delete_one({"key": key})
    await db.users.update_many({"beta_optins": key}, {"$pull": {"beta_optins": key}})
    return {"ok": True}


@api_router.get("/admin/features/{key}/analytics")
async def admin_feature_analytics(key: str, admin: dict = Depends(require_admin)):
    flag = await db.feature_flags.find_one({"key": key}, {"_id": 0})
    if not flag:
        raise HTTPException(status_code=404, detail="Feature not found.")
    fb = await db.beta_feedback.find({"flag_key": key}, {"_id": 0}).sort("created_at", -1).to_list(500)
    ratings = [f["rating"] for f in fb if f.get("rating")]
    useful = [f["useful"] for f in fb if f.get("useful") is not None]
    tags: dict = {}
    for f in fb:
        tags[f.get("tag", "suggestion")] = tags.get(f.get("tag", "suggestion"), 0) + 1
    optins = await db.users.count_documents({"beta_optins": key})
    return {
        "flag": flag, "optin_count": optins, "feedback_count": len(fb),
        "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else 0,
        "useful_pct": round(100 * sum(1 for u in useful if u) / len(useful)) if useful else 0,
        "tag_breakdown": tags, "recent": fb[:50],
    }


async def seed_feature_flags():
    seeds = [
        {"key": "ar_personalization", "label": "Avatar & AR Personalization",
         "description": "Customize your DIY mentor avatar look, voice & AR overlay style.",
         "icon": "face-man-shimmer-outline", "enabled": True, "rollout_type": "optin", "rollout_value": None},
        {"key": "bulk_buying", "label": "Neighborhood Bulk Buying",
         "description": "Pool orders with neighbors to unlock wholesale pricing on materials.",
         "icon": "cart-arrow-down", "enabled": True, "rollout_type": "optin", "rollout_value": None},
        {"key": "real_estate_mode", "label": "Real Estate / Listing Mode",
         "description": "Turn your home record into a resale-ready report for agents & buyers.",
         "icon": "home-city-outline", "enabled": True, "rollout_type": "optin", "rollout_value": None},
    ]
    for s in seeds:
        if not await db.feature_flags.find_one({"key": s["key"]}):
            await db.feature_flags.insert_one({"id": new_id(), **s, "created_at": now_iso()})
    logger.info("feature flags seeded")




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
        pro_invoice_id = meta.get("pro_invoice_id")
        if pro_invoice_id:
            inv = await db.pro_invoices.find_one({"id": pro_invoice_id})
            if inv and inv.get("status") != "paid":
                await db.pro_invoices.update_one(
                    {"id": pro_invoice_id},
                    {"$set": {"status": "paid", "paid_at": now_iso(), "stripe_session_id": obj.get("id")}},
                )
                fee = int(inv["amount_cents"] * PLATFORM_FEE_PCT)
                await db.pro_profiles.update_one({"user_id": inv["pro_user_id"]}, {"$inc": {"payout_cents": inv["amount_cents"] - fee}})
                if inv.get("pro_user_id"):
                    await emit_event("pro_invoice_paid", inv["pro_user_id"], {"amount_cents": inv["amount_cents"]})
                    await push_notification(inv["pro_user_id"], title="You got paid 💸",
                                            body=f"An invoice was paid. Funds are on the way to your account.",
                                            ntype="project", priority="normal", meta={"invoice_id": inv.get("id")})
        elif uid and tier:
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
    # Loyalty: award in-app credits for a verified conversion (stacks per convert)
    await award_loyalty_credits(rec["referrer_id"], REFERRAL_LOYALTY_CREDITS,
                                "referral_converted", {"referred_id": referred_user_id})


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
        await db.neighborhood_posts.create_index([("neighborhood_key", 1), ("created_at", -1)])
        await db.neighborhood_posts.create_index("id")
        await db.users.create_index("neighborhood_optin")
        await db.pro_profiles.create_index("user_id")
        await db.pro_profiles.create_index("status")
        await db.pro_jobs.create_index([("pro_user_id", 1), ("updated_at", -1)])
        await db.pro_jobs.create_index("client_email")
        await db.pro_jobs.create_index("id")
        await db.pro_invoices.create_index("job_id")
        await db.pro_invoices.create_index("id")
        await db.emergency_events.create_index([("user_id", 1), ("created_at", -1)])
        await db.notifications.create_index([("user_id", 1), ("read", 1), ("created_at", -1)])
        await db.notifications.create_index("meta.campaign_id")
        logger.info("indexes ensured")
    except Exception as e:
        logger.warning(f"index ensure: {e}")


@app.on_event("startup")
async def _startup_seed_community():
    await seed_community()
    await seed_vendors()
    await seed_pros()
    await seed_suppliers()
    await seed_loyalty_campaigns()
    await seed_feature_flags()


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
