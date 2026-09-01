import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const blockedAddresses = new BlockList();
const allocatedPublicIpv6 = new BlockList();
const wellKnownNat64 = new BlockList();

function block4(network: string, prefix: number): void {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

function block6(network: string, prefix: number): void {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

// Non-routable, local, private, link-local, benchmarking, multicast and
// reserved IPv4 space. Documentation ranges are denied too: they are never a
// legitimate production upstream and make fail-closed tests deterministic.
block4('0.0.0.0', 8);
block4('10.0.0.0', 8);
block4('100.64.0.0', 10);
block4('127.0.0.0', 8);
block4('169.254.0.0', 16);
block4('172.16.0.0', 12);
block4('192.0.0.0', 24);
block4('192.0.2.0', 24);
block4('192.168.0.0', 16);
block4('192.88.99.0', 24);
block4('198.18.0.0', 15);
block4('198.51.100.0', 24);
block4('203.0.113.0', 24);
block4('224.0.0.0', 4);
block4('240.0.0.0', 4);

// IPv6 unspecified, loopback, mapped local/private ranges, documentation,
// unique-local, link-local and multicast.
block6('::', 128);
block6('::1', 128);
// Deprecated IPv4-compatible addresses can otherwise spell loopback/RFC1918
// destinations as `::127.0.0.1` or `::10.0.0.1`.
block6('::', 96);
block6('::ffff:0:0', 104);
block6('::ffff:10.0.0.0', 104);
block6('::ffff:100.64.0.0', 106);
block6('::ffff:127.0.0.0', 104);
block6('::ffff:169.254.0.0', 112);
block6('::ffff:172.16.0.0', 108);
block6('::ffff:192.0.0.0', 120);
block6('::ffff:192.0.2.0', 120);
block6('::ffff:192.168.0.0', 112);
block6('::ffff:198.18.0.0', 111);
block6('::ffff:198.51.100.0', 120);
block6('::ffff:203.0.113.0', 120);
block6('::ffff:224.0.0.0', 100);
block6('::ffff:240.0.0.0', 100);
block6('2001:db8::', 32);
block6('fc00::', 7);
block6('fe80::', 10);
block6('fec0::', 10);
block6('ff00::', 8);

// Fail closed on deprecated or locally administered transition mechanisms.
// The RFC 6052 well-known /96 is handled separately: its embedded IPv4 address
// is accepted only when that exact IPv4 address passes the normal public policy.
// Other transition ranges cannot prove the final public destination from the
// DNS answer alone.
wellKnownNat64.addSubnet('64:ff9b::', 96, 'ipv6');
block6('64:ff9b:1::', 48); // local-use NAT64
block6('2001::', 32); // Teredo
block6('2001:10::', 28); // ORCHIDv1
block6('2001:20::', 28); // ORCHIDv2
block6('2001:2::', 48); // benchmarking
block6('2002::', 16); // 6to4
block6('3ffe::', 16); // returned 6bone allocation
block6('3fff::', 20); // documentation

// Positive list of IANA's currently ALLOCATED native global-unicast ranges.
// The surrounding 2000::/3 is only *assignable*: IANA explicitly reserves all
// table gaps for future allocation. Those gaps must remain unreachable until
// this reviewed list is deliberately updated. IANA protocol/transition ranges
// (2001::/23 and 2002::/16) are intentionally omitted as provider origins.
for (const [network, prefix] of [
  ['2001:200::', 23],
  ['2001:400::', 23],
  ['2001:600::', 23],
  ['2001:800::', 22],
  ['2001:c00::', 23],
  ['2001:e00::', 23],
  ['2001:1200::', 23],
  ['2001:1400::', 22],
  ['2001:1800::', 23],
  ['2001:1a00::', 23],
  ['2001:1c00::', 22],
  ['2001:2000::', 19],
  ['2001:4000::', 23],
  ['2001:4200::', 23],
  ['2001:4400::', 23],
  ['2001:4600::', 23],
  ['2001:4800::', 23],
  ['2001:4a00::', 23],
  ['2001:4c00::', 23],
  ['2001:5000::', 20],
  ['2001:8000::', 19],
  ['2001:a000::', 20],
  ['2001:b000::', 20],
  ['2003::', 18],
  ['2400::', 12],
  ['2410::', 12],
  ['2600::', 12],
  ['2610::', 23],
  ['2620::', 23],
  ['2630::', 12],
  ['2800::', 12],
  ['2a00::', 12],
  ['2a10::', 12],
  ['2c00::', 12],
] as const) {
  allocatedPublicIpv6.addSubnet(network, prefix, 'ipv6');
}

export const systemHostResolver: HostResolver = async (hostname) => (
  lookup(hostname, { all: true, verbatim: true })
);

export function normalizedIpLiteral(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

export function isBlockedAddress(address: string): boolean {
  const normalized = normalizedIpLiteral(address);
  const family = isIP(normalized);
  if (family === 4) return blockedAddresses.check(normalized, 'ipv4');
  if (family === 6) {
    if (wellKnownNat64.check(normalized, 'ipv6')) {
      const embedded = embeddedIpv4Address(normalized);
      return embedded === undefined || blockedAddresses.check(embedded, 'ipv4');
    }
    return blockedAddresses.check(normalized, 'ipv6')
      || !allocatedPublicIpv6.check(normalized, 'ipv6');
  }
  return true;
}

function embeddedIpv4Address(address: string): string | undefined {
  let source = address.toLowerCase();
  const dottedTail = source.slice(source.lastIndexOf(':') + 1);
  if (dottedTail.includes('.')) {
    const octets = dottedTail.split('.').map(Number);
    if (
      octets.length !== 4
      || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) return undefined;
    const [a, b, c, d] = octets as [number, number, number, number];
    source = source.slice(0, source.lastIndexOf(':') + 1)
      + ((a << 8) | b).toString(16)
      + ':'
      + ((c << 8) | d).toString(16);
  }

  const halves = source.split('::');
  if (halves.length > 2) return undefined;
  const parseWords = (part: string): number[] | undefined => {
    if (part.length === 0) return [];
    const words = part.split(':').map((word) => Number.parseInt(word, 16));
    return words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
      ? undefined
      : words;
  };
  const left = parseWords(halves[0] ?? '');
  const right = parseWords(halves[1] ?? '');
  if (left === undefined || right === undefined) return undefined;
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) {
    return undefined;
  }
  const words = [...left, ...Array.from({ length: omitted }, () => 0), ...right];
  if (words.length !== 8) return undefined;
  const high = words[6];
  const low = words[7];
  if (high === undefined || low === undefined) return undefined;
  return [
    high >>> 8,
    high & 0xff,
    low >>> 8,
    low & 0xff,
  ].join('.');
}
