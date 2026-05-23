type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonObject(
  request: Request,
): Promise<JsonObject | null> {
  try {
    const body = await request.json();
    return isJsonObject(body) ? body : null;
  } catch {
    return null;
  }
}

export function readRequiredString(
  body: JsonObject,
  key: string,
  maxLength = 200,
): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    return null;
  }

  return normalized;
}

export function readOptionalString(
  body: JsonObject,
  key: string,
  maxLength = 200,
): string | undefined {
  const value = body[key];
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    return undefined;
  }

  return normalized;
}

export function readOptionalBoolean(
  body: JsonObject,
  key: string,
): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readOptionalStringArray(
  body: JsonObject,
  key: string,
  maxItemLength = 240,
): string[] | undefined {
  const value = body[key];

  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const items: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      return undefined;
    }

    const normalized = entry.trim();
    if (!normalized || normalized.length > maxItemLength) {
      return undefined;
    }

    items.push(normalized);
  }

  return items;
}