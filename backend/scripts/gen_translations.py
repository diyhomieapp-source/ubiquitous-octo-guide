"""One-off: translate frontend/src/i18n/locales/en.json into all supported languages.
Run: cd /app/backend && python scripts/gen_translations.py
Uses the Emergent universal key (OpenAI gpt-4o) via emergentintegrations.
"""
import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
LOCALES = Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n" / "locales"

# code -> language name for the prompt
TARGETS = {
    "es": "Spanish", "zh": "Simplified Chinese", "tl": "Tagalog (Filipino)",
    "vi": "Vietnamese", "ar": "Arabic", "fr": "French", "ko": "Korean",
    "ru": "Russian", "ht": "Haitian Creole", "de": "German", "hi": "Hindi",
    "pt": "Brazilian Portuguese", "it": "Italian", "pl": "Polish",
    "ja": "Japanese", "ur": "Urdu", "fa": "Persian (Farsi)",
    "gu": "Gujarati", "bn": "Bengali",
}


async def translate(lang_name: str, en: dict) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    system = (
        "You are a professional app localizer for a DIY home-improvement mobile app called DIYhomie. "
        f"Translate every JSON string VALUE from English into {lang_name}. "
        "Rules: keep the EXACT same JSON structure and keys; do NOT translate keys; "
        "preserve placeholders like {{name}}, {{ref}} and the word 'DIYhomie' verbatim; "
        "keep UPPERCASE strings uppercase where the target script supports case; "
        "use natural, friendly, native phrasing. Respond ONLY with the JSON object, no markdown fences."
    )
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"i18n-{lang_name}", system_message=system).with_model("openai", "gpt-4o")
    out = await chat.send_message(UserMessage(text=json.dumps(en, ensure_ascii=False)))
    txt = out.strip()
    if txt.startswith("```"):
        txt = txt.split("```", 2)[1]
        if txt.startswith("json"):
            txt = txt[4:]
    return json.loads(txt.strip())


async def main():
    en = json.loads((LOCALES / "en.json").read_text())
    for code, name in TARGETS.items():
        target = LOCALES / f"{code}.json"
        try:
            data = await translate(name, en)
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2))
            print(f"OK  {code} ({name})")
        except Exception as e:
            print(f"ERR {code} ({name}): {e}")


if __name__ == "__main__":
    asyncio.run(main())
