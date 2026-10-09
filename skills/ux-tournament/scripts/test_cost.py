#!/usr/bin/env python3
"""Regression test for cost.py: a streamed message repeats its usage line under one message.id and only the
last line carries the full output count. Run: python3 test_cost.py"""
import json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def line(mid, out, ts):
    return json.dumps({"type": "assistant", "timestamp": ts, "message": {
        "id": mid, "model": "claude-sonnet-5",
        "usage": {"input_tokens": 10, "output_tokens": out, "cache_read_input_tokens": 0,
                  "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0}}}})


class StreamedUsage(unittest.TestCase):
    def test_keeps_full_output_count_of_a_streamed_message(self):
        with tempfile.TemporaryDirectory() as pdir:
            with open(os.path.join(pdir, "s1.jsonl"), "w") as fh:
                fh.write("\n".join([
                    line("msg_a", 5, "2026-09-26T10:00:00.000Z"),
                    line("msg_a", 5, "2026-09-26T10:00:01.000Z"),
                    line("msg_a", 552, "2026-09-26T10:00:09.000Z"),
                    line("msg_b", 40, "2026-09-26T10:01:00.000Z"),
                ]) + "\n")
            out = subprocess.run([sys.executable, os.path.join(HERE, "cost.py"), "--project-dir", pdir,
                                  "--session", "s1", "--json"], capture_output=True, text=True, check=True)
            d = json.loads(out.stdout)
            row = d["models"][0]
            self.assertEqual(d["messages"], 2)
            self.assertEqual(row["output"], 592)
            self.assertEqual(row["input"], 20)


if __name__ == "__main__":
    unittest.main()
