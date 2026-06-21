import asyncio, os, sys
from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-53aB4D488D1993cB7F")
PROMPT = (
    "Mobile app icon logo of a friendly, confident master contractor mascot. "
    "A cheerful man wearing a bright safety-orange hard hat, giving a reassuring thumbs up, "
    "warm trustworthy smile, modern clean flat vector mascot illustration with bold simple shapes, "
    "centered, on a solid safety-orange (#FF5A00) rounded-square background, white and dark-charcoal mascot, "
    "high contrast, professional brand mark, no text, no words, no letters."
)

async def main():
    gen = OpenAIImageGeneration(api_key=KEY)
    imgs = await gen.generate_images(prompt=PROMPT, model="gpt-image-1", number_of_images=1)
    if not imgs:
        print("NO_IMAGE"); sys.exit(1)
    out = "/app/frontend/assets/logo-contractor.png"
    with open(out, "wb") as f:
        f.write(imgs[0])
    print("SAVED", out, os.path.getsize(out))

asyncio.run(main())
