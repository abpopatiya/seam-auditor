require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are a "seam auditor" — you find dangerous compositions in policy documents. A seam is when two individually TRUE policy statements can be wrongly combined by an AI into a THIRD, false rule, especially when they share entities, keywords, or category overlap (e.g. one policy about "all X" and another about a subset of X).

You are NOT looking for internal contradictions within a single policy, and NOT looking for simple sequential/timeline confusion (steps of one process in order). You ARE looking for: two genuinely separate, true statements whose combination could produce a plausible-sounding but FALSE rule.

Return ONLY valid JSON, no markdown fences, no preamble. Format:
{
  "findings": [
    {
      "id": "short-slug",
      "policies_involved": ["Policy A", "Policy B"],
      "shared_entity": "what concept/entity links them",
      "hierarchy_note": "any subset/superset relationship, or 'none' if purely coincidental keyword overlap",
      "false_merge": "the specific plausible false rule an AI could generate",
      "risk_level": "high | medium | low",
      "suggested_fix": "a short, concrete sentence that could be added to the source docs to close this seam"
    }
  ]
}

If you find no genuine seams, return {"findings": []}. Do not invent seams that aren't real composition risks — be conservative and precise, like an auditor, not creative.

Keep every field concise: shared_entity and hierarchy_note under 15 words, false_merge and suggested_fix under 25 words each. Return at most 4 findings, the most important ones only.`;

app.post('/api/analyze', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Server is missing ANTHROPIC_API_KEY. Add it to your .env file (see .env.example) and restart the server.',
    });
  }

  const { policies } = req.body;
  if (!Array.isArray(policies) || policies.length < 2) {
    return res.status(400).json({ error: 'Send at least two policies to compare.' });
  }

  const policyBlock = policies
    .map((p) => `[${p.label}]\n${p.text.trim()}`)
    .join('\n\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Analyze these policies for seams:\n\n${policyBlock}` },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Anthropic API error: ${data?.error?.message || response.statusText}`,
      });
    }

    const text = (data.content || []).map((b) => b.text || '').join('\n');
    const cleaned = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(502).json({
        error: 'Model response was not valid JSON. Try again, or shorten the policy text.',
        raw: cleaned.slice(0, 500),
      });
    }

    res.json({ findings: parsed.findings || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server failed to reach Anthropic API: ' + err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(ANTHROPIC_API_KEY) });
});

app.listen(PORT, () => {
  console.log(`Seam Auditor running at http://localhost:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.');
  }
});
