import { test, expect } from "@playwright/test";

test("unauthenticated user is redirected to this app's own /sign-in page", async ({
  page,
}) => {
  await page.goto("/dashboard");

  // Clerk's hosted Account Portal fallback (e.g.
  // https://<subdomain>.accounts.dev/sign-in?redirect_url=...) also contains
  // the substring "/sign-in", so a loose /sign-in/ regex would pass
  // identically whether the app redirected to its own local /sign-in page
  // or to the wrong hosted portal. Anchor to the full, same-origin URL so
  // the test actually discriminates between the two.
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/sign-in(\?.*)?$/);
});
