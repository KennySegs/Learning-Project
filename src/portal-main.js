import { initClerkHeader } from './clerk.js';
import { initPortal } from './portal.js';
import { initSentry, reportError } from './sentry.js';
import { isSupabaseConfigured } from './supabase.js';

initSentry();

async function bootstrap() {
  await initClerkHeader();

  await initPortal();

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

  if (import.meta.env.DEV && isSupabaseConfigured()) {
    console.info('[Supabase] Client ready.');
  } else if (import.meta.env.DEV) {
    console.info(
      '[Supabase] Not configured — copy .env.example to .env and add your project URL and anon key.'
    );
  }
}

bootstrap().catch(function (err) {
  console.error('[portal] Bootstrap failed:', err);
  reportError(err);
});
