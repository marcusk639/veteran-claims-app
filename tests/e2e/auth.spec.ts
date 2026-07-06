import { test, expect } from "@playwright/test";

test("unauthenticated user is redirected away from /dashboard", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/sign-in/);
});
