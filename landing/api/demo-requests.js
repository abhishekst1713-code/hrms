/*
 * api/demo-requests.js — Vercel function behind the "Book a demo" form.
 *
 * The site is served from Vercel and the Flask API lives elsewhere, so a
 * same-origin POST to /api/demo-requests had nothing to land on and every
 * submission failed. This function takes the form and writes the lead
 * straight into the same MongoDB collection the Flask route uses
 * (hr_offer_letters.demo_requests), with the same validation and the same
 * one-row-per-email upsert.
 *
 * The lead is saved first, unconditionally — a mail failure must never cost
 * the lead. Only once that write succeeds does this send the confirmation
 * and internal notification mail over SMTP, same as
 * backend/routes/demo_requests.py. There is no background-thread option in
 * a Vercel function (nothing survives after the response goes out), so both
 * sends are awaited inline before responding; mail_triggered is set from
 * the confirmation send's real outcome, same meaning as on the Flask side.
 *
 * Needs MONGO_URI set in the Vercel project's environment variables, and for
 * mail: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM (or SMTP_FROM)
 * and optionally DEMO_NOTIFY_EMAIL — the same values as backend/.env.
 */
import { MongoClient } from 'mongodb';
import nodemailer from 'nodemailer';

const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const LOCAL_TYPO_RE = /^\.|\.$|\.\.|^www\./i;
const PHONE_RE = /^\+?[\d\s()\-.]+$/;

// Reused across warm invocations so each request does not open a new pool.
let clientPromise;
function db() {
  if (!clientPromise) {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI is not set');
    clientPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 }).connect()
      .catch(err => { clientPromise = undefined; throw err; });
  }
  return clientPromise.then(c => c.db(process.env.MONGO_DB || 'hr_offer_letters'));
}

const text = v => (typeof v === 'string' ? v.trim() : '');
const squash = v => text(v).split(/\s+/).filter(Boolean).join(' ');

// ── Mail ─────────────────────────────────────────────────────────────────

function smtpConfig() {
  return {
    host: process.env.SMTP_HOST || process.env.SMTP_SERVER || '',
    user: process.env.SMTP_USER || process.env.SMTP_EMAIL || '',
    pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '',
    port: Number(process.env.SMTP_PORT || 587),
    from: process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '',
  };
}

function isEmailConfigured() {
  const cfg = smtpConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass);
}

let transporter;
function mailer() {
  if (!transporter) {
    const cfg = smtpConfig();
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465, // 465 is implicit TLS; everything else STARTTLS
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }
  return transporter;
}

// Returns true if sent, false if not configured or the send failed —
// never throws, so a bad mail server can't break the request that
// triggered it (the lead is already safely in Mongo by then).
async function sendMail(to, subject, text, fromLabel = 'HR Team') {
  if (!isEmailConfigured()) return false;
  const cfg = smtpConfig();
  try {
    await mailer().sendMail({
      from: cfg.from ? `"${fromLabel}" <${cfg.from}>` : fromLabel,
      to,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error('demo request: email send failed:', subject, '->', to, err?.message || err);
    return false;
  }
}

function notifyAddress() {
  return process.env.DEMO_NOTIFY_EMAIL || smtpConfig().from;
}

function confirmationBody(email) {
  return `Hi there,

Thank you for your interest in Infopace HR Automation.

We've received your request for a product walkthrough at ${email}, and
someone from our team will reach out shortly to find a time that works
for you.

What happens next:

  1. We'll get in touch to book a slot that suits your schedule.
  2. We'll walk you through the product using your own structure —
     your departments, leave policies, and payroll setup — so you can
     see exactly how it would work for your team.
  3. If it's a good fit, we'll help you set up your account, branding,
     and first records together.

If you didn't submit this request, you can simply ignore this email —
no account has been created and we won't be in touch again.

Looking forward to showing you around.

Warm regards,
Team Infopace
Infopace Management Pvt Ltd
`;
}

function notificationBody(email, source, when, name, phone, company) {
  return `New demo request received from the website.

  Name       : ${name}
  Company    : ${company}
  Phone      : ${phone}
  Email      : ${email}
  Source     : ${source || 'landing'}
  Received   : ${when.toUTCString()}

Please reach out to the address above to schedule the walkthrough.
`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let data = req.body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};

  // Honeypot: answer 200 so a bot has nothing to learn.
  if (text(data.company_website)) return res.status(200).json({ ok: true });

  const name = squash(data.name);
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  if (name.length > 120) return res.status(400).json({ error: 'That name is too long.' });

  const company = squash(data.company_name);
  if (!company) return res.status(400).json({ error: 'Enter your company name.' });
  if (company.length > 160) return res.status(400).json({ error: 'That company name is too long.' });

  const phone = text(data.phone);
  const digits = phone.replace(/\D/g, '');
  if (!phone || !PHONE_RE.test(phone) || digits.length < 7 || digits.length > 15) {
    return res.status(400).json({ error: 'Enter a valid phone number.' });
  }

  const email = text(data.email).toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (LOCAL_TYPO_RE.test(email.split('@')[0])) {
    return res.status(400).json({ error: 'That address does not look right. '
                                       + 'Check for a stray "www." or a misplaced dot.' });
  }

  const source = text(data.source).slice(0, 60) || 'landing';
  const now = new Date();

  let collection;
  try {
    const database = await db();
    collection = database.collection('demo_requests');
    await collection.updateOne(
      { email },
      {
        // mail_triggered resets to False here because a fresh send is about
        // to be attempted (or skipped, if email isn't configured); it only
        // flips to True once the confirmation mail below is confirmed sent.
        $set: { email, name, phone, company_name: company, source,
                last_requested_at: now, updated_at: now, mail_triggered: false },
        $inc: { request_count: 1 },
        $setOnInsert: { created_at: now, status: 'new' },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('demo request not stored:', err);
    return res.status(500).json({ error: 'We could not save that just now. '
                                       + 'Try again, or write to us directly.' });
  }

  // The lead is safe now. Mail is sent inline (and awaited) because nothing
  // in a Vercel function survives past the response — there is no
  // background thread to hand this to the way the Flask route can.
  const configured = isEmailConfigured();
  let confirmationSent = false;
  let notificationSent = false;
  if (configured) {
    confirmationSent = await sendMail(email, 'Your Infopace HR demo request',
                                      confirmationBody(email), 'Infopace HR');
    try {
      await collection.updateOne({ email }, { $set: { mail_triggered: confirmationSent } });
    } catch (err) {
      console.error('demo request: could not update mail_triggered for', email, err);
    }

    const notifyTo = notifyAddress();
    if (notifyTo) {
      notificationSent = await sendMail(notifyTo, `Demo request: ${email}`,
                                        notificationBody(email, source, now, name, phone, company),
                                        'Infopace HR website');
    } else {
      console.warn('demo request: no DEMO_NOTIFY_EMAIL or send-as address set, team not notified');
    }
  } else {
    console.warn('demo request stored but email is not configured, no mail sent:', email);
  }

  return res.status(201).json({
    ok: true,
    emailed: { confirmation: confirmationSent, notification: notificationSent },
    queued: false,
  });
}
