require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function callClaude(systemPrompt, userMessage, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const err = new Error(`Anthropic API error: ${data?.error?.message || response.statusText}`);
    err.status = response.status;
    throw err;
  }

  const text = (data.content || []).map((b) => b.text || '').join('\n');
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

// ---------- STAGE 1: Extraction ----------
// Turns a long, messy policy document into a list of short, atomic, checkable claims.

const EXTRACTION_PROMPT = `You extract atomic, checkable claims from a policy document.

Break the text into short, independent factual statements about rules, eligibility, durations, conditions, or exceptions. Each statement should:
- Stand alone (make sense without reading the rest of the document)
- Cover exactly ONE rule or condition — split compound sentences into separate facts if they contain more than one rule
- Stay close to the original wording — do not add interpretation or combine facts from different sentences
- Be under 25 words

Ignore boilerplate, definitions of terms, and legal filler that isn't itself a rule (e.g. skip "This Agreement governs your use of..." but keep "Free Plan accounts expire after six months").

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "facts": [
    { "id": "f1", "statement": "..." }
  ]
}

Extract at most 12 facts. Prioritize the ones most likely to state a specific number, deadline, eligibility condition, or exception — those are the ones that create real risk if misapplied.`;

app.post('/api/extract', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Server is missing ANTHROPIC_API_KEY. Add it to your .env file and restart the server.',
    });
  }

  const { label, text } = req.body;
  if (!text || text.trim().length < 20) {
    return res.status(400).json({ error: 'Paste a longer document to extract facts from.' });
  }

  try {
    const parsed = await callClaude(
      EXTRACTION_PROMPT,
      `Document label: ${label || 'Document'}\n\nText:\n${text.trim()}`,
      1500
    );
    const facts = (parsed.facts || []).map((f, i) => ({
      id: `${(label || 'doc').replace(/\s+/g, '_')}_${i}_${Date.now().toString(36)}`,
      source: label || 'Document',
      statement: f.statement,
    }));
    res.json({ facts });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Extraction failed.' });
  }
});

// ---------- STAGE 2: Seam-checking ----------
// Compares a whole set of atomic facts (possibly from many documents) against each
// other for composition risk — not just a single pair.

const SEAM_PROMPT = `You are a "seam auditor" — you find dangerous compositions across a set of atomic policy facts. A seam is when two individually TRUE facts can be wrongly combined by an AI into a THIRD, false rule — especially when they share entities, keywords, or category overlap (e.g. one fact about "all X" and another about a subset of X).

You are given a numbered list of facts, each tagged with its source document. Compare facts ACROSS the whole list — including facts from the same document and facts from different documents — looking for pairs (or small groups) that could be wrongly merged.

You are NOT looking for: internal contradictions restated as different facts, or simple sequential/timeline steps of one continuous process. You ARE looking for: genuinely separate, true facts whose combination could produce a plausible-sounding but FALSE rule.

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "findings": [
    {
      "id": "short-slug",
      "facts_involved": ["exact statement text of fact 1", "exact statement text of fact 2"],
      "shared_entity": "what concept/entity links them",
      "hierarchy_note": "any subset/superset relationship, or 'none' if purely coincidental keyword overlap",
      "false_merge": "the specific plausible false rule an AI could generate",
      "risk_level": "high | medium | low",
      "suggested_fix": "a short, concrete sentence that could be added to the source docs to close this seam"
    }
  ]
}

If you find no genuine seams, return {"findings": []}. Be conservative and precise, like an auditor, not creative. Keep shared_entity and hierarchy_note under 15 words, false_merge and suggested_fix under 25 words each. Return at most 6 findings, the most important ones only.`;

app.post('/api/analyze', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Server is missing ANTHROPIC_API_KEY. Add it to your .env file and restart the server.',
    });
  }

  const { facts } = req.body;
  if (!Array.isArray(facts) || facts.length < 2) {
    return res.status(400).json({ error: 'Need at least two facts to compare.' });
  }

  const factList = facts
    .map((f, i) => `${i + 1}. [${f.source}] ${f.statement}`)
    .join('\n');

  try {
    const parsed = await callClaude(
      SEAM_PROMPT,
      `Facts to compare:\n\n${factList}`,
      2500
    );
    res.json({ findings: parsed.findings || [] });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Seam check failed.' });
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
