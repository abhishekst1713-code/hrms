/*
 * api/demo-requests.js — Vercel function behind the "Book a demo" form.
 *
 * The site is served from Vercel and the Flask API lives elsewhere, so a
 * same-origin POST to /api/demo-requests had nothing to land on and every
 * submission failed. This function takes the form and writes the lead
 * straight into the same MongoDB collection the Flask route uses
 * (hr_offer_letters.demo_requests), with the same validation and the same
 * one-row-per-email upsert. No email is sent.
 *
 * Needs MONGO_URI set in the Vercel project's environment variables.
 */
import { MongoClient } from 'mongodb';

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

  try {
    const database = await db();
    await database.collection('demo_requests').updateOne(
      { email },
      {
        $set: { email, name, phone, company_name: company, source,
                last_requested_at: now, updated_at: now },
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

  return res.status(201).json({ ok: true, emailed: { confirmation: false, notification: false },
                                queued: false });
}
