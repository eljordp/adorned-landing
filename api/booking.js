const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'a.aestheticsbykayy@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Aesthetics By Kayy <onboarding@resend.dev>';

const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

function escapeHtml(text) {
  if (!text || typeof text !== 'string') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 255;
}

async function sendEmail({ to, subject, html, replyTo }) {
  const body = { from: FROM_EMAIL, to: [to], subject, html };
  if (replyTo) body.reply_to = replyTo;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend ${res.status}: ${err}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured');
    return res.status(500).json({ error: 'Email service is not configured' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const b = req.body || {};
  const required = ['service', 'date', 'time', 'name', 'phone', 'email'];
  for (const field of required) {
    const v = b[field];
    if (!v || typeof v !== 'string' || v.trim().length === 0 || v.length > 500) {
      return res.status(400).json({ error: `Missing or invalid field: ${field}` });
    }
  }
  if (!isValidEmail(b.email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const safe = {
    service: escapeHtml(b.service),
    date: escapeHtml(b.date),
    time: escapeHtml(b.time),
    price: escapeHtml(b.price || ''),
    promoCode: escapeHtml(b.promoCode || ''),
    discount: escapeHtml(b.discount || ''),
    finalPrice: escapeHtml(b.finalPrice || b.price || ''),
    name: escapeHtml(b.name),
    phone: escapeHtml(b.phone),
    email: escapeHtml(b.email),
    notes: escapeHtml(b.notes || ''),
  };

  let formattedDate = safe.date;
  try {
    const d = new Date(b.date);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    }
  } catch {}

  const promoLine = safe.promoCode
    ? `<tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Promo Code:</td><td style="padding:10px;border-bottom:1px solid #eee;">${safe.promoCode} (${safe.discount})</td></tr>`
    : '';
  const finalLine = safe.promoCode
    ? `<tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Total:</td><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">${safe.finalPrice}</td></tr>`
    : '';
  const notesBlock = safe.notes
    ? `<div style="margin-top:20px;padding:15px;background:#f9f9f9;border-radius:8px;"><h3 style="margin-top:0;color:#333;">Notes from client:</h3><p style="color:#666;line-height:1.6;">${safe.notes}</p></div>`
    : '';

  const ownerHtml = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-family:'Cormorant Garamond',Georgia,serif;border-bottom:1px solid #b8a48a;padding-bottom:10px;">New Booking Request</h1>
      <table style="width:100%;border-collapse:collapse;margin-top:20px;">
        <tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;width:140px;">Service:</td><td style="padding:10px;border-bottom:1px solid #eee;">${safe.service}</td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Date:</td><td style="padding:10px;border-bottom:1px solid #eee;">${escapeHtml(formattedDate)}</td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Time:</td><td style="padding:10px;border-bottom:1px solid #eee;">${safe.time}</td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Price:</td><td style="padding:10px;border-bottom:1px solid #eee;">${safe.price}</td></tr>
        ${promoLine}
        ${finalLine}
        <tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Name:</td><td style="padding:10px;border-bottom:1px solid #eee;">${safe.name}</td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Phone:</td><td style="padding:10px;border-bottom:1px solid #eee;"><a href="tel:${safe.phone}">${safe.phone}</a></td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #eee;font-weight:bold;">Email:</td><td style="padding:10px;border-bottom:1px solid #eee;"><a href="mailto:${safe.email}">${safe.email}</a></td></tr>
      </table>
      ${notesBlock}
      <p style="margin-top:24px;color:#888;font-size:12px;">Reply directly to this email to respond to ${safe.name}.</p>
    </div>
  `;

  const customerHtml = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-family:'Cormorant Garamond',Georgia,serif;color:#b8a48a;">Thank you, ${safe.name}.</h1>
      <p style="line-height:1.7;">We've received your booking request. Kayy will confirm your appointment within 24 hours by email or text.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:20px;background:#faf7f2;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:12px 16px;font-weight:bold;width:120px;">Service</td><td style="padding:12px 16px;">${safe.service}</td></tr>
        <tr><td style="padding:12px 16px;font-weight:bold;">Date</td><td style="padding:12px 16px;">${escapeHtml(formattedDate)}</td></tr>
        <tr><td style="padding:12px 16px;font-weight:bold;">Time</td><td style="padding:12px 16px;">${safe.time}</td></tr>
        ${safe.promoCode ? `<tr><td style="padding:12px 16px;font-weight:bold;">Total</td><td style="padding:12px 16px;">${safe.finalPrice} <span style="color:#888;text-decoration:line-through;margin-left:8px;">${safe.price}</span></td></tr>` : `<tr><td style="padding:12px 16px;font-weight:bold;">Price</td><td style="padding:12px 16px;">${safe.price}</td></tr>`}
      </table>
      <p style="line-height:1.7;margin-top:24px;">If you need to reach Kayy, reply to this email or DM <a href="https://instagram.com/aesthetics_bykayy">@aesthetics_bykayy</a> on Instagram.</p>
      <p style="margin-top:32px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;color:#b8a48a;">Aesthetics By Kayy</p>
    </div>
  `;

  try {
    await sendEmail({
      to: NOTIFY_EMAIL,
      subject: `New Booking: ${b.name} — ${b.service}`,
      html: ownerHtml,
      replyTo: b.email,
    });

    try {
      await sendEmail({
        to: b.email,
        subject: 'Booking received — Aesthetics By Kayy',
        html: customerHtml,
        replyTo: NOTIFY_EMAIL,
      });
    } catch (e) {
      console.error('Customer confirmation failed (owner email sent):', e.message);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Booking email error:', error.message);
    return res.status(500).json({ error: 'Failed to send booking. Please try again or DM @aesthetics_bykayy.' });
  }
}
