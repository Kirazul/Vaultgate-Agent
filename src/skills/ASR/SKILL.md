---
name: ASR
description: Transcribe speech to text from audio files (and audio tracks of video) — meetings, voice notes, podcasts, interviews. Use when the user wants an audio file turned into text, a transcript, captions, or to extract what was said.
when_to_use: User provides an audio/video file (or path) and wants a text transcript of the speech.
license: MIT
---

# ASR — speech to text

Transcribe audio with the **Transcribe** tool. It uses the provider configured
in Settings (with an audio-transcription model) and handles auth + upload
server-side — do NOT `curl` the API or use `$OPENAI_API_KEY` from the shell (the
key isn't available there).

## Usage

Call the **Transcribe** tool:

- `input` — the audio file path, e.g. `upload/meeting.m4a` (required)
- `output` — optional file to save the transcript to, e.g. `download/transcript.txt`
- `language` — optional ISO code (e.g. `en`) to bias recognition
- `model` — optional transcription model id (defaults to `whisper-1`)

Common audio formats: mp3, m4a, wav, flac, ogg. If no provider is configured (or
it lacks a transcription model), the tool says so and does nothing — tell the
user to set a capable model in Settings → Providers and stop; don't loop.

## Tips

- For **video**, extract the audio first with ffmpeg, then transcribe the file:
  ```bash
  ffmpeg -i ./upload/clip.mp4 -vn -ac 1 -ar 16000 download/audio.wav
  ```
  Then call Transcribe on `download/audio.wav`.
- Large files: split on silence with ffmpeg and transcribe chunks, then concatenate.
- After transcribing, you can summarize/clean the text yourself — no extra skill needed.
