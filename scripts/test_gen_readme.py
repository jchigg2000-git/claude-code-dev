"""Regression test: the README catalog uses plain summaries, not the descriptions Claude reads.

    python3 -m unittest scripts/test_gen_readme.py
"""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "gen_readme", Path(__file__).resolve().parent / "gen-readme.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

README = "# t\n\n<!-- BEGIN:catalog -->\n<!-- END:catalog -->\n\n## License\n"


def make_repo(root: Path, entries: dict) -> None:
    (root / "docs").mkdir()
    (root / "commands").mkdir()
    (root / "skills" / "new-skill").mkdir(parents=True)
    (root / "commands" / "shipit.md").write_text(
        "---\ndescription: Ship the tree. Fire on `/shipit`.\n---\nbody\n")
    (root / "skills" / "new-skill" / "SKILL.md").write_text(
        "---\nname: new-skill\ndescription: Does a new thing for you. More detail. Fire on `/new-skill`.\n---\n")
    catalog = {"groups": [{"id": "ship", "title": "Ship and save work", "blurb": "b"}],
               "entries": entries}
    (root / gen.CATALOG).write_text(json.dumps(catalog))


class Catalog(unittest.TestCase):
    def test_summary_wins_and_uncatalogued_entry_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, {"commands/shipit": {"group": "ship", "summary": "Commits and pushes."}})
            out, missing = gen.render(README, root)

        self.assertIn("| [`/shipit`](commands/shipit.md) | command | Commits and pushes. |", out)
        self.assertNotIn("Ship the tree", out)
        self.assertEqual(missing, ["skills/new-skill"])
        unsorted = out.split("### Not yet summarized", 1)[1]
        self.assertIn("| skill | Does a new thing for you. |", unsorted)
        self.assertNotIn("Fire on", out)
        self.assertIn("## License", out)  # text outside the markers survives

    def test_catalog_key_without_a_file_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, {"commands/gone": {"group": "ship", "summary": "Was removed."}})
            with self.assertRaises(SystemExit) as ctx:
                gen.render(README, root)
        self.assertIn("commands/gone", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
