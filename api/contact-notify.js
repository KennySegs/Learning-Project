import { Resend } from 'resend';

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.RESEND_TO;
  const from =
    process.env.RESEND_FROM || 'LivingRite Care <onboarding@resend.dev>';

  if (!apiKey || !to) {
    json(res, 503, {
      error: 'Email notifications are not configured on the server.',
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const role = String(body.role || '').trim();
  const phone = String(body.phone || '').trim();
  const support = String(body.support || '').trim();

  if (!name || !email) {
    json(res, 400, { error: 'Name and email are required' });
    return;
  }

  const resend = new Resend(apiKey);
  const lines = [
    ['Name', name],
    ['Email', email],
    ['Role', role || '—'],
    ['Phone', phone || '—'],
    ['Support needs', support || '—'],
  ];

  const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html = `<pre style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lines
    .map(
      ([k, v]) =>
        `<strong>${escapeHtml(k)}</strong>: ${escapeHtml(v)}<br/>`
    )
    .join('')}</pre>`;

  const { error } = await resend.emails.send({
    from,
    to: [to],
    replyTo: email,
    subject: `New consultation lead: ${name}`,
    text,
    html,
  });

  if (error) {
    console.error('[Resend]', error);
    json(res, 502, { error: 'Could not send email' });
    return;
  }

  json(res, 200, { ok: true });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
