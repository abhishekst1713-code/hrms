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
"""
import argparse
import csv
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


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
        w.writerow(['email', 'status', 'requests', 'source', 'first_asked', 'last_asked'])
        for r in rows:
            w.writerow([r.get('email', ''), r.get('status', ''), r.get('request_count', 1),
                        r.get('source', ''),
                        _when(r.get('created_at')), _when(r.get('last_requested_at'))])
        return 0

    print(f'{len(rows)} lead(s), newest first'
          + (f" with status {args.status!r}" if args.status else '') + '\n')
    print(f'{"EMAIL":42} {"STATUS":11} {"#":>3}  {"LAST ASKED":17} SOURCE')
    print('-' * 92)
    for r in rows:
        print(f'{r.get("email", "")[:42]:42} {str(r.get("status", "")):11} '
              f'{r.get("request_count", 1):>3}  {_when(r.get("last_requested_at")):17} '
              f'{r.get("source", "")}')

    total = db.demo_requests.count_documents({})
    if total > len(rows):
        print(f'\n({len(rows)} of {total} shown — raise --limit to see more)')
    return 0


def _when(dt):
    return dt.strftime('%d %b %Y %H:%M') if dt else ''


if __name__ == '__main__':
    sys.exit(main())
