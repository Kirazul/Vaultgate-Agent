---
name: contentanalysis
description: Content extraction and analysis — wisdom extraction from videos, podcasts, articles, and YouTube. Use when the user asks to extract wisdom, analyze content, get insight reports, analyze a video/podcast, extract insights, get key takeaways, or summarize what's interesting in a piece of content.
when_to_use: User wants to extract key insights, wisdom, or takeaways from any content source (YouTube, articles, podcasts, pasted text, files).
license: MIT
---

# Content Analysis — Dynamic Wisdom Extraction

Extract content-adaptive wisdom from any source. Instead of static sections (IDEAS, QUOTES, HABITS…), this skill detects what wisdom domains actually exist in the content and builds custom sections around them.

A programming interview gets "Programming Philosophy" and "Developer Workflow Tips." A business podcast gets "Contrarian Business Takes" and "Money Philosophy." A security talk gets "Threat Model Insights" and "Defense Strategies." The sections adapt because the content dictates them.

## Input Sources

| Source | Method |
|--------|--------|
| YouTube URL | Use `WebFetch` to get the page, extract transcript from the page content or description. If no transcript is available, tell the user. |
| Article URL | `WebFetch` to get the full article text |
| File path | `Read` the file directly |
| Pasted text | Use the text as-is |

## Depth Levels

Default is **Full** if no level is specified.

| Level | Sections | Bullets/Section | Closing Sections | When |
|-------|----------|----------------|-----------------|------|
| **Instant** | 1 | 8 | None | Quick hit. One killer section. |
| **Fast** | 3 | 3 | None | Skim in 30 seconds. |
| **Basic** | 3 | 5 | One-Sentence Takeaway only | Solid overview without the deep cuts. |
| **Full** | 5-12 | 3-15 | All three | The default. Complete extraction. |
| **Comprehensive** | 10-15 | 8-15 | All three + Themes & Connections | Maximum depth. Nothing left behind. |

Invoke with: "extract wisdom (fast)" or "extract wisdom at comprehensive level" or just "extract wisdom" for Full.

## Workflow

### Step 1: Get the Content

Obtain the full text/transcript. For YouTube, use `WebFetch` to get the page and extract the transcript. For articles, `WebFetch` the URL. For files, `Read` them. Save to a working file if large.

### Step 2: Deep Read

Read the entire content. Don't extract yet. Notice:
- What domains of wisdom are present?
- What made you stop and think?
- What's genuinely novel vs. commonly known?
- What quotes land perfectly?

### Step 3: Select Dynamic Sections

Pick sections based on depth level. Requirements:
- Section count follows the depth table above
- Each section must have at least 3 STRONG bullets to justify existing
- Always include "Quotes That Hit Different" if the content has good ones
- Always include "First-Time Revelations" if there are genuinely new ideas
- Section names should be conversational, not academic — "Money Philosophy" not "Financial Considerations"
- Sections should be SPECIFIC to this content. Generic sections = failure.
- Name sections like a magazine editor: "The Death of 80% of Apps" beats "Technology Predictions"

### Step 4: Extract Per Section

For each section, extract 3-15 bullets. Rules:

1. **Write like you'd say it.** Read each bullet aloud. If it sounds like a press release, rewrite it.
2. **8-16 words per sentence.** Mix short with medium and longer. Don't make them all the same length.
3. **Let ideas breathe.** Use periods between thoughts, not em-dashes.
4. **Include the actual detail.** Not "he talked about money" but "a cheeseburger is a cheeseburger no matter how rich you are."
5. **Use the speaker's words when they're good.** If they said something perfectly, use it.
6. **No hedging language.** Not "it was suggested that" or "the speaker noted." Just say the thing.
7. **Capture what made you stop.** Every bullet should be something worth telling someone about.
8. **Vary your openers.** Don't start three bullets the same way.
9. **Capture the human moments.** Burnout stories, moments of doubt, something that moved them.
10. **Insight over inventory.** Go deeper on WHY choices matter.
11. **Specificity is everything.** Give the actual example, not a vague summary.
12. **Tension and surprise.** The best bullets have a contradiction or reversal.
13. **Understated, not clever.** Let the content carry the weight.

### Step 5: Add Closing Sections

Which closing sections depend on depth level:

| Level | Closing Sections |
|-------|-----------------|
| Instant | None |
| Fast | None |
| Basic | One-Sentence Takeaway only |
| Full | One-Sentence Takeaway + If You Only Have 2 Minutes + References & Rabbit Holes |
| Comprehensive | All above + Themes & Connections |

- **One-Sentence Takeaway**: The single most important thing in 15-20 words.
- **If You Only Have 2 Minutes**: The 5-7 absolute must-know points.
- **References & Rabbit Holes**: People, projects, books, tools mentioned that are worth following up on.
- **Themes & Connections** (Comprehensive only): 3-5 throughlines connecting multiple sections.

### Step 6: Quality Check

Before delivering, verify:
- [ ] Sections are specific to THIS content, not generic
- [ ] Every bullet has a specific detail, quote, or insight
- [ ] Section names are conversational and headline-worthy
- [ ] Section count matches the depth level
- [ ] No bullet starts with "The speaker" or "It was noted that"
- [ ] Reading the output makes you want to consume the original content

## Output Format

```markdown
# EXTRACT WISDOM: {Content Title}
> {One-line description of what this is and who's talking}

---

## {Dynamic Section 1 Name}

- {bullet}
- {bullet}
- {bullet}

## {Dynamic Section 2 Name}

- {bullet}
- {bullet}

[... more dynamic sections ...]

---

## One-Sentence Takeaway

{15-20 word sentence}

## If You Only Have 2 Minutes

- {essential point 1}
- {essential point 2}
- {essential point 3}
- {essential point 4}
- {essential point 5}

## References & Rabbit Holes

- **{Name/Project}** — {one-line context of why it's worth looking into}
```
