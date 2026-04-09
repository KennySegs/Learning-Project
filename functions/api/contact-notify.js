/**
 * Cloudflare Pages Function — POST /api/contact-notify
 * Uses Resend HTTP API (Workers-compatible; no Node resend package).
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function corsHeaders(request, extra = {}) {
  const h = new Headers(extra);
  const origin = request.headers.get('Origin');
  if (origin) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
  }
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return h;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders(request, {
        Allow: 'POST, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
      }),
    });
  }

  const apiKey = env.RESEND_API_KEY;
  const to = env.RESEND_TO;
  const from =
    env.RESEND_FROM || 'LivingRite Care <onboarding@resend.dev>';

  if (!apiKey || !to) {
    return new Response(
      JSON.stringify({
        error: 'Email notifications are not configured on the server.',
      }),
      {
        status: 503,
        headers: corsHeaders(request, {
          'Content-Type': 'application/json; charset=utf-8',
        }),
      },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json; charset=utf-8',
      }),
    });
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const role = String(body.role || '').trim();
  const phone = String(body.phone || '').trim();
  const support = String(body.support || '').trim();

  if (!name || !email) {
    return new Response(JSON.stringify({ error: 'Name and email are required' }), {
      status: 400,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json; charset=utf-8',
      }),
    });
  }

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

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `New consultation lead: ${name}`,
      text,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error('[Resend]', resendRes.status, errText);
    return new Response(JSON.stringify({ error: 'Could not send email' }), {
      status: 502,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json; charset=utf-8',
      }),
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json; charset=utf-8',
    }),
  });
}
