"""Puts the backend directory on sys.path so `import services...` works the
same whether the suite is run as `pytest` or `python -m pytest`."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
