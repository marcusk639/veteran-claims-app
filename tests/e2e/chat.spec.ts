import { test, expect } from "@playwright/test";

test("unauthenticated user visiting /dashboard/chat is redirected to /sign-in", async ({
  page,
}) => {
  await page.goto("/dashboard/chat");
  await expect(page).toHaveURL(/sign-in/);
});

test("sourcing standard page is publicly reachable and mentions verification convention", async ({
  page,
}) => {
  await page.goto("/sourcing-standard");
  await expect(page.getByTestId("sourcing-standard-heading")).toBeVisible();
  await expect(page.getByText(/last_verified/i)).toBeVisible();
});

test("support page is publicly reachable and shows a coming-soon state with no donation links configured", async ({
  page,
}) => {
  await page.goto("/support");
  await expect(page.getByTestId("support-heading")).toBeVisible();
  // Regression guard: with no NEXT_PUBLIC_DONATION_LINK/
  // NEXT_PUBLIC_FOUNDING_SUPPORTER_LINK set, the page must render a
  // coming-soon message rather than a dead/empty link.
  await expect(page.getByTestId("donation-coming-soon")).toBeVisible();
  await expect(
    page.getByTestId("founding-supporter-coming-soon"),
  ).toBeVisible();
});
