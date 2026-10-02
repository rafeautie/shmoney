---
name: release
description: Cut a shmoney release. Bumps the version with the release:patch/minor/major npm script, waits for the tag-triggered Release workflow, writes release notes, and publishes the draft GitHub release once the builds are in. Use when asked to cut, ship, tag or publish a release.
argument-hint: "[patch|minor|major]"
---

# Cutting a shmoney release

`npm run release:<bump>` runs `npm version <bump>` (commit + `vX.Y.Z` tag) and
`git push --follow-tags`. The tag starts `.github/workflows/release.yml`,
which creates a **draft** release, uploads the Windows/macOS/Linux builds into
it and deploys the web demo. Publishing the draft is the final gate and is
public, so it needs the user's explicit yes.

## 1. Pick the bump

Use the argument if given. Otherwise read `git log --oneline <last tag>..origin/main`
(last tag: `git describe --tags --abbrev=0 origin/main`), recommend one
(features → minor, fixes/polish → patch; we're pre-1.0, so major only when
asked), and confirm with the user.

If there are no commits since the last tag, stop and say so.

## 2. Get onto an up-to-date main

The script pushes the current branch, so it must run on `main`:

```bash
git fetch origin
git worktree list   # is main checked out somewhere?
```

- If a worktree has `[main]`, run the remaining git/npm commands there
  (`cd` into it in the same Bash call). Its tree must be clean.
- Otherwise, in this worktree: require a clean tree, remember the current
  branch, `git switch main`.

Then `git pull --ff-only origin main`. If main has local commits not on
origin, stop and ask; don't release unpushed work silently.

## 3. Run the npm script

```bash
npm run release:<bump>
```

Capture the new version from `node -p "require('./package.json').version"`
and set `TAG=v<version>`. If the push fails, the commit and tag exist only
locally; report it and don't retry with force.

If you switched branches in step 2, `git switch` back to the original branch
afterwards.

## 4. Wait for the Release workflow

The run appears a few seconds after the push; poll briefly for it:

```bash
gh run list --workflow release.yml --branch "$TAG" --limit 1 --json databaseId,status -q '.[0].databaseId'
```

Then watch it with Bash `run_in_background: true` (a run takes ~8 minutes):

```bash
gh run watch <id> --exit-status --interval 30 > /dev/null
```

Write the notes (step 5) while it runs.

If it fails: `gh run view <id> --log-failed | tail -80`, report the failing
job and cause, and stop. Don't publish a partial draft. A rerun is
`gh run rerun <id> --failed`, but ask first.

## 5. Write the release notes

Sources: `git log --oneline <prev tag>..$TAG` plus, for each merged PR,
`gh pr view <n> --json title,body`. Read the actual diffs when a PR body is
thin; the notes describe user-visible behavior, not implementation.

Match the style of earlier releases (`gh release view <prev tag> --json body -q .body`):

```markdown
## Highlights
* **Bold one-line headline of the change.** Then a few plain sentences on what
  the user sees now and why it matters. (#NN)
* Smaller items as plain bullets. (#NN)
* Small polish: a, b, and c.

<contents of first-launch.md, verbatim>

**Full Changelog**: https://github.com/rafeautie/shmoney/compare/<prev tag>...<TAG>
```

Rules:
- Written for users, not developers: no file names, function names or
  internals. Name settings and buttons exactly as the UI shows them, in bold.
- Biggest user-facing change first. Fold release plumbing, refactors, tests,
  docs and CI out entirely unless they change what users get.
- If a release fixes a bug that stopped some users from updating, say who is
  affected and what to do.
- No em dashes. Use commas, semicolons or periods.
- Reference PRs as `(#NN)`; direct commits get no reference.

Save to `<scratchpad>/release-notes-<TAG>.md`.

## 6. Check the draft and publish

After the workflow succeeds, confirm the draft has every platform's assets:

```bash
gh release view "$TAG" --json isDraft,assets -q '.isDraft, .assets[].name'
```

Expect `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, the `-setup.exe`,
`.dmg`, `.AppImage` and `_amd64.deb` (plus blockmaps). A missing updater
`.yml` would leave that platform's users without the update; stop if any is
missing.

Upload the notes to the draft (not public yet):

```bash
gh release edit "$TAG" --notes-file <notes file>
```

Show the user the notes and the asset list and **ask before publishing**.
On a yes:

```bash
gh release edit "$TAG" --draft=false --latest
```

Report the release URL (`gh release view "$TAG" --json url -q .url`) and that
the demo job deployed shmoney-demo.rafe.dev.
