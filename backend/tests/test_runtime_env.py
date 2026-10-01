"""
tests/test_runtime_env.py — the two serverless differences, pinned.

Both were silent failures: a thread that never resumes sends no mail and
logs nothing, and an os.makedirs() on a read-only filesystem takes down the
whole app at import.
"""
import os

import pytest

import runtime_env


ENV = ('VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'SERVERLESS', 'FORCE_INLINE_WORK',
       'STORAGE_ROOT')


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ENV:
        monkeypatch.delenv(name, raising=False)


def test_container_host_is_not_serverless():
    assert runtime_env.is_serverless() is False
    assert runtime_env.background_work_survives_response() is True


@pytest.mark.parametrize('var', ['VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'SERVERLESS'])
def test_each_marker_is_recognised(monkeypatch, var):
    monkeypatch.setenv(var, '1')
    assert runtime_env.is_serverless() is True
    # The point of detecting it at all: mail must be sent before the
    # response, not handed to a thread that gets frozen.
    assert runtime_env.background_work_survives_response() is False


def test_force_inline_work_overrides_both_ways(monkeypatch):
    monkeypatch.setenv('FORCE_INLINE_WORK', '1')
    assert runtime_env.background_work_survives_response() is False

    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.setenv('FORCE_INLINE_WORK', '0')
    assert runtime_env.background_work_survives_response() is True


def test_storage_root_creates_subdirs(monkeypatch, tmp_path):
    monkeypatch.setenv('STORAGE_ROOT', str(tmp_path / 'store'))
    root = runtime_env.writable_storage_root(['letters', 'previews'])
    assert root == str(tmp_path / 'store')
    assert os.path.isdir(os.path.join(root, 'letters'))
    assert os.path.isdir(os.path.join(root, 'previews'))


def test_read_only_filesystem_falls_back_to_temp(monkeypatch, tmp_path):
    """The Vercel case: ./storage cannot be created, and the app must still
    import rather than 500 on every request.

    EROFS is raised rather than acted out with permissions, because the
    suite may run as root, and root writes into a 0o500 directory happily.
    """
    import errno
    import tempfile

    blocked = str(tmp_path / 'storage')
    real_makedirs = os.makedirs

    def fake_makedirs(path, *args, **kwargs):
        if str(path).startswith(blocked):
            raise OSError(errno.EROFS, 'Read-only file system', path)
        return real_makedirs(path, *args, **kwargs)

    monkeypatch.setenv('STORAGE_ROOT', blocked)
    monkeypatch.setattr(runtime_env.os, 'makedirs', fake_makedirs)

    root = runtime_env.writable_storage_root(['letters'])

    assert root != blocked
    assert root.startswith(tempfile.gettempdir())
    assert os.path.isdir(os.path.join(root, 'letters'))
