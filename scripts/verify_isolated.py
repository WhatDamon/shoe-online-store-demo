"""Run the commerce smoke test in a disposable, owned-process snapshot.

This runner deliberately does not copy dotenv files, databases, dependency caches,
or generated output. It reports ``passed``, ``failed`` or ``incomplete`` instead of
turning missing PostgreSQL/browser/dependency evidence into a false green result.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path, PurePath, PurePosixPath
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

_EXCLUDED_DIRECTORIES = frozenset(
    {
        ".git",
        "node_modules",
        ".venv",
        "__pycache__",
        ".next",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        ".vitest",
        "data",
        "outputs",
        "dist",
        "build",
    }
)
_EXCLUDED_SUFFIXES = (".db", ".sqlite", ".sqlite3")
_EXCLUDED_SIDECARS = ("-wal", "-shm", "-journal")
_SNAPSHOT_EXCEPTIONS = frozenset(
    {"backend/data/catalog.json", "src/server/catalog/data/supplier.json"}
)
_SAFE_HOST_KEYS = frozenset(
    {
        "COMSPEC",
        "CODEBUDDY_SESSION_ID",
        "CLAUDE_SESSION_ID",
        "CODEBUDDY_BROKERED_FS_HOOK_ENABLED",
        "CODEBUDDY_SAFE_DELETE_BIN_DIR",
        "CODEBUDDY_SAFE_DELETE_BROKER_DELETE",
        "CODEBUDDY_SAFE_DELETE_BULK_GUARD",
        "CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR",
        "CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD",
        "CODEBUDDY_SAFE_DELETE_ENABLED",
        "CODEBUDDY_SAFE_DELETE_REPORT_PATH",
        "CODEBUDDY_SAFE_DELETE_SANDBOX",
        "SANDBOX_CENTER_IPC_ADDRESS",
        "SANDBOX_CENTER_UID",
        "HOME",
        "LOCALAPPDATA",
        "PATH",
        "PATHEXT",
        "PROGRAMDATA",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
    }
)
_SAFE_OVERRIDES = {
    "PYTHONDONTWRITEBYTECODE": "1",
    "AI_DISABLE_REAL": "1",
    "SHOPIFY_ENABLED": "false",
    "NEXT_TELEMETRY_DISABLED": "1",
    "APP_ENV": "development",
    "COMMERCE_PROXY_SECRET": "",
}


class RunnerError(RuntimeError):
    """A controlled runner failure that should become a failed gate."""


def excluded(path: PurePath) -> bool:
    """Return whether a repository-relative path must not enter a snapshot."""

    parts = tuple(part for part in path.parts if part not in ("", "."))
    if any(
        part.lower() in _EXCLUDED_DIRECTORIES
        or part.lower() == ".env"
        or part.lower().startswith(".env.")
        for part in parts[:-1]
    ):
        return True

    name = parts[-1].lower() if parts else ""
    if name in _EXCLUDED_DIRECTORIES:
        return True
    if name == ".env" or name.startswith(".env."):
        return True
    if name.endswith(".pyc"):
        return True
    if any(name.endswith(suffix) for suffix in _EXCLUDED_SUFFIXES):
        return True
    return any(
        name.endswith(suffix + sidecar)
        for suffix in _EXCLUDED_SUFFIXES
        for sidecar in _EXCLUDED_SIDECARS
    )


def _is_reparse(path: Path) -> bool:
    if path.is_symlink():
        return True
    if os.name != "nt" or not path.exists():
        return False
    try:
        attributes = path.stat(follow_symlinks=False).st_file_attributes
    except (AttributeError, OSError):
        return False
    return bool(attributes & 0x400)  # FILE_ATTRIBUTE_REPARSE_POINT


def _reject_reparse_path(path: Path, *, allow_missing_leaf: bool) -> None:
    """Reject symlinks/junctions in a path before resolving it."""

    current = path
    missing: list[Path] = []
    while True:
        if current.exists() or current.is_symlink():
            if _is_reparse(current):
                raise RunnerError(
                    f"snapshot path contains a symbolic link or reparse point: {current}"
                )
            break
        missing.append(current)
        parent = current.parent
        if parent == current:
            break
        current = parent
    for ancestor in (path, *path.parents):
        if (ancestor.exists() or ancestor.is_symlink()) and _is_reparse(ancestor):
            raise RunnerError(
                f"snapshot path contains a symbolic link or reparse point: {ancestor}"
            )
    if missing and not allow_missing_leaf:
        raise RunnerError(f"snapshot path does not exist: {path}")


def _resolved_without_reparse(path: Path, *, allow_missing_leaf: bool) -> Path:
    _reject_reparse_path(path, allow_missing_leaf=allow_missing_leaf)
    return path.resolve(strict=False)


def _assert_snapshot_paths(source: Path, destination: Path) -> tuple[Path, Path]:
    source = Path(source)
    destination = Path(destination)
    if not source.is_dir():
        raise RunnerError(f"snapshot source is not a directory: {source}")
    source_resolved = _resolved_without_reparse(source, allow_missing_leaf=False)
    destination_resolved = _resolved_without_reparse(destination, allow_missing_leaf=True)
    if source_resolved == destination_resolved:
        raise RunnerError("snapshot source and destination must be different")
    if source_resolved in destination_resolved.parents:
        raise RunnerError("snapshot destination cannot be inside the source")
    if destination_resolved in source_resolved.parents:
        raise RunnerError("snapshot destination cannot contain the source")
    if destination.exists() and any(destination.iterdir()):
        raise RunnerError(f"snapshot destination must be absent or empty: {destination}")
    return source_resolved, destination_resolved


def _git_environment() -> dict[str, str]:
    environment = safe_environment()
    environment.update(
        {
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
            "LC_ALL": "C",
        }
    )
    return environment


def _git(source: Path, *arguments: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(source), *arguments],
            cwd=source,
            env=_git_environment(),
            capture_output=True,
            check=True,
            timeout=30,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RunnerError(
            f"git snapshot command failed: {arguments[0] if arguments else 'git'}"
        ) from error
    return result.stdout


def _repository_files(source: Path) -> list[PurePosixPath]:
    output = _git(source, "ls-files", "-z", "-c", "-o", "--exclude-standard")
    names = [name for name in output.split("\0") if name]
    paths = sorted({PurePosixPath(name) for name in names}, key=lambda value: value.as_posix())
    included: list[PurePosixPath] = []
    for relative in paths:
        if excluded(relative) and relative.as_posix() not in _SNAPSHOT_EXCEPTIONS:
            continue
        if any(part in ("", ".", "..") for part in relative.parts):
            raise RunnerError(f"git returned an unsafe relative path: {relative}")
        included.append(relative)
    return included


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _manifest_digest(files: dict[str, str]) -> str:
    digest = hashlib.sha256()
    for relative, checksum in sorted(files.items()):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(checksum.encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def _safe_destination_file(destination: Path, relative: PurePosixPath) -> Path:
    target = destination.joinpath(*relative.parts)
    resolved = target.resolve(strict=False)
    root = destination.resolve(strict=False)
    if resolved != root and root not in resolved.parents:
        raise RunnerError(f"snapshot file escapes destination: {relative}")
    _reject_reparse_path(target.parent, allow_missing_leaf=True)
    if target.exists() or target.is_symlink():
        if _is_reparse(target):
            raise RunnerError(f"snapshot target is a symbolic link or reparse point: {target}")
    return target


def snapshot(source: Path, destination: Path) -> dict[str, Any]:
    """Copy the real source bytes and return a reproducible source manifest."""

    source, destination = _assert_snapshot_paths(Path(source), Path(destination))
    # Git does not traverse directory symlinks/junctions; reject them before
    # trusting ls-files, otherwise an omitted link looks deceptively safe.
    for directory, names, _ in os.walk(source, followlinks=False):
        for name in list(names):
            relative = PurePosixPath((Path(directory) / name).relative_to(source).as_posix())
            has_exception_below = any(
                exception == relative.as_posix() or exception.startswith(relative.as_posix() + "/")
                for exception in _SNAPSHOT_EXCEPTIONS
            )
            if excluded(relative) and not has_exception_below:
                names.remove(name)
            elif _is_reparse(Path(directory) / name):
                raise RunnerError(f"snapshot refuses linked directory: {relative}")
    files = _repository_files(source)
    created_destination = not destination.exists()
    try:
        destination.mkdir(parents=True, exist_ok=False) if created_destination else None
        checksums: dict[str, str] = {}
        for relative in files:
            origin = source.joinpath(*relative.parts)
            if not origin.is_file() or _is_reparse(origin):
                raise RunnerError(f"snapshot refuses non-regular or linked file: {relative}")
            target = _safe_destination_file(destination, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            if _is_reparse(target.parent):
                raise RunnerError(f"snapshot target parent is linked: {target.parent}")
            _reject_reparse_path(origin, allow_missing_leaf=False)
            before = _file_digest(origin)
            shutil.copyfile(origin, target, follow_symlinks=False)
            shutil.copymode(origin, target, follow_symlinks=False)
            copied = _file_digest(target)
            if before != copied or _file_digest(origin) != copied:
                raise RunnerError(f"source changed while snapshotting: {relative}")
            checksums[relative.as_posix()] = copied
        return {
            "files": checksums,
            "sha256": _manifest_digest(checksums),
            "head": _git(source, "rev-parse", "HEAD").strip(),
            "tree": _git(source, "rev-parse", "HEAD^{tree}").strip(),
            "dirty": bool(_git(source, "status", "--porcelain=v1", "-z", "--untracked-files=all")),
        }
    except Exception:
        # Retain partial disposable evidence; never recursively delete user paths.
        raise


def safe_environment(*, node: Path | None = None, python: Path | None = None) -> dict[str, str]:
    """Build a child environment without inheriting application secrets or proxies."""

    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in _SAFE_HOST_KEYS and isinstance(value, str)
    }
    options = os.environ.get("NODE_OPTIONS", "").strip()
    match = re.fullmatch(r'--require=(?:"([^"]+)"|([^\\s]+))', options)
    if match:
        preload = Path(match.group(1) or match.group(2))
        normalized = preload.as_posix()
        if (
            normalized.endswith("/app.asar.unpacked/cli/vendor/shim/node-language-shim.cjs")
            and preload.is_file()
        ):
            # Preserve the host's filesystem protection, never arbitrary preloads.
            environment["NODE_OPTIONS"] = options
    host_path = next((value for key, value in environment.items() if key.upper() == "PATH"), "")
    path_entries = [entry for entry in host_path.split(os.pathsep) if entry]
    for executable in (node, python):
        if executable is None:
            continue
        parent = str(Path(executable).absolute().parent)
        if parent not in path_entries:
            path_entries.insert(0, parent)
    if path_entries:
        path_key = next((key for key in environment if key.upper() == "PATH"), "PATH")
        environment[path_key] = os.pathsep.join(path_entries)
    environment.update(_SAFE_OVERRIDES)
    return environment


if os.name == "nt":

    class _WindowsJob:
        """Job Object that kills descendants when its handle is closed."""

        _KILL_ON_CLOSE = 0x2000
        _EXTENDED_LIMIT_INFORMATION = 9

        def __init__(self, pid: int) -> None:
            self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            self._kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
            self._kernel32.CreateJobObjectW.restype = wintypes.HANDLE
            self._kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            self._kernel32.OpenProcess.restype = wintypes.HANDLE
            self._kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            self._kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
            self._kernel32.SetInformationJobObject.argtypes = [
                wintypes.HANDLE,
                ctypes.c_int,
                ctypes.c_void_p,
                wintypes.DWORD,
            ]
            self._kernel32.SetInformationJobObject.restype = wintypes.BOOL
            self._kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            self._kernel32.CloseHandle.restype = wintypes.BOOL
            self._handle = self._kernel32.CreateJobObjectW(None, None)
            if not self._handle:
                raise OSError(ctypes.get_last_error(), "CreateJobObjectW failed")
            try:
                self._set_kill_on_close()
                process = self._kernel32.OpenProcess(0x0100 | 0x0001, False, pid)
                if not process:
                    raise OSError(ctypes.get_last_error(), "OpenProcess failed")
                try:
                    if not self._kernel32.AssignProcessToJobObject(self._handle, process):
                        raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
                finally:
                    self._kernel32.CloseHandle(process)
            except Exception:
                self.close()
                raise

        def _set_kill_on_close(self) -> None:
            class BasicLimitInformation(ctypes.Structure):
                _fields_ = [
                    ("PerProcessUserTimeLimit", ctypes.c_longlong),
                    ("PerJobUserTimeLimit", ctypes.c_longlong),
                    ("LimitFlags", ctypes.c_uint32),
                    ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t),
                    ("ActiveProcessLimit", ctypes.c_uint32),
                    ("Affinity", ctypes.c_size_t),
                    ("PriorityClass", ctypes.c_uint32),
                    ("SchedulingClass", ctypes.c_uint32),
                ]

            class IoCounters(ctypes.Structure):
                _fields_ = [
                    ("ReadOperationCount", ctypes.c_uint64),
                    ("WriteOperationCount", ctypes.c_uint64),
                    ("OtherOperationCount", ctypes.c_uint64),
                    ("ReadTransferCount", ctypes.c_uint64),
                    ("WriteTransferCount", ctypes.c_uint64),
                    ("OtherTransferCount", ctypes.c_uint64),
                ]

            class ExtendedLimitInformation(ctypes.Structure):
                _fields_ = [
                    ("BasicLimitInformation", BasicLimitInformation),
                    ("IoInfo", IoCounters),
                    ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t),
                ]

            limits = ExtendedLimitInformation()
            limits.BasicLimitInformation.LimitFlags = self._KILL_ON_CLOSE
            if not self._kernel32.SetInformationJobObject(
                self._handle,
                self._EXTENDED_LIMIT_INFORMATION,
                ctypes.byref(limits),
                ctypes.sizeof(limits),
            ):
                raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")

        def close(self) -> None:
            if getattr(self, "_handle", None):
                self._kernel32.CloseHandle(self._handle)
                self._handle = None

else:

    class _WindowsJob:  # pragma: no cover - platform placeholder
        def __init__(self, pid: int) -> None:
            raise RuntimeError(f"Windows job requested on {os.name}: {pid}")

        def close(self) -> None:
            return None


class OwnedProcess:
    """A process plus the process-group/job ownership needed for safe cleanup."""

    def __init__(self, command: list[str], *, cwd: Path, env: dict[str, str], log: Path) -> None:
        if not command:
            raise ValueError("owned process command cannot be empty")
        if not Path(cwd).is_dir():
            raise ValueError(f"owned process cwd is not a directory: {cwd}")
        if log.exists() and _is_reparse(log):
            raise ValueError(f"owned process log cannot be a link: {log}")
        log.parent.mkdir(parents=True, exist_ok=True)
        self.command = list(command)
        self.log = Path(log)
        self._log_handle = self.log.open("w", encoding="utf-8", buffering=1)
        self._closed = False
        self._close_result: dict[str, Any] | None = None
        self._job: _WindowsJob | None = None
        creationflags = 0
        start_new_session = os.name != "nt"
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        try:
            launch_command = self.command
            if os.name == "nt":
                # The worker cannot spawn the command until assignment succeeds.
                # Starting the actual command first races fast exits and descendants.
                worker = (
                    "import json,subprocess,sys; "
                    "gate=sys.stdin.buffer.read(1); "
                    "sys.exit(125) if gate!=b'1' else None; "
                    "child=subprocess.Popen(json.loads(sys.argv[1]),stdin=subprocess.DEVNULL); "
                    "sys.exit(child.wait())"
                )
                launch_command = [
                    sys.executable,
                    "-B",
                    "-u",
                    "-c",
                    worker,
                    json.dumps(self.command),
                ]
            self.process = subprocess.Popen(
                launch_command,
                cwd=str(cwd),
                env=dict(env),
                stdin=subprocess.PIPE if os.name == "nt" else subprocess.DEVNULL,
                stdout=self._log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
                start_new_session=start_new_session,
            )
            if os.name == "nt":
                self._job = _WindowsJob(self.process.pid)
                assert self.process.stdin is not None
                self.process.stdin.write(b"1")
                self.process.stdin.close()
        except Exception:
            self._log_handle.close()
            if hasattr(self, "process") and self.process.poll() is None:
                self.process.kill()
                self.process.wait(timeout=5)
            if self._job is not None:
                self._job.close()
            raise

    def wait(self, *, timeout: float) -> int:
        if timeout <= 0:
            raise ValueError("process wait timeout must be positive")
        return self.process.wait(timeout=timeout)

    def _terminate_group(self) -> str | None:
        errors: list[str] = []
        if os.name == "nt":
            if self._job is not None:
                try:
                    self._job.close()
                    self._job = None
                except OSError as error:
                    errors.append(f"job close: {error}")
            if self.process.poll() is None:
                try:
                    self.process.kill()
                except OSError as error:
                    errors.append(f"process kill: {error}")
        else:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except OSError as error:
                errors.append(f"process group terminate: {error}")
        return "; ".join(errors) or None

    def close(self) -> dict[str, Any]:
        if self._close_result is not None:
            return dict(self._close_result)
        cleanup_error = self._terminate_group()
        if os.name != "nt":
            # A parent can already be dead while its group still contains children.
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                self.process.poll()
                try:
                    os.killpg(self.process.pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.02)
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError as error:
                cleanup_error = f"process group kill: {error}"
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if os.name != "nt":
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError as error:
                    cleanup_error = "; ".join(
                        filter(None, [cleanup_error, f"process group kill: {error}"])
                    )
            try:
                self.process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired) as error:
                cleanup_error = "; ".join(filter(None, [cleanup_error, f"process reap: {error}"]))
        try:
            self._log_handle.close()
        except OSError as error:
            cleanup_error = "; ".join(filter(None, [cleanup_error, f"log close: {error}"]))
        self._closed = True
        self._close_result = {
            "pid": self.process.pid,
            "closed": self.process.poll() is not None and cleanup_error is None,
        }
        if cleanup_error:
            self._close_result["cleanup_error"] = cleanup_error
        return dict(self._close_result)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _listener_pids(port: int) -> set[int]:
    """Inspect listener ownership without sending requests to an unknown service."""
    if os.name == "nt":
        api = ctypes.WinDLL("iphlpapi", use_last_error=True)
        api.GetExtendedTcpTable.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(wintypes.DWORD),
            wintypes.BOOL,
            wintypes.ULONG,
            ctypes.c_int,
            wintypes.ULONG,
        ]
        api.GetExtendedTcpTable.restype = wintypes.DWORD
        size = wintypes.DWORD()
        api.GetExtendedTcpTable(None, ctypes.byref(size), False, socket.AF_INET, 3, 0)
        buffer = ctypes.create_string_buffer(size.value)
        if api.GetExtendedTcpTable(buffer, ctypes.byref(size), False, socket.AF_INET, 3, 0):
            raise RunnerError("cannot verify TCP listener ownership")
        count = ctypes.c_uint32.from_buffer(buffer).value
        values = (ctypes.c_uint32 * (count * 6)).from_buffer(buffer, 4)
        return {
            values[index * 6 + 5]
            for index in range(count)
            if values[index * 6] == 2 and socket.ntohs(values[index * 6 + 2] & 0xFFFF) == port
        }
    if sys.platform != "linux":
        raise RunnerError("TCP listener ownership is supported on Windows and Linux only")
    inodes = set()
    for table in (Path("/proc/net/tcp"), Path("/proc/net/tcp6")):
        for line in table.read_text().splitlines()[1:]:
            fields = line.split()
            if fields[3] == "0A" and int(fields[1].split(":")[1], 16) == port:
                inodes.add(fields[9])
    result = set()
    for process_dir in Path("/proc").iterdir():
        if not process_dir.name.isdigit():
            continue
        try:
            for descriptor in (process_dir / "fd").iterdir():
                target = os.readlink(descriptor)
                if target.startswith("socket:[") and target[8:-1] in inodes:
                    result.add(int(process_dir.name))
        except (OSError, PermissionError):
            continue
    return result


def _belongs_to(process: OwnedProcess, pid: int) -> bool:
    if os.name != "nt":
        try:
            return os.getpgid(pid) == process.process.pid
        except ProcessLookupError:
            return False
    if process._job is None:
        return False
    api = process._job._kernel32
    api.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
    api.IsProcessInJob.restype = wintypes.BOOL
    handle = api.OpenProcess(0x0400, False, pid)
    if not handle:
        raise RunnerError("cannot inspect listener process ownership")
    try:
        assigned = wintypes.BOOL()
        if not api.IsProcessInJob(handle, process._job._handle, ctypes.byref(assigned)):
            raise RunnerError("cannot verify listener job ownership")
        return bool(assigned.value)
    finally:
        api.CloseHandle(handle)


def _validate_ready_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
        raise ValueError("readiness URL must use http://127.0.0.1")
    if parsed.username or parsed.password or parsed.port is None:
        raise ValueError("readiness URL must contain a loopback port and no credentials")


def wait_ready(process: OwnedProcess, url: str, *, timeout: float) -> None:
    """Probe only a live owned process on canonical loopback until it is ready."""

    if timeout <= 0:
        raise ValueError("readiness timeout must be positive")
    _validate_ready_url(url)
    deadline = time.monotonic() + timeout
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    last_error: BaseException | None = None
    while time.monotonic() < deadline:
        if process.process.poll() is not None:
            raise RuntimeError(
                f"owned process exited before readiness: {process.process.returncode}"
            )
        listeners = _listener_pids(urlsplit(url).port)
        if not listeners:
            time.sleep(min(0.05, max(0.0, deadline - time.monotonic())))
            continue
        if not all(_belongs_to(process, pid) for pid in listeners):
            raise RunnerError("readiness refused a listener outside the owned process tree")
        remaining = max(0.05, min(1.0, deadline - time.monotonic()))
        try:
            request = Request(url, method="GET")
            with opener.open(request, timeout=remaining) as response:
                if 200 <= response.status < 300:
                    return
                last_error = RuntimeError(f"readiness returned HTTP {response.status}")
        except HTTPError as error:
            last_error = error
        except (OSError, URLError, TimeoutError) as error:
            last_error = error
        time.sleep(min(0.05, max(0.0, deadline - time.monotonic())))
    if process.process.poll() is not None:
        raise RuntimeError(
            f"owned process exited before readiness: {process.process.returncode}"
        ) from last_error
    raise TimeoutError(f"readiness timed out for {url}") from last_error


def outcome(
    gates: list[dict[str, Any]],
    cleanup: list[dict[str, Any]],
    missing: list[str],
    *,
    profile: str = "foundation",
) -> dict[str, Any]:
    """Summarize gate state without allowing incomplete evidence to become green."""
    if profile not in {"foundation", "full"}:
        raise ValueError("unknown verification profile")
    missing = list(dict.fromkeys(missing))
    if profile == "full":
        missing.extend(
            key for key in ("postgres_evidence", "browser_evidence") if key not in missing
        )

    if any(gate.get("status") == "failed" for gate in gates) or any(
        result.get("closed") is not True for result in cleanup
    ):
        status = "failed"
    elif missing or any(gate.get("status") == "incomplete" for gate in gates):
        status = "incomplete"
    else:
        status = "passed"
    return {"status": status, "gates": gates, "cleanup": cleanup, "missing": missing}


def _command_gate(
    name: str,
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    log: Path,
    timeout: float = 180,
) -> dict[str, Any]:
    started = time.monotonic()
    result: dict[str, Any] = {
        "name": name,
        "status": "failed",
        "returncode": None,
        "command": command,
        "cwd": str(cwd),
        "log": str(log),
    }
    owned = None
    try:
        owned = OwnedProcess(command, cwd=cwd, env=env, log=log)
        result["returncode"] = owned.wait(timeout=timeout)
        result["status"] = "passed" if result["returncode"] == 0 else "failed"
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        result["error"] = type(error).__name__
    finally:
        if owned is not None:
            result["cleanup"] = owned.close()
            if not result["cleanup"]["closed"]:
                result["status"] = "failed"
        result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return result


def _default_source() -> Path:
    return Path(__file__).resolve().parents[1]


def _default_run_dir(source: Path) -> Path:
    return source.parent / f"r7-run-{uuid4().hex}"


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.resolve().as_posix()}"


def _copy_dependencies(origin: Path, source_copy: Path) -> dict[str, Any]:
    """Copy a lock-matched dependency tree; never link it back to the source."""
    origin = Path(origin).absolute()
    _reject_reparse_path(origin, allow_missing_leaf=False)
    lock = source_copy / "package-lock.json"
    if (
        not lock.is_file()
        or (origin.parent / "package-lock.json").read_bytes() != lock.read_bytes()
    ):
        raise RunnerError("dependency source package-lock does not match snapshot")
    installed_lock = origin / ".package-lock.json"
    installed = json.loads(installed_lock.read_text(encoding="utf-8"))["packages"]
    expected = json.loads(lock.read_text(encoding="utf-8"))["packages"]
    for name, entry in installed.items():
        wanted = expected.get(name)
        if wanted is None or entry.get("version") != wanted.get("version"):
            raise RunnerError("installed dependency versions do not match snapshot lock")
        if entry.get("integrity") != wanted.get("integrity"):
            raise RunnerError("installed dependency integrity metadata differs from snapshot lock")
    # npm links in .bin may point to files inside the tree. Materialize them;
    # reject directory links/escapes instead of traversing unknown locations.
    # The project lock is authoritative: npm's hidden lock can omit an installed
    # optional package, while dependency packages may contain test fixtures with
    # their own nested node_modules directories that are not runtime dependencies.
    expected_packages = {name for name in expected if name.startswith("node_modules/")}
    installed_packages = {name for name in installed if name.startswith("node_modules/")}
    for name in expected_packages - installed_packages:
        if not expected[name].get("optional"):
            raise RunnerError("installed dependency lock omits a required package")
    for directory, dirs, files in os.walk(origin, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            if _is_reparse(path):
                target = path.resolve()
                if path.is_dir() or origin.resolve() not in target.parents:
                    raise RunnerError("dependency tree contains an escaping or directory link")
        container = Path(directory)
        if container != origin and container.name != "node_modules":
            continue
        if container == origin:
            parent_package = None
        else:
            parent_relative = container.parent.relative_to(origin).as_posix()
            parent_package = "node_modules/" + parent_relative
            if parent_package not in expected_packages:
                # This is a package-owned fixture directory such as
                # resolve/test/shadowed_core/node_modules, not an install root.
                continue
        package_paths = []
        for name in dirs:
            if name.startswith("."):
                continue
            candidate = container / name
            if name.startswith("@"):
                package_paths.extend(
                    child
                    for child in candidate.iterdir()
                    if child.is_dir() and not child.name.startswith(".")
                )
            else:
                package_paths.append(candidate)
        for package_path in package_paths:
            relative = "node_modules/" + package_path.relative_to(origin).as_posix()
            if relative not in expected_packages:
                raise RunnerError("physical dependency tree contains an unlocked package")
            metadata = json.loads((package_path / "package.json").read_text(encoding="utf-8"))
            if metadata.get("version") != expected[relative].get("version"):
                raise RunnerError("physical dependency version differs from snapshot lock")
    before = _file_digest(installed_lock)
    destination = source_copy / "node_modules"
    shutil.copytree(
        origin,
        destination,
        symlinks=False,
        ignore=lambda _directory, names: [
            name for name in names if name.lower() == ".env" or name.lower().startswith(".env.")
        ],
    )
    if before != _file_digest(installed_lock) or before != _file_digest(
        destination / ".package-lock.json"
    ):
        raise RunnerError("dependency source changed while copying")
    return {
        "name": "node_dependencies",
        "status": "passed",
        "installed_packages": len(installed),
        "package_lock_sha256": _file_digest(lock),
        "installed_lock_sha256": before,
        "strategy": "physical_copy_of_explicit_lock_matched_source",
    }


def _python_dependency_probe() -> str:
    """Code executed by the selected interpreter, not the runner interpreter."""
    return """
import importlib
import importlib.metadata
import json
from pathlib import Path
import sys

lock = Path(sys.argv[1])
expected = {}
for line in lock.read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    name, separator, version = line.partition('==')
    if not separator or not name or not version or ';' in version:
        raise ValueError('dependency lock must contain exact version pins')
    expected[name] = version
installed = {}
missing = []
mismatch = []
for name, version in expected.items():
    try:
        actual = importlib.metadata.version(name)
        installed[name] = actual
        if actual != version:
            mismatch.append(name)
    except importlib.metadata.PackageNotFoundError:
        missing.append(name)
report = {'python_version': sys.version.split()[0], 'executable': sys.executable,
          'installed': installed, 'missing': missing, 'mismatch': mismatch}
print(json.dumps(report, sort_keys=True), flush=True)
if sys.version_info < (3, 12) or mismatch:
    sys.exit(1)
if missing:
    sys.exit(2)
for module in ('alembic', 'fastapi', 'httpx', 'sqlalchemy', 'uvicorn',
               'pydantic_settings', 'pytest', 'mypy'):
    importlib.import_module(module)
from packaging.requirements import Requirement
conflicts = []
for name in installed:
    for text in importlib.metadata.requires(name) or []:
        requirement = Requirement(text)
        if requirement.marker and not requirement.marker.evaluate({'extra': ''}):
            continue
        try:
            actual = importlib.metadata.version(requirement.name)
            if not requirement.specifier.contains(actual, prereleases=True):
                conflicts.append([name, requirement.name])
        except importlib.metadata.PackageNotFoundError:
            conflicts.append([name, requirement.name])
print(json.dumps({'dependency_conflicts': conflicts}, sort_keys=True), flush=True)
sys.exit(1 if conflicts else 0)
"""


class _StopRun(Exception):
    """Stop subsequent stages but still finalize evidence and owned cleanup."""


def run_isolated(
    *,
    source: Path,
    run_dir: Path,
    node: Path | None,
    python: Path | None,
    next_port: int,
    python_port: int,
    node_modules: Path | None = None,
    profile: str = "foundation",
    quality: bool = False,
    npm_cli: Path | None = None,
) -> dict[str, Any]:
    """Create a snapshot, then run migrations/services/smoke if dependencies exist."""

    if profile not in {"foundation", "full"}:
        raise ValueError("unknown verification profile")
    if not all(1 <= port <= 65535 for port in (next_port, python_port)) or next_port == python_port:
        raise ValueError("service ports must be distinct and within 1..65535")
    source, run_dir = _assert_snapshot_paths(Path(source).absolute(), Path(run_dir).absolute())
    if run_dir.exists():
        raise RunnerError("run directory must be newly created by this runner")
    if not run_dir.parent.is_dir():
        raise RunnerError("run directory parent must already exist")
    run_dir.mkdir(exist_ok=False)
    source_copy = run_dir / "source"
    gates: list[dict[str, Any]] = []
    cleanup: list[dict[str, Any]] = []
    missing: list[str] = []
    snapshot_manifest: dict[str, Any] | None = None
    processes: list[OwnedProcess] = []
    try:
        snapshot_manifest = snapshot(Path(source), source_copy)
        (run_dir / "snapshot-manifest.json").write_text(
            json.dumps(snapshot_manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        gates.append({"name": "source_snapshot", "status": "passed", **snapshot_manifest})

        node = Path(node).absolute() if node is not None else None
        python = Path(python).absolute() if python is not None else None
        if node is None or not node.is_file():
            missing.append("node_runtime")
        if python is None or not python.is_file():
            missing.append("python_runtime")
        if node_modules is None:
            missing.append("isolated_node_modules")
        if missing:
            raise _StopRun()
        python_lock = source_copy / "backend" / "requirements-dev.lock"
        backend_import = _command_gate(
            "python_dependencies",
            [str(python), "-B", "-c", _python_dependency_probe(), str(python_lock)],
            cwd=source_copy,
            env=safe_environment(python=python),
            log=run_dir / "logs" / "python-dependencies.log",
            timeout=30,
        )
        if backend_import["returncode"] == 2 and backend_import.get("cleanup", {}).get("closed"):
            backend_import["status"] = "incomplete"
            missing.append("python_dependencies")
        backend_import["lock_sha256"] = _file_digest(python_lock)
        gates.append(backend_import)
        if backend_import["status"] != "passed":
            raise _StopRun()
        gates.append(_copy_dependencies(node_modules, source_copy))

        child_env = safe_environment(node=node, python=python)
        database_path = run_dir / "commerce.sqlite3"
        display_database_path = run_dir / "display.sqlite3"
        child_env.update(
            {
                "DATABASE_URL": _sqlite_url(database_path),
                "DB_DRIVER": "sqlite",
                "PYTHON_API_URL": f"http://127.0.0.1:{python_port}",
                "NODE_ENV": "development",
                "RESERVATION_SWEEPER_ENABLED": "false",
                "COMMERCE_PROXY_SECRET": "r7-test-" + uuid4().hex,
                "AI_API_KEY": "",
                "AI_SESSION_SECRET": "r7-session-" + uuid4().hex,
                "CATALOG_SOURCE": "seed",
            }
        )
        backend = source_copy / "backend"
        if quality:
            npm_cli = (npm_cli or node.parent / "node_modules/npm/bin/npm-cli.js").absolute()
            if not npm_cli.is_file():
                missing.append("npm_cli_runtime")
                raise _StopRun()
            frontend_env = {**child_env, "DATABASE_URL": display_database_path.as_posix()}
            python_test_env = {**child_env, "COMMERCE_PROXY_SECRET": "", "APP_ENV": "test"}
            checks = [
                (
                    "frontend_verify",
                    [str(node), str(npm_cli), "run", "verify"],
                    source_copy,
                    frontend_env,
                ),
                (
                    "frontend_build",
                    [str(node), str(npm_cli), "run", "build"],
                    source_copy,
                    {**frontend_env, "NODE_ENV": "production", "APP_ENV": "production"},
                ),
                (
                    "python_lint",
                    [str(python), "-m", "ruff", "check", "app", "migrations", "tests"],
                    backend,
                    python_test_env,
                ),
                (
                    "python_format",
                    [str(python), "-m", "ruff", "format", "--check", "app", "migrations", "tests"],
                    backend,
                    python_test_env,
                ),
                (
                    "runner_lint",
                    [
                        str(python),
                        "-m",
                        "ruff",
                        "check",
                        "--config",
                        "backend/pyproject.toml",
                        "scripts/verify_isolated.py",
                        "scripts/test_verify_isolated.py",
                    ],
                    source_copy,
                    python_test_env,
                ),
                (
                    "runner_format",
                    [
                        str(python),
                        "-m",
                        "ruff",
                        "format",
                        "--check",
                        "--config",
                        "backend/pyproject.toml",
                        "scripts/verify_isolated.py",
                        "scripts/test_verify_isolated.py",
                    ],
                    source_copy,
                    python_test_env,
                ),
                ("python_mypy", [str(python), "-m", "mypy"], backend, python_test_env),
                (
                    "python_tests_sqlite",
                    [str(python), "-m", "pytest", "-q"],
                    backend,
                    python_test_env,
                ),
                (
                    "runner_tests",
                    [
                        str(python),
                        "-B",
                        "-m",
                        "unittest",
                        "discover",
                        "-s",
                        "scripts",
                        "-p",
                        "test_verify_isolated.py",
                        "-v",
                    ],
                    source_copy,
                    python_test_env,
                ),
            ]
            for name, command, cwd, environment in checks:
                gates.append(
                    _command_gate(
                        name,
                        command,
                        cwd=cwd,
                        env=environment,
                        log=run_dir / "logs" / f"{name}.log",
                        timeout=600,
                    )
                )
                if gates[-1]["status"] != "passed":
                    raise _StopRun()
        for name, command in (
            ("backend_migrate", [str(python), "-m", "alembic", "upgrade", "head"]),
            ("backend_schema_check", [str(python), "-m", "alembic", "check"]),
            ("backend_seed", [str(python), "-m", "app.seed"]),
        ):
            gates.append(
                _command_gate(
                    name,
                    command,
                    cwd=backend,
                    env=child_env,
                    log=run_dir / "logs" / f"{name}.log",
                )
            )
            if gates[-1]["status"] != "passed":
                raise _StopRun()

        backend_process = OwnedProcess(
            [
                str(python),
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(python_port),
                "--no-access-log",
            ],
            cwd=backend,
            env=child_env,
            log=run_dir / "logs" / "backend.log",
        )
        processes.append(backend_process)
        try:
            wait_ready(backend_process, f"http://127.0.0.1:{python_port}/health", timeout=20)
            gates.append({"name": "backend_ready", "status": "passed"})
        except (RuntimeError, TimeoutError, ValueError) as error:
            gates.append(
                {"name": "backend_ready", "status": "failed", "error": type(error).__name__}
            )
            raise _StopRun() from error

        child_env.update(
            {
                "DATABASE_URL": display_database_path.as_posix(),
            }
        )
        next_binary = source_copy / "node_modules" / "next" / "dist" / "bin" / "next"
        frontend_process = OwnedProcess(
            [
                str(node),
                str(next_binary),
                "dev",
                "--hostname",
                "127.0.0.1",
                "--port",
                str(next_port),
            ],
            cwd=source_copy,
            env=child_env,
            log=run_dir / "logs" / "frontend.log",
        )
        processes.append(frontend_process)
        try:
            wait_ready(frontend_process, f"http://127.0.0.1:{next_port}/", timeout=30)
            gates.append({"name": "frontend_ready", "status": "passed"})
        except (RuntimeError, TimeoutError, ValueError) as error:
            gates.append(
                {"name": "frontend_ready", "status": "failed", "error": type(error).__name__}
            )
            raise _StopRun() from error

        smoke = _command_gate(
            "commerce_smoke",
            [
                str(python),
                "scripts/smoke-commerce.py",
                "--base-url",
                f"http://127.0.0.1:{next_port}",
            ],
            cwd=source_copy,
            env=child_env,
            log=run_dir / "logs" / "commerce-smoke.log",
            timeout=90,
        )
        gates.append(smoke)
    except _StopRun:
        pass
    except (OSError, RunnerError, subprocess.SubprocessError, ValueError) as error:
        gates.append(
            {
                "name": "runner",
                "status": "failed",
                "error": type(error).__name__,
                "detail": str(error),
            }
        )
    finally:
        for process in reversed(processes):
            cleanup.append(process.close())
        result_path = run_dir / "evidence.json"
        cleanup.extend(gate["cleanup"] for gate in gates if "cleanup" in gate)
        final = outcome(gates, cleanup, sorted(set(missing)), profile=profile)
        final["profile"] = profile
        final["quality_requested"] = quality
        final["run_dir"] = str(run_dir)
        if snapshot_manifest is not None:
            final["snapshot"] = snapshot_manifest
        result_path.write_text(
            json.dumps(final, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return final


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=_default_source())
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--python", dest="python_executable", type=Path)
    parser.add_argument(
        "--node-modules", type=Path, help="explicit lock-matched dependency source to copy"
    )
    parser.add_argument("--npm-cli", type=Path, help="explicit npm-cli.js for quality checks")
    parser.add_argument("--profile", choices=("foundation", "full"), default="foundation")
    parser.add_argument(
        "--quality", action="store_true", help="also run existing quality/build gates"
    )
    parser.add_argument("--next-port", type=int, default=3100)
    parser.add_argument("--python-port", type=int, default=8100)
    args = parser.parse_args(argv)
    source = args.source.absolute()
    run_dir = (args.run_dir or _default_run_dir(source)).absolute()
    node = args.node or (Path(shutil.which("node")) if shutil.which("node") else None)
    python = args.python_executable or Path(sys.executable)
    result = run_isolated(
        source=source,
        run_dir=run_dir,
        node=node,
        python=python,
        next_port=args.next_port,
        python_port=args.python_port,
        node_modules=args.node_modules,
        profile=args.profile,
        quality=args.quality,
        npm_cli=args.npm_cli,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return {"passed": 0, "incomplete": 2, "failed": 1}[result["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
