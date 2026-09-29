import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketingEvent,
  isMarketingEventName,
  isSignupHref,
  resolveDeviceClass,
} from "./marketing-analytics.ts";

test("resolveDeviceClass buckets viewports into mobile, tablet, and desktop", () => {
  assert.equal(resolveDeviceClass(375), "mobile");
  assert.equal(resolveDeviceClass(768), "tablet");
  assert.equal(resolveDeviceClass(1440), "desktop");
  assert.equal(resolveDeviceClass(Number.NaN), "mobile");
});

test("buildMarketingEvent drops empty props and stamps device + path", () => {
  const event = buildMarketingEvent(
    "pricing_cta",
    { placement: "pricing", cycle: "annual", empty: "", missing: undefined },
    { viewportWidth: 1280, path: "/" },
  );

  assert.deepEqual(event, {
    placement: "pricing",
    cycle: "annual",
    event: "pricing_cta",
    device: "desktop",
    path: "/",
  });
});

test("buildMarketingEvent never lets props override the event name", () => {
  const event = buildMarketingEvent("faq_expand", { event: "spoofed" }, { viewportWidth: 400, path: "/" });
  assert.equal(event.event, "faq_expand");
});

test("isMarketingEventName only accepts known events", () => {
  assert.equal(isMarketingEventName("hero_primary_cta"), true);
  assert.equal(isMarketingEventName("made_up"), false);
  assert.equal(isMarketingEventName(null), false);
});

test("isSignupHref matches signup routes with or without query strings", () => {
  assert.equal(isSignupHref("/signup"), true);
  assert.equal(isSignupHref("/signup?cycle=annual"), true);
  assert.equal(isSignupHref("/signups"), false);
  assert.equal(isSignupHref("/signin"), false);
  assert.equal(isSignupHref(undefined), false);
});
