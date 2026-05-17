(function () {
  'use strict';

  const form = document.getElementById('login-form');
  const errEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');
  const userEl = document.getElementById('login-username');
  const passEl = document.getElementById('login-password');

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }
  function clearError() {
    errEl.hidden = true;
    errEl.textContent = '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const username = (userEl.value || '').trim();
    const password = passEl.value || '';
    if (!username || !password) {
      showError('아이디와 비밀번호를 입력해 주세요.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '로그인 중…';

    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });

      if (r.ok) {
        location.href = '/console-e7m3k9p2/';
        return;
      }

      if (r.status === 401) {
        showError('아이디 또는 비밀번호가 올바르지 않습니다.');
      } else if (r.status === 429) {
        showError('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      } else if (r.status === 503) {
        showError('어드민이 아직 설정되지 않았습니다.');
      } else {
        showError('로그인 실패 (오류 ' + r.status + ')');
      }
    } catch (err) {
      showError('네트워크 오류 — 잠시 후 다시 시도해 주세요.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '로그인';
    }
  });
})();
