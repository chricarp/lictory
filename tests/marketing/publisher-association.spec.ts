import { test, expect } from "@playwright/test";

// Microsoft verifies the publisher domain (lictory.com, the website) for the
// sign-in application.
test("Microsoft publisher association is public JSON", async ({ request }) => {
  const response = await request.get(
    "/.well-known/microsoft-identity-association.json",
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({
    associatedApplications: [
      { applicationId: "674718cd-ca91-451c-84eb-02aa492d2b10" },
    ],
  });
});
