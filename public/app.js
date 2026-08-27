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
    policies: [
      { id: uid(), label: 'Policy A', text: '' },
      { id: uid(), label: 'Policy B', text: '' },
    ],
    loading: false,
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

  function updatePolicyText(id, text) {
    const p = state.policies.find((p) => p.id === id);
    if (p) p.text = text;
  }

  function addPolicy() {
    const nextLetter = String.fromCharCode(65 + state.policies.length);
    state.policies.push({ id: uid(), label: `Policy ${nextLetter}`, text: '' });
    render();
  }

  function removePolicy(id) {
    state.policies = state.policies
      .filter((p) => p.id !== id)
      .map((p, i) => ({ ...p, label: `Policy ${String.fromCharCode(65 + i)}` }));
    render();
  }

  async function runCheck() {
    state.error = null;
    const filled = state.policies.filter((p) => p.text.trim().length > 10);
    if (filled.length < 2) {
      state.error = 'Add at least two policies with real content before running a check.';
      render();
      return;
    }
    state.loading = true;
    state.results = null;
    state.statuses = {};
    render();

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policies: filled.map((p) => ({ label: p.label, text: p.text })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      state.results = data.findings || [];
    } catch (e) {
      console.error(e);
      state.error = 'The analysis failed: ' + (e && e.message ? e.message : String(e));
    } finally {
      state.loading = false;
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
          `${i + 1}. [${(r.risk_level || '').toUpperCase()}] ${(r.policies_involved || []).join(' + ')}\n` +
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

    return `<div class="sa-card">
      <div class="sa-card-risk sa-risk-${esc(f.risk_level)}"></div>
      ${status === 'confirmed' ? '<div class="sa-stamp">Logged</div>' : ''}
      <div class="sa-card-inner">
        <div class="sa-card-top">
          <div class="sa-card-title">${esc((f.policies_involved || []).join(' + '))}</div>
          <span class="sa-badge sa-badge-${esc(f.risk_level)}">${esc(f.risk_level)} risk</span>
        </div>
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
        <div class="sa-card-section-label">${esc((r.policies_involved || []).join(' + '))} - shared entity</div>
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

  function render() {
    const policiesHtml = state.policies
      .map(
        (p) => `<div>
        <div class="sa-row-label">
          <label class="sa-field-label">${esc(p.label)}</label>
          ${state.policies.length > 2 ? `<button class="sa-remove" data-action="remove-policy" data-id="${esc(p.id)}">remove</button>` : ''}
        </div>
        <textarea class="sa-textarea" data-action="policy-text" data-id="${esc(p.id)}" placeholder="Paste the policy text here.">${esc(p.text)}</textarea>
      </div>`
      )
      .join('');

    let resultsHtml = '';
    if (state.results && !state.loading) {
      if (state.results.length === 0) {
        resultsHtml = `<div class="sa-results">
          <div class="sa-result-count">No seams flagged</div>
          <div class="sa-empty">
            <div class="sa-empty-title">Clean</div>
            <div class="sa-empty-sub">No obvious composition risk found. Try a more overlapping pair, or add a third policy.</div>
          </div>
        </div>`;
      } else {
        resultsHtml = `<div class="sa-results">
          <div class="sa-result-count">${state.results.length} potential seam${state.results.length > 1 ? 's' : ''} found</div>
          ${state.results.map(renderCard).join('')}
        </div>`;
      }
    }

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

    root.innerHTML = `
      <div class="sa-header">
        <div class="sa-eyebrow">Composition Risk Review</div>
        <h1 class="sa-title">Seam Auditor</h1>
        <p class="sa-sub">Paste two or more real policy statements. This flags places where an AI could blend them into a rule that sounds true but isn't - then helps you log the ones worth fixing.</p>
      </div>
      ${state.apiKeyMissing ? `<div class="sa-warning">No Anthropic API key detected on the server. Copy .env.example to .env, add your key, and restart the server.</div>` : ''}
      <div class="sa-tabs">
        <button class="sa-tab ${state.tab === 'check' ? 'active' : ''}" data-action="tab" data-tab="check">Run a Check</button>
        <button class="sa-tab ${state.tab === 'registry' ? 'active' : ''}" data-action="tab" data-tab="registry">Registry (${state.registry.length})</button>
      </div>
      ${
        state.tab === 'check'
          ? `<div class="sa-body">
          ${policiesHtml}
          <button class="sa-add-btn" data-action="add-policy">+ Add another policy</button>
          <button class="sa-run-btn" data-action="run" ${state.loading ? 'disabled' : ''}>${state.loading ? 'Checking...' : 'Check for seams'}</button>
          ${state.error ? `<div class="sa-error">${esc(state.error)}</div>` : ''}
          ${state.loading ? `<div class="sa-loading">Reading each policy, comparing entities across all pairs...</div>` : ''}
          ${resultsHtml}
        </div>`
          : `<div class="sa-body">${registryHtml}</div>`
      }
    `;

    root.querySelectorAll('[data-action="tab"]').forEach((el) => {
      el.addEventListener('click', () => setTab(el.getAttribute('data-tab')));
    });
    root.querySelectorAll('[data-action="policy-text"]').forEach((el) => {
      el.addEventListener('input', () => updatePolicyText(el.getAttribute('data-id'), el.value));
    });
    root.querySelectorAll('[data-action="remove-policy"]').forEach((el) => {
      el.addEventListener('click', () => removePolicy(el.getAttribute('data-id')));
    });
    const addBtn = root.querySelector('[data-action="add-policy"]');
    if (addBtn) addBtn.addEventListener('click', addPolicy);
    const runBtn = root.querySelector('[data-action="run"]');
    if (runBtn) runBtn.addEventListener('click', runCheck);
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
