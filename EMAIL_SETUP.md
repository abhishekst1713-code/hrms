# Email setup

Every outbound email in this app — invites, password resets, demo-request
confirmations, offer and relieving letters, birthday and anniversary mail —
goes through `backend/services/email_service.py`. It has two transports and
picks one from the environment:

| Transport | Used when | Port |
|---|---|---|
| Provider HTTP API (Resend, Brevo, SendGrid) | one of the API keys below is set | 443 (HTTPS) |
| SMTP | no API key is set | `SMTP_PORT`, default 587 |

## The problem this solves

On Render, the logs looked like this:

```
WARNING [services.email_service] Email send failed: Your Infopace HR demo
request -> someone@gmail.com ([Errno 101] Network is unreachable)
```

`Errno 101` happens at `connect()`, before any SMTP conversation. Render
blocks outbound connections on ports 25, 465 and 587 from free instances, so
the socket never leaves the host. Nothing in `SMTP_HOST`, `SMTP_USER` or the
Gmail app password can change that — the settings were never reached.

The demo requests themselves were fine throughout: the lead row is written
before the mail is attempted, and the mail runs on a background thread, so
only the confirmation and the internal heads-up were lost.

## The fix: send over HTTPS

Pick one provider, verify a sender address with it, and set two environment
variables in the Render dashboard (**Environment → Environment Variables**).
Port 443 is open, so the send goes out from the same instance.

### Brevo (free: 300 emails/day, no domain required)

1. Sign up at <https://www.brevo.com>, then **Senders, Domains & Dedicated
   IPs → Senders** and add the address you want mail to come from, e.g.
   `support@infopaceindia.com`. Click the link in the verification mail.
2. **SMTP & API → API Keys → Generate a new API key**.
3. On Render set:
   ```
   BREVO_API_KEY=xkeysib-...
   EMAIL_FROM=support@infopaceindia.com
   ```

### Resend (free: 3,000 emails/month, needs a domain)

1. Sign up at <https://resend.com>, add your domain and the DNS records it
   gives you.
2. **API Keys → Create API Key**.
3. On Render set:
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=hr@yourdomain.com
   ```

### SendGrid

1. Sign up, complete **Single Sender Verification** (or domain
   authentication).
2. **Settings → API Keys → Create API Key** with the *Mail Send* permission.
3. On Render set:
   ```
   SENDGRID_API_KEY=SG....
   EMAIL_FROM=hr@yourdomain.com
   ```

Redeploy (or let Render restart the service on the env change) and send a
demo request. The log line becomes:

```
INFO [services.email_service] Email sent via brevo: Your Infopace HR demo request -> ...
```

## Keeping SMTP

If you would rather not change how the app sends mail, SMTP can still work —
but not against Gmail on a free Render instance. Render's changelog is
explicit:

> Free web services can't send outbound network traffic on ports 25, 465, or
> 587, commonly used for SMTP.
>
> — <https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports>

Those three ports are the only ones named. Relay providers also listen on
**2525** for exactly this situation, and Gmail does not offer it at all — so
there are two SMTP routes:

### Route 1: an SMTP relay on port 2525 (stays free)

Check first, from the Render **Shell** tab, what this instance can reach:

```bash
cd backend && python scripts/test_email.py --probe
```

It opens one TCP connection per port and prints which answered. If 2525 is
open, sign up with a relay, take its SMTP credentials — not your Gmail
password — and set:

```
SMTP_HOST=smtp-relay.brevo.com     # SendGrid: smtp.sendgrid.net
SMTP_PORT=2525                     # Mailgun:  smtp.mailgun.org
SMTP_USER=<the provider's SMTP login>
SMTP_PASS=<the provider's SMTP key>
SMTP_FROM=support@infopaceindia.com   # verified with the provider
```

Leave `RESEND_API_KEY` / `BREVO_API_KEY` / `SENDGRID_API_KEY` unset and the
app uses SMTP, exactly as it does locally. Verify with:

```bash
python scripts/test_email.py --to you@example.com
```

### Route 2: a paid Render instance

Upgrading the service to any paid instance type unblocks 465 and 587, and
your existing Gmail settings then work untouched. Port 25 stays blocked
everywhere, so leave `SMTP_PORT` at 587.

Note that Gmail app-password sending is rate limited (roughly 500
recipients/day on a personal account) and Google increasingly rejects SMTP
logins from cloud IP ranges, so a relay is steadier even once the port is
open.

## On Vercel

Vercel's own guidance is that **port 25 is blocked and 465 and 587 are
open** (<https://vercel.com/kb/guide/serverless-functions-and-smtp>), so
plain SMTP works there — including Gmail with an app password, at
`SMTP_PORT=587`. The provider API route works too, and is still steadier
under load.

The catch is not the port, it is the lifecycle: a serverless instance is
frozen as soon as the response is written, so anything handed to a
background thread is paused mid-flight and usually never resumes — no
error, no email. The demo-request endpoint used to hand its mail to a
thread for exactly the right reason (not making the visitor wait), so
`runtime_env.background_work_survives_response()` now decides: a thread on
a container, inline on a serverless host. Nothing to configure;
`FORCE_INLINE_WORK=1` reproduces the inline path locally.

Two other things change shape on a serverless host, both handled at import
in `app.py`:

- **Storage.** The filesystem is read-only apart from the temp directory,
  so `STORAGE_ROOT` falls back to `/tmp/hrms-storage`. That is per-instance
  and wiped between invocations — fine, because durable files go to GridFS,
  but do not expect anything left on disk to still be there.
- **The daily scheduler** (birthday and anniversary mail) is a thread that
  waits for 09:00 and cannot run. It is not started, and the reason is
  logged. To keep those emails, call `scheduler.run_checks_now(app)` from a
  platform cron once a day.

## Checking it

From the `backend` directory:

```bash
python scripts/test_email.py                      # report the configuration
python scripts/test_email.py --probe              # which SMTP ports are open
python scripts/test_email.py --to you@example.com # send a real test message
```

The script names the transport it will use and, when a send fails, prints
what to change — a wrong key, an unverified `EMAIL_FROM`, a Gmail app
password that is not 16 characters, or the blocked-port case above.

## Notes

- `EMAIL_PROVIDER` forces a transport (`resend`, `brevo`, `sendgrid`,
  `smtp`) when more than one is configured. Leave it unset and the first key
  that is present wins, then SMTP.
- `EMAIL_FROM` must be an address the provider has verified, otherwise the
  API answers 403 and the reason is logged verbatim.
- SMTP still works anywhere outbound 587/465 is allowed: local development,
  a VM, a paid Render instance (paid instances allow 465 and 587, not 25).
  Port 465 is handled as implicit TLS, 587 as STARTTLS.
- With nothing configured the app does not fail: invites and resets return
  their link in the API response, and demo requests are still stored and
  readable through `scripts/list_demo_requests.py`.
