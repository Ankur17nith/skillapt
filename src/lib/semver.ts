import semver from "semver";
import type { SkillDetail, SkillVersionSummary } from "./registry.js";

/**
 * Resolve the best matching version for a skill given a semver range or pinned version.
 *
 * Rules:
 * 1. Pinned exact versions (e.g. "1.2.0") can match even if yanked.
 * 2. Ranges (e.g. "^1.0.0", "~2.1.0", "*", or null/"latest") ONLY match non-yanked versions.
 * 3. Returns the highest matching version according to SemVer 2.0.0.
 */
export function resolveSkillVersion(
  skill: SkillDetail,
  requestedRange?: string | null
): SkillVersionSummary {
  const versions = skill.versions ?? {};
  const versionKeys = Object.keys(versions);

  if (versionKeys.length === 0) {
    throw new Error(`Skill "${skill.name}" has no published versions.`);
  }

  const range = requestedRange?.trim() || "*";

  // Check if an exact pinned version was requested
  const exactVersion = semver.clean(range);
  if (exactVersion) {
    const exactMatch = versions[exactVersion];
    if (exactMatch) {
      return exactMatch;
    }
  }

  // Filter out yanked versions for range resolution
  const nonYankedVersions = versionKeys.filter((v) => !versions[v]?.yanked);

  if (nonYankedVersions.length === 0) {
    throw new Error(
      `All versions of "${skill.name}" have been yanked. Specify an exact version to install.`
    );
  }

  // Find the highest version satisfying the range
  const matchedVersion = semver.maxSatisfying(
    nonYankedVersions,
    range === "latest" ? "*" : range
  );

  if (!matchedVersion) {
    const availableStr = nonYankedVersions.sort(semver.rcompare).join(", ");
    throw new Error(
      `No version of "${skill.name}" satisfies range "${range}". Available non-yanked versions: ${availableStr}`
    );
  }

  const versionSummary = versions[matchedVersion];
  if (!versionSummary) {
    throw new Error(`Resolved version "${matchedVersion}" metadata is missing.`);
  }

  return versionSummary;
}
