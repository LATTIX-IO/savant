import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { GitProviderError } from "./errors.ts";
import type { Env } from "./secret-vault.ts";

/**
 * SSRF protection for configurable provider hosts (self-managed GitLab).
 *
 * Only HTTPS origins are accepted, and hosts that resolve to loopback,
 * link-local, cloud metadata, or private ranges are rejected unless an operator
 * explicitly allows them through GIT_PROVIDER_ALLOWED_PRIVATE_HOSTS (for
 * deliberately supported private connectivity, e.g. a VPN or peering link).
 */

const ALLOWED_PRIVATE_HOSTS_ENV = "GIT_PROVIDER_ALLOWED_PRIVATE_HOSTS";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inIpv4Cidr(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(base) & mask);
}

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    return BLOCKED_IPV4_RANGES.some(([base, bits]) => inIpv4Cidr(address, base, bits));
  }

  if (version === 6) {
    const normalized = address.toLowerCase();

    if (normalized === "::" || normalized === "::1") {
      return true;
    }

    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped?.[1]) {
      return isBlockedIpAddress(mapped[1]);
    }

    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast, AWS IMDS fd00:ec2::254.
    return /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
  }

  return false;
}

function readAllowedPrivateHosts(env: Env): Set<string> {
  return new Set(
    (env[ALLOWED_PRIVATE_HOSTS_ENV] ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Validates and normalizes a self-managed provider base URL, returning its
 * origin (e.g. `https://gitlab.example.com`). Paths are allowed for instances
 * served under a relative URL root.
 */
export async function validateProviderBaseUrl(
  rawUrl: string,
  options?: { env?: Env | undefined; resolve?: HostResolver | undefined },
): Promise<{ origin: string; host: string; baseUrl: string }> {
  const env = options?.env ?? process.env;
  let parsed: URL;

  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`);
  } catch {
    throw new GitProviderError("PROVIDER_HOST_REJECTED", "Enter a valid HTTPS URL for the provider instance.");
  }

  if (parsed.protocol !== "https:") {
    throw new GitProviderError("PROVIDER_HOST_REJECTED", "Self-managed provider URLs must use HTTPS.");
  }

  if (parsed.username || parsed.password) {
    throw new GitProviderError("PROVIDER_HOST_REJECTED", "Provider URLs must not embed credentials.");
  }

  if (parsed.search || parsed.hash) {
    throw new GitProviderError("PROVIDER_HOST_REJECTED", "Provider URLs must not include a query string or fragment.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowed = readAllowedPrivateHosts(env);
  const explicitlyAllowed = allowed.has(hostname) || allowed.has(parsed.host.toLowerCase());

  if (!explicitlyAllowed) {
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
      throw new GitProviderError("PROVIDER_HOST_REJECTED", `The host '${hostname}' is not an allowed provider host.`);
    }

    if (isIP(hostname)) {
      if (isBlockedIpAddress(hostname)) {
        throw new GitProviderError("PROVIDER_HOST_REJECTED", `The address '${hostname}' is in a blocked network range.`);
      }
    } else {
      let addresses: string[];

      try {
        addresses = await (options?.resolve ?? defaultResolver)(hostname);
      } catch {
        throw new GitProviderError("PROVIDER_HOST_REJECTED", `The host '${hostname}' could not be resolved.`);
      }

      if (addresses.length === 0 || addresses.some(isBlockedIpAddress)) {
        throw new GitProviderError(
          "PROVIDER_HOST_REJECTED",
          `The host '${hostname}' resolves to a loopback, link-local, metadata, or private address.`,
        );
      }
    }
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const host = parsed.port ? `${hostname}:${parsed.port}` : hostname;

  return {
    origin: `https://${host}`,
    host,
    baseUrl: `https://${host}${path}`,
  };
}
