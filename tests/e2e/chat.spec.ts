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
