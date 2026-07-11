import { clerk } from "@clerk/testing/playwright";
import { test, expect } from "@playwright/test";
import { getRequiredEnv } from "@/lib/env";

// Requires a real user to exist in this project's Clerk dev instance (confirmed
// dev via the pk_test_/sk_test_ prefixes in .env.local -- clerk.signIn's
// email-based path refuses to run against a production secret key) with the
// email set as E2E_CLERK_USER_EMAIL. No password is needed: this helper signs
// in via Clerk's backend API (CLERK_SECRET_KEY) using a one-time sign-in
// ticket for that user, not a credential-based login.
const testUserEmail = getRequiredEnv("E2E_CLERK_USER_EMAIL");

test("authenticated user can send a chat message and see a response", async ({
  page,
}) => {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: testUserEmail });
  await page.goto("/dashboard/chat");
  await expect(page).not.toHaveURL(/sign-in/);

  await page
    .getByPlaceholder(/ask about your va disability claim/i)
    .fill("What is a DBQ?");
  await page.getByRole("button", { name: /send/i }).click();

  // The assistant's reply should render -- this is exactly the path where
  // Critical #1 (conversation persistence) and #2 (MCP-failure fallback
  // response shape) previously went undetected by any test.
  await expect(
    page.getByTestId("chat-messages").getByText(/assistant:/i),
  ).toBeVisible({ timeout: 15_000 });
});

test("a second message in the same session threads onto the same conversation", async ({
  page,
}) => {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: testUserEmail });
  await page.goto("/dashboard/chat");

  await page
    .getByPlaceholder(/ask about your va disability claim/i)
    .fill("first question");
  await page.getByRole("button", { name: /send/i }).click();
  await expect(
    page.getByTestId("chat-messages").getByText(/assistant:/i),
  ).toBeVisible({ timeout: 15_000 });

  await page
    .getByPlaceholder(/ask about your va disability claim/i)
    .fill("follow-up question");
  await page.getByRole("button", { name: /send/i }).click();
  // Regression guard for the conversation-persistence fix (Phase 5 of the
  // original review's fixes) -- both exchanges should be visible in the
  // same message list, not a fresh/empty thread.
  await expect(
    page.getByTestId("chat-messages").getByText("first question"),
  ).toBeVisible();
});
