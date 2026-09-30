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

## Checking it

From the `backend` directory:

```bash
python scripts/test_email.py                      # report the configuration
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
