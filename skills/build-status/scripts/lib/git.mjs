// The git facts the page shows: branch, uncommitted count, the last 12 commits. Read live on every
// render, so they're never stale the way hand-maintained state can be.
import { git } from "./paths.mjs";

export function gitContext(root) {
  if (git(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return { isGitRepo: false, branch: "", dirty: 0, commits: [] };
  }
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || "";
  const dirty = (git(root, ["status", "--porcelain"]) || "").split("\n").filter(Boolean).length;
  const commits = (git(root, ["log", "--pretty=format:%h\u001f%ar\u001f%s", "-12"]) || "")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, when, subject] = l.split("\u001f");
      return { sha, when, subject };
    });
  return { isGitRepo: true, branch, dirty, commits };
}
