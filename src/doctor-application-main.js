import { initClerkHeader } from './clerk.js';
import { initSentry, reportError } from './sentry.js';

initSentry();

async function bootstrap() {
  await initClerkHeader();

  document.querySelectorAll('[data-login-dropdown]').forEach(function (loginDropdown) {
    const loginToggle = loginDropdown.querySelector('.login-toggle');

    if (!loginToggle) return;

    function closeLoginMenu() {
      loginDropdown.classList.remove('is-open');
      loginToggle.setAttribute('aria-expanded', 'false');
    }

    function openLoginMenu() {
      loginDropdown.classList.add('is-open');
      loginToggle.setAttribute('aria-expanded', 'true');
    }

    loginToggle.addEventListener('click', function () {
      const open = loginDropdown.classList.contains('is-open');
      if (open) {
        closeLoginMenu();
      } else {
        openLoginMenu();
      }
    });

    document.addEventListener('click', function (event) {
      if (!loginDropdown.contains(event.target)) {
        closeLoginMenu();
      }
    });
  });

  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
}

bootstrap().catch(function (err) {
  console.error('[doctor-application] Bootstrap failed:', err);
  reportError(err);
});
