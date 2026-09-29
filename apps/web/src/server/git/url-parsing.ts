import type { GitProviderType, RepositoryLocator } from "./types.ts";

/**
 * Normalizes supported repository URL formats (HTTPS and SSH) into a
 * RepositoryLocator. URLs are only used for addressing and duplicate
 * detection; provider repository IDs remain canonical identity.
 */

type SplitUrl = { host: string; segments: string[] };

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

function splitRepositoryUrl(raw: string): SplitUrl | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  // scp-like SSH: git@host:path
  const scp = /^(?:[^@\s/]+@)?([^:\s/]+):(?!\/\/)(.+)$/.exec(value);
  if (scp?.[1] && scp[2] && !value.includes("://") && !/^\d+\//.test(scp[2])) {
    return {
      host: scp[1].toLowerCase(),
      segments: stripGitSuffix(scp[2]).split("/").filter(Boolean),
    };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(withScheme);
    if (!["https:", "http:", "ssh:", "git+ssh:"].includes(url.protocol)) {
      return null;
    }

    const host = url.hostname.toLowerCase();
    const segments = stripGitSuffix(decodeURIComponent(url.pathname).replace(/\/+$/, ""))
      .split("/")
      .filter(Boolean);

    return { host: url.port && url.protocol.startsWith("http") ? `${host}:${url.port}` : host, segments };
  } catch {
    return null;
  }
}

function buildLocator(provider: GitProviderType, host: string, owner: string, name: string, project?: string): RepositoryLocator {
  const fullName = project ? `${owner}/${project}/${name}` : `${owner}/${name}`;
  return {
    provider,
    host,
    owner,
    ...(project ? { project } : {}),
    name,
    fullName,
  };
}

export function parseGitHubRepositoryUrl(raw: string, expectedHost = "github.com"): RepositoryLocator | null {
  const split = splitRepositoryUrl(raw);
  if (!split || split.host !== expectedHost.toLowerCase()) {
    return null;
  }

  const [owner, name] = split.segments;
  return owner && name ? buildLocator("github", split.host, owner, stripGitSuffix(name)) : null;
}

export function parseGitLabRepositoryUrl(raw: string, expectedHost = "gitlab.com"): RepositoryLocator | null {
  const split = splitRepositoryUrl(raw);
  if (!split || split.host !== expectedHost.toLowerCase()) {
    return null;
  }

  // Drop GitLab UI suffixes such as /-/tree/main.
  const dash = split.segments.indexOf("-");
  const segments = dash >= 0 ? split.segments.slice(0, dash) : split.segments;
  if (segments.length < 2) {
    return null;
  }

  const name = segments.at(-1) as string;
  return buildLocator("gitlab", split.host, segments.slice(0, -1).join("/"), name);
}

export function parseBitbucketRepositoryUrl(raw: string): RepositoryLocator | null {
  const split = splitRepositoryUrl(raw);
  if (!split || split.host !== "bitbucket.org") {
    return null;
  }

  const [workspace, name] = split.segments;
  return workspace && name ? buildLocator("bitbucket", split.host, workspace, name) : null;
}

export function parseAzureReposUrl(raw: string): RepositoryLocator | null {
  const split = splitRepositoryUrl(raw);
  if (!split) {
    return null;
  }

  // git@ssh.dev.azure.com:v3/org/project/repo
  if (split.host === "ssh.dev.azure.com" || split.host === "vs-ssh.visualstudio.com") {
    const [version, org, project, name] = split.segments;
    return version === "v3" && org && project && name ? buildLocator("azure", "dev.azure.com", org, name, project) : null;
  }

  const gitIndex = split.segments.findIndex((segment) => segment.toLowerCase() === "_git");
  if (gitIndex < 0) {
    return null;
  }

  const name = split.segments[gitIndex + 1];
  if (!name) {
    return null;
  }

  if (split.host === "dev.azure.com") {
    const [org, project] = split.segments;
    // https://dev.azure.com/org/_git/repo uses the repository name as project.
    if (!org) {
      return null;
    }
    return buildLocator("azure", "dev.azure.com", org, name, gitIndex >= 2 ? project : name);
  }

  // https://org.visualstudio.com/project/_git/repo
  const legacy = /^([^.]+)\.visualstudio\.com$/.exec(split.host);
  if (legacy?.[1]) {
    const project = gitIndex >= 1 ? split.segments[0] : name;
    return buildLocator("azure", "dev.azure.com", legacy[1], name, project);
  }

  return null;
}

/** Detects the provider from a URL and parses it. Self-managed GitLab hosts must be passed explicitly. */
export function parseGitRepositoryUrl(raw: string, options?: { gitlabHosts?: readonly string[] | undefined }): RepositoryLocator | null {
  return parseGitHubRepositoryUrl(raw)
    ?? parseGitLabRepositoryUrl(raw)
    ?? parseBitbucketRepositoryUrl(raw)
    ?? parseAzureReposUrl(raw)
    ?? (options?.gitlabHosts ?? []).reduce<RepositoryLocator | null>(
      (found, host) => found ?? parseGitLabRepositoryUrl(raw, host),
      null,
    );
}

/** Canonical HTTPS URL used for duplicate detection. */
export function canonicalRepositoryUrl(locator: RepositoryLocator): string {
  if (locator.provider === "azure") {
    return `https://dev.azure.com/${locator.owner}/${locator.project ?? locator.name}/_git/${locator.name}`.toLowerCase();
  }

  return `https://${locator.host}/${locator.owner}/${locator.name}`.toLowerCase();
}
