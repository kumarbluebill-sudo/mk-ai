import { expect, test } from "@playwright/test";
import { BASE_A, newAgency, PASSWORD } from "./helpers";

test.describe("booking from a trip item", () => {
  test("the booking page opens with the tour from the trip chosen, and ignores malformed links", async ({ page }) => {
    const { email } = await newAgency("booklink");
    await page.goto(`${BASE_A}/login`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");

    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`${BASE_A}/bookings/new?tourId=12345&title=${encodeURIComponent("Desert Safari")}&date=${future}`);
    await expect(page.getByText("Desert Safari")).toBeVisible();
    await expect(page.getByText("chosen from your trip")).toBeVisible();
    await expect(page.getByLabel("Date", { exact: true })).toHaveValue(future);

    // A link that is not a plain numeric tour id is ignored: nothing is chosen.
    await page.goto(`${BASE_A}/bookings/new?tourId=abc&title=Evil`);
    await expect(page.getByText("chosen from your trip")).toHaveCount(0);
    await expect(page.getByText("Evil")).toHaveCount(0);
  });
});
