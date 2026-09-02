import { createRequire } from 'node:module';

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
}

let cached: PackageMetadata | undefined;

/** Read package metadata lazily so importing the library root has no I/O. */
export function getPackageMetadata(): PackageMetadata {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const value = require('../package.json') as Partial<PackageMetadata>;
  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error('package.json does not contain valid name/version metadata');
  }
  cached = {
    name: value.name,
    version: value.version,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
  };
  return cached;
}
