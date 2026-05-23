import type {
  AuditEventRange,
  AuditEventRecord,
  AuditListResponse,
} from "@savant/types";
import { NextResponse } from "next/server";

import { AUDIT_FULL } from "@/lib/savant-data";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import {
  readAuditEventsFromDatabase,
  resolveAuditRangeLowerBound,
} from "@/server/control-plane/read-model-db";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";

function parseAuditRange(value: string | null): AuditEventRange {
  if (value === "24h" || value === "7d" || value === "30d" || value === "90d" || value === "all") {
    return value;
  }

  return "7d";
}

function approximateFallbackOccurredAt(label: string, now: Date, offset: number): Date {
  const normalized = label.trim().toLowerCase();

  if (normalized === "now" || normalized === "just now") {
    return new Date(now.getTime() - offset * 1000);
  }

  const minutesMatch = normalized.match(/^(\d+)m ago$/);
  if (minutesMatch) {
    return new Date(now.getTime() - Number.parseInt(minutesMatch[1] ?? "0", 10) * 60 * 1000);
  }

  const hoursMatch = normalized.match(/^(\d+)h ago$/);
  if (hoursMatch) {
    return new Date(now.getTime() - Number.parseInt(hoursMatch[1] ?? "0", 10) * 60 * 60 * 1000);
  }

  const daysMatch = normalized.match(/^(\d+)d ago$/);
  if (daysMatch) {
    return new Date(now.getTime() - Number.parseInt(daysMatch[1] ?? "0", 10) * 24 * 60 * 60 * 1000);
  }

  return new Date(now.getTime() - (offset + 1) * 24 * 60 * 60 * 1000);
}

function buildFallbackAuditListResponse(range: AuditEventRange): AuditListResponse {
  const now = new Date();
  const lowerBound = resolveAuditRangeLowerBound(range, now);

  const data = AUDIT_FULL
    .map<AuditEventRecord>((event, index) => {
      const occurredAt = approximateFallbackOccurredAt(event.when, now, index).toISOString();

      return {
        occurredAt,
        when: event.when,
        time: event.time,
        who: event.who,
        action: event.action,
        target: event.target,
        category: event.category,
        node: event.node,
      };
    })
    .filter((event) => !lowerBound || new Date(event.occurredAt) >= lowerBound);

  return {
    data,
    meta: {
      ...createControlPlaneMeta("mixed"),
      count: data.length,
    },
  };
}

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);
    const { searchParams } = new URL(request.url);
    const range = parseAuditRange(searchParams.get("range"));

    return NextResponse.json(
      tenantContext.isDevelopmentFallback
        ? buildFallbackAuditListResponse(range)
        : await readAuditEventsFromDatabase(tenantContext, { range }),
    );
  } catch (error) {
    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    throw error;
  }
}