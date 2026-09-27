"""Regression test: a path in .provenance/not-first-party.txt stays out, even if allowlisted.

    python3 -m unittest scripts/test_provenance_gate.py
"""

import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "provenance_gate", Path(__file__).resolve().parent / "provenance-gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class KnownThirdParty(unittest.TestCase):
    def test_listed_path_is_blocked_and_cannot_be_attested(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            prov = root / ".provenance"
            prov.mkdir()
            (root / "skills" / "vendor-thing").mkdir(parents=True)
            (root / "skills" / "vendor-thing" / "SKILL.md").write_text("# vendor\n")
            deny = prov / "not-first-party.txt"
            deny.write_text("skills/vendor-thing/\tsomeone else's bundle\n")
            allow = prov / "first-party.txt"
            allow.write_text("skills/vendor-thing/SKILL.md\n")

            with mock.patch.multiple(gate, REPO_ROOT=root, PROV_DIR=prov,
                                     ALLOWLIST=allow, NOT_FIRST_PARTY=deny):
                # Allowlisted by mistake: the deny list still wins.
                findings = gate.scan(["skills/vendor-thing/SKILL.md"], gate.load_allowlist(),
                                     set(), gate.load_denylist())
                self.assertIn("known-third-party",
                              [f.rule for f in findings if f.severity == "block"])

                # And it cannot be attested back in.
                allow.write_text("")
                with redirect_stderr(io.StringIO()):
                    self.assertEqual(gate.attest(["skills/vendor-thing"]), 2)
                self.assertNotIn("vendor-thing", allow.read_text())


if __name__ == "__main__":
    unittest.main()
