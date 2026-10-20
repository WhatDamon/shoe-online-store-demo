"""以独立、无业务环境的进程导出真实 commerce 契约。"""

import argparse
import json
import os
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch

_RUNTIME_ENV_KEYS = frozenset(
    {
        "SYSTEMROOT",
        "WINDIR",
        "SYSTEMDRIVE",
        "TEMP",
        "TMP",
        "TMPDIR",
        "COMSPEC",
        "PATH",
        "PATHEXT",
        "OS",
        "PROCESSOR_ARCHITECTURE",
        "PROCESSOR_ARCHITEW6432",
        "NUMBER_OF_PROCESSORS",
    }
)
_FIXED_ENV = {
    "APP_ENV": "test",
    "NODE_ENV": "test",
    "DATABASE_URL": "sqlite:///:memory:",
    "RESERVATION_SWEEPER_ENABLED": "false",
}


def worker_environment() -> dict[str, str]:
    # 仅访问运行时白名单中的值，不读取业务凭据。
    environment = {key: os.environ[key] for key in os.environ if key.upper() in _RUNTIME_ENV_KEYS}
    return environment | _FIXED_ENV


class _SideEffectError(RuntimeError):
    pass


@contextmanager
def _side_effect_guard():
    from pydantic_settings import DotEnvSettingsSource
    from sqlalchemy.engine import Engine
    from sqlalchemy.pool import Pool

    attempted = False

    def deny(*_args, **_kwargs):
        nonlocal attempted
        attempted = True
        raise _SideEffectError("契约导出禁止数据库或网络连接。")

    with ExitStack() as stack:
        stack.enter_context(patch.object(DotEnvSettingsSource, "_read_env_files", return_value={}))
        for target, name in (
            (Pool, "connect"),
            (Engine, "connect"),
            (sqlite3, "connect"),
            (sqlite3.dbapi2, "connect"),
            (socket.socket, "connect"),
            (socket.socket, "connect_ex"),
            (socket, "getaddrinfo"),
            (socket, "create_connection"),
        ):
            stack.enter_context(patch.object(target, name, deny))
        yield
        # 即使被导入的代码吞掉连接异常，本次导出也不能成功。
        if attempted:
            raise _SideEffectError("契约导出禁止数据库或网络连接。")


def _samples() -> dict[str, list[dict]]:
    from app.schemas.responses import (
        CartResponse,
        OrderResponse,
        PaymentResponse,
        ProductResponse,
    )

    variant = {
        "id": "00000000-0000-4000-8000-000000000002",
        "sku": "DEMO-BLUE-42",
        "color": "蓝色",
        "color_hex": "#336699",
        "size": 42,
        "price": "19.95",
        "currency": "USD",
        "available": 120,
    }
    unavailable_variant = variant | {
        "id": "00000000-0000-4000-8000-000000000003",
        "sku": "DEMO-BLUE-43",
        "size": 43,
        "available": 0,
    }
    products = [
        {
            "id": "00000000-0000-4000-8000-000000000001",
            "handle": "demo-contract-shoe",
            "title": "Demo 轻量运动鞋",
            "description": "仅供契约测试的合成商品。",
            "media": [
                {"url": "/demo/contract-shoe-blue.webp", "color": "蓝色"},
                {"url": "/demo/contract-shoe-detail.webp", "color": None},
            ],
            "variants": [variant, unavailable_variant],
        }
    ]
    item = {
        "id": "00000000-0000-4000-8000-000000000004",
        "variant_id": variant["id"],
        "title": products[0]["title"],
        "sku": variant["sku"],
        "color": variant["color"],
        "size": variant["size"],
        "quantity": 2,
        "unit_price": variant["price"],
    }
    cart_item = item | {"subtotal": "39.90", "available": 120, "sellable": True}
    carts = [
        {"items": [], "total": "0.00", "currency": "USD"},
        {"items": [cart_item], "total": "39.90", "currency": "USD"},
        {
            "items": [cart_item | {"quantity": 99, "subtotal": "1975.05"}],
            "total": "1975.05",
            "currency": "USD",
        },
        {
            "items": [
                cart_item
                | {
                    "variant_id": unavailable_variant["id"],
                    "sku": unavailable_variant["sku"],
                    "size": unavailable_variant["size"],
                    "available": 0,
                    "sellable": False,
                }
            ],
            "total": "39.90",
            "currency": "USD",
        },
    ]
    order = {
        "id": "00000000-0000-4000-8000-000000000101",
        "status": "pending_payment",
        "expires_at": "2030-01-02T03:04:05+00:00",
        "cancellation_reason": None,
        "total": "39.90",
        "currency": "USD",
        "payment_enabled": False,
        "message": "Payments are not available yet.",
        "items": [item | {"id": "00000000-0000-4000-8000-000000000005"}],
    }
    orders = [
        order,
        order
        | {
            "id": "00000000-0000-4000-8000-000000000102",
            "status": "cancelled",
            "cancellation_reason": "customer_cancelled",
        },
        order
        | {
            "id": "00000000-0000-4000-8000-000000000103",
            "status": "cancelled",
            "cancellation_reason": "expired",
        },
        order | {"id": "00000000-0000-4000-8000-000000000104", "expires_at": None},
    ]
    payments = [
        {
            "code": "payment_disabled",
            "payment_enabled": False,
            "provider": "mock",
            "charged": False,
            "order_id": sample["id"],
            "order_status": sample["status"],
            "message": "Payments are not available yet.",
        }
        for sample in orders[:2]
    ]
    return {
        name: [model.model_validate(sample).model_dump(mode="json") for sample in values]
        for name, model, values in (
            ("products", ProductResponse, products),
            ("carts", CartResponse, carts),
            ("orders", OrderResponse, orders),
            ("payments", PaymentResponse, payments),
        )
    }


def _export(samples: bool = False) -> dict:
    with _side_effect_guard():
        from app.main import app

        return _samples() if samples else app.openapi()


@contextmanager
def _windows_worker_exit_guard(pid: int):
    # taskkill can return before descendants exit. Hold their handles for the wait,
    # rejecting PIDs created after the snapshot cutoff if an original PID exited.
    import ctypes
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    for name in ("Process32FirstW", "Process32NextW"):
        function = getattr(kernel32, name)
        function.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
        function.restype = wintypes.BOOL
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    filetime_pointer = ctypes.POINTER(wintypes.FILETIME)
    kernel32.GetSystemTimeAsFileTime.argtypes = [filetime_pointer]
    kernel32.GetSystemTimeAsFileTime.restype = None
    kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE] + [filetime_pointer] * 4
    kernel32.GetProcessTimes.restype = wintypes.BOOL
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    cutoff = wintypes.FILETIME()
    kernel32.GetSystemTimeAsFileTime(ctypes.byref(cutoff))
    cutoff_time = (cutoff.dwHighDateTime << 32) | cutoff.dwLowDateTime
    snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    parents = {}
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        present = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while present:
            parents[entry.th32ProcessID] = entry.th32ParentProcessID
            present = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        if ctypes.get_last_error() != 18:  # ERROR_NO_MORE_FILES
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel32.CloseHandle(snapshot)
    owned = {pid}
    while children := {child for child, parent in parents.items() if parent in owned} - owned:
        owned.update(children)
    handles = []
    try:
        for process_id in owned:
            handle = kernel32.OpenProcess(0x00101000, False, process_id)
            if not handle:
                error = ctypes.get_last_error()
                if error == 87:  # Already exited before the handle was acquired.
                    continue
                raise ctypes.WinError(error)
            handles.append(handle)
            created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
            if not kernel32.GetProcessTimes(
                handle,
                ctypes.byref(created),
                ctypes.byref(exited),
                ctypes.byref(kernel),
                ctypes.byref(user),
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            if ((created.dwHighDateTime << 32) | created.dwLowDateTime) > cutoff_time:
                kernel32.CloseHandle(handles.pop())

        def wait_for_exit():
            deadline = time.monotonic() + 5
            for handle in handles:
                milliseconds = max(0, int((deadline - time.monotonic()) * 1000))
                if kernel32.WaitForSingleObject(handle, milliseconds) != 0:
                    raise OSError("契约 worker 进程树清理失败。")

        yield wait_for_exit
    finally:
        for handle in handles:
            kernel32.CloseHandle(handle)


def _run_worker(command: list[str], backend: Path) -> subprocess.CompletedProcess:
    # A surviving descendant can hold a pipe open indefinitely after launcher
    # termination. Temporary files avoid reader threads and unbounded pipe close.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        worker = subprocess.Popen(
            command,
            cwd=backend,
            env=worker_environment(),
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            start_new_session=os.name != "nt",
        )
        try:
            try:
                worker.wait(timeout=20)
            except subprocess.TimeoutExpired:
                try:
                    if os.name == "nt":
                        # Windows venv launchers can own a second Python process.
                        system_root = os.environ.get("SystemRoot", os.environ.get("SYSTEMROOT", ""))
                        taskkill = Path(system_root) / "System32" / "taskkill.exe"
                        with _windows_worker_exit_guard(worker.pid) as wait_for_exit:
                            cleanup = subprocess.run(
                                [str(taskkill), "/PID", str(worker.pid), "/T", "/F"],
                                env=worker_environment(),
                                capture_output=True,
                                timeout=10,
                                check=False,
                            )
                            if cleanup.returncode:
                                raise OSError("契约 worker 进程树清理失败。")
                            wait_for_exit()
                    else:
                        os.killpg(worker.pid, signal.SIGKILL)
                    worker.wait(timeout=5)
                except (OSError, subprocess.SubprocessError):
                    raise OSError("契约 worker 进程树清理失败。") from None
                raise
            stdout.seek(0)
            stderr.seek(0)
            return subprocess.CompletedProcess(
                command, worker.returncode, stdout.read(), stderr.read()
            )
        finally:
            # Do not use Popen.__exit__: all launcher waits, including failure
            # cleanup, must have a deadline. Failure never claims tree exit.
            if worker.poll() is None:
                try:
                    worker.kill()
                    worker.wait(timeout=5)
                except (OSError, subprocess.SubprocessError):
                    raise OSError("契约 worker 进程树清理失败。") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="隔离导出真实 OpenAPI 或响应样本。")
    parser.add_argument("--samples", action="store_true", help="输出经响应模型验证的合成样本。")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    backend = Path(__file__).resolve().parent
    if not args.worker:
        command = [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--worker"]
        if args.samples:
            command.append("--samples")
        try:
            result = _run_worker(command, backend)
        except subprocess.TimeoutExpired:
            sys.stderr.buffer.write("契约导出超时，worker 已终止。\n".encode())
            return 1
        except (OSError, subprocess.SubprocessError):
            sys.stderr.buffer.write("契约导出失败：worker 启动或清理未通过。\n".encode())
            return 1
        if result.returncode == 0:
            sys.stdout.buffer.write(result.stdout)
        sys.stderr.buffer.write(result.stderr)
        return result.returncode

    if not sys.flags.isolated or not sys.dont_write_bytecode:
        sys.stderr.write("契约 worker 必须由隔离父进程启动。\n")
        return 2
    sys.path.insert(0, str(backend))
    try:
        payload = _export(args.samples)
        output = json.dumps(payload, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
    except _SideEffectError as exc:
        sys.stderr.buffer.write((str(exc) + "\n").encode())
        return 1
    except Exception:
        # 不把导入错误或 Pydantic 错误中的原始配置写入输出。
        sys.stderr.buffer.write("契约导出失败：应用导入或响应模型验证未通过。\n".encode())
        return 1
    sys.stdout.buffer.write(output.encode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
