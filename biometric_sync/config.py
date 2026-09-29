"""
config.py
All connection settings in one place. Edit these values for your environment.
"""

import os

# ---------------- eSSL / ZKTeco Device ----------------
DEVICE_IP = os.getenv("DEVICE_IP", "192.168.0.4")
DEVICE_PORT = int(os.getenv("DEVICE_PORT", "4370"))
DEVICE_TIMEOUT = int(os.getenv("DEVICE_TIMEOUT", "10"))  # seconds

# ---------------- MySQL ----------------
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "Hrms@2004")  # set via env var, don't hardcode in real use
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "hr_attendance_db")
MYSQL_TABLE = "biometric_attendance"

# ---------------- Sync Behavior ----------------
# How often to check the device for new punches. The device can't "push"
# events to us — pyzk has no live-event mode for most eSSL models — so we
# poll instead. A short interval (e.g. 30 seconds) makes each login/logout
# show up in MySQL almost immediately without hammering the device.
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))