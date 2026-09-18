// Self-check: node --experimental-strip-types test-guard.ts  (node >= 22.6)
import assert from "node:assert/strict";
import { firstGitSubcommand, isDestructiveGit } from "./index.ts";

const BLOCK: [string, string][] = [
  ["git push --force", "push"],
  ["git push -f origin main", "push"],
  ["git push origin :old-branch", "push"],
  ["git push --mirror", "push"],
  ["git push --force-with-lease", "push"], // conservative: blocks --force*
  ["git reset --hard", "reset"],
  ["git checkout .", "checkout"],
  ["git checkout -- .", "checkout"],
  ["git restore .", "restore"],
  ["git checkout -f feat", "checkout"],
  ["git checkout --force file.txt", "checkout"],
  ["git switch -f feat", "switch"],
  ["git switch --discard-changes feat", "switch"],
  ["git checkout --orphan tmp", "checkout"],
  ["git checkout -B feat", "checkout"],
  ["git branch -D feature", "branch"],
  ["git branch -M main", "branch"],
  ["git branch --force main", "branch"],
  ["git stash drop", "stash"],
  ["git stash clear", "stash"],
  ["git tag -d v1", "tag"],
  ["git tag --force v1", "tag"],
  ["git reflog expire --all", "reflog"],
  ["git gc --prune=now", "gc"],
  ["git update-ref refs/heads/x abc", "update-ref"],
  ["git prune", "prune"],
  ["git filter-branch --tree-filter 'x' HEAD", "filter-branch"],
  ["git filter-repo --path secret.txt --invert-paths", "filter-repo"],
  ["git worktree remove --force /tmp/wt", "worktree"],
  ["git worktree prune", "worktree"],
  ["git clean -fd", "clean"],
  ["git clean -dfx", "clean"],
  ["git clean --force", "clean"],
  // chain segments are checked independently
  ["git status && git push --force", "push"],
  ["git add . ; git reset --hard", "reset"],
  // globals + env vars are skipped when resolving the subcommand
  ["git -C repo push --force", "push"],
  ["GIT_TRACE=1 git push --force", "push"],
  // conservative on segments not led by git
  ["echo $(git push --force)", "push"],
  ["sudo git reset --hard", "reset"],
  // known false-positive class: text merely mentioning the commands
  ["echo git push --force mentioned in text", "push"],
];

const ALLOW: string[] = [
  "git status",
  "git status && git log",
  "git commit -m \"git push --force\"", // quoted message → reports `commit`
  "git commit -am 'git push --force' && git push",
  "git push", // plain push → permission ask layer, not this guard
  "git checkout feat/branch",
  "git checkout -- file.txt",
  "git branch feature",
  "git stash list",
  "git stash pop",
  "git tag --list",
  "git tag v1",
  "git clean -n", // dry-run exempt
  "git clean --dry-run",
  "git clean -nd",
  "git worktree remove /tmp/wt",
  "git worktree add ../wt feat",
  "git gc",
  "git reflog show",
  "git -C repo status",
  "git fetch --prune origin",
  "git fetch --mirror",
  "git config user.name Ahmed",
  "git restore --staged file.txt",
];

let failures = 0;

for (const [cmd, expected] of BLOCK) {
  try {
    assert.equal(isDestructiveGit(cmd), expected, `expected block=${expected}`);
  } catch (err) {
    failures++;
    console.error(`BLOCK case failed: ${cmd}\n  ${(err as Error).message}`);
  }
}

for (const cmd of ALLOW) {
  try {
    assert.equal(isDestructiveGit(cmd), null, "expected allow");
  } catch (err) {
    failures++;
    console.error(`ALLOW case failed: ${cmd}\n  ${(err as Error).message}`);
  }
}

// Subcommand attribution unit checks
const ATTRIB: [string, string | null][] = [
  ["git -C dir push --force", "push"],
  ["git --git-dir=. log", "log"],
  ["GIT_TRACE=1 git commit -m x", "commit"],
  ["git commit -m \"git push --force\"", "commit"],
  ["git -c core.hooksPath=/x status", "status"],
  ["ls -la", null],
];
for (const [seg, expected] of ATTRIB) {
  try {
    assert.equal(firstGitSubcommand(seg), expected);
  } catch (err) {
    failures++;
    console.error(`ATTRIB case failed: ${seg}\n  ${(err as Error).message}`);
  }
}

const total = BLOCK.length + ALLOW.length + ATTRIB.length;
if (failures) {
  console.error(`\nFAILED: ${failures}/${total} cases`);
  process.exit(1);
}
console.log(`OK: ${total}/${total} guard cases pass`);
