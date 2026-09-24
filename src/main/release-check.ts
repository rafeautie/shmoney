// macOS can't self-update without a Developer ID (see ipc/updates.ts), so there
// the app only looks for a newer GitHub release and links to it. Kept free of
// electron imports so it can be tested directly.

// /releases/latest skips drafts and prereleases, matching what the Windows
// updater would pick up
const LATEST_RELEASE_URL = 'https://api.github.com/repos/rafeautie/shmoney/releases/latest'

export interface AvailableRelease {
  version: string
  /** the release's GitHub page, where the user downloads the dmg */
  url: string
}

/** Parses "1.2.3" or "v1.2.3"; null for anything else (including prerelease tags). */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/**
 * The latest published release, if it's newer than `currentVersion` and has a
 * macOS build attached (a release whose mac job failed has nothing to offer).
 * Throws on network or GitHub errors so the caller can report them.
 */
export async function findNewerMacRelease(
  currentVersion: string
): Promise<AvailableRelease | null> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' }
  })
  // 404 means no published release yet
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)

  const release = (await response.json()) as {
    tag_name?: unknown
    html_url?: unknown
    assets?: { name?: unknown }[]
  }
  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
    throw new Error('Unexpected response from GitHub')
  }
  if (!isNewerVersion(release.tag_name, currentVersion)) return null
  const hasDmg = (release.assets ?? []).some(
    (asset) => typeof asset.name === 'string' && asset.name.endsWith('.dmg')
  )
  if (!hasDmg) return null
  return { version: release.tag_name.replace(/^v/, ''), url: release.html_url }
}
