const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseStableVersion(value, label = 'version') {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a stable semantic version string.`);
  }
  const match = STABLE_SEMVER.exec(value);
  if (!match) {
    throw new Error(`${label} ${JSON.stringify(value)} is not canonical stable SemVer.`);
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`${label} ${value} exceeds the supported SemVer integer range.`);
  }
  return parts;
}

export function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left, 'candidate version');
  const rightParts = parseStableVersion(right, 'baseline version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

export function requireStrictlyNewerStableVersion(candidate, baseline, destination) {
  if (compareStableVersions(candidate, baseline) <= 0) {
    throw new Error(
      `Stable candidate ${candidate} must be strictly newer than ${destination} ${baseline}.`,
    );
  }
}

export function greatestStableReleaseTag(tags) {
  let greatest;
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.startsWith('v')) continue;
    const version = tag.slice(1);
    if (!STABLE_SEMVER.test(version)) continue;
    if (greatest === undefined || compareStableVersions(version, greatest) > 0) {
      greatest = version;
    }
  }
  return greatest;
}
