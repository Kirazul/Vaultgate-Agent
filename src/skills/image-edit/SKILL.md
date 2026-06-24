---
name: image-edit
description: Edit or transform an existing image — restyle, recolor, inpaint/remove or add elements, change background, upscale-by-redraw, make variations. Use when the user supplies an image and wants it modified rather than described or generated from scratch.
when_to_use: User has an existing image (path or URL) and wants a modified version of it.
license: MIT
---

# Image editing

Transform an existing image with the **ImageEdit** tool. It runs against the
image model configured in Settings (Providers → image role) and handles auth +
upload server-side — do NOT `curl` the API or use `$OPENAI_API_KEY` from the
shell (the key isn't available there).

## Usage

Call the **ImageEdit** tool:

- `prompt` — the change to make (required)
- `input` — the source image path, e.g. `upload/photo.jpg` (required)
- `output` — where to save the result, e.g. `download/edited.png`
- `size` — optional, e.g. `1024x1024`

If no image model is configured, the tool says so and does nothing — tell the
user to set a capable image model in Settings → Providers and stop; don't loop.

## Tips

- Describe the **change**, not the whole scene — "make the jacket red, leave everything else" edits cleanly.
- For inpainting, provide a mask if the provider supports one; otherwise describe the region precisely.
- Edits are generative, not pixel-exact — for deterministic crops/resizes/format changes, use an image library (`sharp` / Python `Pillow`) via Bash instead.
- To create from nothing use **image-generation**; to read an image use **vision**.
