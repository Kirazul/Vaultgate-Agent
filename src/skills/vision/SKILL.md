---
name: vision
description: Understand images and video — describe scenes, OCR text, detect/count objects, compare images, read charts/screenshots, generate alt text. Use whenever the user supplies an image or video (URL or local file) and wants it analyzed, or asks "what's in this", "read the text in", "what does this screenshot show".
when_to_use: User shares or points to an image/video and wants its contents read, described, extracted, compared, or classified.
license: MIT
---

# Vision — image & video understanding

Analyze static images (PNG/JPEG/WebP/GIF/BMP) and video (MP4/MOV/AVI) through the configured multimodal model. Use it for description, OCR, object detection/counting, chart/screenshot reading, comparison, and alt-text.

## Usage

Call the **Vision** tool. It uses the vision model configured in Settings
(Providers → vision role; falls back to the chat model) and handles auth + image
encoding server-side — do NOT `curl` the API or use `$OPENAI_API_KEY` from the
shell (the key isn't available there).

- `prompt` — what to do with the image(s) (required)
- `images` — array of local paths (e.g. `upload/photo.jpg`) and/or `https://` URLs (required)

If no multimodal model is configured (or the model can't see images), the tool
says so and does nothing — tell the user *"Vision needs a multimodal model; pick
one in Settings → Providers, then try again."* and stop. Don't loop.

## Tips

- Be specific in the prompt ("list each object with its location" beats "describe").
- Ask for **structured JSON** when the result feeds code; parse defensively.
- For multi-page documents, prefer the `pdf` skill (text extraction) and only fall back to vision for scanned/image-only pages.
- High-resolution, well-lit images give far better OCR and counting accuracy.
