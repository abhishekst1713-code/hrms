"""
device.py
Connects to the eSSL/ZKTeco biometric device and returns attendance records
in a clean, normalized format ready for MySQL insertion.
"""

from zk import ZK
import config


def fetch_attendance(since=None):
    """
    Connect to the device, pull attendance logs, and return only the ones
    newer than `since` (a datetime, or None to return everything — used on
    the very first run when the table is empty).

    Returns None (and prints the error) if the device is unreachable so the
    sync loop can distinguish a connection failure from zero new records.
    """
    zk = ZK(
        config.DEVICE_IP,
        port=config.DEVICE_PORT,
        timeout=config.DEVICE_TIMEOUT,
        ommit_ping=True,
    )
    conn = None
    records = []
    stage = "connect"

    try:
        conn = zk.connect()
        stage = "disable device"
        conn.disable_device()  # pause device briefly so reads are consistent

        stage = "read attendance"
        attendance = conn.get_attendance()
        for entry in attendance:
            if since is not None and entry.timestamp <= since:
                continue  # already synced, skip
            records.append({
                "employee_id": str(entry.user_id),
                "punch_datetime": entry.timestamp,  # already a datetime object
            })

        # Oldest first, so slno order matches punch order
        records.sort(key=lambda r: r["punch_datetime"])

        if since is not None:
            print(f"[device] Found {len(records)} new punch(es) since {since}.")
        else:
            print(f"[device] First run — fetched all {len(records)} record(s) from device.")

    except Exception as e:
        print(f"[device] ERROR during {stage} at {config.DEVICE_IP}:{config.DEVICE_PORT}: {e}")
        return None

    finally:
        if conn:
            try:
                conn.enable_device()
            except Exception as e:
                print(f"[device] WARNING: could not re-enable device: {e}")
            try:
                conn.disconnect()
            except Exception as e:
                print(f"[device] WARNING: could not disconnect cleanly: {e}")

    return records