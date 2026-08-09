/* ============ AI Call Assistant — frontend logic (vanilla JS) ============ */
const LS = { token: 'cai_token', api: 'cai_api' };

const state = {
  api: localStorage.getItem(LS.api) || (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '',
  token: localStorage.getItem(LS.token) || '',
  settings: null,
  calls: [],
  selected: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.className = 'toast'), 3200);
}

async function api(path, options = {}) {
  if (!state.api) throw new Error('Backend URL is not set');
  const res = await fetch(state.api.replace(/\/+$/, '') + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired — please sign in again');
  }
  const text = await res.text();
  const data = text && text.trim().startsWith('{') ? JSON.parse(text) : text;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* ---------------------------- auth ---------------------------- */

$('#login-api').value = state.api;

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#login-msg');
  msg.className = 'form-msg';
  msg.textContent = 'Signing in…';
  const apiInput = $('#login-api').value.trim();
  if (apiInput) {
    state.api = apiInput;
    localStorage.setItem(LS.api, apiInput);
  }
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#login-user').value, password: $('#login-pass').value }),
    });
    state.token = data.token;
    localStorage.setItem(LS.token, data.token);
    enterApp();
  } catch (err) {
    msg.className = 'form-msg err';
    msg.textContent = err.message;
  }
});

function logout() {
  state.token = '';
  localStorage.removeItem(LS.token);
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}

$('#logout').addEventListener('click', logout);

/* ---------------------------- tabs ---------------------------- */

$$('.nav-item').forEach((btn) =>
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    $$('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'calls') loadCalls();
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'ai') loadTemplates();
    if (btn.dataset.tab === 'deploy') loadWebhooks();
  })
);

/* ---------------------------- settings ---------------------------- */

function fillSettings(s) {
  state.settings = s;
  $$('[data-field]').forEach((el) => {
    const v = s[el.dataset.field];
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else if (el.type === 'password') el.value = '';
    else el.value = v ?? '';
  });
  $$('[data-list]').forEach((el) => {
    el.value = (s[el.dataset.list] || []).join('\n');
  });
  $('#temp-val').textContent = s.temperature;
}

$('#temp').addEventListener('input', (e) => ($('#temp-val').textContent = e.target.value));

function collectSettings() {
  const out = {};
  $$('[data-field]').forEach((el) => {
    const f = el.dataset.field;
    if (el.type === 'checkbox') out[f] = el.checked;
    else if (el.type === 'number' || el.type === 'range') out[f] = Number(el.value);
    else if (el.type === 'password') { if (el.value.trim()) out[f] = el.value.trim(); }
    else out[f] = el.value;
  });
  $$('[data-list]').forEach((el) => {
    out[el.dataset.list] = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
  });
  return out;
}

$$('[data-save]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      fillSettings(await api('/api/settings', { method: 'PUT', body: JSON.stringify(collectSettings()) }));
      toast('Saved');
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  })
);

$('#test-creds').addEventListener('click', async () => {
  const box = $('#creds-result');
  box.classList.remove('hidden');
  box.textContent = 'Testing…';
  try {
    const r = await api('/api/settings/test', { method: 'POST' });
    box.textContent =
      `Twilio: ${r.twilio.ok ? `OK — ${r.twilio.friendlyName} (${r.twilio.status})` : `FAILED — ${r.twilio.error}`}\n` +
      `Gemini: ${r.gemini.ok ? `OK — replied "${r.gemini.reply}"` : `FAILED — ${r.gemini.error}`}`;
  } catch (e) {
    box.textContent = e.message;
  }
});

async function loadWebhooks() {
  try {
    const w = await api('/api/settings/webhooks');
    $('#webhooks').innerHTML = Object.entries(w)
      .map(([k, v]) => `<div><span>${k}</span><code>${v}</code></div>`)
      .join('');
  } catch (e) {
    $('#webhooks').textContent = e.message;
  }
}

/* ---------------------------- health ---------------------------- */

async function loadHealth() {
  try {
    const h = await api('/api/health');
    const c = h.configured;
    $('#health').innerHTML = `DB: <b>${h.db}</b><br>Twilio: <b>${c.twilio ? 'ready' : 'missing'}</b><br>Gemini: <b>${c.gemini ? 'ready' : 'missing'}</b>`;
  } catch (e) {
    $('#health').innerHTML = `<b>offline</b><br>${e.message}`;
  }
}

/* ---------------------------- dashboard ---------------------------- */

async function loadDashboard() {
  try {
    const a = await api('/api/analytics');
    $('#stat-grid').innerHTML = [
      ['Total calls', a.total],
      ['Today', a.today],
      ['Last 30 days', a.last30],
      ['Avg duration', `${a.avgDuration}s`],
      ['Avg lead score', a.avgLeadScore ?? '—'],
    ]
      .map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`)
      .join('');

    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push([d, a.byDay[d] || 0]);
    }
    const max = Math.max(1, ...days.map((d) => d[1]));
    $('#chart-days').innerHTML = days
      .map(([d, n]) => `<div class="bar" style="height:${(n / max) * 100}%" data-label="${d}: ${n}"></div>`)
      .join('');

    const totalS = Object.values(a.bySentiment).reduce((x, y) => x + y, 0) || 1;
    $('#chart-sentiment').innerHTML =
      Object.entries(a.bySentiment)
        .map(
          ([k, v]) =>
            `<div class="lrow"><span class="pill ${k}">${k}</span><div class="track"><div class="fill" style="width:${(v / totalS) * 100}%"></div></div><b>${v}</b></div>`
        )
        .join('') || '<p class="muted">No analysed calls yet.</p>';

    $('#top-intents').innerHTML =
      a.topIntents.map(([k, v]) => `<li>${k} — <b>${v}</b></li>`).join('') || '<li class="muted">No data yet</li>';

    const recent = await api('/api/calls?limit=6');
    $('#recent-list').innerHTML = recent.items.length
      ? recent.items.map(callRow).join('')
      : '<p class="muted">No calls recorded yet. Point your Twilio number at the webhook URL to get started.</p>';
  } catch (e) {
    toast(e.message, true);
  }
}

$('#refresh-dash').addEventListener('click', loadDashboard);

$('#ask-btn').addEventListener('click', async () => {
  const q = $('#ask-input').value.trim();
  if (!q) return;
  const box = $('#ask-answer');
  box.classList.remove('hidden');
  box.textContent = 'Thinking…';
  try {
    const r = await api('/api/actions/ask', { method: 'POST', body: JSON.stringify({ question: q }) });
    box.textContent = r.answer || 'No answer returned.';
  } catch (e) {
    box.textContent = e.message;
  }
});

/* ---------------------------- calls ---------------------------- */

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function callRow(c) {
  const when = new Date(c.createdAt).toLocaleString();
  const snippet = c.summary || (c.transcript || '').replace(/\n/g, ' ') || 'No transcript';
  return `<div class="item" data-id="${c._id}">
    <div class="top"><span>${c.starred ? '★ ' : ''}${esc(c.from || 'unknown')}</span>
      <span class="pill ${esc(c.sentiment || '')}">${esc(c.sentiment || c.handledBy)}</span></div>
    <div class="sub">${when} · ${c.durationSeconds || 0}s · ${esc(c.handledBy)}</div>
    <div class="snip">${esc(snippet)}</div>
  </div>`;
}

async function loadCalls() {
  const params = new URLSearchParams({ limit: '100' });
  if ($('#f-q').value.trim()) params.set('q', $('#f-q').value.trim());
  if ($('#f-sentiment').value) params.set('sentiment', $('#f-sentiment').value);
  if ($('#f-handled').value) params.set('handledBy', $('#f-handled').value);
  if ($('#f-starred').checked) params.set('starred', 'true');
  try {
    const data = await api(`/api/calls?${params}`);
    state.calls = data.items;
    $('#calls-list').innerHTML = data.items.length
      ? data.items.map(callRow).join('')
      : '<p class="muted">No calls match these filters.</p>';
  } catch (e) {
    toast(e.message, true);
  }
}

['#f-q', '#f-sentiment', '#f-handled', '#f-starred'].forEach((sel) => {
  const el = $(sel);
  const ev = el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change';
  let t;
  el.addEventListener(ev, () => {
    clearTimeout(t);
    t = setTimeout(loadCalls, 280);
  });
});

$('#reload-calls').addEventListener('click', loadCalls);

$('#export-csv').addEventListener('click', async () => {
  try {
    const res = await fetch(`${state.api.replace(/\/+$/, '')}/api/calls/export/csv`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calls.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast(e.message, true);
  }
});

document.addEventListener('click', (e) => {
  const item = e.target.closest('.item[data-id]');
  if (item) showCall(item.dataset.id);
});

async function showCall(id) {
  $$('.item').forEach((i) => i.classList.toggle('sel', i.dataset.id === id));
  const box = $('#call-detail');
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const c = await api(`/api/calls/${id}`);
    state.selected = c;
    const kv = [
      ['From', c.from],
      ['To', c.to],
      ['When', new Date(c.createdAt).toLocaleString()],
      ['Duration', `${c.durationSeconds || 0}s`],
      ['Handled by', c.handledBy],
      ['Status', c.status],
      ['Caller name', c.callerName || '—'],
      ['Callback', c.callbackNumber || '—'],
      ['Intent', c.intent || '—'],
      ['Sentiment', c.sentiment || '—'],
      ['Urgency', c.urgency || '—'],
      ['Lead score', c.leadScore ?? '—'],
    ];
    box.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Call detail</h2>
        <div class="row">
          <button class="btn tiny" id="d-star">${c.starred ? 'Unstar' : 'Star'}</button>
          <button class="btn tiny" id="d-analyze">Re-analyse with AI</button>
          <button class="btn tiny danger" id="d-del">Delete</button>
        </div>
      </div>
      <div class="kv mt">${kv.map(([k, v]) => `<div><span>${k}</span><span>${esc(v)}</span></div>`).join('')}</div>
      ${c.summary ? `<h2>AI summary</h2><p style="font-size:.9rem;line-height:1.6">${esc(c.summary)}</p>` : ''}
      ${c.actionItems && c.actionItems.length ? `<h2>Action items</h2><ol class="ranked">${c.actionItems.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
      ${c.tags && c.tags.length ? `<div class="tags">${c.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}
      ${c.recordingUrl ? `<h2 class="mt">Recording</h2><audio controls src="${esc(c.recordingUrl)}.mp3" style="width:100%"></audio>` : ''}
      <h2 class="mt">Transcript</h2>
      <div class="turns">${
        (c.turns || []).filter((t) => t.role !== 'system').length
          ? c.turns
              .filter((t) => t.role !== 'system')
              .map((t) => `<div class="turn ${t.role}"><small>${t.role}</small>${esc(t.text)}</div>`)
              .join('')
          : '<p class="muted">No transcript captured.</p>'
      }</div>`;

    $('#d-star').onclick = async () => {
      await api(`/api/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ starred: !c.starred }) });
      loadCalls();
      showCall(id);
    };
    $('#d-analyze').onclick = async () => {
      toast('Analysing…');
      try {
        await api(`/api/calls/${id}/analyze`, { method: 'POST' });
        showCall(id);
        loadCalls();
        toast('Analysis updated');
      } catch (err) {
        toast(err.message, true);
      }
    };
    $('#d-del').onclick = async () => {
      if (!confirm('Delete this call and its transcript?')) return;
      await api(`/api/calls/${id}`, { method: 'DELETE' });
      box.innerHTML = '<p class="muted">Call deleted.</p>';
      loadCalls();
    };
  } catch (e) {
    box.innerHTML = `<p class="form-msg err">${esc(e.message)}</p>`;
  }
}

/* ---------------------------- templates ---------------------------- */

async function loadTemplates() {
  try {
    const list = await api('/api/templates');
    $('#tpl-list').innerHTML = list.length
      ? list
          .map(
            (t) => `<div class="item" style="cursor:default">
              <div class="top"><span>${esc(t.name)}</span>
                <span class="row"><button class="btn tiny" data-apply="${t._id}">Apply</button>
                <button class="btn tiny danger" data-del-tpl="${t._id}">Delete</button></span></div>
              <div class="snip">${esc(t.systemPrompt || '')}</div></div>`
          )
          .join('')
      : '<p class="muted">No templates saved yet.</p>';
  } catch (e) {
    toast(e.message, true);
  }
}

$('#tpl-save').addEventListener('click', async () => {
  const name = $('#tpl-name').value.trim();
  if (!name) return toast('Give the template a name', true);
  try {
    await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name,
        systemPrompt: $('[data-field="systemPrompt"]').value,
        greeting: $('[data-field="greeting"]').value,
      }),
    });
    $('#tpl-name').value = '';
    loadTemplates();
    toast('Template saved');
  } catch (e) {
    toast(e.message, true);
  }
});

$('#tpl-list').addEventListener('click', async (e) => {
  const apply = e.target.dataset.apply;
  const del = e.target.dataset.delTpl;
  try {
    if (apply) {
      fillSettings(await api(`/api/templates/${apply}/apply`, { method: 'POST' }));
      toast('Template applied');
    }
    if (del) {
      await api(`/api/templates/${del}`, { method: 'DELETE' });
      loadTemplates();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------------------------- actions ---------------------------- */

$('#out-call').addEventListener('click', async () => {
  const el = $('#out-msg-status');
  el.className = 'form-msg';
  el.textContent = 'Dialling…';
  try {
    const r = await api('/api/actions/call', {
      method: 'POST',
      body: JSON.stringify({ to: $('#out-to').value.trim(), message: $('#out-msg').value }),
    });
    el.className = 'form-msg ok';
    el.textContent = `Call started (${r.sid})`;
  } catch (e) {
    el.className = 'form-msg err';
    el.textContent = e.message;
  }
});

$('#sms-send').addEventListener('click', async () => {
  const el = $('#sms-status');
  el.className = 'form-msg';
  el.textContent = 'Sending…';
  try {
    const r = await api('/api/actions/sms', {
      method: 'POST',
      body: JSON.stringify({ to: $('#sms-to').value.trim(), body: $('#sms-body').value }),
    });
    el.className = 'form-msg ok';
    el.textContent = `Sent (${r.sid})`;
  } catch (e) {
    el.className = 'form-msg err';
    el.textContent = e.message;
  }
});

/* ---------------------------- boot ---------------------------- */

async function enterApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  try {
    fillSettings(await api('/api/settings'));
  } catch (e) {
    toast(e.message, true);
  }
  loadHealth();
  loadDashboard();
  clearInterval(enterApp._poll);
  enterApp._poll = setInterval(() => {
    loadHealth();
    if ($('#tab-dashboard').classList.contains('active')) loadDashboard();
    if ($('#tab-calls').classList.contains('active')) loadCalls();
  }, 30000);
}

if (state.token && state.api) {
  api('/api/auth/me')
    .then(enterApp)
    .catch(() => logout());
}
