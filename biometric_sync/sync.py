"""
sync.py
Main entry point. Continuously polls the eSSL device every
POLL_INTERVAL_MINUTES and writes new punches into MySQL.

Run:
    python sync.py

Stop:
    Ctrl+C
"""

import time
import schedule

import config
import db
import device


def run_sync_cycle():
    print("\n" + "=" * 60)
    print("[sync] Starting sync cycle...")

    conn = db.get_connection()
    try:
        db.ensure_unique_constraint(conn)

        # Pull current highest slno so new rows continue counting up from there
        next_slno = db.get_last_slno(conn) + 1

        # Only ask the device for punches newer than the last one we already have
        last_synced = db.get_last_punch_datetime(conn)

        raw_records = device.fetch_attendance(since=last_synced)
        if raw_records is None:
            print("[sync] Device unavailable; no records were synced. Retrying next cycle.")
            return
        if not raw_records:
            print("[sync] No new punches this cycle.")
            return

        # Build (slno, employee_id, punch_datetime) tuples
        rows = []
        for rec in raw_records:
            rows.append((next_slno, rec["employee_id"], rec["punch_datetime"]))
            print(f"[sync]   -> New punch: employee_id={rec['employee_id']}  "
                  f"time={rec['punch_datetime']}  (slno={next_slno})")
            next_slno += 1

        inserted = db.insert_records(conn, rows)
        skipped = len(rows) - inserted
        print(f"[sync] Inserted {inserted} new row(s), skipped {skipped} duplicate(s).")

    finally:
        conn.close()

    print("[sync] Cycle complete.")


def main():
    print(f"[sync] Biometric sync starting. Polling every {config.POLL_INTERVAL_SECONDS} second(s).")
    print(f"[sync] Device: {config.DEVICE_IP}:{config.DEVICE_PORT}")
    print(f"[sync] MySQL:  {config.MYSQL_HOST}/{config.MYSQL_DATABASE}.{config.MYSQL_TABLE}")

    # Run once immediately on startup, then on the schedule
    run_sync_cycle()
    schedule.every(config.POLL_INTERVAL_SECONDS).seconds.do(run_sync_cycle)

    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[sync] Stopped by user.")


if __name__ == "__main__":
    main()