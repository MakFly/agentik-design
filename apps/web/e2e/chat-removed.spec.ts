import { test, expect } from "@playwright/test";

// P0 — the isolated /chat route violated the North Star "no lite chat page" rule and
// was removed. The conversational surface now lives in the project console. Guard the
// removal so it can't silently come back.
test("the isolated /chat route is gone (404)", async ({ request }) => {
  const res = await request.get("/demo/chat");
  expect(res.status()).toBe(404);
});

test("the chat thread sub-routes are gone too", async ({ request }) => {
  expect((await request.get("/demo/chat/settings")).status()).toBe(404);
});
