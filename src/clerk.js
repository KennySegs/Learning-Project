import { Clerk } from '@clerk/clerk-js';
import { setSupabaseAuthTokenGetter } from './supabase.js';

const publishableKey = String(
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
    import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    ''
).trim();

export function isClerkConfigured() {
  return Boolean(publishableKey && publishableKey.startsWith('pk_'));
}

function redirectHomeAfterSignOutFromPortal() {
  try {
    const path = window.location.pathname || '';
    if (!/portal\.html$/i.test(path)) {
      return;
    }
    window.location.replace(new URL('index.html', window.location.href).href);
  } catch {
    /* noop */
  }
}

/**
 * Starts sign-in via Clerk-hosted page (redirect). Does not use prebuilt UI modals.
 *
 * Vite + `@clerk/clerk-js` often omits the lazy-loaded Clerk UI chunk, so
 * `openSignIn()` / `mountUserButton()` throw "Clerk was not loaded with Ui components".
 * Redirects avoid that bundle and work reliably.
 *
 * @param {import('@clerk/clerk-js').Clerk} clerk
 */
export function openClerkSignIn(clerk) {
  if (!clerk) {
    console.warn('[Clerk] openSignIn skipped: Clerk is not loaded.');
    return;
  }
  const origin = typeof window !== 'undefined' ? window.location.href : undefined;
  void clerk
    .redirectToSignIn(
      origin
        ? {
            signInFallbackRedirectUrl: origin,
          }
        : undefined
    )
    .catch(function (err) {
      console.error('[Clerk] redirectToSignIn failed:', err);
      window.alert(
        'Sign-in redirect failed. Check the browser console.\n\n' +
          'Common fixes: add VITE_CLERK_PUBLISHABLE_KEY in .env, restart `npm run dev`, ' +
          'and in Clerk Dashboard add http://localhost:5173 to Allowed origins / redirect URLs.'
      );
    });
}

/** @type {Clerk | null} */
let clerkInstance = null;

export function getClerk() {
  return clerkInstance;
}

/**
 * Replaces #header-auth with Clerk (user button or Sign in) + “More” menu.
 * Returns true when Clerk owns the header; false to keep static HTML fallback.
 */
export async function initClerkHeader() {
  const headerAuth = document.getElementById('header-auth');
  if (!headerAuth || !isClerkConfigured()) {
    return false;
  }

  const clerk = new Clerk(publishableKey);
  try {
    await clerk.load();
  } catch (err) {
    console.error('[Clerk] Failed to load:', err);
    document.documentElement.setAttribute('data-clerk-status', 'error');
    return false;
  }

  document.documentElement.setAttribute('data-clerk-status', 'ready');

  clerkInstance = clerk;

  function bindSupabaseAuth() {
    setSupabaseAuthTokenGetter(async function () {
      if (!clerk.session) {
        return null;
      }
      try {
        return await clerk.session.getToken({ template: 'supabase' });
      } catch {
        return null;
      }
    });
  }

  bindSupabaseAuth();
  clerk.addListener(function () {
    bindSupabaseAuth();
  });

  headerAuth.replaceChildren();
  const row = document.createElement('div');
  row.className = 'header-auth-row';
  row.innerHTML = `
    <div id="clerk-user-button-root" class="clerk-user-slot"></div>
    <div class="login-dropdown" data-login-dropdown>
      <button class="login-toggle" type="button" aria-haspopup="true" aria-expanded="false">
        <span class="login-label">More</span>
        <span class="login-chevron">▾</span>
      </button>
      <div class="login-menu" role="menu" aria-label="Additional links">
        <a href="/portal.html" class="login-item" role="menuitem">
          <span class="login-item-title">Care portal &amp; matching</span>
          <span class="login-item-desc">Sign in, choose your role, and complete intake for provider matching.</span>
        </a>
        <a href="/doctor-application.html" class="login-item" role="menuitem">
          <span class="login-item-title">Doctor application form</span>
          <span class="login-item-desc">Answer screening questions and upload your credentials.</span>
        </a>
      </div>
    </div>
  `;
  headerAuth.appendChild(row);

  const slot = () => document.getElementById('clerk-user-button-root');

  function render() {
    const el = slot();
    if (!el) return;
    el.replaceChildren();

    if (clerk.isSignedIn && clerk.user) {
      const wrap = document.createElement('div');
      wrap.className = 'clerk-header-signed-in';

      const email =
        clerk.user.primaryEmailAddress?.emailAddress ||
        clerk.user.emailAddresses?.[0]?.emailAddress ||
        'Signed in';

      const label = document.createElement('span');
      label.className = 'clerk-user-email';
      label.textContent = email;
      label.title = email;

      const accountBtn = document.createElement('button');
      accountBtn.type = 'button';
      accountBtn.className = 'login-toggle';
      accountBtn.setAttribute('aria-label', 'Account');
      accountBtn.innerHTML = '<span class="login-label">Account</span>';
      accountBtn.addEventListener('click', function () {
        void clerk.redirectToUserProfile().catch(function (err) {
          console.error('[Clerk] redirectToUserProfile failed:', err);
        });
      });

      const outBtn = document.createElement('button');
      outBtn.type = 'button';
      outBtn.className = 'login-toggle';
      outBtn.setAttribute('aria-label', 'Sign out');
      outBtn.innerHTML = '<span class="login-label">Sign out</span>';
      outBtn.addEventListener('click', function () {
        void clerk
          .signOut()
          .then(function () {
            redirectHomeAfterSignOutFromPortal();
          })
          .catch(function () {
            redirectHomeAfterSignOutFromPortal();
          });
      });

      wrap.appendChild(label);
      wrap.appendChild(accountBtn);
      wrap.appendChild(outBtn);
      el.appendChild(wrap);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'login-toggle';
      btn.setAttribute('aria-label', 'Sign in');
      btn.innerHTML = '<span class="login-label">Sign in</span>';
      btn.addEventListener('click', function () {
        openClerkSignIn(clerk);
      });
      el.appendChild(btn);
    }
  }

  clerk.addListener(render);
  render();

  if (import.meta.env.DEV) {
    console.info('[Clerk] Ready.');
  }

  return true;
}
