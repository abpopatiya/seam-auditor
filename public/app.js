(function () {
  const root = document.getElementById('sa-root');
  const REGISTRY_KEY = 'seam-auditor-registry';

  function uid() { return Math.random().toString(36).slice(2, 10); }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  let state = {
    tab: 'check',
    step: 'input', // 'input' -> 'facts' -> 'results'
    documents: [
      { id: uid(), label: 'Document A', text: '' },
      { id: uid(), label: 'Document B', text: '' },
    ],
    extracting: false,
    facts: [], // { id, source, statement, included }
    checking: false,
    results: null,
    error: null,
    statuses: {},
    registry: [],
    apiKeyMissing: false,
  };

  function loadRegistry() {
    try {
      const raw = localStorage.getItem(REGISTRY_KEY);
      state.registry = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.registry = [];
    }
  }

  function saveRegistry(next) {
    state.registry = next;
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(next));
    render();
  }

  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      state.apiKeyMissing = !data.hasApiKey;
    } catch (e) {
      state.apiKeyMissing = true;
    }
    render();
  }

  function setTab(tab) { state.tab = tab; render(); }

  function updateDocText(id, text) {
    const d = state.documents.find((d) => d.id === id);
    if (d) d.text = text;
  }

  function addDocument() {
    const nextLetter = String.fromCharCode(65 + state.documents.length);
    state.documents.push({ id: uid(), label: `Document ${nextLetter}`, text: '' });
    render();
  }

  function removeDocument(id) {
    state.documents = state.documents
      .filter((d) => d.id !== id)
      .map((d, i) => ({ ...d, label: `Document ${String.fromCharCode(65 + i)}` }));
    render();
  }

  async function extractAll() {
    state.error = null;
    const filled = state.documents.filter((d) => d.text.trim().length > 20);
    if (filled.length < 1) {
      state.error = 'Paste at least one document with real content.';
      render();
      return;
    }
    state.extracting = true;
    state.facts = [];
    render();

    try {
      const allFacts = [];
      for (const doc of filled) {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: doc.label, text: doc.text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Extraction failed for ${doc.label}`);
        (data.facts || []).forEach((f) => allFacts.push({ ...f, included: true }));
      }
      if (allFacts.length < 2) {
        state.error = 'Fewer than two facts were extracted — try pasting more detailed text.';
        state.extracting = false;
        render();
        return;
      }
      state.facts = allFacts;
      state.step = 'facts';
    } catch (e) {
      console.error(e);
      state.error = 'Extraction failed: ' + (e && e.message ? e.message : String(e));
    } finally {
      state.extracting = false;
      render();
    }
  }

  function toggleFact(id) {
    const f = state.facts.find((f) => f.id === id);
    if (f) f.included = !f.included;
    render();
  }

  function removeFact(id) {
    state.facts = state.facts.filter((f) => f.id !== id);
    render();
  }

  function backToInput() {
    state.step = 'input';
    state.facts = [];
    state.results = null;
    render();
  }

  async function runSeamCheck() {
    state.error = null;
    const included = state.facts.filter((f) => f.included);
    if (included.length < 2) {
      state.error = 'Keep at least two facts included to run a seam check.';
      render();
      return;
    }
    state.checking = true;
    state.results = null;
    state.statuses = {};
    render();

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts: included.map((f) => ({ source: f.source, statement: f.statement })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
      state.results = data.findings || [];
      state.step = 'results';
    } catch (e) {
      console.error(e);
      state.error = 'The seam check failed: ' + (e && e.message ? e.message : String(e));
    } finally {
      state.checking = false;
      render();
    }
  }

  function confirmFinding(fid) {
    const finding = (state.results || []).find((f) => f.id === fid);
    if (!finding) return;
    state.statuses[fid] = 'confirmed';
    render();
    const entry = { ...finding, confirmedAt: new Date().toISOString(), regId: uid() };
    saveRegistry([entry, ...state.registry]);
  }

  function dismissFinding(fid) {
    state.statuses[fid] = 'dismissed';
    render();
  }

  function removeFromRegistry(regId) {
    saveRegistry(state.registry.filter((r) => r.regId !== regId));
  }

  function exportRegistry() {
    const lines = state.registry
      .map(
        (r, i) =>
          `${i + 1}. [${(r.risk_level || '').toUpperCase()}] ${(r.facts_involved || []).join(' + ')}\n` +
          `   Shared entity: ${r.shared_entity}\n` +
          `   False merge risk: ${r.false_merge}\n` +
          `   Suggested fix: ${r.suggested_fix}\n`
      )
      .join('\n');
    const blob = new Blob(
      [`SEAM REGISTRY - exported ${new Date().toLocaleDateString()}\n\n${lines}`],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seam-registry.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderCard(f) {
    const status = state.statuses[f.id];
    const hierarchyHtml =
      f.hierarchy_note && f.hierarchy_note !== 'none'
        ? `<div class="sa-card-section">
            <div class="sa-card-section-label">Hierarchy relationship</div>
            <div class="sa-card-section-body">${esc(f.hierarchy_note)}</div>
          </div>`
        : '';

    let actionsHtml = '';
    if (!status) {
      actionsHtml = `<div class="sa-card-actions">
        <button class="sa-btn-confirm" data-action="confirm" data-id="${esc(f.id)}">Confirm - log this risk</button>
        <button class="sa-btn-dismiss" data-action="dismiss" data-id="${esc(f.id)}">Dismiss</button>
      </div>`;
    } else if (status === 'confirmed') {
      actionsHtml = `<span class="sa-status-tag sa-status-confirmed">Added to registry</span>`;
    } else {
      actionsHtml = `<span class="sa-status-tag sa-status-dismissed">Dismissed</span>`;
    }

    const factsInvolvedHtml = (f.facts_involved || [])
      .map((s) => `<div class="sa-fact-quote">"${esc(s)}"</div>`)
      .join('');

    return `<div class="sa-card">
      <div class="sa-card-risk sa-risk-${esc(f.risk_level)}"></div>
      ${status === 'confirmed' ? '<div class="sa-stamp">Logged</div>' : ''}
      <div class="sa-card-inner">
        <div class="sa-card-top">
          <div class="sa-card-title">Facts involved</div>
          <span class="sa-badge sa-badge-${esc(f.risk_level)}">${esc(f.risk_level)} risk</span>
        </div>
        ${factsInvolvedHtml}
        <div class="sa-card-section">
          <div class="sa-card-section-label">Shared entity</div>
          <div class="sa-card-section-body">${esc(f.shared_entity)}</div>
        </div>
        ${hierarchyHtml}
        <div class="sa-card-section">
          <div class="sa-card-section-label">Plausible false merge</div>
          <div class="sa-false-merge">${esc(f.false_merge)}</div>
        </div>
        <div class="sa-card-section">
          <div class="sa-card-section-label">Suggested fix</div>
          <div class="sa-fix">${esc(f.suggested_fix)}</div>
        </div>
        ${actionsHtml}
      </div>
    </div>`;
  }

  function renderRegistryItem(r) {
    return `<div class="sa-registry-item">
      <div class="sa-registry-date">Logged ${new Date(r.confirmedAt).toLocaleDateString()} - ${esc(r.risk_level)} risk</div>
      <div class="sa-card-section">
        <div class="sa-card-section-label">${esc((r.facts_involved || []).join(' + '))}</div>
      </div>
      <div class="sa-card-section">
        <div class="sa-card-section-label">Shared entity</div>
        <div class="sa-card-section-body">${esc(r.shared_entity)}</div>
      </div>
      <div class="sa-card-section">
        <div class="sa-card-section-label">False merge risk</div>
        <div class="sa-false-merge">${esc(r.false_merge)}</div>
      </div>
      <div class="sa-card-section">
        <div class="sa-card-section-label">Suggested fix</div>
        <div class="sa-fix">${esc(r.suggested_fix)}</div>
      </div>
      <div class="sa-card-actions">
        <button class="sa-btn-dismiss" data-action="remove-registry" data-regid="${esc(r.regId)}">Remove from registry</button>
      </div>
    </div>`;
  }

  function renderInputStep() {
    const docsHtml = state.documents
      .map(
        (d) => `<div>
        <div class="sa-row-label">
          <label class="sa-field-label">${esc(d.label)}</label>
          ${state.documents.length > 1 ? `<button class="sa-remove" data-action="remove-doc" data-id="${esc(d.id)}">remove</button>` : ''}
        </div>
        <textarea class="sa-textarea" data-action="doc-text" data-id="${esc(d.id)}" placeholder="Paste a policy document or section here — long blurbs are fine, no need to trim it down yourself.">${esc(d.text)}</textarea>
      </div>`
      )
      .join('');

    return `<div class="sa-body">
      ${docsHtml}
      <button class="sa-add-btn" data-action="add-doc">+ Add another document</button>
      <button class="sa-run-btn" data-action="extract" ${state.extracting ? 'disabled' : ''}>${state.extracting ? 'Extracting facts...' : 'Extract facts'}</button>
      ${state.error ? `<div class="sa-error">${esc(state.error)}</div>` : ''}
      ${state.extracting ? `<div class="sa-loading">Reading each document, pulling out checkable claims...</div>` : ''}
    </div>`;
  }

  function renderFactsStep() {
    const includedCount = state.facts.filter((f) => f.included).length;
    const factsHtml = state.facts
      .map(
        (f) => `<div class="sa-fact-row ${f.included ? '' : 'sa-fact-row-excluded'}">
        <label class="sa-fact-checkbox-label">
          <input type="checkbox" data-action="toggle-fact" data-id="${esc(f.id)}" ${f.included ? 'checked' : ''} />
          <span class="sa-fact-source">${esc(f.source)}</span>
        </label>
        <div class="sa-fact-statement">${esc(f.statement)}</div>
        <button class="sa-fact-remove" data-action="remove-fact" data-id="${esc(f.id)}">✕</button>
      </div>`
      )
      .join('');

    return `<div class="sa-body">
      <div class="sa-step-header">
        <button class="sa-back-btn" data-action="back-to-input">&larr; Back to documents</button>
        <div class="sa-result-count">${state.facts.length} facts extracted, ${includedCount} included</div>
      </div>
      <div class="sa-hint">Review what was pulled out — uncheck or remove anything that looks wrong or irrelevant before checking for seams.</div>
      <div class="sa-facts-list">${factsHtml}</div>
      <button class="sa-run-btn" data-action="check" ${state.checking ? 'disabled' : ''}>${state.checking ? 'Checking...' : `Check ${includedCount} facts for seams`}</button>
      ${state.error ? `<div class="sa-error">${esc(state.error)}</div>` : ''}
      ${state.checking ? `<div class="sa-loading">Comparing every fact against every other fact...</div>` : ''}
    </div>`;
  }

  function renderResultsStep() {
    let resultsHtml = '';
    if (state.results.length === 0) {
      resultsHtml = `<div class="sa-empty">
        <div class="sa-empty-title">Clean</div>
        <div class="sa-empty-sub">No obvious composition risk found among these facts.</div>
      </div>`;
    } else {
      resultsHtml = `<div class="sa-results">
        ${state.results.map(renderCard).join('')}
      </div>`;
    }

    return `<div class="sa-body">
      <div class="sa-step-header">
        <button class="sa-back-btn" data-action="back-to-facts">&larr; Back to facts</button>
        <div class="sa-result-count">${state.results.length} potential seam${state.results.length !== 1 ? 's' : ''} found</div>
      </div>
      ${resultsHtml}
    </div>`;
  }

  function render() {
    let registryHtml = '';
    if (state.registry.length === 0) {
      registryHtml = `<div class="sa-empty">
        <div class="sa-empty-title">Registry is empty</div>
        <div class="sa-empty-sub">Confirmed seams from your checks collect here as a running log of known danger zones.</div>
      </div>`;
    } else {
      registryHtml = `<button class="sa-export-btn" data-action="export">Export registry (.txt)</button>
        ${state.registry.map(renderRegistryItem).join('')}`;
    }

    let checkBody = '';
    if (state.step === 'input') checkBody = renderInputStep();
    else if (state.step === 'facts') checkBody = renderFactsStep();
    else checkBody = renderResultsStep();

    root.innerHTML = `
      <div class="sa-header">
        <div class="sa-eyebrow">Composition Risk Review</div>
        <h1 class="sa-title">Seam Auditor</h1>
        <p class="sa-sub">Paste one or more policy documents. This extracts the individual claims, then checks every claim against every other for places an AI could combine them into something false.</p>
      </div>
      ${state.apiKeyMissing ? `<div class="sa-warning">No Anthropic API key detected on the server. Copy .env.example to .env, add your key, and restart the server.</div>` : ''}
      <div class="sa-tabs">
        <button class="sa-tab ${state.tab === 'check' ? 'active' : ''}" data-action="tab" data-tab="check">Run a Check</button>
        <button class="sa-tab ${state.tab === 'registry' ? 'active' : ''}" data-action="tab" data-tab="registry">Registry (${state.registry.length})</button>
      </div>
      ${state.tab === 'check' ? checkBody : `<div class="sa-body">${registryHtml}</div>`}
    `;

    root.querySelectorAll('[data-action="tab"]').forEach((el) => {
      el.addEventListener('click', () => setTab(el.getAttribute('data-tab')));
    });
    root.querySelectorAll('[data-action="doc-text"]').forEach((el) => {
      el.addEventListener('input', () => updateDocText(el.getAttribute('data-id'), el.value));
    });
    root.querySelectorAll('[data-action="remove-doc"]').forEach((el) => {
      el.addEventListener('click', () => removeDocument(el.getAttribute('data-id')));
    });
    const addBtn = root.querySelector('[data-action="add-doc"]');
    if (addBtn) addBtn.addEventListener('click', addDocument);
    const extractBtn = root.querySelector('[data-action="extract"]');
    if (extractBtn) extractBtn.addEventListener('click', extractAll);
    const backInputBtn = root.querySelector('[data-action="back-to-input"]');
    if (backInputBtn) backInputBtn.addEventListener('click', backToInput);
    const backFactsBtn = root.querySelector('[data-action="back-to-facts"]');
    if (backFactsBtn) backFactsBtn.addEventListener('click', () => { state.step = 'facts'; render(); });
    root.querySelectorAll('[data-action="toggle-fact"]').forEach((el) => {
      el.addEventListener('change', () => toggleFact(el.getAttribute('data-id')));
    });
    root.querySelectorAll('[data-action="remove-fact"]').forEach((el) => {
      el.addEventListener('click', () => removeFact(el.getAttribute('data-id')));
    });
    const checkBtn = root.querySelector('[data-action="check"]');
    if (checkBtn) checkBtn.addEventListener('click', runSeamCheck);
    root.querySelectorAll('[data-action="confirm"]').forEach((el) => {
      el.addEventListener('click', () => confirmFinding(el.getAttribute('data-id')));
    });
    root.querySelectorAll('[data-action="dismiss"]').forEach((el) => {
      el.addEventListener('click', () => dismissFinding(el.getAttribute('data-id')));
    });
    root.querySelectorAll('[data-action="remove-registry"]').forEach((el) => {
      el.addEventListener('click', () => removeFromRegistry(el.getAttribute('data-regid')));
    });
    const exportBtn = root.querySelector('[data-action="export"]');
    if (exportBtn) exportBtn.addEventListener('click', exportRegistry);
  }

  loadRegistry();
  render();
  checkHealth();
})();
