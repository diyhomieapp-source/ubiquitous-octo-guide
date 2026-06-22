import os
import json
import base64
import uuid
import logging
import re
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
import jwt
import httpx
import asyncio
import stripe
from fastapi import Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from urllib.parse import quote
from passlib.context import CryptContext

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
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    token = create_token(user["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@api_router.post("/auth/login")
async def login(req: LoginReq):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not pwd_context.verify(req.password, user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
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
            "created_at": now_iso(),
        }
        await db.users.insert_one(user)
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
    items = []
    for t in project.get("missing_supplies", []):
        q = t.replace(" ", "+")
        items.append({
            "name": t,
            "url": f"https://www.amazon.com/s?k={q}&tag={AMAZON_TAG}",
        })
    bundle_q = "+".join((s.replace(" ", "+") for s in project.get("missing_supplies", [])))
    bundle_url = f"https://www.amazon.com/s?k={bundle_q}&tag={AMAZON_TAG}" if bundle_q else ""
    return {"items": items, "bundle_url": bundle_url, "project_title": project["title"]}


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


async def _activate_subscription(user_id: str, tier: str, subscription_id: Optional[str]):
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
        await _activate_subscription(tx["user_id"], tx["tier"], sub_id)
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
            await _activate_subscription(u["id"], u.get("subscription_tier", "pro"), sub_id)
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


# ---------------------------------------------------------------- SEO blog (viral growth loop)
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


@api_router.get("/blog")
async def list_blog(limit: int = 24, category: Optional[str] = None, q: Optional[str] = None):
    query: dict = {"published": True}
    if category:
        query["category"] = category
    if q:
        query["$or"] = [{"title": {"$regex": q, "$options": "i"}},
                        {"keywords": {"$regex": q, "$options": "i"}},
                        {"product": {"$regex": q, "$options": "i"}}]
    cur = db.blog_posts.find(query, {"_id": 0, "overview": 0, "steps": 0}).sort("created_at", -1).limit(min(limit, 100))
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


def _build_post_html(post: dict, base: str, canonical: str) -> str:
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
    return HTMLResponse(_build_post_html(post, base, canonical))


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


@api_router.get("/")
async def root():
    return {"message": "DIYhomie API", "brain": "perplexity" if PERPLEXITY_API_KEY else "fallback-openai"}


app.include_router(api_router)

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
