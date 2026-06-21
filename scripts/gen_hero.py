import asyncio, os, sys
from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-53aB4D488D1993cB7F")
PROMPT = (
    "Moody atmospheric still life of DIY home-improvement tools — a cordless power drill, hammer, "
    "measuring tape, screws and freshly cut wood on a dark wooden workbench. Dramatic warm rim lighting "
    "from one side, deep charcoal background fading to pure black at the edges and bottom. Cinematic, "
    "premium, high detail, no people, no text, no words, no logos."
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
