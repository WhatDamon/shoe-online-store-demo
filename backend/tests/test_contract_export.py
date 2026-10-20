import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import nullcontext
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic_settings import DotEnvSettingsSource
from sqlalchemy.engine import Engine
from sqlalchemy.pool import Pool

import export_contract
from app.config import Settings
from app.main import app
from app.schemas.responses import (
    CartResponse,
    OrderResponse,
    PaymentResponse,
    ProductResponse,
    VariantResponse,
)

BACKEND = Path(__file__).resolve().parents[1]
RUNTIME_KEYS = {
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
TEST_ENV = {
    "APP_ENV": "test",
    "NODE_ENV": "test",
    "DATABASE_URL": "sqlite:///:memory:",
    "RESERVATION_SWEEPER_ENABLED": "false",
}
DEMO_SECRET = "synthetic-hostile-secret-never-export"


def cli(backend=BACKEND, args=(), extra_env=None, cwd=None):
    environment = {key: os.environ[key] for key in os.environ if key.upper() in RUNTIME_KEYS}
    environment.update(TEST_ENV)
    environment.update(extra_env or {})
    return subprocess.run(
        [sys.executable, "-I", "-B", str(backend / "export_contract.py"), *args],
        cwd=cwd or backend,
        env=environment,
        capture_output=True,
        check=False,
        timeout=30,
    )


def successful(result):
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    assert result.stderr == b""
    payload = json.loads(result.stdout.decode("utf-8"))
    assert result.stdout == (
        json.dumps(payload, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    return payload


@pytest.fixture
def minimal_backend(tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    shutil.copyfile(BACKEND / "export_contract.py", backend / "export_contract.py")
    # 只复制应用 Python 源码，不读取真实 .env、数据或本地凭据。
    for source in (BACKEND / "app").rglob("*.py"):
        target = backend / source.relative_to(BACKEND)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    assert not (backend / ".env").exists()
    return backend


@pytest.mark.parametrize("args", [(), ("--samples",)])
def test_cli_is_byte_stable_and_ignores_hostile_environment(args, tmp_path):
    first = cli(args=args)
    second = cli(args=args)
    successful(first)
    successful(second)
    assert second.stdout == first.stdout
    fake_pythonpath = tmp_path / "pythonpath"
    fake_pythonpath.mkdir()
    (fake_pythonpath / "sitecustomize.py").write_text(
        "raise RuntimeError('hostile PYTHONPATH was imported')\n", encoding="utf-8"
    )
    hostile = cli(
        args=args,
        cwd=tmp_path,
        extra_env={
            "APP_ENV": "production",
            "NODE_ENV": "production",
            "DATABASE_URL": "invalid-database-url",
            "COMMERCE_PROXY_SECRET": DEMO_SECRET,
            "RESERVATION_SWEEPER_ENABLED": "true",
            "RESERVATION_TTL_SECONDS": "invalid",
            "RESERVATION_SWEEP_SECONDS": "invalid",
            "RESERVATION_SWEEP_BATCH_SIZE": "invalid",
            "COMMERCE_TEST_POSTGRES_URL": "invalid-postgres-url",
            "OPENAI_API_KEY": DEMO_SECRET,
            "PYTHONPATH": str(fake_pythonpath),
            "PYTHONHOME": str(tmp_path / "invalid-python-home"),
            "PYTHONIOENCODING": "ascii",
        },
    )
    successful(hostile)
    assert hostile.stdout == first.stdout
    assert DEMO_SECRET.encode() not in hostile.stdout + hostile.stderr


def test_worker_environment_is_an_allowlist(monkeypatch):
    monkeypatch.setattr(
        os,
        "environ",
        {
            "SystemRoot": "synthetic-windows-root",
            "PATH": "synthetic-runtime-path",
            "TMP": "synthetic-temp",
            "APP_ENV": "production",
            "NODE_ENV": "production",
            "DATABASE_URL": "invalid",
            "COMMERCE_PROXY_SECRET": DEMO_SECRET,
            "UNRELATED_BUSINESS_VALUE": DEMO_SECRET,
            "PYTHONPATH": "synthetic-pythonpath",
        },
    )
    assert export_contract.worker_environment() == TEST_ENV | {
        "SystemRoot": "synthetic-windows-root",
        "PATH": "synthetic-runtime-path",
        "TMP": "synthetic-temp",
    }


@pytest.mark.parametrize("args", [(), ("--samples",)])
def test_cli_ignores_poison_dotenv_and_creates_no_files(minimal_backend, tmp_path, args):
    forbidden_db = tmp_path / "must-not-exist.db"
    dotenv = minimal_backend / ".env"
    dotenv.write_text(
        "APP_ENV=production\n"
        "NODE_ENV=production\n"
        f"DATABASE_URL=sqlite:///{forbidden_db.as_posix()}\n"
        f"COMMERCE_PROXY_SECRET={DEMO_SECRET}\n"
        "RESERVATION_TTL_SECONDS=invalid\n"
        "RESERVATION_SWEEPER_ENABLED=true\n",
        encoding="utf-8",
    )
    before = {path.relative_to(tmp_path) for path in tmp_path.rglob("*")}
    baseline = cli(args=args)
    poisoned = cli(backend=minimal_backend, args=args)
    successful(baseline)
    successful(poisoned)
    assert poisoned.stdout == baseline.stdout
    assert DEMO_SECRET.encode() not in poisoned.stdout + poisoned.stderr
    assert not forbidden_db.exists()
    assert {path.relative_to(tmp_path) for path in tmp_path.rglob("*")} == before


def test_real_worker_has_isolated_flags_and_fixed_configuration(minimal_backend):
    database = minimal_backend / "app" / "infrastructure" / "database.py"
    with database.open("a", encoding="utf-8") as stream:
        stream.write(
            "\nimport os\nimport sys\n"
            "assert sys.flags.isolated and sys.dont_write_bytecode\n"
            "assert settings.app_env == 'test'\n"
            "assert os.environ['NODE_ENV'] == 'test'\n"
            "assert settings.database_url == 'sqlite:///:memory:'\n"
            "assert settings.reservation_sweeper_enabled is False\n"
            "assert settings.commerce_proxy_secret == ''\n"
            "assert not {'PYTHONPATH', 'PYTHONHOME', 'COMMERCE_PROXY_SECRET', "
            "'OPENAI_API_KEY', 'UNRELATED_BUSINESS_VALUE'} & os.environ.keys()\n"
        )
    result = cli(
        backend=minimal_backend,
        extra_env={
            "APP_ENV": "production",
            "NODE_ENV": "production",
            "DATABASE_URL": "invalid",
            "RESERVATION_SWEEPER_ENABLED": "true",
            "COMMERCE_PROXY_SECRET": DEMO_SECRET,
            "OPENAI_API_KEY": DEMO_SECRET,
            "UNRELATED_BUSINESS_VALUE": DEMO_SECRET,
            "PYTHONPATH": "synthetic-pythonpath",
            "PYTHONHOME": "synthetic-pythonhome",
        },
    )
    successful(result)


def test_openapi_is_the_real_application_schema():
    document = successful(cli())
    assert document == app.openapi()
    paths = document["paths"]
    assert len(paths) == 11
    expected = [
        ("/health", "get", "HealthResponse"),
        ("/api/v1/catalog/products/{handle}", "get", "ProductResponse"),
        ("/api/v1/cart", "get", "CartResponse"),
        ("/api/v1/cart/items", "post", "CartResponse"),
        ("/api/v1/cart/items/{item_id}", "patch", "CartResponse"),
        ("/api/v1/cart/items/{item_id}", "delete", "CartResponse"),
        ("/api/v1/checkout/preview", "post", "CartResponse"),
        ("/api/v1/checkout/create-order", "post", "OrderResponse"),
        ("/api/v1/orders/{order_id}", "get", "OrderResponse"),
        ("/api/v1/orders/{order_id}/cancel", "post", "OrderResponse"),
        ("/api/v1/payments/session", "post", "PaymentResponse"),
    ]
    for path, method, model in expected:
        response = paths[path][method]["responses"]["200"]
        assert response["content"]["application/json"]["schema"] == {
            "$ref": f"#/components/schemas/{model}"
        }
    catalog = paths["/api/v1/catalog/products"]["get"]["responses"]["200"]
    schema = catalog["content"]["application/json"]["schema"]
    assert schema["type"] == "array"
    assert schema["items"]["$ref"] == "#/components/schemas/ProductResponse"


def test_samples_validate_with_authoritative_models_and_cover_boundaries():
    samples = successful(cli(args=("--samples",)))
    assert {name: len(values) for name, values in samples.items()} == {
        "products": 1,
        "carts": 4,
        "orders": 4,
        "payments": 2,
    }
    for name, model in (
        ("products", ProductResponse),
        ("carts", CartResponse),
        ("orders", OrderResponse),
        ("payments", PaymentResponse),
    ):
        for sample in samples[name]:
            assert model.model_validate(sample).model_dump(mode="json") == sample
            assert set(sample) == set(model.model_fields)
    product = samples["products"][0]
    assert product["media"] and product["variants"]
    assert {media["color"] for media in product["media"]} == {"蓝色", None}
    assert {variant["available"] for variant in product["variants"]} == {120, 0}
    for variant in product["variants"]:
        assert set(variant) == set(VariantResponse.model_fields)
    carts = samples["carts"]
    assert carts[0] == {"items": [], "total": "0.00", "currency": "USD"}
    assert carts[1]["items"][0]["quantity"] == 2
    assert carts[1]["items"][0]["sellable"] is True
    assert carts[2]["items"][0]["quantity"] == 99
    assert carts[3]["items"][0]["available"] == 0
    assert carts[3]["items"][0]["sellable"] is False
    for cart in carts:
        assert Decimal(cart["total"]) == sum(
            (Decimal(item["subtotal"]) for item in cart["items"]), Decimal("0.00")
        )
        for item in cart["items"]:
            assert Decimal(item["subtotal"]) == Decimal(item["unit_price"]) * item["quantity"]
    orders = samples["orders"]
    assert orders[0]["status"] == "pending_payment"
    assert orders[0]["expires_at"] is not None
    assert orders[0]["cancellation_reason"] is None
    assert {(order["status"], order["cancellation_reason"]) for order in orders[1:3]} == {
        ("cancelled", "customer_cancelled"),
        ("cancelled", "expired"),
    }
    assert orders[3]["expires_at"] is None
    assert orders[3]["cancellation_reason"] is None
    assert all(order["items"] and order["payment_enabled"] is False for order in orders)
    payments = samples["payments"]
    assert {payment["order_status"] for payment in payments} == {"pending_payment", "cancelled"}
    for payment in payments:
        assert payment["code"] == "payment_disabled"
        assert payment["provider"] == "mock"
        assert payment["payment_enabled"] is False
        assert payment["charged"] is False
    assert "Demo 轻量运动鞋".encode() in cli(args=("--samples",)).stdout


@pytest.mark.parametrize("args", [(), ("--samples",)])
@pytest.mark.parametrize(
    "attempt",
    [
        "from sqlalchemy import create_engine\ncreate_engine('sqlite:///:memory:').connect()",
        "from sqlalchemy import create_engine\ncreate_engine('sqlite:///:memory:').pool.connect()",
        "import sqlite3\nsqlite3.connect('must-not-exist.db')",
        "import sqlite3.dbapi2\nsqlite3.dbapi2.connect('must-not-exist.db')",
        "import socket\nwith socket.socket() as connection:\n"
        "    connection.connect(('127.0.0.1', 9))",
        "import socket\nsocket.create_connection(('127.0.0.1', 9))",
        "import socket\nsocket.getaddrinfo('example.invalid', 80)",
        "import socket\nwith socket.socket() as connection:\n"
        "    connection.connect_ex(('127.0.0.1', 9))",
        "try:\n    engine.connect()\nexcept RuntimeError:\n    pass",
    ],
    ids=[
        "engine",
        "pool",
        "sqlite",
        "sqlite-dbapi",
        "socket",
        "create-connection",
        "dns",
        "connect-ex",
        "swallowed",
    ],
)
def test_cli_fails_closed_on_import_side_effects(minimal_backend, args, attempt):
    # 在临时基础设施模块故意加入副作用，不替换 app、路由或响应模型。
    database = minimal_backend / "app" / "infrastructure" / "database.py"
    with database.open("a", encoding="utf-8") as stream:
        stream.write("\n" + attempt + "\n")
    before = {path.relative_to(minimal_backend) for path in minimal_backend.rglob("*")}
    result = cli(backend=minimal_backend, args=args)
    assert result.returncode == 1
    assert result.stdout == b""
    assert "禁止数据库或网络连接" in result.stderr.decode("utf-8")
    assert {path.relative_to(minimal_backend) for path in minimal_backend.rglob("*")} == before


@pytest.mark.parametrize("args", [(), ("--samples",)])
def test_main_real_timeout_terminates_worker_without_leaking_output(
    minimal_backend, monkeypatch, capsysbinary, args
):
    pid_file = minimal_backend / "worker.pid"
    completed_file = minimal_backend / "worker.completed"
    with (minimal_backend / "app" / "__init__.py").open("a", encoding="utf-8") as stream:
        stream.write(
            "\nimport os\nimport sys\nimport time\nfrom pathlib import Path\n"
            f"print({DEMO_SECRET!r}, flush=True)\n"
            f"print({DEMO_SECRET!r}, file=sys.stderr, flush=True)\n"
            f"Path({str(pid_file)!r}).write_text(str(os.getpid()), encoding='ascii')\n"
            "time.sleep(10)\n"
            f"Path({str(completed_file)!r}).write_text('completed', encoding='ascii')\n"
        )

    real_popen = subprocess.Popen
    workers = []
    timeouts = []
    output_files = []
    worker_pid = None
    ready_at = None
    worker_handle = None
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel32.TerminateProcess.restype = wintypes.BOOL

    def tracked_popen(*popen_args, **popen_kwargs):
        nonlocal worker_pid, ready_at, worker_handle
        worker = real_popen(*popen_args, **popen_kwargs)
        if "--worker" not in popen_args[0]:
            return worker
        workers.append(worker)
        # 复制真实临时文件描述符，exporter 关闭后仍可核验 worker 写入的内容。
        for name in ("stdout", "stderr"):
            output_files.append(os.fdopen(os.dup(popen_kwargs[name].fileno()), "rb"))
        real_wait = worker.wait

        def short_timeout_wait(*wait_args, **wait_kwargs):
            if wait_kwargs.get("timeout") == 20:
                wait_kwargs["timeout"] = 0.2
            try:
                return real_wait(*wait_args, **wait_kwargs)
            except subprocess.TimeoutExpired as exc:
                timeouts.append(exc)
                raise

        worker.wait = short_timeout_wait
        # 启动就绪后再计短超时，避免慢机器尚未执行延迟源码就通过用例。
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if pid_file.exists():
                value = pid_file.read_text(encoding="ascii")
                if value:
                    worker_pid = int(value)
                    break
            assert worker.poll() is None, "真实 worker 在进入延迟前已退出。"
            time.sleep(0.01)
        assert worker_pid is not None, "真实 worker 未写出自身 PID。"
        assert worker_pid != os.getpid()
        if sys.platform == "win32":
            # venv redirector 的 Popen.pid 可能只是启动器；持有实际 PID 的句柄防止复用。
            worker_handle = kernel32.OpenProcess(0x00100001, False, worker_pid)
            if not worker_handle:
                raise ctypes.WinError(ctypes.get_last_error())
            assert kernel32.WaitForSingleObject(worker_handle, 0) == 258
        else:
            os.kill(worker_pid, 0)
        ready_at = time.monotonic()
        return worker

    monkeypatch.setattr(export_contract, "__file__", str(minimal_backend / "export_contract.py"))
    monkeypatch.setattr(export_contract.subprocess, "Popen", tracked_popen)
    try:
        assert export_contract.main(list(args)) == 1
        captured = capsysbinary.readouterr()
        assert captured.out == b""
        assert captured.err == "契约导出超时，worker 已终止。\n".encode()
        assert len(workers) == len(timeouts) == 1
        assert timeouts[0].timeout == 0.2
        assert "--worker" in timeouts[0].cmd
        assert len(output_files) == 2
        for output in output_files:
            output.seek(0)
            assert DEMO_SECRET.encode() in output.read()
        assert DEMO_SECRET.encode() not in captured.out + captured.err
        assert workers[0].poll() is not None
        assert time.monotonic() - ready_at < 5, "超时出口仍在等待实际 worker。"
        assert not completed_file.exists(), "实际 worker 自然完成了延迟，并未被超时终止。"
        if sys.platform == "win32":
            assert kernel32.WaitForSingleObject(worker_handle, 0) == 0, (
                f"实际 worker PID {worker_pid} 在超时返回后仍存活；Popen PID 为 {workers[0].pid}。"
            )
        else:
            with pytest.raises(ProcessLookupError):
                os.kill(worker_pid, 0)
    finally:
        # 先验收 exporter 的清理；测试失败后仅通过已持有句柄精确回收。
        if sys.platform == "win32" and worker_handle:
            try:
                if kernel32.WaitForSingleObject(worker_handle, 0) == 258:
                    assert kernel32.TerminateProcess(worker_handle, 1)
                assert kernel32.WaitForSingleObject(worker_handle, 5000) == 0
            finally:
                assert kernel32.CloseHandle(worker_handle)
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
            worker.wait(timeout=5)
        for output in output_files:
            output.close()


@pytest.mark.skipif(os.name != "nt", reason="仅验证 Windows 进程树清理失败路径")
@pytest.mark.parametrize(
    "failure", ["launch", "command-timeout", "exit-wait", "command-status", "snapshot"]
)
def test_windows_cleanup_failure_kills_and_reaps_launcher(monkeypatch, failure):
    calls = []

    class Worker:
        pid = 123
        returncode = None

        def poll(self):
            return self.returncode

        def kill(self):
            calls.append("kill")
            self.returncode = 1

        def wait(self, *, timeout):
            calls.append(("wait", timeout))
            if timeout == 20:
                raise subprocess.TimeoutExpired("worker", timeout)
            assert timeout == 5
            self.returncode = 1
            return self.returncode

    def failed_cleanup(*_args, **kwargs):
        assert kwargs["timeout"] == 10
        if failure == "launch":
            raise OSError("synthetic")
        if failure == "command-timeout":
            raise subprocess.TimeoutExpired("taskkill", 10)
        return subprocess.CompletedProcess("taskkill", 1 if failure == "command-status" else 0)

    def exit_guard(_pid):
        if failure == "snapshot":
            raise OSError("synthetic snapshot failure")

        def wait_for_exit():
            if failure == "exit-wait":
                raise OSError("synthetic wait failure")

        return nullcontext(wait_for_exit)

    monkeypatch.setattr(export_contract.subprocess, "Popen", lambda *_args, **_kwargs: Worker())
    monkeypatch.setattr(export_contract.subprocess, "run", failed_cleanup)
    monkeypatch.setattr(export_contract, "_windows_worker_exit_guard", exit_guard)
    with pytest.raises(OSError, match="进程树清理失败"):
        export_contract._run_worker(["synthetic-worker"], BACKEND)
    assert calls == [("wait", 20), "kill", ("wait", 5)]


@pytest.mark.skipif(os.name != "nt", reason="仅验证 Windows 创建时间及句柄所有权")
@pytest.mark.parametrize(
    "scenario",
    ["original", "reused", "creation-error", "open-error", "enumeration-error", "wait-error"],
)
def test_windows_worker_exit_guard_checks_creation_and_closes_handles(monkeypatch, scenario):
    import ctypes

    calls = []
    opened = []
    closed = []
    waited = []
    # 把孙进程放在父进程之前，确保快照顺序不会截断后代闭包。
    entries = [(125, 124), (999, 998), (124, 123), (123, 0)]
    cutoff = (1 << 32) + 100
    creation = {1123: cutoff, 1124: cutoff - 1, 1125: (1 << 32) - 1}
    if scenario == "reused":
        creation[1124] = 2 << 32

    class Function:
        def __init__(self, implementation):
            self.implementation = implementation

        def __call__(self, *args):
            return self.implementation(*args)

    def set_filetime(pointer, value):
        pointer._obj.dwLowDateTime = value & 0xFFFFFFFF
        pointer._obj.dwHighDateTime = value >> 32

    def get_cutoff(pointer):
        calls.append("cutoff")
        set_filetime(pointer, cutoff)

    def snapshot(flags, pid):
        calls.append("snapshot")
        assert calls == ["cutoff", "snapshot"], "cutoff 必须在进程快照之前采集。"
        assert (flags, pid) == (2, 0)
        return 900

    def populate(pointer, index):
        entry = pointer._obj
        entry.th32ProcessID, entry.th32ParentProcessID = entries[index]
        assert entry.dwSize == ctypes.sizeof(entry)
        return True

    entry_index = 0

    def first(handle, pointer):
        assert handle == 900
        return populate(pointer, 0)

    def next_entry(handle, pointer):
        nonlocal entry_index
        assert handle == 900
        entry_index += 1
        if entry_index == len(entries):
            ctypes.set_last_error(5 if scenario == "enumeration-error" else 18)
            return False
        return populate(pointer, entry_index)

    def open_process(access, inherit, pid):
        assert access == 0x00101000
        assert not inherit
        assert pid in {123, 124, 125}, "不能打开快照中的无关进程。"
        if scenario == "open-error" and len(opened) == 1:
            ctypes.set_last_error(5)
            return None
        handle = pid + 1000
        opened.append(handle)
        return handle

    def process_times(handle, created, exited, kernel, user):
        assert handle in opened
        assert handle not in closed
        calls.append(("creation", handle))
        if scenario == "creation-error" and len(opened) == 2:
            ctypes.set_last_error(5)
            return False
        set_filetime(created, creation[handle])
        for pointer in (exited, kernel, user):
            set_filetime(pointer, 0)
        return True

    def wait(handle, milliseconds):
        assert handle in opened
        assert handle not in closed
        assert 0 <= milliseconds <= 5000
        assert creation[handle] <= cutoff, "不能等待快照之后创建的替换 PID。"
        waited.append(handle)
        return 258 if scenario == "wait-error" else 0

    def close(handle):
        assert handle == 900 or handle in opened
        assert handle not in closed, "同一句柄不能关闭两次。"
        closed.append(handle)
        return True

    class Kernel32:
        GetSystemTimeAsFileTime = Function(get_cutoff)
        CreateToolhelp32Snapshot = Function(snapshot)
        Process32FirstW = Function(first)
        Process32NextW = Function(next_entry)
        OpenProcess = Function(open_process)
        GetProcessTimes = Function(process_times)
        WaitForSingleObject = Function(wait)
        CloseHandle = Function(close)

    def win_dll(name, *, use_last_error):
        assert name == "kernel32" and use_last_error
        return Kernel32()

    monkeypatch.setattr(ctypes, "WinDLL", win_dll)

    def guarded():
        with export_contract._windows_worker_exit_guard(123) as wait_for_exit:
            assert closed == ([900, 1124] if scenario == "reused" else [900])
            wait_for_exit()

    if scenario in {"original", "reused"}:
        guarded()
        assert set(opened) == {1123, 1124, 1125}
        expected = set(opened) - ({1124} if scenario == "reused" else set())
        assert set(waited) == expected
        assert len(waited) == len(expected)
        assert {handle for event, handle in calls[2:]} == set(opened)
    else:
        with pytest.raises(OSError):
            guarded()
        if scenario in {"creation-error", "open-error", "enumeration-error"}:
            assert waited == []
    assert calls[:2] == ["cutoff", "snapshot"]
    assert set(closed) == {900, *opened}
    assert len(closed) == 1 + len(opened)


@pytest.mark.skipif(os.name != "nt", reason="仅验证 Windows 真实进程句柄")
def test_windows_worker_exit_guard_waits_for_real_process_handles(tmp_path):
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    pid_file = tmp_path / "guard-worker.pid"
    source = (
        "import os, time; from pathlib import Path; "
        f"Path({str(pid_file)!r}).write_text(str(os.getpid()), encoding='ascii'); "
        "time.sleep(60)"
    )
    worker = subprocess.Popen(
        [sys.executable, "-I", "-B", "-c", source],
        env=export_contract.worker_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    handle = None
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if pid_file.exists():
                value = pid_file.read_text(encoding="ascii")
                if value:
                    handle = kernel32.OpenProcess(0x00100001, False, int(value))
                    if not handle:
                        raise ctypes.WinError(ctypes.get_last_error())
                    break
            assert worker.poll() is None
            time.sleep(0.01)
        assert handle, "真实进程未写入 PID。"
        with export_contract._windows_worker_exit_guard(worker.pid) as wait_for_exit:
            assert kernel32.WaitForSingleObject(handle, 0) == 258
            assert kernel32.TerminateProcess(handle, 1)
            wait_for_exit()
            assert kernel32.WaitForSingleObject(handle, 0) == 0
        worker.wait(timeout=5)
    finally:
        if handle:
            try:
                if kernel32.WaitForSingleObject(handle, 0) == 258:
                    assert kernel32.TerminateProcess(handle, 1)
                assert kernel32.WaitForSingleObject(handle, 5000) == 0
            finally:
                assert kernel32.CloseHandle(handle)
        if worker.poll() is None:
            worker.kill()
        worker.wait(timeout=5)


@pytest.mark.skipif(os.name != "nt", reason="仅验证 Windows 真实后代的清理失败出口")
@pytest.mark.parametrize("failure", ["launch", "snapshot", "exit-wait"])
def test_windows_real_cleanup_failure_is_bounded_with_live_output_holder(
    minimal_backend, monkeypatch, capsysbinary, failure
):
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    pid_file = minimal_backend / "worker.pid"
    holder_pid_file = minimal_backend / "holder.pid"
    holder_source = (
        "import os, sys, time; from pathlib import Path; "
        f"print({DEMO_SECRET!r}, flush=True); "
        f"print({DEMO_SECRET!r}, file=sys.stderr, flush=True); "
        f"Path({str(holder_pid_file)!r}).write_text(str(os.getpid()), encoding='ascii'); "
        "time.sleep(60)"
    )
    with (minimal_backend / "app" / "__init__.py").open("a", encoding="utf-8") as stream:
        stream.write(
            "\nimport os\nimport subprocess\nimport sys\nimport time\nfrom pathlib import Path\n"
            f"subprocess.Popen([sys.executable, '-I', '-B', '-c', {holder_source!r}], "
            "stdout=sys.stdout, stderr=sys.stderr)\n"
            f"Path({str(pid_file)!r}).write_text(str(os.getpid()), encoding='ascii')\n"
            "time.sleep(60)\n"
        )

    real_popen = subprocess.Popen
    workers = []
    handles = {}
    output_files = []
    cleanup_calls = []
    watchdog_fired = threading.Event()
    watchdog = None

    def rescue_owned_processes():
        watchdog_fired.set()
        for handle in handles.values():
            if kernel32.WaitForSingleObject(handle, 0) == 258:
                kernel32.TerminateProcess(handle, 1)

    def tracked_popen(*popen_args, **popen_kwargs):
        nonlocal watchdog
        worker = real_popen(*popen_args, **popen_kwargs)
        workers.append(worker)
        for name in ("stdout", "stderr"):
            output = popen_kwargs[name]
            if output != subprocess.PIPE:
                output_files.append(os.fdopen(os.dup(output.fileno()), "rb"))
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            for name, path in (("worker", pid_file), ("holder", holder_pid_file)):
                if name not in handles and path.exists():
                    value = path.read_text(encoding="ascii")
                    if value:
                        # 持有实际进程句柄；最终回收不按可能已复用的 PID 查找。
                        handle = kernel32.OpenProcess(0x00100001, False, int(value))
                        if not handle:
                            raise ctypes.WinError(ctypes.get_last_error())
                        handles[name] = handle
            if len(handles) == 2:
                break
            assert worker.poll() is None, "真实 worker 在后代就绪前已退出。"
            time.sleep(0.01)
        assert len(handles) == 2, "真实 worker 或持有输出句柄的后代未就绪。"
        assert all(kernel32.WaitForSingleObject(handle, 0) == 258 for handle in handles.values())
        real_wait = worker.wait
        real_communicate = worker.communicate

        def short_wait(*wait_args, **wait_kwargs):
            if wait_kwargs.get("timeout") == 20:
                wait_kwargs["timeout"] = 0.2
            return real_wait(*wait_args, **wait_kwargs)

        def short_communicate(*communicate_args, **communicate_kwargs):
            # 同一回归也可运行旧 PIPE 实现，不能靠 20 秒原始超时制造失败。
            if communicate_kwargs.get("timeout") == 20:
                communicate_kwargs["timeout"] = 0.2
            return real_communicate(*communicate_args, **communicate_kwargs)

        worker.wait = short_wait
        worker.communicate = short_communicate
        # 旧 Popen.__exit__ 会卡住；救援只为结束失败测试，不能计为 exporter 清理成功。
        watchdog = threading.Timer(4, rescue_owned_processes)
        watchdog.start()
        return worker

    def failed_cleanup(command, **kwargs):
        cleanup_calls.append("taskkill")
        assert Path(command[0]).name.lower() == "taskkill.exe"
        assert kwargs["timeout"] == 10
        if failure == "launch":
            raise OSError(DEMO_SECRET)
        return subprocess.CompletedProcess(command, 0)

    def exit_guard(_pid):
        cleanup_calls.append("snapshot")
        if failure == "snapshot":
            raise OSError(DEMO_SECRET)

        def wait_for_exit():
            cleanup_calls.append("exit-wait")
            raise OSError(DEMO_SECRET)

        return nullcontext(wait_for_exit)

    monkeypatch.setattr(export_contract, "__file__", str(minimal_backend / "export_contract.py"))
    monkeypatch.setattr(export_contract.subprocess, "Popen", tracked_popen)
    monkeypatch.setattr(export_contract.subprocess, "run", failed_cleanup)
    monkeypatch.setattr(export_contract, "_windows_worker_exit_guard", exit_guard)
    started_at = time.monotonic()
    try:
        result = export_contract.main([])
        elapsed = time.monotonic() - started_at
        captured = capsysbinary.readouterr()
        assert elapsed < 3, f"清理失败返回耗时 {elapsed:.3f} 秒，超过严格 3 秒上限。"
        assert not watchdog_fired.is_set(), "exporter 依赖测试救援才返回。"
        assert result == 1
        assert captured.out == b""
        assert captured.err == "契约导出失败：worker 启动或清理未通过。\n".encode()
        assert DEMO_SECRET.encode() not in captured.out + captured.err
        assert len(workers) == 1
        assert workers[0].poll() is not None
        assert len(output_files) == 2
        for output in output_files:
            output.seek(0)
            assert DEMO_SECRET.encode() in output.read()
        assert kernel32.WaitForSingleObject(handles["holder"], 0) == 258, (
            "持有 stdout/stderr 的真实后代应仍存活，不能用自然退出掩盖失败出口。"
        )
        assert (
            cleanup_calls
            == {
                "launch": ["snapshot", "taskkill"],
                "snapshot": ["snapshot"],
                "exit-wait": ["snapshot", "taskkill", "exit-wait"],
            }[failure]
        )
    finally:
        if watchdog is not None:
            watchdog.cancel()
            watchdog.join(timeout=5)
            assert not watchdog.is_alive()
        for handle in handles.values():
            try:
                if kernel32.WaitForSingleObject(handle, 0) == 258:
                    # The launcher can already have requested worker termination
                    # while its handle is still unsignaled. Verify exit either way.
                    kernel32.TerminateProcess(handle, 1)
                assert kernel32.WaitForSingleObject(handle, 5000) == 0
            finally:
                assert kernel32.CloseHandle(handle)
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
            worker.wait(timeout=5)
            for stream in (worker.stdout, worker.stderr):
                if stream is not None:
                    stream.close()
        for output in output_files:
            output.close()


@pytest.mark.parametrize("args", [(), ("--samples",)])
def test_cli_import_failure_has_no_partial_output_or_private_details(minimal_backend, args):
    database = minimal_backend / "app" / "infrastructure" / "database.py"
    with database.open("a", encoding="utf-8") as stream:
        stream.write(f"\nraise ValueError({DEMO_SECRET!r})\n")
    result = cli(backend=minimal_backend, args=args)
    assert result.returncode == 1
    assert result.stdout == b""
    assert "应用导入或响应模型验证未通过" in result.stderr.decode("utf-8")
    assert DEMO_SECRET.encode() not in result.stderr
    assert b"Traceback" not in result.stderr


@pytest.mark.parametrize("fail", [False, True])
def test_guard_skips_dotenv_and_restores_patches_on_all_exits(monkeypatch, tmp_path, fail):
    (tmp_path / ".env").write_text("RESERVATION_TTL_SECONDS=invalid\n", encoding="utf-8")

    def forbidden_read(*_args, **_kwargs):
        pytest.fail("契约导出读取了 dotenv 文件。")

    monkeypatch.setattr(DotEnvSettingsSource, "_read_env_file", forbidden_read)
    targets = (
        (DotEnvSettingsSource, "_read_env_files"),
        (Pool, "connect"),
        (Engine, "connect"),
        (sqlite3, "connect"),
        (sqlite3.dbapi2, "connect"),
        (socket.socket, "connect"),
        (socket.socket, "connect_ex"),
        (socket, "getaddrinfo"),
        (socket, "create_connection"),
    )
    originals = [getattr(target, name) for target, name in targets]

    def guarded():
        with export_contract._side_effect_guard():
            source = DotEnvSettingsSource(Settings, env_file=tmp_path / ".env")
            assert source.env_vars == {}
            if fail:
                sqlite3.connect("must-not-exist.db")

    if fail:
        with pytest.raises(RuntimeError, match="禁止数据库或网络连接"):
            guarded()
    else:
        guarded()
    assert [getattr(target, name) for target, name in targets] == originals
