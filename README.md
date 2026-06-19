# TCG Graded Price Ticker

Automated **9:16 (TikTok) graded-card price ticker** — render → data → video → publish.

```
src/ticker.html        render engine (infinite scroll, USD+VND, 1080×1920)
data/cards.json        the data (validated against cards.schema.json)
scripts/serve.mjs      static preview server  → npm run serve  (http://localhost:4173)
scripts/validate.mjs   data contract validator → npm run validate
scripts/capture.mjs    record one loop to out/ticker.mp4 → npm run capture
```

## Quick start
```bash
npm install
npx playwright install chromium     # one-time
npm run validate
npm run serve                       # preview at http://localhost:4173
npm run capture                     # → out/ticker.mp4
```

See **CLAUDE.md** for the full handover, design system, data contract, and IP guardrails.

> Prices are estimates / demo data — not financial advice.
