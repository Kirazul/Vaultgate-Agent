---
name: image-generation
description: Generate images from text prompts — illustrations, concept art, icons, hero images, product mockups, textures, og-images. Use when the user asks to create/draw/render/make an image, generate artwork or visuals, or needs a placeholder/asset image for a design or app.
when_to_use: User wants a brand-new image created from a description (not editing an existing one — that's image-edit).
license: MIT
---

# Image generation

Create images from text with the **ImageGenerate** tool. It runs against the
image model configured in Settings (Providers → image role) and calls the
provider for you. Do NOT `curl` the API or use `$OPENAI_API_KEY` from the shell —
the key isn't available there; the tool handles auth server-side.

## Usage

Call the **ImageGenerate** tool:

- `prompt` — the full image description (required)
- `output` — where to save it, e.g. `download/logo.png`
- `size` — optional, e.g. `1024x1024`
- `count` — optional, 1–4 variations

If no image model is configured, the tool says so and does nothing — relay that
to the user (*"Set an image model in Settings → Providers, then try again."*) and
stop; don't retry in a loop. Save outputs under `download/` and link them with
`download/...` markdown links.

## Prompting that works

- **Subject + style + composition + lighting + palette.** "Flat vector icon of a fox, geometric, orange/cream, centered, transparent bg" beats "a fox."
- Name the medium: *flat vector, watercolor, 3D render, pixel art, photoreal, line art*.
- For UI assets, state aspect + use: *"1200×630 og-image, dark, product name centered, subtle gradient."*
- Generate 2–3 variations for important assets, then pick.

## Common jobs

- App/site assets: hero images, og-images, empty-state illustrations, favicons (generate large, downscale).
- Concept/mood exploration before committing to a design.
- Themed placeholders while building, replaced later.

To *edit* an existing image use **image-edit**; to *read* one use **vision**.
