"""
runtime_env.py — what the host we are running on does and does not allow.

This app runs on two shapes of host: a normal container (Docker, Render, a
laptop), where one process stays alive between requests and the working
directory is writable, and a serverless host (Vercel), where neither is
true. The two differences that matter are silent ones:

  * a thread started during a request is paused when the response is sent
    and may never resume, so work handed to one is simply lost;
  * the filesystem is read-only apart from the temp directory, so the first
    os.makedirs() at import raises and takes the whole app down with it.

Both are cheap to handle once here and expensive to rediscover from a 500.
"""
import logging
import os
import tempfile

log = logging.getLogger(__name__)


def is_serverless():
    """Vercel sets VERCEL=1 in build and runtime; Lambda-style runtimes set
    AWS_LAMBDA_FUNCTION_NAME. SERVERLESS=1 declares it for anything else
    that behaves the same way."""
    return bool(os.getenv('VERCEL') or os.getenv('AWS_LAMBDA_FUNCTION_NAME')
                or os.getenv('SERVERLESS'))


def background_work_survives_response():
    """Whether work handed to a thread during a request will actually run.

    FORCE_INLINE_WORK=1 forces the inline path anywhere (useful to reproduce
    serverless behaviour locally); =0 keeps threads even on a host detected
    as serverless."""
    override = os.getenv('FORCE_INLINE_WORK')
    if override is not None:
        return override.strip() not in ('1', 'true', 'yes')
    return not is_serverless()


def writable_storage_root(subdirs=()):
    """The directory for generated files, created and confirmed writable.

    STORAGE_ROOT wins if set. Otherwise ./storage, and if that cannot be
    created — a read-only serverless filesystem — the temp directory, which
    is the one writable place. Temp storage is per-instance and wiped, so
    anything that has to outlive a request belongs in GridFS; every route
    that stores documents already puts them there."""
    candidates = [os.getenv('STORAGE_ROOT') or os.path.join(os.getcwd(), 'storage')]
    fallback = os.path.join(tempfile.gettempdir(), 'hrms-storage')
    if fallback not in candidates:
        candidates.append(fallback)

    last_error = None
    for root in candidates:
        try:
            for d in subdirs:
                os.makedirs(os.path.join(root, d), exist_ok=True)
            os.makedirs(root, exist_ok=True)
            return root
        except OSError as e:
            last_error = e
            continue

    # Nothing is writable. Returning the path anyway keeps import working:
    # the routes that write files will fail individually, which is a far
    # better failure than the whole API refusing to start.
    log.error('No writable storage directory (%s); file writes will fail', last_error)
    return candidates[-1]
