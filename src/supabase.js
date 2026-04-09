import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function isConfigured() {
  return Boolean(
    url &&
      anonKey &&
      !String(url).includes('your-project-ref') &&
      String(anonKey) !== 'your-anon-key'
  );
}

/** @type {(() => Promise<string | null | undefined>) | null} */
let getAuthToken = null;

async function supabaseFetch(input, init) {
  const options = init || {};
  const headers = new Headers(options.headers);
  if (getAuthToken) {
    try {
      const token = await getAuthToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch {
      /* noop */
    }
  }
  return fetch(input, { ...options, headers });
}

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
export const supabase = isConfigured()
  ? createClient(url, anonKey, {
      global: { fetch: supabaseFetch },
    })
  : null;

/**
 * Pass a function that returns the Clerk session JWT for the Supabase template.
 * Configure Clerk JWT template named "supabase" and link Clerk in Supabase Auth settings.
 * @param {(() => Promise<string | null | undefined>) | null} fn
 */
export function setSupabaseAuthTokenGetter(fn) {
  getAuthToken = fn;
}

export function isSupabaseConfigured() {
  return isConfigured();
}
