export type AuthSessionUser = {
  email?: string | null | undefined;
  name?: string | null | undefined;
  nickname?: string | null | undefined;
  sub?: string | null | undefined;
};

export type AuthViewer = {
  isAuthenticated: boolean;
  displayName: string;
  subtitle: string;
  initials: string;
  email: string | null;
};

export type AuthOverviewField = {
  label: string;
  value: string;
};

export type AuthOverview = {
  viewer: AuthViewer;
  fields: AuthOverviewField[];
};

function toNonEmptyString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function firstDefined(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const normalized = toNonEmptyString(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function getInitials(value: string): string {
  const tokens = value
    .split(/[\s@._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return "GU";
  }

  const [first, second] = tokens;

  return `${first?.[0] ?? ""}${second?.[0] ?? first?.[1] ?? ""}`.toUpperCase();
}

export function buildAuthViewer(user?: AuthSessionUser | null): AuthViewer {
  if (!user) {
    return {
      isAuthenticated: false,
      displayName: "Guest user",
      subtitle: "Not signed in",
      initials: "GU",
      email: null,
    };
  }

  const email = firstDefined(user.email);
  const displayName = firstDefined(user.name, user.nickname, email) ?? "Authenticated user";

  return {
    isAuthenticated: true,
    displayName,
    subtitle: email ?? "Authenticated via Auth0",
    initials: getInitials(displayName),
    email: email ?? null,
  };
}

export function buildAuthOverview(user?: AuthSessionUser | null): AuthOverview {
  const viewer = buildAuthViewer(user);

  if (!user) {
    return {
      viewer,
      fields: [],
    };
  }

  const fields: AuthOverviewField[] = [];
  const email = firstDefined(user.email);
  const name = firstDefined(user.name);
  const nickname = firstDefined(user.nickname);
  const subject = firstDefined(user.sub);

  if (email) {
    fields.push({ label: "Email", value: email });
  }

  if (name) {
    fields.push({ label: "Name", value: name });
  }

  if (nickname && nickname !== name) {
    fields.push({ label: "Nickname", value: nickname });
  }

  if (subject) {
    fields.push({ label: "Subject", value: subject });
  }

  return {
    viewer,
    fields,
  };
}
