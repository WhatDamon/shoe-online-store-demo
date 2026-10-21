"""R7 隔离入口的标准库测试；仅使用临时目录、临时 Git 仓库和回环服务。"""

import base64
import contextlib
import errno
import hashlib
import importlib.metadata
import importlib.util
import inspect
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path, PurePosixPath, PureWindowsPath
from unittest.mock import patch
from urllib.request import ProxyHandler, build_opener

sys.dont_write_bytecode = True
IMPLEMENTATION = Path(__file__).with_name("verify_isolated.py")
if not IMPLEMENTATION.is_file():
    raise ImportError(f"主实现尚不存在，R7 测试未验证（不得跳过）：{IMPLEMENTATION}")
_spec = importlib.util.spec_from_file_location("_r7_verify_isolated", IMPLEMENTATION)
if _spec is None or _spec.loader is None:
    raise ImportError(f"无法加载 R7 主实现：{IMPLEMENTATION}")
verify = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = verify
_spec.loader.exec_module(verify)

EXCLUDED_DIRECTORIES = (
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
)
EXCLUDED_FILES = (
    ".env",
    ".env.local",
    ".env.example",
    "nested/.env.test",
    "nested/cache.pyc",
    *(
        f"nested/store{extension}{sidecar}"
        for extension in (".db", ".sqlite", ".sqlite3")
        for sidecar in ("", "-wal", "-shm", "-journal")
    ),
)
REJECTION_ERRORS = (ValueError, RuntimeError, OSError)
READINESS_ERRORS = (ValueError, RuntimeError, TimeoutError, subprocess.TimeoutExpired)


def local_environment():
    # Git 夹具不读取宿主用户配置，也不继承业务凭据或代理配置。
    allowed = {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP"}
    result = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    result.update(
        {
            "PYTHONDONTWRITEBYTECODE": "1",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
            "LC_ALL": "C",
        }
    )
    return result


def wait_for_file(path, timeout=8.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_file() and path.stat().st_size:
            return path.read_text(encoding="utf-8")
        time.sleep(0.02)
    raise AssertionError(f"临时子进程未在有限时间内写出就绪标记：{path}")


def health_get(url):
    with build_opener(ProxyHandler({})).open(url, timeout=1) as response:
        return response.status, response.read()


@contextlib.contextmanager
def external_health_service():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.server.probes += 1
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    server.probes = 0
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, f"http://127.0.0.1:{server.server_port}/health"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        if thread.is_alive():
            raise AssertionError("外部健康服务未停止")


class TemporaryTestCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="r7-foundation-tests-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def symlink(self, link, target, directory=False):
        try:
            link.symlink_to(target, target_is_directory=directory)
        except OSError as error:
            if getattr(error, "winerror", None) in (5, 50, 1314) or error.errno in (
                errno.ENOSYS,
                errno.ENOTSUP,
                errno.EPERM,
                errno.EACCES,
            ):
                self.skipTest(f"当前系统权限或文件系统不支持真实符号链接：{error}")
            raise


class ExcludedTests(unittest.TestCase):
    def test_excludes_sensitive_files_at_any_depth_for_both_path_flavors(self):
        for flavor in (PurePosixPath, PureWindowsPath):
            for filename in EXCLUDED_FILES:
                for prefix in ("", "src/deep/"):
                    with self.subTest(flavor=flavor.__name__, path=prefix + filename):
                        self.assertTrue(verify.excluded(flavor(prefix + filename)))

    def test_excludes_directory_components_and_dotenv_directories(self):
        for flavor in (PurePosixPath, PureWindowsPath):
            for directory in (*EXCLUDED_DIRECTORIES, ".env", ".env.production"):
                for path in (directory, f"src/{directory}/payload.txt"):
                    with self.subTest(flavor=flavor.__name__, path=path):
                        self.assertTrue(verify.excluded(flavor(path)))

    def test_does_not_exclude_similar_names_or_normal_source_files(self):
        for flavor in (PurePosixPath, PureWindowsPath):
            for path in (
                "src/app.py",
                ".gitignore",
                ".envrc",
                "docs/env.example.txt",
                "src/database.py",
                "src/builder.py",
                "docs/outputs.md",
                "node_modules-notes.txt",
                "fixtures/store.db.txt",
                "notes.env",
            ):
                with self.subTest(flavor=flavor.__name__, path=path):
                    self.assertFalse(verify.excluded(flavor(path)))


class TemporaryGitTestCase(TemporaryTestCase):
    def setUp(self):
        super().setUp()
        self.git = shutil.which("git")
        if self.git is None:
            raise RuntimeError("环境中没有现成 Git，快照测试未验证；不会安装依赖或跳过")
        self.source = self.root / "source"
        self.source.mkdir()
        self.git_run("init", "-q")
        self.git_run("config", "--local", "user.name", "R7 Temporary Test")
        self.git_run("config", "--local", "user.email", "r7-test@example.invalid")
        self.git_run("config", "--local", "core.autocrlf", "false")
        self.git_run("config", "--local", "core.symlinks", "true")
        self.write(".gitignore", b"ignored/\n*.ignored\n")
        self.write("README.txt", b"baseline\n")
        self.write("src/app.py", b"print('fixture')\n")
        self.git_run("add", ".")
        # 只在可丢弃仓库建立 HEAD/tree 夹具，不提交任何项目工作树。
        self.git_run("commit", "-q", "-m", "temporary snapshot fixture")

    def git_run(self, *arguments):
        return subprocess.run(
            [self.git, "-C", str(self.source), *arguments],
            cwd=self.root,
            env=local_environment(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
            timeout=15,
        ).stdout.strip()

    def write(self, relative, content):
        path = self.source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def take_snapshot(self, name="snapshot"):
        destination = self.root / name
        return verify.snapshot(self.source, destination), destination


class SnapshotTests(TemporaryGitTestCase):
    def test_manifest_matches_bytes_git_identity_and_is_repeatable(self):
        first, destination = self.take_snapshot()
        second, _ = self.take_snapshot("second")
        expected = {
            relative: hashlib.sha256((self.source / relative).read_bytes()).hexdigest()
            for relative in (".gitignore", "README.txt", "src/app.py")
        }
        self.assertEqual(first["files"], expected)
        self.assertEqual(first["head"], self.git_run("rev-parse", "HEAD"))
        self.assertEqual(first["tree"], self.git_run("rev-parse", "HEAD^{tree}"))
        self.assertFalse(first["dirty"])
        self.assertRegex(first["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(first["files"], second["files"])
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(
            {
                path.relative_to(destination).as_posix()
                for path in destination.rglob("*")
                if path.is_file()
            },
            set(expected),
        )
        for relative in expected:
            self.assertEqual(
                (destination / relative).read_bytes(),
                (self.source / relative).read_bytes(),
            )

    def test_excludes_tracked_and_untracked_dotenv_database_and_generated_files(self):
        denied = [
            *EXCLUDED_FILES,
            *(
                f"src/{directory}/payload.txt"
                for directory in EXCLUDED_DIRECTORIES
                if directory != ".git"
            ),
        ]
        for relative in denied:
            self.write(relative, b"synthetic excluded fixture; not a real secret or database\n")
        self.git_run("add", "-f", "--", *denied)
        self.git_run("commit", "-q", "-m", "temporary excluded fixtures")
        self.write(".env.untracked", b"synthetic fixture\n")
        self.write("ignored/payload.txt", b"ignored fixture\n")
        self.write("untracked.ignored", b"ignored fixture\n")
        self.write("new file.txt", b"included untracked fixture\n")
        result, destination = self.take_snapshot()
        expected = {".gitignore", "README.txt", "src/app.py", "new file.txt"}
        self.assertEqual(set(result["files"]), expected)
        self.assertEqual(
            {
                path.relative_to(destination).as_posix()
                for path in destination.rglob("*")
                if path.is_file()
            },
            expected,
        )
        self.assertFalse((destination / ".git").exists())

    def test_dirty_bytes_and_nonignored_untracked_files_change_hash_not_head_or_tree(
        self,
    ):
        clean, _ = self.take_snapshot("clean")
        self.write("src/app.py", b"print('dirty fixture')\n")
        dirty, dirty_destination = self.take_snapshot("dirty")
        self.assertTrue(dirty["dirty"])
        self.assertNotEqual(dirty["sha256"], clean["sha256"])
        self.assertNotEqual(dirty["files"]["src/app.py"], clean["files"]["src/app.py"])
        self.assertEqual(
            (dirty_destination / "src/app.py").read_bytes(), b"print('dirty fixture')\n"
        )
        self.write("new/deep/file.txt", b"new bytes\n")
        untracked, _ = self.take_snapshot("untracked")
        self.assertTrue(untracked["dirty"])
        self.assertNotEqual(untracked["sha256"], dirty["sha256"])
        self.assertEqual(
            untracked["files"]["new/deep/file.txt"],
            hashlib.sha256(b"new bytes\n").hexdigest(),
        )
        for result in (dirty, untracked):
            self.assertEqual(result["head"], clean["head"])
            self.assertEqual(result["tree"], clean["tree"])

    def test_ignored_untracked_files_do_not_change_manifest_hash_or_clean_state(self):
        before, _ = self.take_snapshot("before")
        self.write("ignored/private.txt", b"synthetic ignored bytes\n")
        self.write("cache.ignored", b"synthetic ignored bytes\n")
        after, _ = self.take_snapshot("after")
        self.assertEqual(before["files"], after["files"])
        self.assertEqual(before["sha256"], after["sha256"])
        self.assertFalse(after["dirty"])

    def test_git_tracked_file_is_included_even_when_gitignore_matches_it(self):
        self.write("tracked.ignored", b"tracked bytes\n")
        self.git_run("add", "-f", "--", "tracked.ignored")
        self.git_run("commit", "-q", "-m", "temporary tracked ignored fixture")
        result, destination = self.take_snapshot()
        self.assertEqual(
            result["files"]["tracked.ignored"],
            hashlib.sha256(b"tracked bytes\n").hexdigest(),
        )
        self.assertEqual((destination / "tracked.ignored").read_bytes(), b"tracked bytes\n")

    def test_copies_only_exact_source_json_exceptions_not_sibling_runtime_data(self):
        included = {
            "src/server/catalog/data/supplier.json": b'{"supplier": "fixture"}\n',
            "backend/data/catalog.json": b'{"catalog": "fixture"}\n',
        }
        denied = (
            "src/server/catalog/data/runtime.json",
            "src/server/catalog/data/supplier.json.bak",
            "src/server/catalog/data/nested/supplier.json",
            "backend/data/orders.json",
            "backend/data/catalog.json.bak",
            "backend/data/nested/catalog.json",
            "other/data/catalog.json",
        )
        for relative, content in included.items():
            self.write(relative, content)
        for relative in denied:
            self.write(relative, b'{"runtime": "synthetic"}\n')
        # supplier 作为已跟踪源码，catalog 作为非忽略未跟踪源码，两者都必须进入快照。
        self.git_run("add", "--", "src/server/catalog/data/supplier.json", *denied)
        result, destination = self.take_snapshot()
        expected = {".gitignore", "README.txt", "src/app.py", *included}
        self.assertEqual(set(result["files"]), expected)
        self.assertEqual(
            {
                path.relative_to(destination).as_posix()
                for path in destination.rglob("*")
                if path.is_file()
            },
            expected,
        )
        for relative, content in included.items():
            with self.subTest(included=relative):
                self.assertEqual((destination / relative).read_bytes(), content)
                self.assertEqual(result["files"][relative], hashlib.sha256(content).hexdigest())
        for relative in denied:
            with self.subTest(excluded=relative):
                self.assertFalse((destination / relative).exists())

    def test_source_mutation_after_copyfile_rejects_snapshot_without_returning_a_manifest(
        self,
    ):
        origin = self.source / "src/app.py"
        original = origin.read_bytes()
        changed = b"print('changed after real copy')\n"
        real_copyfile = shutil.copyfile
        mutations = []

        def copy_then_change_source(src, dst, *args, **kwargs):
            result = real_copyfile(src, dst, *args, **kwargs)
            if Path(src).resolve() == origin.resolve():
                self.assertEqual(Path(dst).read_bytes(), original)
                origin.write_bytes(changed)
                mutations.append(Path(src).resolve())
            return result

        returned = []
        with (
            patch.object(verify.shutil, "copyfile", side_effect=copy_then_change_source),
            self.assertRaises(REJECTION_ERRORS),
        ):
            returned.append(verify.snapshot(self.source, self.root / "raced-snapshot"))
        self.assertEqual(mutations, [origin.resolve()])
        self.assertEqual(origin.read_bytes(), changed)
        self.assertEqual(returned, [], "不能返回与复制字节或当前源码不一致的伪哈希")

    def test_rejects_same_directory_descendant_ancestor_and_normalized_overlap(self):
        for destination in (
            self.source,
            self.source / "copy",
            self.root,
            self.source / "nested" / ".." / "copy",
        ):
            with self.subTest(destination=destination):
                with self.assertRaises(REJECTION_ERRORS):
                    verify.snapshot(self.source, destination)
        self.assertEqual((self.source / "README.txt").read_bytes(), b"baseline\n")
        self.assertFalse((self.source / "copy").exists())

    def test_rejects_tracked_and_untracked_file_symlinks_without_copying_target(self):
        target = self.root / "outside.txt"
        target.write_bytes(b"must never enter the snapshot\n")
        link = self.source / "linked.txt"
        self.symlink(link, target)
        with self.assertRaises(REJECTION_ERRORS):
            self.take_snapshot("untracked-link")
        self.git_run("add", "--", "linked.txt")
        with self.assertRaises(REJECTION_ERRORS):
            self.take_snapshot("tracked-link")
        self.assertEqual(target.read_bytes(), b"must never enter the snapshot\n")
        for name in ("untracked-link", "tracked-link"):
            self.assertFalse((self.root / name / "linked.txt").exists())

    def test_rejects_directory_symlink_escape(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "payload.txt").write_bytes(b"outside bytes\n")
        self.symlink(self.source / "escape", outside, directory=True)
        with self.assertRaises(REJECTION_ERRORS):
            self.take_snapshot()
        self.assertFalse((self.root / "snapshot" / "escape" / "payload.txt").exists())

    def test_rejects_symlink_source_and_destination(self):
        source_link = self.root / "source-link"
        self.symlink(source_link, self.source, directory=True)
        with self.assertRaises(REJECTION_ERRORS):
            verify.snapshot(source_link, self.root / "copy")
        outside = self.root / "outside-destination"
        outside.mkdir()
        destination_link = self.root / "destination-link"
        self.symlink(destination_link, outside, directory=True)
        with self.assertRaises(REJECTION_ERRORS):
            verify.snapshot(self.source, destination_link)
        self.assertEqual(list(outside.iterdir()), [])

    @unittest.skipUnless(os.name == "nt", "Windows junction/reparse 场景仅适用于 Windows")
    def test_rejects_windows_junction_reparse_directory(self):
        import _winapi

        if not hasattr(_winapi, "CreateJunction"):
            self.skipTest("当前 Python 标准库未提供 CreateJunction，无法构造真实 junction")
        outside = self.root / "junction-target"
        outside.mkdir()
        (outside / "payload.txt").write_bytes(b"junction outside bytes\n")
        junction = self.source / "junction"
        _winapi.CreateJunction(str(outside), str(junction))
        try:
            with self.assertRaises(REJECTION_ERRORS):
                self.take_snapshot()
            self.assertFalse((self.root / "snapshot" / "junction" / "payload.txt").exists())
        finally:
            junction.rmdir()


class CopyDependenciesTests(TemporaryTestCase):
    def setUp(self):
        super().setUp()
        self.origin = self.root / "dependency-source" / "node_modules"
        self.source_copy = self.root / "snapshot"
        self.origin.mkdir(parents=True)
        self.source_copy.mkdir()
        self.packages = {}
        for name, version in (("r7-fixture", "1.2.3"), ("@r7/scoped-fixture", "4.5.6")):
            package = self.origin / name
            package.mkdir(parents=True)
            payload = f"module.exports = {json.dumps(name)};\n".encode()
            (package / "index.js").write_bytes(payload)
            (package / "package.json").write_text(
                json.dumps({"name": name, "version": version, "main": "index.js"}),
                encoding="utf-8",
            )
            self.packages[f"node_modules/{name}"] = {
                "version": version,
                "integrity": "sha512-"
                + base64.b64encode(hashlib.sha512(payload).digest()).decode(),
            }
        self.lock_bytes = json.dumps(
            {
                "name": "r7-synthetic-dependency-fixture",
                "lockfileVersion": 3,
                "packages": {"": {"name": "r7-synthetic-dependency-fixture"}, **self.packages},
            },
            sort_keys=True,
        ).encode()
        (self.origin.parent / "package-lock.json").write_bytes(self.lock_bytes)
        (self.source_copy / "package-lock.json").write_bytes(self.lock_bytes)
        self.write_installed_lock(self.packages)
        self.fixture_files = self.file_bytes(self.origin)

    def write_installed_lock(self, packages):
        (self.origin / ".package-lock.json").write_text(
            json.dumps({"lockfileVersion": 3, "packages": packages}, sort_keys=True),
            encoding="utf-8",
        )

    def add_project_locked_package(self, name, version, *, optional=False):
        package = self.origin / name
        package.mkdir(parents=True)
        payload = f"module.exports = {json.dumps(name)};\n".encode()
        (package / "index.js").write_bytes(payload)
        (package / "package.json").write_text(
            json.dumps({"name": name, "version": version, "main": "index.js"}),
            encoding="utf-8",
        )
        relative = f"node_modules/{name}"
        self.packages[relative] = {
            "version": version,
            "integrity": "sha512-" + base64.b64encode(hashlib.sha512(payload).digest()).decode(),
            **({"optional": True} if optional else {}),
        }
        lock = {
            "name": "r7-synthetic-dependency-fixture",
            "lockfileVersion": 3,
            "packages": {"": {"name": "r7-synthetic-dependency-fixture"}, **self.packages},
        }
        self.lock_bytes = json.dumps(lock, sort_keys=True).encode()
        (self.origin.parent / "package-lock.json").write_bytes(self.lock_bytes)
        (self.source_copy / "package-lock.json").write_bytes(self.lock_bytes)
        self.fixture_files = self.file_bytes(self.origin)

    def file_bytes(self, directory):
        return {
            path.relative_to(directory).as_posix(): path.read_bytes()
            for path in directory.rglob("*")
            if path.is_file()
        }

    def assert_rejected_before_copy(self, message):
        before = self.file_bytes(self.origin)
        with self.assertRaisesRegex(verify.RunnerError, message):
            verify._copy_dependencies(self.origin, self.source_copy)
        self.assertFalse((self.source_copy / "node_modules").exists())
        self.assertEqual(self.file_bytes(self.origin), before)
        self.assertEqual((self.source_copy / "package-lock.json").read_bytes(), self.lock_bytes)

    def test_exact_locks_copy_regular_and_scoped_packages_as_independent_physical_files(self):
        result = verify._copy_dependencies(self.origin, self.source_copy)
        destination = self.source_copy / "node_modules"
        self.assertEqual(
            result,
            {
                "name": "node_dependencies",
                "status": "passed",
                "installed_packages": 2,
                "package_lock_sha256": hashlib.sha256(self.lock_bytes).hexdigest(),
                "installed_lock_sha256": hashlib.sha256(
                    self.fixture_files[".package-lock.json"]
                ).hexdigest(),
                "strategy": "physical_copy_of_explicit_lock_matched_source",
            },
        )
        self.assertEqual(self.file_bytes(destination), self.fixture_files)
        self.assertEqual(self.file_bytes(self.origin), self.fixture_files)
        self.assertEqual((self.origin.parent / "package-lock.json").read_bytes(), self.lock_bytes)
        for path in (destination, *destination.rglob("*")):
            with self.subTest(path=path.relative_to(destination)):
                self.assertFalse(path.is_symlink())
                self.assertFalse(getattr(path.lstat(), "st_file_attributes", 0) & 0x400)
                self.assertNotIn(self.origin.resolve(), path.resolve().parents)
                source = self.origin / path.relative_to(destination)
                self.assertFalse(os.path.samefile(path, source), "不能回连或硬链接依赖源")
        source_payload = self.origin / "r7-fixture/index.js"
        copied_payload = destination / "r7-fixture/index.js"
        source_payload.write_bytes(b"source changed after copy\n")
        self.assertEqual(copied_payload.read_bytes(), self.fixture_files["r7-fixture/index.js"])
        copied_payload.write_bytes(b"copy changed independently\n")
        self.assertEqual(source_payload.read_bytes(), b"source changed after copy\n")

    def test_rejects_source_package_lock_bytes_different_from_snapshot(self):
        # JSON 内容仍相同，只有字节差异也不能冒充同一份快照锁。
        (self.origin.parent / "package-lock.json").write_bytes(self.lock_bytes + b"\n")
        self.assert_rejected_before_copy("dependency source package-lock does not match snapshot")
        self.assertEqual(
            (self.origin.parent / "package-lock.json").read_bytes(), self.lock_bytes + b"\n"
        )

    def test_rejects_extra_installed_package_not_in_snapshot_lock(self):
        extra = self.origin / "r7-unlocked"
        extra.mkdir()
        (extra / "package.json").write_text(
            json.dumps({"name": "r7-unlocked", "version": "9.0.0"}), encoding="utf-8"
        )
        self.write_installed_lock(
            {**self.packages, "node_modules/r7-unlocked": {"version": "9.0.0"}}
        )
        self.assert_rejected_before_copy("installed dependency versions do not match snapshot lock")

    def test_allows_project_locked_optional_package_missing_from_npm_hidden_lock(self):
        self.add_project_locked_package("r7-optional", "7.8.9", optional=True)
        installed = {
            name: entry
            for name, entry in self.packages.items()
            if name != "node_modules/r7-optional"
        }
        self.write_installed_lock(installed)
        result = verify._copy_dependencies(self.origin, self.source_copy)
        self.assertEqual(result["status"], "passed")
        self.assertTrue((self.source_copy / "node_modules/r7-optional/package.json").is_file())

    def test_rejects_project_locked_required_package_missing_from_npm_hidden_lock(self):
        self.add_project_locked_package("r7-required", "7.8.9")
        installed = {
            name: entry
            for name, entry in self.packages.items()
            if name != "node_modules/r7-required"
        }
        self.write_installed_lock(installed)
        self.assert_rejected_before_copy("installed dependency lock omits a required package")

    def test_rejects_unlocked_physical_package_even_when_installed_lock_omits_it(self):
        extra = self.origin / "r7-unregistered"
        extra.mkdir()
        (extra / "package.json").write_text(
            json.dumps({"name": "r7-unregistered", "version": "9.0.0"}), encoding="utf-8"
        )
        (extra / "index.js").write_bytes(b"unlocked physical package must not be copied\n")
        before = self.file_bytes(self.origin)
        with self.assertRaises(verify.RunnerError):
            verify._copy_dependencies(self.origin, self.source_copy)
        self.assertFalse((self.source_copy / "node_modules").exists())
        self.assertEqual(self.file_bytes(self.origin), before)

    def test_rejects_installed_version_different_from_snapshot_pin(self):
        packages = {name: dict(entry) for name, entry in self.packages.items()}
        packages["node_modules/r7-fixture"]["version"] = "1.2.4"
        self.write_installed_lock(packages)
        self.assert_rejected_before_copy("installed dependency versions do not match snapshot lock")

    def test_rejects_installed_integrity_different_from_snapshot_metadata(self):
        packages = {name: dict(entry) for name, entry in self.packages.items()}
        packages["node_modules/@r7/scoped-fixture"]["integrity"] = "sha512-synthetic-mismatch"
        self.write_installed_lock(packages)
        self.assert_rejected_before_copy("installed dependency integrity metadata differs")

    def test_excludes_dotenv_files_and_directories_at_every_dependency_depth(self):
        denied_files = (
            ".env",
            ".ENV.LOCAL",
            "r7-fixture/.env.production",
            "@r7/scoped-fixture/.env/nested.txt",
            "r7-fixture/nested/.ENV.testing/payload.txt",
        )
        for relative in denied_files:
            path = self.origin / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"synthetic dotenv fixture; not a secret\n")
        included = {
            "r7-fixture/.envrc": b"ordinary fixture\n",
            "@r7/scoped-fixture/notes.env": b"ordinary notes\n",
        }
        for relative, content in included.items():
            (self.origin / relative).write_bytes(content)
        before = self.file_bytes(self.origin)
        result = verify._copy_dependencies(self.origin, self.source_copy)
        self.assertEqual(result["status"], "passed")
        destination = self.source_copy / "node_modules"
        self.assertEqual(self.file_bytes(destination), {**self.fixture_files, **included})
        for relative in (
            *denied_files,
            "@r7/scoped-fixture/.env",
            "r7-fixture/nested/.ENV.testing",
        ):
            with self.subTest(excluded=relative):
                self.assertFalse((destination / relative).exists())
        self.assertEqual(self.file_bytes(self.origin), before)

    def test_rejects_file_link_escaping_the_explicit_dependency_tree(self):
        outside = self.root / "outside.js"
        outside.write_bytes(b"outside fixture must stay outside\n")
        self.symlink(self.origin / "r7-fixture/escape.js", outside)
        self.assert_rejected_before_copy("dependency tree contains an escaping or directory link")
        self.assertEqual(outside.read_bytes(), b"outside fixture must stay outside\n")

    def test_rejects_directory_link_even_when_target_is_inside_dependency_tree(self):
        self.symlink(self.origin / "linked-package", self.origin / "r7-fixture", directory=True)
        self.assert_rejected_before_copy("dependency tree contains an escaping or directory link")

    def test_materializes_internal_bin_file_link_without_reconnecting_to_source(self):
        bin_directory = self.origin / ".bin"
        bin_directory.mkdir()
        target = self.origin / "r7-fixture/index.js"
        self.symlink(bin_directory / "r7-fixture", target)
        result = verify._copy_dependencies(self.origin, self.source_copy)
        self.assertEqual(result["status"], "passed")
        copied = self.source_copy / "node_modules/.bin/r7-fixture"
        self.assertTrue(copied.is_file())
        self.assertFalse(copied.is_symlink())
        self.assertFalse(getattr(copied.lstat(), "st_file_attributes", 0) & 0x400)
        self.assertFalse(os.path.samefile(copied, target))
        self.assertEqual(copied.read_bytes(), target.read_bytes())
        target.write_bytes(b"source bin changed\n")
        self.assertEqual(copied.read_bytes(), self.fixture_files["r7-fixture/index.js"])


class SafeEnvironmentTests(TemporaryTestCase):
    def test_whitelist_drops_credentials_proxies_and_arbitrary_host_variables(self):
        host = {
            "PATH": os.pathsep.join((str(self.root / "bin-a"), str(self.root / "bin-b"))),
            "SystemRoot": str(self.root / "Windows"),
            "TEMP": str(self.root),
            "AI_API_KEY": "synthetic",
            "AI_DISABLE_REAL": "0",
            "OPENAI_API_KEY": "synthetic",
            "NEXT_PUBLIC_AI_KEY": "synthetic",
            "PGHOST": "synthetic",
            "PGPASSWORD": "synthetic",
            "DATABASE_URL": "synthetic",
            "DB_PASSWORD": "synthetic",
            "COMMERCE_API_URL": "synthetic",
            "COMMERCE_PROXY_SECRET": "synthetic",
            "FIREBASE_PRIVATE_KEY": "synthetic",
            "NEXT_PUBLIC_FIREBASE_API_KEY": "synthetic",
            "GOOGLE_APPLICATION_CREDENTIALS": "synthetic",
            "SHOPIFY_ENABLED": "true",
            "HTTP_PROXY": "synthetic",
            "HTTPS_PROXY": "synthetic",
            "ALL_PROXY": "synthetic",
            "NO_PROXY": "synthetic",
            "http_proxy": "synthetic",
            "https_proxy": "synthetic",
            "all_proxy": "synthetic",
            "no_proxy": "synthetic",
            "PYTHONPATH": "synthetic",
            "PYTHONHOME": "synthetic",
            "NODE_OPTIONS": "synthetic",
            "BASH_ENV": "synthetic",
            "UNRELATED_PRIVATE_TOKEN": "synthetic",
            "APP_ENV": "production",
            "PYTHONDONTWRITEBYTECODE": "0",
            "NEXT_TELEMETRY_DISABLED": "0",
        }
        with patch.dict(os.environ, host, clear=True):
            before = dict(os.environ)
            result = verify.safe_environment()
            self.assertEqual(dict(os.environ), before)
        overrides = {
            "PYTHONDONTWRITEBYTECODE": "1",
            "AI_DISABLE_REAL": "1",
            "SHOPIFY_ENABLED": "false",
            "NEXT_TELEMETRY_DISABLED": "1",
            "APP_ENV": "development",
            "COMMERCE_PROXY_SECRET": "",
        }
        for key, value in overrides.items():
            with self.subTest(key=key):
                self.assertEqual(result[key], value)
        self.assertEqual(result["PATH"], host["PATH"])
        system_root_key = next(key for key in result if key.upper() == "SYSTEMROOT")
        self.assertEqual(result[system_root_key], host["SystemRoot"])
        self.assertEqual(result["TEMP"], host["TEMP"])
        for key in host.keys() - overrides.keys() - {"PATH", "SystemRoot", "TEMP"}:
            with self.subTest(forbidden=key):
                self.assertNotIn(key, result)
        self.assertTrue(
            all(isinstance(key, str) and isinstance(value, str) for key, value in result.items())
        )

    def test_safe_overrides_exist_even_with_empty_host_environment(self):
        with patch.dict(os.environ, {}, clear=True):
            result = verify.safe_environment()
        self.assertEqual(result["PYTHONDONTWRITEBYTECODE"], "1")
        self.assertEqual(result["AI_DISABLE_REAL"], "1")
        self.assertEqual(result["SHOPIFY_ENABLED"], "false")
        self.assertEqual(result["NEXT_TELEMETRY_DISABLED"], "1")
        self.assertEqual(result["APP_ENV"], "development")
        self.assertEqual(result["COMMERCE_PROXY_SECRET"], "")

    def test_optional_executables_add_parent_directories_not_executable_paths(self):
        node = self.root / "node-bin" / "node.exe"
        python = self.root / "python-bin" / "python.exe"
        with patch.dict(os.environ, {"PATH": str(self.root / "host-bin")}, clear=True):
            result = verify.safe_environment(node=node, python=python)
        entries = result["PATH"].split(os.pathsep)
        self.assertIn(str(node.parent), entries)
        self.assertIn(str(python.parent), entries)
        self.assertNotIn(str(node), entries)
        self.assertNotIn(str(python), entries)

    def test_preserves_windows_path_key_casing_with_and_without_executable_overrides(
        self,
    ):
        host = {"Path": str(self.root / "host-bin")}
        node = self.root / "node-bin" / "node.exe"
        python = self.root / "python-bin" / "python.exe"
        for overrides in ({}, {"node": node, "python": python}):
            with self.subTest(overrides=overrides):
                # Windows 的 os.environ 会大写键，使用原样宿主映射验证 API 的键名契约。
                with patch.object(verify.os, "environ", dict(host)):
                    result = verify.safe_environment(**overrides)
                self.assertEqual([key for key in result if key.upper() == "PATH"], ["Path"])
                entries = result["Path"].split(os.pathsep)
                self.assertIn(host["Path"], entries)
                for executable in overrides.values():
                    self.assertIn(str(executable.parent), entries)

    def test_preserves_safe_host_session_keys_but_drops_arbitrary_business_secrets(
        self,
    ):
        retained = {
            "CODEBUDDY_SAFE_DELETE_ENABLED": "1",
            "SANDBOX_CENTER_UID": "sandbox-fixture",
            "CLAUDE_SESSION_ID": "claude-fixture",
        }
        denied = {
            "BUSINESS_SECRET": "synthetic",
            "CODEBUDDY_BUSINESS_SECRET": "synthetic",
            "CODEBUDDY_SAFE_DELETE_BUSINESS_SECRET": "synthetic",
            "SANDBOX_CENTER_BUSINESS_SECRET": "synthetic",
            "CLAUDE_API_KEY": "synthetic",
            "CUSTOM_STORE_PASSWORD": "synthetic",
        }
        with patch.dict(os.environ, {**retained, **denied}, clear=True):
            result = verify.safe_environment()
        for key, value in retained.items():
            with self.subTest(retained=key):
                self.assertEqual(result[key], value)
        for key in denied:
            with self.subTest(denied=key):
                self.assertNotIn(key, result)

    def test_does_not_inherit_unknown_node_options(self):
        for options in (
            "--require=unknown-preload.cjs",
            "--import=unknown-loader.mjs",
            "--max-old-space-size=4096",
            "--require=unknown-preload.cjs --inspect",
        ):
            with self.subTest(options=options):
                with patch.dict(os.environ, {"NODE_OPTIONS": options}, clear=True):
                    result = verify.safe_environment()
                self.assertNotIn("NODE_OPTIONS", result)


class OutcomeTests(unittest.TestCase):
    def test_status_precedence_failed_then_incomplete_then_passed(self):
        cases = (
            ([], [], [], "passed"),
            ([{"status": "passed"}], [{"pid": 1, "closed": True}], [], "passed"),
            ([{"status": "passed"}], [], ["node"], "incomplete"),
            ([{"status": "incomplete"}], [], [], "incomplete"),
            ([{"status": "failed"}], [], [], "failed"),
            ([{"status": "passed"}], [{"pid": 1, "closed": False}], [], "failed"),
            (
                [{"status": "incomplete"}, {"status": "failed"}],
                [],
                ["python"],
                "failed",
            ),
            (
                [{"status": "incomplete"}],
                [{"pid": 1, "closed": False}],
                ["node"],
                "failed",
            ),
            (
                [{"status": "passed"}],
                [{"closed": True}, {"closed": False}],
                [],
                "failed",
            ),
        )
        for gates, cleanup, missing, expected in cases:
            with self.subTest(gates=gates, cleanup=cleanup, missing=missing):
                self.assertEqual(verify.outcome(gates, cleanup, missing)["status"], expected)

    def test_explicit_foundation_profile_matches_default_without_full_evidence_requirements(
        self,
    ):
        gates = [{"name": "fixture", "status": "passed"}]
        cleanup = [{"pid": 1, "closed": True}]
        result = verify.outcome(gates, cleanup, [], profile="foundation")
        self.assertEqual(result, verify.outcome(gates, cleanup, []))
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["missing"], [])

    def test_full_profile_appends_missing_evidence_and_retains_status_precedence(self):
        required = {"postgres_evidence", "browser_evidence"}
        cases = (
            ([], [], [], "incomplete"),
            (
                [{"status": "passed"}],
                [{"closed": True}],
                ["node_runtime"],
                "incomplete",
            ),
            ([{"status": "failed"}], [{"closed": True}], [], "failed"),
            ([{"status": "passed"}], [{"closed": False}], ["python_runtime"], "failed"),
        )
        for gates, cleanup, missing, expected in cases:
            with self.subTest(gates=gates, cleanup=cleanup, missing=missing):
                original_missing = list(missing)
                result = verify.outcome(gates, cleanup, missing, profile="full")
                self.assertEqual(result["status"], expected)
                self.assertEqual(set(result["missing"]), set(original_missing) | required)
                self.assertEqual(result["missing"][: len(original_missing)], original_missing)
                self.assertEqual(result["gates"], gates)
                self.assertEqual(result["cleanup"], cleanup)


HTTP_WORKER = """
import http.server
from pathlib import Path
import sys
import threading
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(int(sys.argv[2]))
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *args):
        pass
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
Path(sys.argv[1]).write_text(str(server.server_port), encoding='utf-8')
threading.Timer(20, server.shutdown).start()
server.serve_forever()
server.server_close()
"""

PORT_CHILD = """
from pathlib import Path
import socket
import sys
import time
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    listener.listen()
    Path(sys.argv[1]).write_text(str(listener.getsockname()[1]), encoding='utf-8')
    time.sleep(20)
"""

PORT_PARENT = """
from pathlib import Path
import subprocess
import sys
import time
subprocess.Popen([sys.executable, '-B', '-u', '-c', sys.argv[2], sys.argv[1]],
                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
deadline = time.monotonic() + 8
while time.monotonic() < deadline:
    marker = Path(sys.argv[1])
    if marker.is_file() and marker.stat().st_size:
        print('child ready; parent exits first', flush=True)
        sys.exit(0)
    time.sleep(0.02)
sys.exit(3)
"""


REDIRECT_WORKER = """
import http.server
from pathlib import Path
import sys
import threading
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        Path(sys.argv[3]).write_text('302 served', encoding='utf-8')
        self.send_response(302)
        self.send_header('Location', sys.argv[2])
        self.send_header('Content-Length', '0')
        self.end_headers()
    def log_message(self, *args):
        pass
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
Path(sys.argv[1]).write_text(str(server.server_port), encoding='utf-8')
threading.Timer(20, server.shutdown).start()
server.serve_forever()
server.server_close()
"""

MANAGED_PORT_CHILD = """
import json
import os
from pathlib import Path
import signal
import socket
import sys
import time
marker = Path(sys.argv[1])
if sys.argv[2] == 'ignore':
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    listener.listen()
    marker.write_text(
        json.dumps({'port': listener.getsockname()[1], 'pid': os.getpid()}),
        encoding='utf-8',
    )
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline and not marker.with_suffix('.stop').exists():
        time.sleep(0.02)
"""

MANAGED_PORT_PARENT = """
from pathlib import Path
import subprocess
import sys
import time
subprocess.Popen([sys.executable, '-B', '-u', '-c', sys.argv[2], sys.argv[1], sys.argv[4]],
                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
deadline = time.monotonic() + 8
while time.monotonic() < deadline:
    marker = Path(sys.argv[1])
    if marker.is_file() and marker.stat().st_size:
        print('child ready', flush=True)
        if sys.argv[3] == 'exit':
            sys.exit(0)
        time.sleep(40)
        sys.exit(4)
    time.sleep(0.02)
sys.exit(3)
"""


def assert_port_released(test, port, timeout=4.0):
    deadline = time.monotonic() + timeout
    while True:
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return
            except OSError as error:
                if time.monotonic() >= deadline:
                    test.fail(f"清理后派生子进程仍持有回环端口 {port}：{error}")
        time.sleep(0.02)


def stop_fixture_child(test, marker):
    # 仅在断言结束后的夹具清理中通知自建子进程退出，不按端口或名称终止宿主进程。
    marker.with_suffix(".stop").write_text("stop", encoding="utf-8")
    if marker.is_file():
        assert_port_released(test, json.loads(wait_for_file(marker))["port"])


class OwnedProcessTests(TemporaryTestCase):
    def start(self, code, *arguments):
        log = self.root / "process.log"
        proc = verify.OwnedProcess(
            [sys.executable, "-B", "-u", "-c", code, *(str(arg) for arg in arguments)],
            cwd=self.root,
            env=verify.safe_environment(python=Path(sys.executable)),
            log=log,
        )
        self.addCleanup(proc.close)
        self.assertIsInstance(proc.process, subprocess.Popen)
        self.assertGreater(proc.process.pid, 0)
        return proc, log

    def assert_closed(self, proc, result):
        self.assertEqual(result["pid"], proc.process.pid)
        self.assertIs(result["closed"], True, result)
        self.assertFalse(result.get("cleanup_error"), result)
        self.assertIsNotNone(proc.process.poll())

    def test_starts_immediately_wait_returns_exit_code_and_log_captures_both_streams(
        self,
    ):
        proc, log = self.start(
            "import sys; print('stdout fixture', flush=True); "
            "print('stderr fixture', file=sys.stderr, flush=True); sys.exit(7)"
        )
        try:
            self.assertEqual(proc.wait(timeout=8), 7)
        finally:
            result = proc.close()
        self.assert_closed(proc, result)
        text = log.read_text(encoding="utf-8")
        self.assertIn("stdout fixture", text)
        self.assertIn("stderr fixture", text)

    def test_wait_timeout_is_finite_then_close_reaps_process_and_is_idempotent(self):
        proc, _ = self.start("import time; time.sleep(20)")
        started = time.monotonic()
        try:
            with self.assertRaises(subprocess.TimeoutExpired):
                proc.wait(timeout=0.1)
            self.assertLess(time.monotonic() - started, 3)
        finally:
            result = proc.close()
        self.assert_closed(proc, result)
        self.assert_closed(proc, proc.close())

    def test_wait_ready_accepts_a_live_real_loopback_http_worker(self):
        marker = self.root / "http.port"
        proc, _ = self.start(HTTP_WORKER, marker, 200)
        try:
            port = int(wait_for_file(marker))
            url = f"http://127.0.0.1:{port}/health"
            self.assertIsNone(verify.wait_ready(proc, url, timeout=5))
            self.assertIsNone(proc.process.poll())
            self.assertEqual(health_get(url), (200, b"ok"))
        finally:
            result = proc.close()
        self.assert_closed(proc, result)

    def test_wait_ready_times_out_on_real_unhealthy_loopback_worker(self):
        marker = self.root / "http.port"
        proc, _ = self.start(HTTP_WORKER, marker, 503)
        try:
            port = int(wait_for_file(marker))
            started = time.monotonic()
            with self.assertRaises(READINESS_ERRORS):
                verify.wait_ready(proc, f"http://127.0.0.1:{port}/health", timeout=0.2)
            self.assertLess(time.monotonic() - started, 3)
            self.assertIsNone(proc.process.poll())
        finally:
            result = proc.close()
        self.assert_closed(proc, result)

    def test_wait_ready_rejects_noncanonical_loopback_urls(self):
        proc, _ = self.start("import time; time.sleep(20)")
        try:
            with external_health_service() as (_server, url):
                for invalid in (
                    url.replace("http:", "https:"),
                    url.replace("127.0.0.1", "localhost"),
                    "http://[::1]:1/health",
                    "http://127.0.0.2:1/health",
                ):
                    with self.subTest(url=invalid):
                        with self.assertRaises(ValueError):
                            verify.wait_ready(proc, invalid, timeout=0.1)
        finally:
            result = proc.close()
        self.assert_closed(proc, result)

    def test_dead_process_cannot_borrow_foreign_200_service_or_probe_it_first(self):
        with external_health_service() as (server, url):
            self.assertEqual(health_get(url), (200, b"ok"))
            proc, _ = self.start("import sys; sys.exit(0)")
            try:
                self.assertEqual(proc.wait(timeout=8), 0)
                probes = server.probes
                with self.assertRaises(READINESS_ERRORS):
                    verify.wait_ready(proc, url, timeout=0.5)
                self.assertEqual(server.probes, probes, "必须先发现进程已退出，再考虑探针")
            finally:
                result = proc.close()
            self.assert_closed(proc, result)
            self.assertEqual(health_get(url), (200, b"ok"), "close 不得停止外部服务")

    def test_close_reclaims_descendant_port_after_parent_exits_and_preserves_foreign_service(
        self,
    ):
        marker = self.root / "child.port"
        with external_health_service() as (_server, url):
            proc, _ = self.start(PORT_PARENT, marker, PORT_CHILD)
            try:
                self.assertEqual(proc.wait(timeout=10), 0)
                port = int(wait_for_file(marker))
                with socket.socket() as probe:
                    with self.assertRaises(OSError):
                        probe.bind(("127.0.0.1", port))
                self.assertEqual(health_get(url), (200, b"ok"))
            finally:
                result = proc.close()
            self.assert_closed(proc, result)
            deadline = time.monotonic() + 4
            while True:
                with socket.socket() as probe:
                    try:
                        probe.bind(("127.0.0.1", port))
                        break
                    except OSError as error:
                        if time.monotonic() >= deadline:
                            self.fail(f"close 后派生子进程仍持有回环端口 {port}：{error}")
                time.sleep(0.02)
            self.assertEqual(
                health_get(url),
                (200, b"ok"),
                "清理只能针对已拥有进程，不能按端口杀进程",
            )

    def test_live_sleep_process_cannot_borrow_foreign_health_service_or_probe_it(self):
        marker = self.root / "sleep.ready"
        with external_health_service() as (server, url):
            proc, _ = self.start(
                "from pathlib import Path; import sys,time; "
                "Path(sys.argv[1]).write_text('sleeping', encoding='utf-8'); time.sleep(20)",
                marker,
            )
            try:
                self.assertEqual(wait_for_file(marker), "sleeping")
                self.assertIsNone(proc.process.poll())
                self.assertEqual(server.probes, 0)
                with self.assertRaises(READINESS_ERRORS):
                    verify.wait_ready(proc, url, timeout=0.5)
                self.assertIsNone(proc.process.poll())
                self.assertEqual(server.probes, 0, "活 owned 进程不能借用外部服务的 200")
            finally:
                result = proc.close()
            self.assert_closed(proc, result)
            self.assertEqual(health_get(url), (200, b"ok"), "不得清理外部服务")

    def test_owned_302_worker_times_out_without_following_redirect_to_foreign_service(
        self,
    ):
        marker = self.root / "redirect.port"
        served = self.root / "redirect.served"
        with external_health_service() as (server, foreign_url):
            proc, _ = self.start(REDIRECT_WORKER, marker, foreign_url, served)
            try:
                port = int(wait_for_file(marker))
                self.assertIsNone(proc.process.poll())
                started = time.monotonic()
                with self.assertRaises(TimeoutError):
                    verify.wait_ready(proc, f"http://127.0.0.1:{port}/health", timeout=0.5)
                self.assertLess(time.monotonic() - started, 3)
                self.assertEqual(wait_for_file(served), "302 served", "必须确实探测 owned 302 服务")
                self.assertIsNone(proc.process.poll())
                self.assertEqual(server.probes, 0, "302 的 Location 不得触发任何外部探针")
            finally:
                result = proc.close()
            self.assert_closed(proc, result)
            self.assertEqual(server.probes, 0)
            self.assertEqual(health_get(foreign_url), (200, b"ok"))

    @unittest.skipUnless(os.name == "posix", "忽略 SIGTERM 的真实后代仅适用于 POSIX")
    def test_close_reclaims_sigterm_ignoring_descendant_even_after_parent_exits(self):
        marker = self.root / "ignoring-child.json"
        self.addCleanup(stop_fixture_child, self, marker)
        with external_health_service() as (_server, url):
            proc, _ = self.start(MANAGED_PORT_PARENT, marker, MANAGED_PORT_CHILD, "exit", "ignore")
            try:
                child = json.loads(wait_for_file(marker))
                self.assertNotEqual(child["pid"], proc.process.pid)
                self.assertEqual(proc.wait(timeout=10), 0)
                with socket.socket() as probe, self.assertRaises(OSError):
                    probe.bind(("127.0.0.1", child["port"]))
            finally:
                result = proc.close()
            assert_port_released(self, child["port"])
            self.assert_closed(proc, result)
            self.assertEqual(health_get(url), (200, b"ok"))


class CommandGateTests(TemporaryTestCase):
    def command_gate(self, code, *arguments, timeout=8):
        return verify._command_gate(
            "fixture_gate",
            [sys.executable, "-B", "-u", "-c", code, *(str(arg) for arg in arguments)],
            cwd=self.root,
            env=verify.safe_environment(python=Path(sys.executable)),
            log=self.root / "gate.log",
            timeout=timeout,
        )

    def assert_gate_cleanup(self, result):
        self.assertIn("cleanup", result)
        cleanup = result["cleanup"]
        self.assertIsInstance(cleanup, dict)
        self.assertGreater(cleanup["pid"], 0)
        self.assertIs(cleanup["closed"], True, cleanup)
        self.assertFalse(cleanup.get("cleanup_error"), cleanup)

    def test_successful_command_gate_returns_closed_cleanup_and_real_log(self):
        result = self.command_gate("print('gate fixture', flush=True)")
        self.assertEqual(result["name"], "fixture_gate")
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["returncode"], 0)
        self.assertIn("gate fixture", (self.root / "gate.log").read_text(encoding="utf-8"))
        self.assert_gate_cleanup(result)

    def test_real_timeout_reclaims_child_port_without_stopping_foreign_service(self):
        marker = self.root / "timeout-child.json"
        self.addCleanup(stop_fixture_child, self, marker)
        with external_health_service() as (_server, url):
            started = time.monotonic()
            result = self.command_gate(
                MANAGED_PORT_PARENT,
                marker,
                MANAGED_PORT_CHILD,
                "sleep",
                "normal",
                timeout=3,
            )
            self.assertLess(time.monotonic() - started, 15)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["error"], "TimeoutExpired")
            child = json.loads(wait_for_file(marker))
            self.assertGreater(child["pid"], 0)
            self.assertEqual(health_get(url), (200, b"ok"))
            assert_port_released(self, child["port"])
            self.assert_gate_cleanup(result)
            self.assertEqual(health_get(url), (200, b"ok"), "超时清理不能影响外部服务")

    def test_exited_parent_command_gate_reclaims_child_port_without_stopping_foreign_service(
        self,
    ):
        marker = self.root / "exited-parent-child.json"
        self.addCleanup(stop_fixture_child, self, marker)
        with external_health_service() as (_server, url):
            result = self.command_gate(
                MANAGED_PORT_PARENT,
                marker,
                MANAGED_PORT_CHILD,
                "exit",
                "normal",
                timeout=10,
            )
            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["returncode"], 0)
            child = json.loads(wait_for_file(marker))
            self.assertGreater(child["pid"], 0)
            self.assertEqual(health_get(url), (200, b"ok"))
            assert_port_released(self, child["port"])
            self.assert_gate_cleanup(result)
            self.assertEqual(health_get(url), (200, b"ok"), "父退出清理不能影响外部服务")


class PythonDependencyProbeTests(TemporaryTestCase):
    def setUp(self):
        super().setUp()
        self.python = Path(sys.executable).absolute()
        self.assertTrue(self.python.is_file(), "必须使用真实选定解释器，不能假装探针执行成功")
        self.assertGreaterEqual(sys.version_info[:2], (3, 12))
        # 标准库 metadata 动态选择真实存在的包，不假定宿主装有项目第三方依赖。
        distributions = sorted(
            (distribution.metadata["Name"], distribution.version)
            for distribution in importlib.metadata.distributions()
            if distribution.metadata["Name"] and distribution.version
        )
        self.assertTrue(distributions, "选定解释器无真实包元数据；不得安装依赖或跳过验证")
        self.package, self.version = distributions[0]
        self.assertEqual(importlib.metadata.version(self.package), self.version)
        self.lock = self.root / "synthetic-requirements.lock"
        self.lock.write_text(
            f"# synthetic fixture；仅测试探针分支，非项目安装环境实证\n\n"
            f"  {self.package}=={self.version}  \n",
            encoding="utf-8",
        )

    def run_probe(self):
        log = self.root / "python-probe.log"
        command = [
            str(self.python),
            "-B",
            "-u",
            "-c",
            verify._python_dependency_probe(),
            str(self.lock),
        ]
        before = self.lock.read_bytes()
        proc = verify.OwnedProcess(
            command,
            cwd=self.root,
            env=verify.safe_environment(python=self.python),
            log=log,
        )
        self.addCleanup(proc.close)
        self.assertIsInstance(proc.process, subprocess.Popen)
        self.assertGreater(proc.process.pid, 0)
        self.assertEqual(proc.command, command)
        try:
            returncode = proc.wait(timeout=10)
        finally:
            cleanup = proc.close()
        self.assertEqual(cleanup["pid"], proc.process.pid)
        self.assertIs(cleanup["closed"], True, cleanup)
        self.assertFalse(cleanup.get("cleanup_error"), cleanup)
        self.assertEqual(proc.process.poll(), returncode)
        self.assertEqual(self.lock.read_bytes(), before, "探针不能修改锁文件")
        self.assertFalse(list(self.root.rglob("*.pyc")))
        return returncode, log.read_text(encoding="utf-8")

    def assert_report(self, text, *, installed, missing, mismatch):
        lines = text.splitlines()
        self.assertEqual(len(lines), 1, text)
        report = json.loads(lines[0])
        self.assertEqual(
            report,
            {
                "python_version": sys.version.split()[0],
                "executable": str(self.python),
                "installed": installed,
                "missing": missing,
                "mismatch": mismatch,
            },
        )

    def test_real_selected_interpreter_metadata_version_mismatch_returns_one(self):
        wrong_pin = "0" if self.version != "0" else "1"
        self.lock.write_text(f"{self.package}=={wrong_pin}\n", encoding="utf-8")
        returncode, text = self.run_probe()
        self.assertEqual(returncode, 1, text)
        self.assert_report(
            text, installed={self.package: self.version}, missing=[], mismatch=[self.package]
        )

    def test_real_metadata_exact_pin_and_absent_package_return_two_before_project_imports(self):
        missing = "r7-absent-" + self.root.name
        with self.assertRaises(importlib.metadata.PackageNotFoundError):
            importlib.metadata.version(missing)
        with self.lock.open("a", encoding="utf-8") as handle:
            handle.write(f"{missing}==1.0.0\n")
        returncode, text = self.run_probe()
        self.assertEqual(returncode, 2, text)
        self.assert_report(
            text, installed={self.package: self.version}, missing=[missing], mismatch=[]
        )

    def test_synthetic_metadata_wrapper_version_mismatch_returns_one_in_real_subprocess(self):
        # synthetic fixture：仅替换子进程的 metadata 分支输入，不模拟进程或安装环境。
        probe = verify._python_dependency_probe()
        actual = "0" if self.version != "0" else "1"
        wrapper = (
            "import importlib.metadata\nfrom unittest.mock import patch\n"
            "def fixture_version(name):\n"
            f"    assert name == {self.package!r}, name\n"
            f"    return {actual!r}\n"
            "with patch.object(importlib.metadata, 'version', side_effect=fixture_version):\n"
            f"    exec(compile({probe!r}, '<r7-synthetic-probe-branch>', 'exec'))\n"
        )
        with patch.object(verify, "_python_dependency_probe", return_value=wrapper) as patched:
            returncode, text = self.run_probe()
            patched.assert_called_once_with()
        self.assertEqual(returncode, 1, text)
        self.assert_report(
            text, installed={self.package: actual}, missing=[], mismatch=[self.package]
        )
        self.assertEqual(importlib.metadata.version(self.package), self.version)
        self.assertEqual(verify._python_dependency_probe(), probe)

    def test_synthetic_metadata_wrapper_missing_package_returns_two_in_real_subprocess(self):
        # synthetic fixture：真实锁 pin 的包在子进程中模拟缺失，不宣称真实环境缺包。
        probe = verify._python_dependency_probe()
        wrapper = (
            "import importlib.metadata\nfrom unittest.mock import patch\n"
            "def fixture_version(name):\n"
            f"    assert name == {self.package!r}, name\n"
            "    raise importlib.metadata.PackageNotFoundError(name)\n"
            "with patch.object(importlib.metadata, 'version', side_effect=fixture_version):\n"
            f"    exec(compile({probe!r}, '<r7-synthetic-probe-branch>', 'exec'))\n"
        )
        with patch.object(verify, "_python_dependency_probe", return_value=wrapper) as patched:
            returncode, text = self.run_probe()
            patched.assert_called_once_with()
        self.assertEqual(returncode, 2, text)
        self.assert_report(text, installed={}, missing=[self.package], mismatch=[])
        self.assertEqual(importlib.metadata.version(self.package), self.version)
        self.assertEqual(verify._python_dependency_probe(), probe)

    def test_rejects_nonexact_pins_in_real_selected_interpreter(self):
        for line in ("fixture>=1.0", "==1.0", "fixture==", "fixture==1.0; python_version>'3.12'"):
            with self.subTest(line=line):
                self.lock.write_text(line + "\n", encoding="utf-8")
                returncode, text = self.run_probe()
                self.assertEqual(returncode, 1, text)
                self.assertIn("ValueError: dependency lock must contain exact version pins", text)
                self.assertNotIn('"installed":', text)


class RunIsolatedTests(TemporaryGitTestCase):
    # 编排契约不混入 helper-only 验证，未实现不得跳过、模拟为绿或修改 runner。
    def run_without_dependencies(self, run_dir):
        with socket.socket() as next_listener, socket.socket() as python_listener:
            next_listener.bind(("127.0.0.1", 0))
            python_listener.bind(("127.0.0.1", 0))
            return verify.run_isolated(
                source=self.source,
                run_dir=run_dir,
                node=None,
                python=None,
                next_port=next_listener.getsockname()[1],
                python_port=python_listener.getsockname()[1],
            )

    def test_run_isolated_additional_options_have_safe_defaults(self):
        parameters = inspect.signature(verify.run_isolated).parameters
        self.assertIsNone(parameters["node_modules"].default)
        self.assertEqual(parameters["profile"].default, "foundation")
        self.assertIs(parameters["quality"].default, False)

    def test_missing_dependencies_are_incomplete_and_return_equals_evidence_json(self):
        run_dir = self.root / "fresh-run"
        self.assertFalse(run_dir.exists())
        result = self.run_without_dependencies(run_dir)
        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(
            {"node_runtime", "python_runtime", "isolated_node_modules"}.issubset(result["missing"])
        )
        evidence = json.loads((run_dir / "evidence.json").read_text(encoding="utf-8"))
        self.assertEqual(result, evidence, "返回结果必须与最终落盘证据完全一致")
        self.assertTrue(all(item["closed"] is True for item in result["cleanup"]))
        self.assertFalse((run_dir / "commerce.sqlite3").exists())
        self.assertFalse((run_dir / "display.sqlite3").exists())

    def test_source_or_any_existing_run_directory_is_rejected_without_writing_or_overwriting(
        self,
    ):
        populated = self.root / "existing-run"
        populated.mkdir()
        (populated / "evidence.json").write_bytes(b"existing evidence must not change\n")
        (populated / "snapshot-manifest.json").write_bytes(b"existing manifest must not change\n")
        empty = self.root / "existing-empty-run"
        empty.mkdir()
        for run_dir in (self.source, populated, empty):
            with self.subTest(run_dir=run_dir):
                before_files = {
                    path.relative_to(run_dir).as_posix(): path.read_bytes()
                    for path in run_dir.rglob("*")
                    if path.is_file()
                }
                before_directories = {
                    path.relative_to(run_dir).as_posix()
                    for path in run_dir.rglob("*")
                    if path.is_dir()
                }
                try:
                    with self.assertRaises(REJECTION_ERRORS):
                        self.run_without_dependencies(run_dir)
                finally:
                    self.assertEqual(
                        {
                            path.relative_to(run_dir).as_posix(): path.read_bytes()
                            for path in run_dir.rglob("*")
                            if path.is_file()
                        },
                        before_files,
                        "拒绝既有 run_dir 时不能新增证据或覆盖任何字节",
                    )
                    self.assertEqual(
                        {
                            path.relative_to(run_dir).as_posix()
                            for path in run_dir.rglob("*")
                            if path.is_dir()
                        },
                        before_directories,
                        "拒绝既有 run_dir 时不能创建 source/logs 等目录",
                    )


if __name__ == "__main__":
    unittest.main(verbosity=2)
