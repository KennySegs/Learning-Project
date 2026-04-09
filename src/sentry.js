import * as Sentry from '@sentry/browser';

/**
 * Client-side error tracking. Set VITE_SENTRY_DSN in .env (from Sentry → Settings → Client Keys).
 * If unset, nothing is initialized and the bundle still loads.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || typeof dsn !== 'string') {
    return;
  }

  const release = import.meta.env.VITE_SENTRY_RELEASE;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    ...(release ? { release } : {}),
    sendDefaultPii: false,
  });
}

/** Report an error only when Sentry is active (avoids no-op noise). */
export function reportError(error, captureContext) {
  if (!Sentry.getClient()) return;
  Sentry.captureException(error, captureContext);
}
