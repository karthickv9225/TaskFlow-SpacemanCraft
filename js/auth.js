/**
 * Firebase Authentication & Role-Based Route Protection.
 */
import { UI } from './common.js';
import { API } from './api.js';

export async function login(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (!cleanEmail || !cleanPassword) {
    return { ok: false, error: 'Please enter both email and password.' };
  }
  if (!UI.isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  try {
    const res = await API.login(cleanEmail, cleanPassword);
    if (!res || !res.user || !res.user.role) {
      return {
        ok: false,
        error: 'Unable to sign in. Please verify your Firebase configuration.'
      };
    }
    return { ok: true, session: res.user };
  } catch (err) {
    return { ok: false, error: err.message || 'Sign in failed.' };
  }
}

export async function logout() {
  try {
    await API.logout();
  } catch (_err) {
    // Proceed to login page even if sign-out throws
  }
  window.location.replace('login.html');
}

export async function getValidatedSession() {
  try {
    const res = await API.getMe();
    return res && res.user ? res.user : null;
  } catch (_err) {
    return null;
  }
}

export async function requireAuth(expectedRole) {
  const session = await getValidatedSession();
  if (!session) {
    window.location.replace('login.html');
    return null;
  }
  if (expectedRole && session.role !== expectedRole) {
    window.location.replace(session.role === 'admin' ? 'admin.html' : 'employee.html');
    return null;
  }
  return session;
}

export async function redirectIfAuthenticated() {
  const session = await getValidatedSession();
  if (session) {
    window.location.replace(session.role === 'admin' ? 'admin.html' : 'employee.html');
    return true;
  }
  return false;
}

export async function updateCurrentProfile(updates) {
  const nextName = String((updates && updates.name) || '').trim();
  if (!nextName) {
    return { ok: false, error: 'Full name is required.' };
  }
  const payload = { name: nextName };
  if (updates && updates.newPassword) {
    if (updates.newPassword.length < 6) {
      return { ok: false, error: 'New password must be at least 6 characters.' };
    }
    payload.newPassword = updates.newPassword;
  }
  if (updates && updates.currentPassword) {
    payload.currentPassword = updates.currentPassword;
  }

  try {
    const res = await API.updateCurrentProfile(payload);
    return { ok: true, session: res.user };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : '',
      error: err.message || 'Could not update profile.'
    };
  }
}

export async function initLoginPage() {
  const alreadyAuthed = await redirectIfAuthenticated();
  if (alreadyAuthed) return;

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const errorBox = document.getElementById('login-error');
  const toggleBtn = document.getElementById('toggle-password-btn');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

  const statusBanner = document.getElementById('auth-status-banner');
  const setupSection = document.getElementById('setup-admin-section');
  const setupForm = document.getElementById('setup-admin-form');
  const setupError = document.getElementById('setup-error');
  const cardHeading = document.getElementById('login-card-title');
  const cardSubtitle = document.getElementById('login-card-subtitle');

  if (!form) return;

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener('click', function () {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });
  }

  try {
    const status = await API.getAuthStatus();
    if (!status.firebaseConnected) {
      if (statusBanner) {
        statusBanner.classList.remove('form-info-box');
        statusBanner.classList.add('form-error-box');
        statusBanner.innerHTML =
          '<strong>Firebase Connection Notice:</strong> ' +
          UI.escapeHtml(status.error || 'Unable to connect to Cloud Firestore.');
        statusBanner.classList.remove('hidden');
      }
    } else if (!status.adminInitialized && setupSection && setupForm) {
      if (cardHeading) cardHeading.textContent = 'Initial Admin Setup';
      if (cardSubtitle) {
        cardSubtitle.textContent =
          'Create the first Administrator account for this workspace. Public admin registration locks automatically afterward.';
      }
      form.classList.add('hidden');
      setupSection.classList.remove('hidden');

      setupForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        setupError.classList.add('hidden');
        const sBtn = setupForm.querySelector('button[type="submit"]');
        if (sBtn) sBtn.disabled = true;

        const name = document.getElementById('setup-name').value.trim();
        const email = document.getElementById('setup-email').value.trim().toLowerCase();
        const password = document.getElementById('setup-password').value;

        try {
          const created = await API.setupAdmin({ name, email, password });
          if (created && created.user) {
            window.location.replace('admin.html');
          }
        } catch (err) {
          setupError.textContent = err.message || 'Setup failed.';
          setupError.classList.remove('hidden');
        } finally {
          if (sBtn) sBtn.disabled = false;
        }
      });
    }
  } catch (_err) {
    if (statusBanner) {
      statusBanner.textContent = 'Unable to verify workspace initialization status.';
      statusBanner.classList.remove('hidden');
    }
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();
    if (submitBtn) submitBtn.disabled = true;

    try {
      const result = await login(emailInput.value, passwordInput.value);
      if (!result || !result.ok || !result.session || !result.session.role) {
        showError((result && result.error) || 'Sign in failed. Please try again.');
        return;
      }
      window.location.replace(result.session.role === 'admin' ? 'admin.html' : 'employee.html');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

export const Auth = {
  login,
  logout,
  getValidatedSession,
  requireAuth,
  redirectIfAuthenticated,
  updateCurrentProfile,
  initLoginPage
};

window.CTM = window.CTM || {};
window.CTM.Auth = Auth;

document.addEventListener('DOMContentLoaded', function () {
  if (document.body.getAttribute('data-page') === 'login') {
    initLoginPage();
  }
});
