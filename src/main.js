import { initClerkHeader } from './clerk.js';
import { initPortal } from './portal.js';
import { initSentry, reportError } from './sentry.js';
import { supabase, isSupabaseConfigured } from './supabase.js';

initSentry();

async function bootstrap() {
  await initClerkHeader();

  await initPortal();

  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

  async function notifyLeadByEmail(payload) {
    const url = `${apiBase}/api/contact-notify`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // Smooth scroll for buttons with data-scroll-to
  document.querySelectorAll('[data-scroll-to]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const target = document.querySelector(btn.getAttribute('data-scroll-to'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  const form = document.getElementById('quick-contact-form');
  const success = document.getElementById('form-success');

  if (form && success) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      const formData = new FormData(form);
      const payload = {
        name: String(formData.get('name') || '').trim(),
        role: String(formData.get('role') || ''),
        phone: String(formData.get('phone') || '').trim(),
        email: String(formData.get('email') || '').trim(),
        support: String(formData.get('support') || '').trim(),
      };

      if (isSupabaseConfigured() && supabase) {
        const { error } = await supabase.from('consultation_leads').insert(payload);

        if (error) {
          console.error('Supabase insert failed:', error.message);
          success.textContent =
            'We could not save your request. Please try again or call us. (Check the browser console for details.)';
          success.hidden = false;
          form.classList.remove('form-submitted');
          return;
        }

        const emailResult = await notifyLeadByEmail(payload);
        if (!emailResult.ok && emailResult.status !== 503) {
          console.warn('Lead email notify failed:', emailResult.data?.error || emailResult.status);
        }

        success.textContent =
          'Thanks — your details were received. A coordinator will contact you soon.';
      } else {
        const emailResult = await notifyLeadByEmail(payload);
        if (emailResult.ok) {
          success.textContent =
            'Thanks — your details were received. A coordinator will contact you soon.';
        } else if (emailResult.status === 503) {
          success.textContent =
            'Thanks for reaching out. Add Supabase credentials in .env to save leads to your database, or configure Resend on the server to receive notifications by email.';
        } else {
          console.warn('Lead email notify failed:', emailResult.data?.error || emailResult.status);
          success.textContent =
            'Thanks for reaching out. Add Supabase credentials in .env to save leads to your database.';
        }
      }

      success.hidden = false;
      form.classList.add('form-submitted');
    });
  }

  // Login / “More” dropdowns (static header or Clerk + More menu)
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
  console.error('[app] Bootstrap failed:', err);
  reportError(err);
});
