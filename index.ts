import type { Plugin } from "@opencode-ai/plugin";

/**
 * opencode-git-guard
 *
 * Blocks destructive git variants (push --force, reset --hard, clean -fd,
 * branch -D, tag -d, filter-repo, …) before the bash tool runs, by throwing
 * inside OpenCode's `tool.execute.before` hook. Non-destructive mutating
 * commands (commit, push, checkout, rebase, …) pass through untouched —
 * layer this plugin with OpenCode's `permission.bash` ask/deny rules.
 *
 * Why the parsing is careful:
 * - The command is split into chain segments (|, ;, &, newlines) and every
 *   segment is checked independently, so `git status && git push --force`
 *   cannot hide behind a safe prefix.
 * - Within a segment, the FIRST git subcommand is resolved while skipping
 *   git globals (`-C dir`, `--git-dir=…`, `VAR=v`). A quoted message is NOT
 *   stripped on purpose: `git commit -m "git push --force"` reports
 *   `commit`, so the push pattern's subcommand check passes it through to
 *   the permission layer instead of denying.
 * - Segments not led by git (sudo, bash -c, echo $(…)) are conservative:
 *   any destructive pattern match blocks.
 *
 * Escape hatch: set OPENCODE_GIT_GUARD_DISABLE=1 before starting OpenCode.
 */

export const DESTRUCTIVE_GIT_PATTERNS: { re: RegExp; subcommands: string[] }[] = [
  { re: /\bgit\b[^|;&]*?\bpush\b[^|;&]*?(?:--force\b|\s-f(?=[\s]|$|[|;&]))/i, subcommands: ["push"] },
  { re: /\bgit\b[^|;&]*?\bpush\b[^|;&]*?--mirror\b/i, subcommands: ["push"] },
  { re: /\bgit\b[^|;&]*?\bpush\b[^|;&]*?(?:--delete\b|(?:\s|^)["']?:\S)/i, subcommands: ["push"] },
  { re: /\bgit\b[^|;&]*?\breset\b[^|;&]*?--hard\b/i, subcommands: ["reset"] },
  { re: /\bgit\b[^|;&]*?\b(?:checkout|restore)\b[^|;&]*?(?:--\s+)?\.(?:\/)?(?:\s|$|[|;&])/i, subcommands: ["checkout", "restore"] },
  { re: /\bgit\b[^|;&]*?\bcheckout\b[^|;&]*?--orphan\b/i, subcommands: ["checkout"] },
  { re: /\bgit\b[^|;&]*?\bcheckout\b[^|;&]*?\s-B(?=\s|$|[|;&]|[A-Za-z0-9])/, subcommands: ["checkout"] },
  { re: /\bgit\b[^|;&]*?\b(?:checkout|switch)\b[^|;&]*?(?:\s-f\b|\s--force\b|\s--discard-changes\b)/i, subcommands: ["checkout", "switch"] },
  { re: /\bgit\b[^|;&]*?\bbranch\b[^|;&]*?--force\b/i, subcommands: ["branch"] },
  { re: /\bgit\b[^|;&]*?\bbranch\b[^|;&]*?\s-D(?=\s|$|[|;&]|[A-Za-z0-9])/, subcommands: ["branch"] },
  { re: /\bgit\b[^|;&]*?\bbranch\b[^|;&]*?\s-M(?=\s|$|[|;&]|[A-Za-z0-9])/, subcommands: ["branch"] },
  { re: /\bgit\b[^|;&]*?\bbranch\b[^|;&]*?\s-f(?=[\s]|$|[|;&])/, subcommands: ["branch"] },
  { re: /\bgit\b[^|;&]*?\bstash\b[^|;&]*?\b(?:drop|clear)\b/i, subcommands: ["stash"] },
  { re: /\bgit\b[^|;&]*?\btag\b[^|;&]*?(?:-d\b|--force\b|\s-f(?=[\s]|$|[|;&]))/i, subcommands: ["tag"] },
  { re: /\bgit\b[^|;&]*?\breflog\b[^|;&]*?\bexpire\b/i, subcommands: ["reflog"] },
  { re: /\bgit\b[^|;&]*?\bgc\b[^|;&]*?--prune\b/i, subcommands: ["gc"] },
  { re: /\bgit\b[^|;&]*?\bupdate-ref\b/i, subcommands: ["update-ref"] },
  { re: /\bgit\b[^|;&]*?\bprune\b/i, subcommands: ["prune"] },
  { re: /\bgit\b[^|;&]*?\bfilter-branch\b/i, subcommands: ["filter-branch"] },
  { re: /\bgit\b[^|;&]*?\bfilter-repo\b/i, subcommands: ["filter-repo"] },
  { re: /\bgit\b[^|;&]*?\bworktree\b[^|;&]*?\bremove\b[^|;&]*?(?:--force\b|\s-f(?=[\s]|$|[|;&]))/i, subcommands: ["worktree"] },
  { re: /\bgit\b[^|;&]*?\bworktree\b[^|;&]*?\bprune\b/i, subcommands: ["worktree"] },
  { re: /\bgit\b[^|;&]*?\bclean\b(?![^|;&]*?\s-[a-z]*n)(?![^|;&]*?--dry-run\b)[^|;&]*?--force\b/i, subcommands: ["clean"] },
  { re: /\bgit\b[^|;&]*?\bclean\b(?![^|;&]*?\s-[a-z]*n)(?![^|;&]*?--dry-run\b)[^|;&]*?\s-[a-z]*[fdx]/i, subcommands: ["clean"] },
];

// First `git <subcommand>` in a chain segment (lowercase, null when none).
export function firstGitSubcommand(segment: string): string | null {
  const idx = segment.search(/\bgit\b/i);
  if (idx === -1) return null;
  const toks = segment.slice(idx).split(/\s+/).slice(1);
  let skipNext = false;
  for (const raw of toks) {
    const t = raw.replace(/^['"`]+|['"`;,)]+$/g, "");
    if (!t) continue;
    if (skipNext) { skipNext = false; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
    if (/^(--git-dir|--work-tree|--namespace|-C)$/i.test(t)) { skipNext = true; continue; }
    if (/^--git-dir=|^--work-tree=/.test(t)) continue;
    if (/^-/.test(t)) continue;
    return t.toLowerCase();
  }
  return null;
}

// Returns the offending git subcommand, or null when safe to run.
export function isDestructiveGit(command: string): string | null {
  for (const segment of command.split(/[|;&\n\r]+/)) {
    const first = firstGitSubcommand(segment);
    if (!first) continue;
    const lead = segment.trim().split(/\s+/)[0]?.replace(/^['"`]+/, "").toLowerCase();
    const gitFirst = lead === "git";
    for (const { re, subcommands } of DESTRUCTIVE_GIT_PATTERNS) {
      if (!re.test(segment)) continue;
      if (gitFirst && !subcommands.includes(first)) continue;
      return first;
    }
  }
  return null;
}

export const GitGuardPlugin: Plugin = async () => {
  // Escape hatch, read once at startup. Restart OpenCode to change.
  if (process.env.OPENCODE_GIT_GUARD_DISABLE === "1") return {};

  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      if (tool !== "bash" && tool !== "shell") return;

      const args = output?.args;
      if (!args || typeof args !== "object") return;
      const command = String(args.command ?? "");
      if (!command) return;

      const blocked = isDestructiveGit(command);
      if (blocked) {
        throw new Error(
          `[GitGuard] Destructive git operation blocked: git ${blocked}. ` +
            `To bypass legitimately (e.g. filter-repo), restart OpenCode with OPENCODE_GIT_GUARD_DISABLE=1.`
        );
      }
    },
  };
};

export default GitGuardPlugin;
