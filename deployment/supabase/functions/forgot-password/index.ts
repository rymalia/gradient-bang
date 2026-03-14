/**
 * Public Edge Function: forgot-password
 *
 * Sends a password recovery email to the given address.
 * No EDGE_API_TOKEN required - this is a public endpoint.
 *
 * Always returns success regardless of whether the email exists
 * to prevent user enumeration.
 */

import { createPublicClient } from "../_shared/auth.ts";
import { createServiceRoleClient } from "../_shared/client.ts";
import {
  enforcePublicRateLimit,
  RateLimitError,
} from "../_shared/rate_limiting.ts";
import {
  parseJsonRequest,
  requireString,
  respondWithError,
} from "../_shared/request.ts";
import { traced } from "../_shared/weave.ts";

// CORS headers for public access from web clients
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function corsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(traced("forgot-password", async (req, trace) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const serviceClient = createServiceRoleClient();

  // Apply IP-based rate limiting
  const sRateLimit = trace.span("rate_limit");
  try {
    await enforcePublicRateLimit(serviceClient, req, "forgot-password");
    sRateLimit.end();
  } catch (err) {
    sRateLimit.end({ error: err instanceof Error ? err.message : String(err) });
    if (err instanceof RateLimitError) {
      console.warn("forgot-password.rate_limit", err.message);
      return corsResponse(
        {
          success: false,
          error: "Too many requests. Please try again later.",
        },
        429,
      );
    }
    console.error("forgot-password.rate_limit", err);
    return corsResponse(
      { success: false, error: "Rate limit check failed" },
      500,
    );
  }

  let payload;
  const sParse = trace.span("parse_request");
  try {
    payload = await parseJsonRequest(req);
    sParse.end();
  } catch (err) {
    sParse.end({ error: err instanceof Error ? err.message : String(err) });
    const response = respondWithError(err);
    if (response) {
      return corsResponse(await response.json(), response.status);
    }
    console.error("forgot-password.parse", err);
    return corsResponse({ success: false, error: "Invalid JSON payload" }, 400);
  }

  try {
    const sValidate = trace.span("validate_input");
    const email = requireString(payload, "email");

    trace.setInput({});

    if (!email.includes("@") || email.length < 3) {
      sValidate.end({ error: "Invalid email address" });
      return corsResponse(
        { success: false, error: "Invalid email address" },
        400,
      );
    }
    sValidate.end();

    const publicClient = createPublicClient();

    const sReset = trace.span("auth_reset_password");
    const { error } = await publicClient.auth.resetPasswordForEmail(email);

    if (error) {
      // Log the error but don't expose it to the client
      sReset.end({ error: error.message });
      console.error("forgot-password.reset", error);
    } else {
      sReset.end();
    }

    trace.setOutput({ sent: true });

    // Always return success to prevent user enumeration
    return corsResponse({
      success: true,
      message:
        "If an account exists with that email, a password reset link has been sent.",
    });
  } catch (err) {
    console.error("forgot-password.unhandled", err);
    return corsResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      500,
    );
  }
}));
