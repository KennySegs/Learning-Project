/**
 * One-off: node --env-file=.env scripts/test-resend.mjs
 * Verifies RESEND_API_KEY / RESEND_TO without running Vercel.
 */
import { Resend } from 'resend';

const key = process.env.RESEND_API_KEY;
const to = process.env.RESEND_TO;
const from =
  process.env.RESEND_FROM || 'LivingRite Care <onboarding@resend.dev>';

if (!key || !to) {
  console.error('Missing RESEND_API_KEY or RESEND_TO in environment.');
  process.exit(1);
}

const resend = new Resend(key);
const { data, error } = await resend.emails.send({
  from,
  to: [to],
  subject: 'LivingRite — Resend test',
  text: 'If you received this, the Resend API key and recipient are working.',
});

if (error) {
  console.error('Resend API error:', error);
  process.exit(1);
}

console.log('OK — email queued. Resend id:', data?.id);
