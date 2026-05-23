import { NextResponse } from "next/server";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import {
  processRepositoryWebhookDelivery,
  RepositoryWebhookError,
} from "@/server/control-plane/repository-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ webhookId: string }> },
) {
  const { webhookId } = await context.params;
  const rawBody = await request.text();

  try {
    const result = await processRepositoryWebhookDelivery({
      webhookId,
      headers: request.headers,
      rawBody,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RepositoryWebhookError) {
      return NextResponse.json(
        createApiErrorResponse(error.code, error.message, error.details),
        { status: error.status },
      );
    }

    return NextResponse.json(
      createApiErrorResponse(
        "repository_webhook_handler_failed",
        "Repository webhook processing failed unexpectedly.",
      ),
      { status: 500 },
    );
  }
}
