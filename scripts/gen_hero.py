import asyncio, os, sys
from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-53aB4D488D1993cB7F")
PROMPT = (
    "Crisp, brightly lit flat-lay of recognizable DIY home-improvement tools neatly arranged on a dark "
    "charcoal surface: a bright orange cordless power drill, a hammer, a yellow spirit level, a tape measure, "
    "a paint roller, and a small pile of screws. Vivid colors, clean studio lighting, sharp focus, clearly "
    "readable as a DIY toolkit. The lower portion of the image fades smoothly to pure black. "
    "No people, no text, no words, no logos."
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
