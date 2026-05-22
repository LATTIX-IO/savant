import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthenticatedIdentity,
  buildAuthOverview,
  buildAuthViewer,
  getInitials,
} from "./auth0-session.ts";

test("getInitials derives a compact avatar label from names and email-like identifiers", () => {
  assert.equal(getInitials("Priya Aronson"), "PA");
  assert.equal(getInitials("priya@wh.com"), "PW");
});

test("buildAuthViewer returns a guest state when no Auth0 user is present", () => {
  assert.deepEqual(buildAuthViewer(), {
    isAuthenticated: false,
    displayName: "Guest user",
    subtitle: "Not signed in",
    initials: "GU",
    email: null,
  });
});

test("buildAuthOverview trims profile fields and omits duplicate nicknames", () => {
  assert.deepEqual(
    buildAuthOverview({
      email: "  priya@wh.com ",
      name: " Priya Aronson ",
      nickname: "Priya Aronson",
      sub: " auth0|user_123 ",
    }),
    {
      viewer: {
        isAuthenticated: true,
        displayName: "Priya Aronson",
        subtitle: "priya@wh.com",
        initials: "PA",
        email: "priya@wh.com",
      },
      fields: [
        { label: "Email", value: "priya@wh.com" },
        { label: "Name", value: "Priya Aronson" },
        { label: "Subject", value: "auth0|user_123" },
      ],
    },
  );
});

test("buildAuthenticatedIdentity requires both Auth0 subject and email", () => {
  assert.deepEqual(
    buildAuthenticatedIdentity({
      email: "  priya@wh.com ",
      name: " Priya Aronson ",
      sub: " auth0|user_123 ",
    }),
    {
      subject: "auth0|user_123",
      email: "priya@wh.com",
      displayName: "Priya Aronson",
    },
  );

  assert.equal(
    buildAuthenticatedIdentity({
      email: "priya@wh.com",
    }),
    null,
  );
});
