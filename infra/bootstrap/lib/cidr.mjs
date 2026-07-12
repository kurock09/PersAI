/**
 * Pure IPv4 CIDR helpers for ADR-146 foundation validation.
 * No GCP/network I/O — safe for local unit tests and dry-run planning.
 */

/**
 * @param {string} cidr
 * @returns {{ network: number, mask: number, prefix: number, cidr: string }}
 */
export function parseCidr(cidr) {
  if (typeof cidr !== "string" || !cidr.includes("/")) {
    throw new Error(`invalid CIDR: ${String(cidr)}`);
  }
  const [ipText, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid CIDR prefix: ${cidr}`);
  }
  const network = ipToInt(ipText);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const normalized = (network & mask) >>> 0;
  if (normalized !== network) {
    throw new Error(`CIDR host bits set (expected network address): ${cidr}`);
  }
  return { network: normalized, mask, prefix, cidr };
}

/**
 * @param {string} ip
 * @returns {number}
 */
export function ipToInt(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) {
    throw new Error(`invalid IPv4 address: ${ip}`);
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(`invalid IPv4 address: ${ip}`);
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`invalid IPv4 address: ${ip}`);
    }
    value = ((value << 8) + octet) >>> 0;
  }
  return value;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function cidrsOverlap(a, b) {
  const left = parseCidr(a);
  const right = parseCidr(b);
  const leftEnd =
    (left.network + (left.prefix === 0 ? 0xffffffff : 2 ** (32 - left.prefix) - 1)) >>> 0;
  const rightEnd =
    (right.network + (right.prefix === 0 ? 0xffffffff : 2 ** (32 - right.prefix) - 1)) >>> 0;
  return left.network <= rightEnd && right.network <= leftEnd;
}

/**
 * @param {Array<{ name: string, cidr: string }>} namedCidrs
 * @returns {Array<{ left: string, right: string, leftCidr: string, rightCidr: string }>}
 */
export function findOverlaps(namedCidrs) {
  /** @type {Array<{ left: string, right: string, leftCidr: string, rightCidr: string }>} */
  const overlaps = [];
  for (let i = 0; i < namedCidrs.length; i += 1) {
    for (let j = i + 1; j < namedCidrs.length; j += 1) {
      const left = namedCidrs[i];
      const right = namedCidrs[j];
      if (cidrsOverlap(left.cidr, right.cidr)) {
        overlaps.push({
          left: left.name,
          right: right.name,
          leftCidr: left.cidr,
          rightCidr: right.cidr
        });
      }
    }
  }
  return overlaps;
}

/**
 * Expand inventory into the explicit deny destination set used by VPC firewall.
 * Service CIDR is included even when non-RFC1918 (live 34.118.224.0/20).
 * specialUseDenies already covers RFC1918 aggregates; environment peers remain listed
 * for deploy-truth clarity and NetworkPolicy inventory reuse in later slices.
 *
 * @param {import('./foundation.mjs').FoundationInventory} inventory
 * @returns {string[]}
 */
export function buildFirewallDenyDestinations(inventory) {
  const destinations = new Set([
    ...inventory.cidrs.vpcSubnetDenies,
    ...inventory.cidrs.nonClusterSpecialUseDenies,
    ...Object.values(inventory.cidrs.peers)
  ]);
  return [...destinations].sort();
}

export function buildRestrictedProxyDeniedCidrs(inventory) {
  const specialUse = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4"
  ];
  return [
    ...new Set([
      ...specialUse,
      inventory.cidrs.nodePrimary,
      inventory.cidrs.podDefault,
      inventory.cidrs.sandboxPodSecondary,
      inventory.cidrs.service,
      ...inventory.cidrs.vpcSubnetDenies,
      ...inventory.cidrs.observedPeerRoutes,
      ...Object.values(inventory.cidrs.peers)
    ])
  ].sort();
}

/**
 * Named CIDRs that must not overlap for a coherent sandbox contour.
 * specialUseDenies intentionally overlap peers (they are aggregates) and are excluded.
 *
 * @param {import('./foundation.mjs').FoundationInventory} inventory
 * @returns {Array<{ name: string, cidr: string }>}
 */
export function criticalNamedCidrs(inventory) {
  return [
    { name: "nodePrimary", cidr: inventory.cidrs.nodePrimary },
    { name: "podDefault", cidr: inventory.cidrs.podDefault },
    { name: "service", cidr: inventory.cidrs.service },
    { name: "sandboxPodSecondary", cidr: inventory.cidrs.sandboxPodSecondary },
    ...Object.entries(inventory.cidrs.peers).map(([name, cidr]) => ({ name: `peer.${name}`, cidr }))
  ];
}
