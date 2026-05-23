import type { GitProvider } from "@savant/types";

function stripGitSuffix(pathname: string): string {
  return pathname.replace(/\.git$/i, "");
}

export function normalizeRepositoryWebUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();

  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/i);

  if (sshMatch) {
    const host = sshMatch[1];
    const path = sshMatch[2];

    if (!host || !path) {
      return null;
    }

    return `https://${host}/${stripGitSuffix(path.replace(/^\/+/, ""))}`;
  }

  if (trimmed.startsWith("ssh://git@")) {
    try {
      const parsed = new URL(trimmed);
      return `https://${parsed.host}/${stripGitSuffix(parsed.pathname.replace(/^\/+/, ""))}`;
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = stripGitSuffix(parsed.pathname).replace(/\/$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return null;
  }
}

function normalizeRepositoryName(name: string): string | null {
  const normalized = name
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return normalized.length > 0 ? normalized : null;
}

function buildAzureRepositoryUrl(name: string): string | null {
  const parts = name.split("/").filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const organization = parts[0]!;
  const repository = parts.at(-1)!;
  const project = parts.slice(1, -1).join("/");
  const projectPath = project.length > 0 ? `/${project}` : "";

  return `https://dev.azure.com/${organization}${projectPath}/_git/${repository}`;
}

export function buildRepositoryWebUrl(input: {
  provider: GitProvider;
  name: string;
  canonicalCloneUrl?: string | null;
  webUrl?: string | null;
}): string | null {
  const canonicalUrl = normalizeRepositoryWebUrl(input.webUrl ?? input.canonicalCloneUrl);

  if (canonicalUrl) {
    return canonicalUrl;
  }

  const normalizedName = normalizeRepositoryName(input.name);

  if (!normalizedName) {
    return null;
  }

  switch (input.provider) {
    case "github":
      return `https://github.com/${normalizedName}`;
    case "gitlab":
      return `https://gitlab.com/${normalizedName}`;
    case "bitbucket":
      return `https://bitbucket.org/${normalizedName}`;
    case "azure":
      return buildAzureRepositoryUrl(normalizedName);
    default:
      return null;
  }
}
