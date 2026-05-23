type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type AuditEventPayload = Record<string, unknown>;

function sanitizeAuditEventPayload(payload: AuditEventPayload): { [key: string]: JsonValue } {
  return JSON.parse(JSON.stringify(payload)) as { [key: string]: JsonValue };
}

export async function tryRecordAuditEvent(input: {
  organizationId: string;
  actorSubject: string;
  category: string;
  action: string;
  targetType: string;
  targetRef: string;
  payload?: AuditEventPayload | undefined;
}): Promise<boolean> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    return false;
  }

  try {
    const sql = getControlPlaneDatabase();

    await sql`
      insert into audit_events (
        organization_id,
        actor_type,
        actor_ref,
        category,
        action,
        target_type,
        target_ref,
        payload_redacted
      )
      values (
        ${input.organizationId},
        'user',
        ${input.actorSubject},
        ${input.category},
        ${input.action},
        ${input.targetType},
        ${input.targetRef},
        ${sql.json(sanitizeAuditEventPayload(input.payload ?? {}))}
      )
    `;

    return true;
  } catch {
    return false;
  }
}