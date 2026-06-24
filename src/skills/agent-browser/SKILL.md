---
name: agent-browser
description: Headless browser automation — navigate, click, type, extract data, fill forms, scrape, test UIs, record sessions, and reverse-engineer websites. Three engines available — agent-browser CLI (fastest, ARIA-tree refs), Stagehand SDK (natural-language + code hybrid with structured extraction), and Browser Use (Python, full autonomous agent loop). Use for invisible/background browser automation, web scraping, structured data extraction, automated form filling, end-to-end testing, session recording, AND reverse engineering / decompiling / cloning / analyzing websites (extracting full source, assets, API calls, tech stack, design tokens, component structure). NOT for visible browser work the user watches (use the Open tool for that).
when_to_use: User wants headless/background/invisible browser automation, web scraping, structured data extraction, automated form filling, session recording, browser-based testing, OR reverse engineering / decompiling / cloning / analyzing a website (extract source, assets, APIs, tech stack, design system, recreate it).
license: MIT
platforms: [linux, macos, windows]
metadata:
  vaultgate:
    tags: [browser, automation, headless, scraping, testing, playwright, stagehand, browser-use, reverse-engineer, decompile, clone-website, analyze-site]
    category: automation
---

# Headless Browser Automation

Three engines for invisible browser work — pick based on the task:

| Engine | Best For | Install | Language |
|--------|----------|---------|----------|
| **agent-browser** (default) | Fast CLI automation, ARIA-tree refs, screenshots, recordings, session state | `npm install -g agent-browser && agent-browser install` | CLI (any) |
| **Stagehand** | Natural-language actions, structured extraction with Zod schemas, AI-resilient selectors | `npm install @browserbasehq/stagehand` | TypeScript |
| **Browser Use** | Full autonomous agent loop, complex multi-step workflows, reasoning-driven navigation | `pip install browser-use` | Python |

> **When NOT to use this skill:** If the user wants to *see* or *watch* something in their browser — "open Brave", "play YouTube", "show me this page" — use the **Open** tool instead. This skill runs invisibly; the user cannot see it.

---

## Engine 1: agent-browser CLI (Default)

The fastest path. Rust-based CLI with accessibility tree snapshots. Ideal for most automation tasks.

### Setup

```bash
agent-browser --version                    # Check if installed
npm install -g agent-browser               # Install globally
agent-browser install --with-deps          # Download Chromium + system deps
```

If install fails (no network, restricted environment), fall back to **WebSearch** + **WebFetch** for read-only tasks.

### Core Workflow

1. Navigate: `agent-browser open <url>`
2. Snapshot: `agent-browser snapshot -i` (returns elements with refs like `@e1`, `@e2`)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

### Commands Quick Reference

```bash
# Navigation
agent-browser open <url>           # Navigate
agent-browser back / forward       # History
agent-browser reload               # Reload
agent-browser close                # Close

# Snapshot (page analysis — ARIA tree)
agent-browser snapshot -i          # Interactive elements only (recommended)
agent-browser snapshot -c          # Compact output
agent-browser snapshot -s "#main"  # Scope to CSS selector

# Interactions (use @refs from snapshot)
agent-browser click @e1            # Click element
agent-browser fill @e2 "text"      # Clear + type into input
agent-browser type @e2 "text"      # Type without clearing
agent-browser press Enter          # Press key
agent-browser press Control+a      # Key combination
agent-browser hover @e1            # Hover
agent-browser select @e1 "value"   # Select dropdown
agent-browser scroll down 500      # Scroll
agent-browser upload @e1 file.pdf  # Upload file
agent-browser check @e1            # Check/uncheck checkbox

# Get information
agent-browser get text @e1         # Element text
agent-browser get html @e1         # innerHTML
agent-browser get value @e1        # Input value
agent-browser get attr @e1 href    # Attribute
agent-browser get title            # Page title
agent-browser get url              # Current URL
agent-browser get count ".item"    # Count elements

# State checks
agent-browser is visible @e1       # Visibility check
agent-browser is enabled @e1       # Enabled check

# Screenshots & PDF
agent-browser screenshot download/agent-browser/page.png
agent-browser screenshot --full download/agent-browser/full.png
agent-browser pdf download/agent-browser/page.pdf

# Video recording
agent-browser record start ./demo.webm
# ... perform actions ...
agent-browser record stop

# Wait
agent-browser wait @e1                  # Wait for element
agent-browser wait 2000                 # Wait ms
agent-browser wait --text "Success"     # Wait for text
agent-browser wait --url "/dashboard"   # Wait for URL
agent-browser wait --load networkidle   # Wait for network idle

# Cookies & storage
agent-browser cookies                   # Get all
agent-browser cookies set name value    # Set
agent-browser storage local             # Get localStorage
agent-browser storage local set k v     # Set

# Session state (persist login across runs)
agent-browser state save auth.json      # Save cookies + storage
agent-browser state load auth.json      # Restore session

# Tabs & frames
agent-browser tab new [url]             # New tab
agent-browser tab 2                     # Switch tab
agent-browser frame "#iframe"           # Enter iframe
agent-browser frame main                # Back to main

# Network interception
agent-browser network route <url> --abort     # Block requests
agent-browser network route <url> --body '{}' # Mock response

# JavaScript execution
agent-browser eval "document.title"

# Semantic locators (alternative to refs)
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"

# Settings
agent-browser set viewport 1920 1080
agent-browser set device "iPhone 14"
agent-browser set media dark

# Parallel sessions
agent-browser --session s1 open site-a.com
agent-browser --session s2 open site-b.com

# Debugging
agent-browser open url --headed         # Show browser window
agent-browser console                   # View console messages
agent-browser highlight @e1             # Highlight element
```

### Example: Login + Scrape

```bash
agent-browser open https://app.example.com/login
agent-browser snapshot -i
# Output: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Sign In" [ref=e3]
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --url "/dashboard"
agent-browser state save auth.json              # Save for reuse
agent-browser snapshot -i                        # Read dashboard
agent-browser screenshot download/agent-browser/dashboard.png
```

---

## Engine 2: Stagehand (AI-Native SDK)

When you need natural-language actions, structured extraction with typed schemas, or AI-resilient selectors that survive DOM changes. Best for scraping complex pages into structured data.

### Setup

```bash
npm install @browserbasehq/stagehand zod
# Or scaffold a new project:
npx create-browser-app
```

### Core Primitives

Stagehand gives you four primitives — **act**, **extract**, **observe**, and **agent**:

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const stagehand = new Stagehand({ env: "LOCAL" }); // or "BROWSERBASE" for cloud
await stagehand.init();
const page = stagehand.page;

// Navigate
await page.goto("https://news.ycombinator.com");

// Act — perform actions with natural language
await stagehand.act("click the login link");
await stagehand.act("type 'myuser' into the username field");
await stagehand.act("click the submit button");

// Extract — pull structured data with Zod schemas
const data = await stagehand.extract({
  instruction: "extract the top 5 stories with title, URL, and points",
  schema: z.object({
    stories: z.array(z.object({
      title: z.string(),
      url: z.string(),
      points: z.number(),
    })),
  }),
});
console.log(JSON.stringify(data, null, 2));

// Observe — find elements matching a description
const elements = await stagehand.observe("find all 'Add to cart' buttons");

// Agent — autonomous multi-step task
const agent = stagehand.agent({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
});
await agent.execute("Search for 'wireless headphones', filter by price under $50, and extract the top 3 results with name, price, and rating");

await stagehand.close();
```

### When to Use Stagehand Over agent-browser

- Extracting structured data from complex pages (tables, product listings, search results)
- Actions where CSS selectors are unreliable (dynamically generated classes, SPAs)
- Multi-step autonomous workflows where the AI needs to reason about what to do next
- Scraping that needs typed output (Zod schemas guarantee shape)

---

## Engine 3: Browser Use (Python Agent Loop)

When you need a full autonomous agent that reasons about what to do next. The AI controls the browser end-to-end — you describe the task, it figures out the steps.

### Setup

```bash
pip install browser-use
playwright install chromium
```

### Usage

```python
from browser_use import Agent
from langchain_openai import ChatOpenAI

agent = Agent(
    task="Go to amazon.com, search for 'noise cancelling headphones', "
         "sort by price low to high, and extract the first 5 results "
         "with name, price, and rating",
    llm=ChatOpenAI(model="gpt-4o"),
)
result = await agent.run()
print(result)
```

### When to Use Browser Use Over Others

- Complex multi-page workflows with branching logic
- Tasks where you can't predict the exact sequence of steps
- Research tasks: "find the cheapest flight from NYC to London next month"
- Workflows that span multiple sites

---

## Choosing the Right Engine

```
User Request
│
├─ Simple automation (fill form, click buttons, take screenshot)?
│  └─ agent-browser CLI (fastest, most reliable)
│
├─ Extract structured data from a page?
│  ├─ Simple table/list → agent-browser get text/html + parse
│  └─ Complex/nested data → Stagehand extract() with Zod schema
│
├─ Multi-step workflow with reasoning?
│  ├─ Predictable steps → agent-browser (scripted sequence)
│  └─ Unpredictable steps → Browser Use agent or Stagehand agent
│
├─ Need to bypass anti-bot / CAPTCHAs?
│  └─ Stagehand with Browserbase cloud (built-in solving)
│
└─ Need session recording / debugging?
   └─ agent-browser record / --headed / trace
```

### Hybrid Approach (Production Best Practice)

Use agent-browser for the 80% of steps that are predictable (navigate, fill, click, screenshot) and Stagehand/Browser Use for the 20% that require AI reasoning (finding the right element on an unfamiliar page, extracting unstructured data, handling unexpected modals).

---

## Cloud Backends (Optional)

For production workloads, anti-detection, or running without a local browser:

| Provider | Engine | Features |
|----------|--------|----------|
| **Browserbase** | Stagehand / agent-browser | Session replay, CAPTCHA solving, residential proxies, stealth mode |
| **Browserless** | Playwright / agent-browser | Managed Chrome, pay-per-session, CDP access |
| **Steel** | Any | Managed browsers with built-in proxy rotation |

```bash
# Browserbase with Stagehand
BROWSERBASE_API_KEY=xxx BROWSERBASE_PROJECT_ID=yyy npx tsx script.ts

# Browserbase with agent-browser
BROWSERBASE_API_KEY=xxx agent-browser open https://example.com
```

---

## Advanced agent-browser Features

### Batch Commands (Chain Multiple Actions)

```bash
agent-browser batch "open https://example.com" "snapshot -i" "screenshot download/agent-browser/page.png"
```

### Annotated Screenshots (Visual + Refs Combined)

```bash
agent-browser screenshot download/agent-browser/annotated.png --annotate
# Saves screenshot WITH element refs overlaid — interact using @ref from the image
```

### HAR Network Recording

```bash
agent-browser network har start                   # Start recording all network traffic
# ... perform actions ...
agent-browser network har stop download/agent-browser/trace.har  # Save HAR file
```

### Network Request Monitoring & Filtering

```bash
agent-browser network requests                     # All tracked requests
agent-browser network requests --filter api        # Filter by URL substring
agent-browser network requests --type xhr           # Filter by resource type
agent-browser network requests --method POST        # Filter by HTTP method
agent-browser network requests --status 4xx         # Filter by status range
```

### Advanced Network Interception (Mock APIs, Block Ads)

```bash
# Block analytics/ads
agent-browser network route "*.google-analytics.com*" --abort
agent-browser network route "*.doubleclick.net*" --abort

# Mock an API response
agent-browser network route "*/api/user" --body '{"name":"Test","role":"admin"}' --status 200

# Intercept and modify (redirect)
agent-browser network route "*/old-api/*" --redirect "https://new-api.example.com"

# Remove all routes
agent-browser network unroute
```

### Real Chrome Profile (Persistent Login, Extensions)

```bash
# Use your actual Chrome profile (keeps logins, cookies, extensions)
agent-browser open https://gmail.com --chrome --profile "Default"

# Use a named Chrome profile
agent-browser open https://dashboard.example.com --chrome --profile "Work"
```

### CDP (Chrome DevTools Protocol) Connection

```bash
# Connect to an already-running Chrome via CDP
agent-browser --cdp 9222 snapshot -i

# Connect to a remote browser
agent-browser --cdp ws://remote-host:9222 open https://example.com
```

### Iframe Handling (Automatic)

```bash
# Snapshots automatically resolve iframe content
agent-browser snapshot -i          # Refs inside iframes carry frame context

# Manually enter/exit iframe
agent-browser frame "#payment-iframe"    # Enter iframe
agent-browser fill @e1 "4242424242424242" # Interact inside iframe
agent-browser frame main                  # Return to main page
```

### File Downloads

```bash
# Trigger download by clicking
agent-browser click @e5                              # Click download button
agent-browser wait 5000                              # Wait for download
# Downloaded files go to the browser's download directory

# Or capture download URL from network
agent-browser network requests --filter ".pdf" --type document
```

### Geolocation & Timezone Spoofing

```bash
agent-browser set geo 48.8566 2.3522                # Paris
agent-browser set timezone "Europe/Paris"
agent-browser set locale "fr-FR"
```

### Performance & Resource Monitoring

```bash
# Measure page load performance
agent-browser eval "JSON.stringify(performance.timing)"

# Get memory usage
agent-browser eval "JSON.stringify(performance.memory)"

# Monitor long tasks
agent-browser eval "new PerformanceObserver(e => console.log(e.getEntries())).observe({type:'longtask'})"
```

### Accessibility Audit

```bash
# Full ARIA tree for accessibility testing
agent-browser snapshot                              # Complete accessibility tree
agent-browser snapshot -d 5                         # Deep tree (5 levels)

# Check specific element accessibility
agent-browser get attr @e1 role
agent-browser get attr @e1 aria-label
agent-browser get attr @e1 aria-describedby
```

### Trace Recording (Playwright Traces)

```bash
agent-browser trace start                           # Start trace recording
# ... perform actions ...
agent-browser trace stop download/agent-browser/trace.zip  # Save trace
# Open with: npx playwright show-trace trace.zip
```

---

## Real-World Recipes

### Recipe 1: E-Commerce Price Monitor

```bash
# Monitor a product price and save history
agent-browser open "https://amazon.com/dp/B0EXAMPLE"
agent-browser wait --load networkidle
agent-browser snapshot -i
PRICE=$(agent-browser get text @e3 --json | python3 -c "import sys,json; print(json.load(sys.stdin)['text'])")
TITLE=$(agent-browser get title --json | python3 -c "import sys,json; print(json.load(sys.stdin)['title'])")
echo "$(date),$TITLE,$PRICE" >> download/agent-browser/price-history.csv
agent-browser screenshot download/agent-browser/price-$(date +%Y%m%d).png
agent-browser close
```

### Recipe 2: Multi-Page Data Scraping

```bash
# Scrape paginated results
agent-browser open "https://example.com/results?page=1"
for page in 1 2 3 4 5; do
  agent-browser wait --load networkidle
  agent-browser snapshot -i --json > download/agent-browser/page-$page.json
  agent-browser screenshot download/agent-browser/page-$page.png
  # Click "Next" if it exists
  agent-browser find text "Next" click 2>/dev/null || break
  agent-browser wait 2000
done
agent-browser close
```

### Recipe 3: Automated Form Fill + File Upload

```bash
agent-browser open "https://apply.example.com/form"
agent-browser snapshot -i
agent-browser fill @e1 "John Doe"                   # Name
agent-browser fill @e2 "john@example.com"            # Email
agent-browser fill @e3 "+1-555-123-4567"             # Phone
agent-browser select @e4 "Engineering"               # Department dropdown
agent-browser check @e5                              # Terms checkbox
agent-browser upload @e6 ./resume.pdf                # File upload
agent-browser screenshot download/agent-browser/form-filled.png
agent-browser click @e7                              # Submit
agent-browser wait --text "Thank you"
agent-browser screenshot download/agent-browser/confirmation.png
agent-browser close
```

### Recipe 4: Login + Authenticated API Scraping

```bash
# Login once, save state, reuse across sessions
agent-browser open "https://app.example.com/login"
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "/dashboard"
agent-browser state save download/agent-browser/auth-state.json

# Later sessions — skip login entirely
agent-browser state load download/agent-browser/auth-state.json
agent-browser open "https://app.example.com/api/data"
agent-browser get text "body"                        # Get API response body
```

### Recipe 5: Visual Regression Testing

```bash
# Take baseline screenshots
for url in "/" "/about" "/pricing" "/contact"; do
  agent-browser open "https://mysite.com$url"
  agent-browser wait --load networkidle
  agent-browser screenshot --full "download/agent-browser/baseline${url//\//-}.png"
done

# After changes — take new screenshots and compare
for url in "/" "/about" "/pricing" "/contact"; do
  agent-browser open "https://staging.mysite.com$url"
  agent-browser wait --load networkidle
  agent-browser screenshot --full "download/agent-browser/current${url//\//-}.png"
done
agent-browser close
# Compare with image diff tools
```

### Recipe 6: Session Recording (Demo/Bug Report)

```bash
agent-browser open "https://app.example.com"
agent-browser record start download/agent-browser/bug-repro.webm
# Reproduce the bug step by step
agent-browser snapshot -i
agent-browser click @e1
agent-browser wait 1000
agent-browser fill @e2 "trigger text"
agent-browser click @e3
agent-browser wait --text "Error"
agent-browser screenshot download/agent-browser/error-state.png
agent-browser console                                # Capture JS errors
agent-browser record stop
agent-browser close
# Delivers: video recording + screenshot + console errors
```

### Recipe 7: PDF Generation from Web Page

```bash
agent-browser open "https://invoice.example.com/INV-2024-001"
agent-browser wait --load networkidle
agent-browser set viewport 1200 1600                 # Portrait ratio
agent-browser pdf download/agent-browser/invoice.pdf
agent-browser close
```

### Recipe 8: Social Media Monitoring

```bash
# Monitor a hashtag/topic across tabs
agent-browser --session twitter open "https://x.com/search?q=%23AI"
agent-browser --session reddit open "https://reddit.com/search/?q=AI"
agent-browser --session hn open "https://hn.algolia.com/?q=AI"

# Snapshot each
agent-browser --session twitter snapshot -i --json > download/agent-browser/twitter.json
agent-browser --session reddit snapshot -i --json > download/agent-browser/reddit.json
agent-browser --session hn snapshot -i --json > download/agent-browser/hn.json
```

### Recipe 9: Automated Testing (E2E)

```bash
agent-browser open "http://localhost:3000"
agent-browser wait --load networkidle

# Test: Login flow
agent-browser find label "Email" fill "test@test.com"
agent-browser find label "Password" fill "Test123!"
agent-browser find role button click --name "Sign In"
agent-browser wait --url "/dashboard"
echo "PASS: Login flow"

# Test: Create item
agent-browser find text "New Item" click
agent-browser find label "Title" fill "Test Item"
agent-browser find role button click --name "Save"
agent-browser wait --text "Test Item"
echo "PASS: Create item"

# Test: Delete item
agent-browser find text "Test Item" click
agent-browser find text "Delete" click
agent-browser wait --text "Item deleted"
echo "PASS: Delete item"

agent-browser close
```

### Recipe 10: Stagehand — Competitive Intelligence

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const stagehand = new Stagehand({ env: "LOCAL" });
await stagehand.init();

// Navigate to competitor's pricing page
await stagehand.page.goto("https://competitor.com/pricing");

// Extract all pricing tiers with AI
const pricing = await stagehand.extract({
  instruction: "Extract all pricing tiers with name, monthly price, annual price, and feature list",
  schema: z.object({
    tiers: z.array(z.object({
      name: z.string(),
      monthlyPrice: z.string(),
      annualPrice: z.string().optional(),
      features: z.array(z.string()),
      highlighted: z.boolean(),
    })),
  }),
});

// Save as JSON
const fs = await import("fs");
fs.writeFileSync("download/agent-browser/competitor-pricing.json", JSON.stringify(pricing, null, 2));
await stagehand.close();
```

### Recipe 11: Browser Use — Research Agent

```python
from browser_use import Agent
from langchain_openai import ChatOpenAI

# Autonomous research across multiple sites
agent = Agent(
    task="""
    Research the top 5 open-source AI browser automation tools in 2026.
    For each tool, find: name, GitHub stars, language, key features, and latest version.
    Compare them in a markdown table. Save the result.
    """,
    llm=ChatOpenAI(model="gpt-4o"),
)
result = await agent.run()

with open("download/agent-browser/research-report.md", "w") as f:
    f.write(result)
```

---

## Website Reverse Engineering & Decompilation

When the user says "reverse engineer this website", "decompile this site", "clone this", "extract everything from this site", "analyze this site's stack", or "recreate this" — run this full pipeline. Combine this skill with Code mode tools (Read, Write, Bash, Grep, WebFetch) for the complete workflow.

### Full Reverse Engineering Pipeline

```
Target URL
│
├─ Phase 1: Reconnaissance (what is it?)
│  ├─ Tech stack detection (frameworks, CDN, CMS, analytics)
│  ├─ Page structure & routes discovery
│  └─ Performance & SEO audit
│
├─ Phase 2: Source Extraction (get everything)
│  ├─ HTML source (full DOM after JS execution)
│  ├─ CSS (all stylesheets, inline styles, computed styles)
│  ├─ JavaScript (all script bundles, source maps if available)
│  ├─ Assets (images, fonts, SVGs, videos, favicons)
│  ├─ API calls (all XHR/fetch requests, payloads, responses)
│  └─ Metadata (og:tags, schema.org, manifest.json, robots.txt)
│
├─ Phase 3: Analysis (understand it)
│  ├─ Component tree (identify reusable UI components)
│  ├─ Design tokens (colors, typography, spacing, shadows, radii)
│  ├─ Layout system (grid/flex patterns, breakpoints, responsive rules)
│  ├─ Interaction patterns (animations, transitions, hover states)
│  └─ State management (cookies, localStorage, sessionStorage, URL params)
│
└─ Phase 4: Reconstruction (rebuild it)
   ├─ Generate clean source code in the user's preferred stack
   ├─ Recreate design system tokens (CSS variables / Tailwind config)
   └─ Deliver assets + source + analysis report
```

### Phase 1: Reconnaissance

```bash
# 1. Get the full rendered HTML (after JS execution)
agent-browser open "https://target-site.com"
agent-browser wait --load networkidle

# 2. Tech stack detection via JS
agent-browser eval "JSON.stringify({
  doctype: document.doctype ? document.doctype.name : 'none',
  generator: document.querySelector('meta[name=generator]')?.content,
  frameworks: {
    react: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || !!document.querySelector('[data-reactroot]'),
    next: !!window.__NEXT_DATA__,
    nuxt: !!window.__NUXT__,
    vue: !!window.__VUE__,
    angular: !!window.ng || !!document.querySelector('[ng-version]'),
    svelte: !!document.querySelector('[class*=svelte]'),
    gatsby: !!window.___gatsby,
    remix: !!window.__remixContext,
    astro: !!document.querySelector('[data-astro-cid]'),
    wordpress: !!document.querySelector('meta[name=generator][content*=WordPress]'),
    shopify: !!window.Shopify,
    webflow: !!document.querySelector('html.w-mod-js'),
  },
  analytics: {
    ga: !!window.gtag || !!window.ga,
    gtm: !!window.google_tag_manager,
    hotjar: !!window.hj,
    segment: !!window.analytics,
    mixpanel: !!window.mixpanel,
    plausible: !!document.querySelector('script[data-domain]'),
  },
  css: {
    tailwind: !!document.querySelector('[class*=\\\"tw-\\\"]') || getComputedStyle(document.body).getPropertyValue('--tw-ring-color') !== '',
    bootstrap: !!document.querySelector('.container-fluid,.row,.col-'),
    materialUI: !!document.querySelector('[class*=MuiBox],[class*=css-]'),
    chakra: !!document.querySelector('[class*=chakra]'),
    antd: !!document.querySelector('.ant-'),
  },
  meta: {
    title: document.title,
    description: document.querySelector('meta[name=description]')?.content,
    ogImage: document.querySelector('meta[property=\\\"og:image\\\"]')?.content,
    viewport: document.querySelector('meta[name=viewport]')?.content,
    charset: document.characterSet,
    lang: document.documentElement.lang,
  }
})"

# 3. Get all routes/links on the site
agent-browser eval "JSON.stringify([...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin)))])"

# 4. Check for source maps
agent-browser eval "JSON.stringify([...document.querySelectorAll('script[src]')].map(s => s.src))"
# Then check each .js URL for sourceMappingURL:
# WebFetch the JS file → grep for //# sourceMappingURL= → fetch the .map file
```

### Phase 2: Source Extraction

```bash
# 1. Full rendered DOM (after JS execution — the REAL page, not just the HTML source)
agent-browser eval "document.documentElement.outerHTML" > download/agent-browser/reverse/index.html

# 2. All stylesheets (external + inline + computed)
agent-browser eval "JSON.stringify([...document.styleSheets].map((s,i) => ({
  href: s.href,
  rules: s.href ? null : [...s.cssRules].map(r => r.cssText).join('\\n')
})))" > download/agent-browser/reverse/stylesheets.json

# For external CSS — fetch each:
# WebFetch each stylesheet URL → save to download/agent-browser/reverse/css/

# 3. All JavaScript bundles
agent-browser eval "JSON.stringify([...document.querySelectorAll('script')].map(s => ({
  src: s.src || null,
  inline: s.src ? null : s.textContent.slice(0, 500),
  type: s.type || 'text/javascript',
  async: s.async, defer: s.defer
})))" > download/agent-browser/reverse/scripts.json

# 4. All assets (images, fonts, SVGs, videos)
agent-browser eval "JSON.stringify({
  images: [...document.querySelectorAll('img')].map(i => ({src: i.src, alt: i.alt, width: i.naturalWidth, height: i.naturalHeight})),
  svgs: [...document.querySelectorAll('svg')].map(s => s.outerHTML.slice(0, 200)),
  videos: [...document.querySelectorAll('video source, video')].map(v => v.src || v.currentSrc),
  fonts: [...document.fonts].map(f => ({family: f.family, weight: f.weight, style: f.style, status: f.status})),
  favicons: [...document.querySelectorAll('link[rel*=icon]')].map(l => ({href: l.href, sizes: l.sizes?.toString()})),
})" > download/agent-browser/reverse/assets.json

# 5. Capture ALL API calls the page makes
agent-browser network har start
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 3000   # Wait for lazy-loaded API calls
agent-browser network har stop download/agent-browser/reverse/network.har

# Also capture filtered API/XHR calls:
agent-browser network requests --type xhr --json > download/agent-browser/reverse/api-calls.json
agent-browser network requests --type fetch --json >> download/agent-browser/reverse/api-calls.json

# 6. Metadata extraction
agent-browser eval "JSON.stringify({
  manifest: document.querySelector('link[rel=manifest]')?.href,
  robots: location.origin + '/robots.txt',
  sitemap: location.origin + '/sitemap.xml',
  openGraph: Object.fromEntries([...document.querySelectorAll('meta[property^=og]')].map(m => [m.getAttribute('property'), m.content])),
  twitter: Object.fromEntries([...document.querySelectorAll('meta[name^=twitter]')].map(m => [m.name, m.content])),
  structuredData: [...document.querySelectorAll('script[type=application/ld+json]')].map(s => JSON.parse(s.textContent)),
})" > download/agent-browser/reverse/metadata.json

# 7. localStorage, sessionStorage, cookies
agent-browser cookies --json > download/agent-browser/reverse/cookies.json
agent-browser storage local --json > download/agent-browser/reverse/localstorage.json
agent-browser eval "JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))" > download/agent-browser/reverse/sessionstorage.json
```

### Phase 3: Design Token Extraction

```bash
# Extract the complete design system from computed styles
agent-browser eval "(function() {
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);

  // Extract CSS custom properties (design tokens)
  const cssVars = {};
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText === ':root' || rule.selectorText === 'html') {
          for (const prop of rule.style) {
            if (prop.startsWith('--')) cssVars[prop] = rule.style.getPropertyValue(prop).trim();
          }
        }
      }
    } catch(e) {} // cross-origin sheets
  }

  // Extract unique colors from all visible elements
  const colors = new Set();
  const fonts = new Set();
  const fontSizes = new Set();
  const borderRadii = new Set();
  const shadows = new Set();
  const spacings = new Set();

  document.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el);
    if (s.color !== 'rgba(0, 0, 0, 0)') colors.add(s.color);
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.add(s.backgroundColor);
    fonts.add(s.fontFamily);
    fontSizes.add(s.fontSize);
    if (s.borderRadius !== '0px') borderRadii.add(s.borderRadius);
    if (s.boxShadow !== 'none') shadows.add(s.boxShadow);
  });

  return JSON.stringify({
    cssVariables: cssVars,
    colors: [...colors].slice(0, 50),
    fonts: [...fonts],
    fontSizes: [...fontSizes].sort(),
    borderRadii: [...borderRadii],
    boxShadows: [...shadows].slice(0, 20),
    bodyStyles: {
      fontFamily: body.fontFamily,
      fontSize: body.fontSize,
      lineHeight: body.lineHeight,
      color: body.color,
      backgroundColor: body.backgroundColor,
    }
  }, null, 2);
})()" > download/agent-browser/reverse/design-tokens.json
```

### Phase 4: Component Structure Analysis

```bash
# Map the component tree (works for React, Vue, Svelte, Web Components)
agent-browser eval "(function() {
  // React component tree
  function getReactTree(el, depth) {
    if (depth > 6) return null;
    const fiber = el._reactFiber || el.__reactFiber$ || Object.keys(el).find(k => k.startsWith('__reactFiber'));
    const fiberObj = fiber ? el[fiber] : null;
    const name = fiberObj?.type?.name || fiberObj?.type?.displayName || null;
    const children = [...el.children].map(c => getReactTree(c, depth+1)).filter(Boolean);
    if (!name && children.length === 0) return null;
    return { component: name, tag: el.tagName.toLowerCase(), classes: el.className?.toString().slice(0,100), children: children.length ? children : undefined };
  }

  // Generic DOM structure (fallback)
  function getDOMTree(el, depth) {
    if (depth > 4) return null;
    const tag = el.tagName?.toLowerCase();
    if (!tag || ['script','style','noscript','svg'].includes(tag)) return null;
    const role = el.getAttribute('role');
    const dataAttrs = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name + '=' + a.value.slice(0,30));
    const children = [...el.children].map(c => getDOMTree(c, depth+1)).filter(Boolean);
    return {
      tag, id: el.id || undefined, role: role || undefined,
      classes: el.className?.toString().split(' ').filter(c => c && !c.match(/^[a-z]{6,}$/)).slice(0,5).join(' ') || undefined,
      dataAttrs: dataAttrs.length ? dataAttrs : undefined,
      children: children.length ? children : undefined
    };
  }

  const tree = getReactTree(document.getElementById('root') || document.getElementById('__next') || document.body, 0)
    || getDOMTree(document.body, 0);
  return JSON.stringify(tree, null, 2);
})()" > download/agent-browser/reverse/component-tree.json
```

### Phase 5: Full-Page Multi-Route Capture

```bash
# Discover all routes, then capture each page
agent-browser open "https://target-site.com"
agent-browser wait --load networkidle

# Get all internal links
ROUTES=$(agent-browser eval "JSON.stringify([...new Set([...document.querySelectorAll('a[href]')].map(a => new URL(a.href, location.origin).pathname).filter(p => !p.match(/\\.(jpg|png|gif|svg|css|js|pdf)$/i)))])" --json)

# Capture each route
mkdir -p download/agent-browser/reverse/pages
for route in $(echo "$ROUTES" | python3 -c "import sys,json; [print(r) for r in json.load(sys.stdin)[:20]]"); do
  SAFE=$(echo "$route" | tr '/' '-' | sed 's/^-//')
  agent-browser open "https://target-site.com${route}"
  agent-browser wait --load networkidle
  agent-browser screenshot --full "download/agent-browser/reverse/pages/${SAFE:-index}.png"
  agent-browser eval "document.documentElement.outerHTML" > "download/agent-browser/reverse/pages/${SAFE:-index}.html"
done
agent-browser close
```

### Reverse Engineering Deliverables

After running the pipeline, deliver to the user:

| Deliverable | Path | What It Contains |
|------------|------|-----------------|
| **Analysis report** | `download/agent-browser/reverse/report.md` | Tech stack, framework, CMS, analytics, CDN, key findings |
| **Full rendered HTML** | `download/agent-browser/reverse/index.html` | Complete DOM after JS execution |
| **Design tokens** | `download/agent-browser/reverse/design-tokens.json` | Colors, fonts, sizes, shadows, radii, CSS variables |
| **Component tree** | `download/agent-browser/reverse/component-tree.json` | UI component hierarchy |
| **API calls** | `download/agent-browser/reverse/api-calls.json` | All XHR/fetch requests with URLs and payloads |
| **Network HAR** | `download/agent-browser/reverse/network.har` | Full network trace (open in Chrome DevTools) |
| **Assets manifest** | `download/agent-browser/reverse/assets.json` | Images, fonts, SVGs, videos with URLs |
| **Metadata** | `download/agent-browser/reverse/metadata.json` | OG tags, structured data, manifest, robots.txt |
| **Screenshots** | `download/agent-browser/reverse/pages/*.png` | Visual capture of every route |
| **Stylesheets** | `download/agent-browser/reverse/stylesheets.json` | All CSS rules (external + inline) |
| **Storage state** | `download/agent-browser/reverse/cookies.json` + `localstorage.json` | All client-side state |

### Cross-Skill Integration

For full site reconstruction after extraction, combine with other skills:

- **Code mode** (Read/Write/Edit/Bash): Reconstruct the site in React/Next.js/Vue from extracted structure
- **charts skill**: Recreate any data visualizations found on the site
- **pdf skill**: Generate a polished analysis report PDF
- **ui-ux-pro-max skill**: Design system audit and improvement recommendations
- **diagrams skill**: Generate architecture diagrams from the component tree

---

## Anti-Detection & Stealth

### Local Stealth

```bash
# Rotate user agent
agent-browser set headers '{"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}'

# Emulate real device
agent-browser set device "iPhone 14 Pro"

# Set realistic viewport
agent-browser set viewport 1920 1080

# Spoof geolocation
agent-browser set geo 40.7128 -74.0060              # New York

# Dark mode (some sites serve different content)
agent-browser set media dark
```

### Cloud Stealth (Browserbase)

```bash
# Residential proxies + anti-fingerprinting + CAPTCHA solving
BROWSERBASE_API_KEY=xxx BROWSERBASE_PROXIES=true BROWSERBASE_ADVANCED_STEALTH=true \
  agent-browser open "https://protected-site.com"
```

### CAPTCHA Handling

- **Browserbase cloud**: Automatic CAPTCHA solving (reCAPTCHA, hCaptcha, Cloudflare Turnstile)
- **CapSolver integration**: `pip install capsolver` for Browser Use scripts
- **Manual fallback**: `agent-browser screenshot` + ask the user to solve visually

---

## What You Can Do (Unlimited Possibilities)

This skill gives you full browser control — anything a human can do in a browser, you can automate:

| Category | Examples |
|----------|---------|
| **Data extraction** | Scrape product catalogs, extract financial data, pull competitor pricing, monitor news feeds, collect research papers |
| **Form automation** | Fill job applications, submit surveys, register accounts, file reports, enter data into CRMs |
| **Testing** | E2E test suites, visual regression, accessibility audits, performance monitoring, broken link checking |
| **Content generation** | Generate PDFs from web pages, take annotated screenshots, record video demos, create HAR traces |
| **Monitoring** | Price tracking, uptime checks, social media monitoring, job board scanning, stock alerts |
| **Research** | Competitive analysis, market research, academic paper collection, patent searches, sentiment analysis |
| **Workflow automation** | Multi-site processes (scrape site A → fill form on site B), data migration, bulk operations |
| **Session management** | Persistent login states, multi-account management, parallel sessions, cookie/storage manipulation |
| **Network analysis** | API response capture, request/response logging, HAR recording, traffic interception, mock server responses |
| **Accessibility** | Full ARIA tree inspection, role/label audits, contrast checking, screen reader simulation |

---

## VaultGate Artifact Rules

- Save all screenshots, PDFs, videos, HAR files, and exports under `download/agent-browser/`
- Link files with `download/agent-browser/...` markdown paths
- For JSON output, add `--json` flag to agent-browser commands
- Stagehand/Browser Use script output: capture stdout and save to files
- Video recordings: `.webm` format, keep under 60s for reasonable file size
- HAR files: useful for debugging API issues, open with Chrome DevTools Network tab

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Element not found | Re-snapshot after navigation. Refs change on page load. |
| Page not loaded | Add `agent-browser wait --load networkidle` after navigation |
| Anti-bot blocking | Use `--chrome --profile` for real fingerprint, or Browserbase cloud |
| Timeout | Increase with `--timeout 60000` (ms) |
| Blank screenshot | Wait for content: `agent-browser wait --load networkidle` first |
| iframe content missing | Use `agent-browser frame "#iframe-id"` to enter, `frame main` to exit |
| Login not persisting | Save state: `agent-browser state save auth.json`, load before next session |
| JS errors on page | Check with `agent-browser console`, may need to wait longer or handle modals |
| Download not starting | Some sites need a real Chrome profile: `--chrome --profile "Default"` |
| CAPTCHA blocking | Use Browserbase cloud (auto-solve) or screenshot + manual solve |
| Memory issues on long sessions | Close and reopen: `agent-browser close && agent-browser open <url>` |
| Parallel sessions interfere | Use `--session name` to isolate each browser instance |
