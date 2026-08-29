# Seam Auditor

A small tool that flags **composition risk** in policy documents — cases where two individually
true policy statements can be wrongly combined by an AI into a third, false rule.

## The problem

Most AI safety tooling checks whether an answer is *grounded* — did it come from a real, retrieved
source? That check misses a real failure mode: an AI can combine two completely real, correctly
retrieved facts into something false, simply because they share an entity or keyword.

Example, using AWS's own public docs:

- **Fact A:** Accounts created before July 15, 2025 get 12 months of EC2 Free Tier on t2.micro/t3.micro.
- **Fact B:** Accounts created on or after July 15, 2025 get 6 months of EC2 Free Tier on a different,
  broader set of instance types.

Both are true. An AI answering a support question could easily blend them into: *"EC2 Free Tier
lasts 6 months for all accounts"* — wrong for anyone in the first cohort, and a real, costly support
error. Every fact used would still be real and "grounded" — the error is in the composition, not
the source.

This tool exists to catch that category of risk before it ships, and to build a running, reviewable
log of confirmed seams (with a human confirming each one — see "Why human-in-the-loop" below).

## How it works

1. Paste one or more full policy documents (long blurbs are fine — no need to manually trim them).
2. Click **Extract facts** — the backend sends each document to Claude with a prompt built to pull
   out short, atomic, checkable claims (rules, deadlines, eligibility conditions, exceptions),
   ignoring boilerplate.
3. Review the extracted facts. Uncheck or remove anything that looks wrong or irrelevant before
   moving on — this is the human-verification step, since extraction can occasionally miss nuance.
4. Click **Check for seams** — every included fact (across all documents) is compared against every
   other fact for composition risk, not just a single pair you happened to paste together.
5. Each flagged finding shows the facts involved, the shared entity, any hierarchy relationship
   (e.g. "Basic Economy" is a subset of "all ticket types"), the plausible false merge, a risk
   level, and a suggested fix sentence you could paste into the source docs.
6. Confirm or dismiss each finding. Confirmed ones are saved to a local **registry** — your own
   running record of known danger zones, exportable as a text file.

## Why human-in-the-loop

An AI judging another AI's output shares the same blind spots as the AI it's checking — it can be
fooled by fluent, plausible-sounding text just like the original model was. This tool treats the
model's output as a *flag for review*, not a verdict. You decide what's a real risk. That mirrors
how audit and financial controls already work: automated systems surface anomalies, a person makes
the final call.

## Setup

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
git clone <your-repo-url>
cd seam-auditor
npm install
cp .env.example .env
```

Open `.env` and add your own Anthropic API key (get one at
[console.anthropic.com](https://console.anthropic.com/settings/keys)).

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
seam-auditor/
├── server.js           # Express backend — /api/extract pulls atomic facts, /api/analyze checks them for seams
├── public/
│   ├── index.html       # Page shell
│   ├── styles.css        # All styling
│   └── app.js            # Frontend logic — two-step flow, state, rendering, localStorage registry
├── .env.example          # Template for your API key
└── package.json
```

## Known limitations

- The model is asked to find seams conservatively, but it can still miss subtle ones or flag
  low-value ones — this is a review aid, not a guarantee. Reviewing extracted facts before running
  the seam check is part of the design, not an afterthought.
- Detecting a hierarchy relationship (e.g. "Basic Economy" ⊂ "all ticket types") relies on the
  model's general knowledge, not a maintained category map. A more robust version would maintain
  an explicit entity hierarchy per domain rather than relying on the model to infer it each time.
- Registry is stored in browser `localStorage` — it's per-browser, not synced anywhere. Good enough
  for personal use; a real multi-user version would need a proper database.
- Extraction and seam-checking are two separate API calls per run — this is more accurate than
  doing both in one shot, but means each full check costs two model calls instead of one.

## Possible next steps

- Let a policy be pulled directly from a URL (currently requires pasting text).
- Check a newly extracted fact against the *entire* registry of previously confirmed facts, not
  just the facts extracted in the current session.
- Maintain explicit category/hierarchy maps per domain instead of relying on model inference.
- Allow editing an extracted fact's wording directly, not just removing it.

## License

MIT
