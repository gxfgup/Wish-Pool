function $(id) {
  return document.getElementById(id);
}

const state = {
  token: localStorage.getItem('wishpool_token') || null,
  adminToken: localStorage.getItem('wishpool_admin_token') || null,
  status: null,
  myWish: null,
  countdownTimer: null
};

async function apiFetch(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!admin && state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (admin && state.adminToken) headers['X-Admin-Token'] = state.adminToken;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    const err = (data && data.error) || `HTTP_${res.status}`;
    const e = new Error(err);
    e.status = res.status;
    e.payload = data;
    throw e;
  }

  return data;
}

function setHint(el, msg) {
  el.textContent = msg || '';
}

function show(el, yes) {
  if (yes) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

function fmtCountdown(ms) {
  if (ms <= 0) return '已截止';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${d}天 ${h}小时 ${m}分`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDatetimeLocalValue(ts) {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fromDatetimeLocalValue(v) {
  const s = String(v || '').trim();
  if (!s) return NaN;
  const ts = new Date(s).getTime();
  return ts;
}

function startCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (!state.status) return;
    const ms = state.status.deadlineTs - Date.now();
    $('countdown').textContent = fmtCountdown(ms);
    const authCountdown = $('authCountdown');
    if (authCountdown) authCountdown.textContent = fmtCountdown(ms);
  }, 1000);
}

async function refreshStatus() {
  state.status = await apiFetch('/api/status');
  $('progress').textContent = `${state.status.totalWishes}/${state.status.maxWishes}`;
  $('countdown').textContent = fmtCountdown(state.status.deadlineTs - Date.now());
  const authProgress = $('authProgress');
  if (authProgress) authProgress.textContent = `${state.status.totalWishes}/${state.status.maxWishes}`;
  const authCountdown = $('authCountdown');
  if (authCountdown) authCountdown.textContent = fmtCountdown(state.status.deadlineTs - Date.now());
  startCountdown();
}

async function refreshMyWish() {
  const r = await apiFetch('/api/wish/me');
  state.myWish = r;

  const wishBody = r.wish ? r.wish.text : '（你还没有投递愿望）';
  $('myWishBody').textContent = wishBody;

  if (r.wish) $('wishText').value = r.wish.text;

  const btn = $('btnSubmitWish');
  if (r.canCreate) {
    btn.disabled = false;
    btn.textContent = '投递';
  } else if (r.canEdit) {
    btn.disabled = false;
    btn.textContent = '修改（仅一次）';
  } else {
    btn.disabled = true;
    btn.textContent = '不可修改';
  }
}

async function refreshReveal() {
  const r = await apiFetch('/api/reveal');
  $('revealBox').textContent = r.wishText;
}

function switchToLoggedOut() {
  show($('authCard'), true);
  show($('wellCard'), false);
  show($('adminCard'), false);
  state.token = null;
  localStorage.removeItem('wishpool_token');
}

function switchToLoggedIn() {
  show($('authCard'), false);
  show($('wellCard'), true);
}

async function render() {
  if (!state.token) {
    switchToLoggedOut();
    return;
  }

  switchToLoggedIn();
  await refreshStatus();

  if (state.status.assigned === 1) {
    show($('phaseWish'), false);
    show($('phaseReveal'), true);
    await refreshReveal();
  } else {
    show($('phaseWish'), true);
    show($('phaseReveal'), false);
    await refreshMyWish();
  }
}

$('btnRegister').addEventListener('click', async () => {
  setHint($('authHint'), '');
  try {
    const phone = $('phone').value.trim();
    const password = $('password').value.trim();
    await apiFetch('/api/auth/register', { method: 'POST', body: { phone, password } });
    setHint($('authHint'), '注册成功，请登录');
  } catch (e) {
    setHint($('authHint'), `注册失败：${e.message}`);
  }
});

$('btnLogin').addEventListener('click', async () => {
  setHint($('authHint'), '');
  try {
    const phone = $('phone').value.trim();
    const password = $('password').value.trim();
    const r = await apiFetch('/api/auth/login', { method: 'POST', body: { phone, password } });
    state.token = r.token;
    localStorage.setItem('wishpool_token', state.token);
    await render();
  } catch (e) {
    setHint($('authHint'), `登录失败：${e.message}`);
  }
});

async function renderAuthStatus() {
  try {
    await refreshStatus();
  } catch (_) {
    // ignore
  }
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (_) {
    // ignore
  }
  switchToLoggedOut();
}

$('btnLogout').addEventListener('click', logout);
$('btnLogout2').addEventListener('click', logout);

$('btnSubmitWish').addEventListener('click', async () => {
  setHint($('wishHint'), '');
  try {
    if (!state.status) await refreshStatus();
    if (state.status.assigned === 1) {
      setHint($('wishHint'), '当前已进入揭晓阶段，无法再投递/修改愿望');
      return;
    }
    if (Date.now() >= state.status.deadlineTs) {
      setHint($('wishHint'), '已截止，无法再投递/修改愿望');
      return;
    }
    if (!state.myWish) await refreshMyWish();
    const isCreating = !state.myWish.wish;
    if (isCreating && state.status.totalWishes >= state.status.maxWishes) {
      setHint($('wishHint'), '许愿池已满，请等待下一轮');
      return;
    }
    const text = $('wishText').value.trim();
    await apiFetch('/api/wish', { method: 'POST', body: { text } });
    setHint($('wishHint'), '感谢你许下愿望，会有好心人为你实现你的愿望！');
    await refreshStatus();
    await refreshMyWish();
  } catch (e) {
    setHint($('wishHint'), `提交失败：${e.message}`);
  }
});

$('footerAdmin').addEventListener('click', async () => {
  const pw = prompt('管理员密码');
  if (!pw) return;
  setHint($('adminHint'), '');
  try {
    const r = await apiFetch('/api/admin/login', { method: 'POST', body: { password: pw } });
    state.adminToken = r.token;
    localStorage.setItem('wishpool_admin_token', state.adminToken);
    show($('adminCard'), true);
    await refreshAdmin();
  } catch (e) {
    setHint($('adminHint'), `进入失败：${e.message}`);
  }
});

async function refreshAdmin() {
  if (!state.adminToken) return;
  const r = await apiFetch('/api/admin/status', { admin: true });
  $('adminMaxWishes').value = r.config.maxWishes;
  $('adminDeadline').value = toDatetimeLocalValue(Number(r.config.deadlineTs));
  setHint(
    $('adminHint'),
    `用户数=${r.counts.users}，愿望数=${r.counts.wishes}，配对数=${r.counts.assignments}，已分配=${Number(r.config.assigned) === 1 ? '是' : '否'}`
  );
}

$('btnAdminSave').addEventListener('click', async () => {
  setHint($('adminHint'), '');
  try {
    const maxWishes = Number($('adminMaxWishes').value);
    const deadlineTs = fromDatetimeLocalValue($('adminDeadline').value);
    if (!Number.isFinite(deadlineTs)) throw new Error('截止时间格式不正确');
    await apiFetch('/api/admin/config', { method: 'POST', admin: true, body: { maxWishes, deadlineTs } });
    setHint($('adminHint'), '已保存设置');
    await refreshStatus();
    await refreshAdmin();
  } catch (e) {
    setHint($('adminHint'), `保存失败：${e.message}`);
  }
});

$('btnAdminAssign').addEventListener('click', async () => {
  setHint($('adminHint'), '');
  try {
    await apiFetch('/api/admin/assign', { method: 'POST', admin: true });
    setHint($('adminHint'), '已随机分配');
    await refreshStatus();
    await refreshAdmin();
    await render();
  } catch (e) {
    setHint($('adminHint'), `分配失败：${e.message}`);
  }
});

$('btnAdminResetPool').addEventListener('click', async () => {
  if (!confirm('确认重置许愿池？（清空愿望，不清空用户）')) return;
  setHint($('adminHint'), '');
  try {
    await apiFetch('/api/admin/reset-pool', { method: 'POST', admin: true });
    setHint($('adminHint'), '已重置许愿池');
    await refreshStatus();
    await refreshAdmin();
    await render();
  } catch (e) {
    setHint($('adminHint'), `重置失败：${e.message}`);
  }
});

$('btnAdminResetDb').addEventListener('click', async () => {
  if (!confirm('确认重置数据库？（清空愿望&用户数据）')) return;
  setHint($('adminHint'), '');
  try {
    await apiFetch('/api/admin/reset-db', { method: 'POST', admin: true });
    setHint($('adminHint'), '已重置数据库');
    await refreshStatus();
    await refreshAdmin();
    await render();
  } catch (e) {
    setHint($('adminHint'), `重置失败：${e.message}`);
  }
});

$('btnAdminExport').addEventListener('click', async () => {
  setHint($('adminHint'), '');
  try {
    const res = await fetch('/api/admin/export', {
      method: 'GET',
      headers: { 'X-Admin-Token': state.adminToken }
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wishpool_export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setHint($('adminHint'), '已导出');
  } catch (e) {
    setHint($('adminHint'), `导出失败：${e.message}`);
  }
});

render().catch(() => {
  switchToLoggedOut();
});

renderAuthStatus();
