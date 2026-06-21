import asyncio, os, sys
from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-53aB4D488D1993cB7F")
PROMPT = (
    "Cinematic vertical photograph for a phone app hero background. A confident, happy homeowner in a "
    "bright modern home tackling a DIY home-improvement project — installing or repairing something with "
    "power tools and materials around, tape measure, drill, fresh paint, warm natural daylight. "
    "Aspirational, premium, professional, shallow depth of field, rich warm tones with deep shadows. "
    "Composition leaves the lower third darker and uncluttered for text overlay. No text, no words, no logos."
)

async def main():
    gen = OpenAIImageGeneration(api_key=KEY)
    imgs = await gen.generate_images(prompt=PROMPT, model="gpt-image-1", number_of_images=1)
    if not imgs:
        print("NO_IMAGE"); sys.exit(1)
    out = "/app/frontend/assets/hero-home.png"
    with open(out, "wb") as f:
        f.write(imgs[0])
    print("SAVED", out, os.path.getsize(out))

asyncio.run(main())
