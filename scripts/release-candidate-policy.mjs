export const CHECKSUMS_FILENAME = 'SHA256SUMS';
export const SIGNATURE_FILENAME = 'SHA256SUMS.sig';
export const PROVENANCE_FILENAME = 'provenance.intoto.jsonl';

function requirePackageIdentity(packageJson) {
  if (
    !packageJson
    || typeof packageJson.name !== 'string'
    || !/^@[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(packageJson.name)
    || typeof packageJson.version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(packageJson.version)
  ) {
    throw new Error('Release package identity must be a scoped stable package version.');
  }
}

export function releaseCandidatePolicy(packageJson, tag, flavor = 'private') {
  requirePackageIdentity(packageJson);
  if (!['private', 'public'].includes(flavor)) {
    throw new Error(`Unsupported release candidate flavor: ${String(flavor)}`);
  }
  const expectedTag = `v${packageJson.version}`;
  if (tag !== expectedTag) {
    throw new Error(`Candidate tag ${String(tag)} does not match package version ${expectedTag}.`);
  }
  const npmTarball = `${packageJson.name.replace(/^@/, '').replaceAll('/', '-')}`
    + `-${packageJson.version}.tgz`;
  const suffix = flavor === 'private' ? '-private' : '';
  const binaryPayloads = [
    npmTarball,
    `german-legal-mcp-${packageJson.version}.sbom.cdx.json`,
    `german-legal-mcp${suffix}.mcpb`,
    `german-legal-mcp${suffix}-${tag}.sbom.cdx.json`,
  ];
  const integrityPayloads = [...binaryPayloads, PROVENANCE_FILENAME];
  return {
    flavor,
    tag,
    npmTarball,
    binaryPayloads,
    integrityPayloads,
    candidateFiles: [...integrityPayloads, CHECKSUMS_FILENAME],
    publishedFiles: [...integrityPayloads, CHECKSUMS_FILENAME, SIGNATURE_FILENAME],
  };
}
