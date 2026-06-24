---
name: finance
description: Equity & market analysis and financial modeling — pull quotes/fundamentals/news, run technical and ratio analysis, and build institutional-quality valuation models (DCF, comps, scenarios) in Excel. Use for stock research, company financials, portfolio questions, valuation, and investment write-ups.
when_to_use: User asks about a stock/company/market, wants financial data analyzed, or wants a valuation/DCF/comps model built.
license: MIT
---

# Finance — research & valuation

No hosted "finance API" is assumed. Get data from real, available sources and do the analysis yourself.

## Getting data (pick what fits)

- **Live quotes, news, filings, qualitative info** → `WebSearch` + `WebFetch` tools (e.g. fetch from Yahoo Finance, company IR pages, SEC EDGAR `https://www.sec.gov/cgi-bin/browse-edgar`).
- **Structured prices/fundamentals in bulk** → Python via Bash. `yfinance` is the workhorse:
  ```bash
  pip install yfinance pandas --quiet
  python -c "import yfinance as yf,sys; t=yf.Ticker('AAPL'); print(t.fast_info); print(t.financials.head())"
  ```
  Also useful: `pandas-datareader`, `stockstats` (technical indicators). Always state the data's as-of date and source.
- Never invent numbers. If you can't fetch a figure, say so and show the gap.

## Analysis toolkit

- **Snapshot:** price, market cap, P/E, EPS, revenue/EPS growth, margins, ROE, debt/equity, FCF.
- **Technicals:** moving averages, RSI, MACD, support/resistance — compute from price history with pandas/stockstats.
- **Comps:** peer table of the same multiples; flag relative cheap/expensive.
- **Risks/catalysts:** read recent filings + news; summarize honestly, both sides.

## Valuation — DCF model in Excel

Build with the **xlsx** skill (the workspace ships the `xlsx` library). Deliver a multi-tab model:

1. **Assumptions** — revenue growth, margins, tax, capex, WACC, terminal growth (each a labeled, editable cell).
2. **FCF build** — Revenue → EBIT → NOPAT → +D&A −Capex −ΔNWC → unlevered FCF, projected 5–10y.
3. **DCF** — discount FCF at WACC; terminal value (Gordon growth and/or exit multiple); EV → equity value → per-share.
4. **Scenarios** — Bear / Base / Bull driven by the assumption cells.
5. **Sensitivity** — 5×5 table: per-share value vs. WACC × terminal growth.

Use real formulas (so cells recompute), label units, and save to `download/<ticker>-dcf.xlsx` with a `workspace-file:` link. End with a short written thesis: value vs. price, key drivers, what would change the call.

## Discipline

Always: cite sources + dates, separate fact from estimate, show the model's assumptions, and add a one-line "not investment advice" note on recommendations.
