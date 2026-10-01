"""
scripts/list_demo_requests.py — print the "Book a demo" leads from the
marketing site.

The API's GET /api/demo-requests is platform-admin only, which means a browser
address bar cannot read it (no Authorization header) — deliberately, since the
collection is every prospect's email address. This is the local equivalent for
whoever has server access.

    python scripts/list_demo_requests.py
    python scripts/list_demo_requests.py --status new --limit 20
    python scripts/list_demo_requests.py --csv > leads.csv

Run it from the backend directory so it picks up backend/.env for MONGO_URI.
Needs pymongo. python-dotenv is optional: without it the script falls back to
the MONGO_URI environment variable, then to mongodb://localhost:27017.
"""
import argparse
import csv
import os
import sys

from pymongo import MongoClient

# python-dotenv is optional here. This script is often run with whichever
# interpreter is to hand rather than the backend's venv, and a missing optional
# import should not stop it: without it we fall back to MONGO_URI from the real
# environment, then to the local default.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
except ImportError:
    pass


def main():
    ap = argparse.ArgumentParser(description='List Book-a-demo leads.')
    ap.add_argument('--status', help='only this status (e.g. new, contacted)')
    ap.add_argument('--limit', type=int, default=100, help='max rows (default 100)')
    ap.add_argument('--csv', action='store_true', help='emit CSV instead of a table')
    args = ap.parse_args()

    uri = os.getenv('MONGO_URI', 'mongodb://localhost:27017/hr_offer_letters')
    try:
        db = MongoClient(uri, serverSelectionTimeoutMS=4000).hr_offer_letters
        db.command('ping')
    except Exception as e:
        print(f'Could not reach MongoDB at {uri}\n  {e}', file=sys.stderr)
        return 1

    query = {'status': args.status} if args.status else {}
    rows = list(db.demo_requests.find(query, {'_id': 0})
                .sort('last_requested_at', -1).limit(args.limit))

    if not rows:
        print('No demo requests stored yet.'
              if not args.status else f'No demo requests with status {args.status!r}.')
        return 0

    if args.csv:
        w = csv.writer(sys.stdout)
        w.writerow(['name', 'company', 'phone', 'email', 'status', 'requests', 'mail_triggered',
                    'source', 'first_asked', 'last_asked'])
        for r in rows:
            w.writerow([r.get('name', ''), r.get('company_name', ''), r.get('phone', ''),
                        r.get('email', ''), r.get('status', ''), r.get('request_count', 1),
                        r.get('mail_triggered', False), r.get('source', ''),
                        _when(r.get('created_at')), _when(r.get('last_requested_at'))])
        return 0

    print(f'{len(rows)} lead(s), newest first'
          + (f" with status {args.status!r}" if args.status else '') + '\n')
    print(f'{"NAME":22} {"COMPANY":22} {"PHONE":16} {"EMAIL":36} {"STATUS":11} {"#":>3}  '
          f'{"MAIL":5}  {"LAST ASKED":17} SOURCE')
    print('-' * 156)
    for r in rows:
        print(f'{r.get("name", "")[:22]:22} {r.get("company_name", "")[:22]:22} '
              f'{r.get("phone", "")[:16]:16} '
              f'{r.get("email", "")[:36]:36} {str(r.get("status", "")):11} '
              f'{r.get("request_count", 1):>3}  {str(bool(r.get("mail_triggered", False))):5}  '
              f'{_when(r.get("last_requested_at")):17} '
              f'{r.get("source", "")}')

    total = db.demo_requests.count_documents({})
    if total > len(rows):
        print(f'\n({len(rows)} of {total} shown — raise --limit to see more)')
    return 0


def _when(dt):
    return dt.strftime('%d %b %Y %H:%M') if dt else ''


if __name__ == '__main__':
    sys.exit(main())
