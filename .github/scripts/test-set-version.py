#!/usr/bin/env python3
"""Unit tests for set-version.py (ISEC-853). Stdlib only; run from the repo root."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "set-version.py"
CONFIG = """[tool.bumpver]
current_version = "1.2.0"
commit_message = "chore: Bump version {old_version} -> {new_version}"

[tool.bumpver.file_patterns]
"readme.txt" = ["Stable tag: {version}"]
"composer.json" = ['"version": "{version}",']
"plugin.php" = ["Version: {version}", "this->version = '{version}';"]
"""


def php(header, code, extra=""):
    return f"<?php\n/**\n * Plugin Name: Test\n * Version: {header}\n */\n{extra}class T {{\n    function __construct() {{\n        $this->version = '{code}';\n    }}\n}}\n"



class SetVersionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.cfg = self.root / "trusted.toml"
        self.cfg.write_text(CONFIG)
        self.data = self.root / "data"
        self.data.mkdir()
        self.write("1.2.0", "1.2.0", "1.2.0")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, cv, readme, composer, extra="", php_text=None):
        (self.data / "bumpver.toml").write_text(CONFIG.replace('"1.2.0"', f'"{cv}"'))
        (self.data / "readme.txt").write_text(f"=== Plugin ===\nStable tag: {readme}\n{extra}")
        (self.data / "composer.json").write_text(f'{{\n    "version": "{composer}",\n}}\n')
        (self.data / "plugin.php").write_text(php_text if php_text is not None else php(cv, cv))

    def run_script(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)

    def check(self, version):
        return self.run_script("--check", str(self.cfg), str(self.data), version).returncode

    def test_check_passes_when_every_file_matches(self):
        self.assertEqual(self.check("1.2.0"), 0)

    def test_check_fails_for_another_version(self):
        self.assertEqual(self.check("1.3.0"), 1)

    def test_check_fails_when_one_file_is_behind(self):
        self.write("1.3.0", "1.3.0", "1.2.0")
        self.assertEqual(self.check("1.3.0"), 1)

    def test_check_rejects_a_longer_version_with_the_expected_prefix(self):
        # `Stable tag: {version}` ends at the version: 1.3.0.1 is not 1.3.0.
        self.write("1.3.0", "1.3.0.1", "1.3.0")
        self.assertEqual(self.check("1.3.0"), 1)

    def test_check_rejects_a_non_version_value(self):
        # `Stable tag: trunk` is the declaration, and it is not 1.3.0, even
        # with the expected text in a comment.
        self.write("1.3.0", "trunk", "1.3.0", extra="<!-- Stable tag: 1.3.0 -->\n")
        self.assertEqual(self.check("1.3.0"), 1)
        self.write("1.3.0", "trunk", "1.3.0", extra="Stable tag: 1.3.0\n")
        self.assertEqual(self.check("1.3.0"), 1)

    def test_check_rejects_a_version_with_a_suffix(self):
        # The whole value is compared: `1.3.0_snapshot` and `1.3.0/x` are not 1.3.0.
        for value in ("1.3.0_snapshot", "1.3.0/invalid"):
            self.write("1.3.0", value, "1.3.0")
            self.assertEqual(self.check("1.3.0"), 1, value)
            self.write("1.3.0", "1.3.0", value)
            self.assertEqual(self.check("1.3.0"), 1, value)

    def test_check_rejects_a_decoy_copy(self):
        self.write("1.3.0", "9.9.9", "1.3.0", extra="<!-- Stable tag: 1.3.0 -->\n")
        self.assertEqual(self.check("1.3.0"), 1)

    def test_check_rejects_a_duplicate_declaration(self):
        self.write("1.3.0", "1.3.0", "1.3.0", extra="Stable tag: 1.3.0\n")
        self.assertEqual(self.check("1.3.0"), 1)

    def test_check_reads_the_docblock_header(self):
        # WordPress reads `Version:` from a docblock, so it must count.
        self.write("1.3.0", "1.3.0", "1.3.0", php_text=php("1.3.0", "1.3.0"))
        self.assertEqual(self.check("1.3.0"), 0)
        self.write("1.3.0", "1.3.0", "1.3.0", php_text=php("1.2.0", "1.3.0"))
        self.assertEqual(self.check("1.3.0"), 1)

    def test_check_matches_a_reformatted_declaration(self):
        # `$this->version='9.9.9';` is the same declaration without spaces, so
        # a spaced copy of the expected text in a comment cannot pass for it.
        code = php("1.3.0", "1.3.0").replace("$this->version = '1.3.0';", "$this->version='9.9.9'; // $this->version = '1.3.0';")
        self.write("1.3.0", "1.3.0", "1.3.0", php_text=code)
        self.assertEqual(self.check("1.3.0"), 1)
        self.write("1.3.0", "1.3.0", "1.3.0", php_text=php("1.3.0", "1.3.0").replace("$this->version = '1.3.0';", "$this->version='1.3.0';"))
        self.assertEqual(self.check("1.3.0"), 0)

    def test_check_ignores_declarations_in_comments(self):
        # The real declaration is gone; only commented copies remain.
        for comment in ("// $this->version = '1.3.0';\n", "# $this->version = '1.3.0';\n", "/* $this->version = '1.3.0'; */\n",
                        "$x = 1; # $this->version = '1.3.0';\n", "$x = 1; // $this->version = '1.3.0';\n"):
            code = php("1.3.0", "1.3.0").replace("$this->version = '1.3.0';", "$this->release = '1.3.0';")
            self.write("1.3.0", "1.3.0", "1.3.0", php_text=code.replace("class T", comment + "class T"))
            self.assertEqual(self.check("1.3.0"), 1, comment)
        self.write("1.3.0", "9.9.9", "1.3.0", extra="<!-- Stable tag: 1.3.0 -->\n")
        self.assertEqual(self.check("1.3.0"), 1)

    def test_rewrite_keeps_indentation_and_comment(self):
        cfg = (self.data / "bumpver.toml").read_text().replace(
            'current_version = "1.2.0"', '  current_version = "1.2.0"  # pinned'
        )
        (self.data / "bumpver.toml").write_text(cfg)
        out = self.run_script(str(self.cfg), str(self.data), "1.2.0", "1.3.0")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn('  current_version = "1.3.0"  # pinned', (self.data / "bumpver.toml").read_text())
        self.assertEqual(self.check("1.3.0"), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
