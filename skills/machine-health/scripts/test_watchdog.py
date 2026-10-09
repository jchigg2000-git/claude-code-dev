"""Run: python3 -m unittest discover ~/.claude/skills/machine-health/scripts"""
import sys
import unittest
from unittest import mock

sys.argv = ["watchdog.py", "--ignore", "ask-meadowlark"]
import watchdog as w  # noqa: E402


def proc(pid, ppid, cmd):
    return dict(pid=pid, ppid=ppid, cpu=0.0, rss_mb=0, age=0.0, nice=0, cmd=cmd)


class GuardedTest(unittest.TestCase):
    def test_ignore_protects_the_whole_tree_of_a_matching_session(self):
        ps = [
            proc(100, 1, "claude --dangerously-skip-permissions"),  # cwd ask-meadowlark
            proc(101, 100, "/bin/zsh -c npm exec vitest run"),
            proc(102, 101, "node (vitest)"),
            proc(103, 102, "node (vitest 3)"),
            proc(200, 1, "claude --dangerously-skip-permissions"),  # cwd career
            proc(201, 200, "node (vitest)"),
        ]
        lsof = "p100\nfcwd\nn/Users/x/Projects/ask-meadowlark\np200\nfcwd\nn/Users/x/Projects/career\n"
        with mock.patch.object(w, "sh", return_value=lsof):
            self.assertEqual(w.guarded(ps), {100, 101, 102, 103})


if __name__ == "__main__":
    unittest.main()
