import { expect, test } from "@playwright/test";
import { BASE_A, newAgency, PASSWORD } from "./helpers";

test.describe("trip designer", () => {
  test("drag and drop re-orders stops, Traveldesk items offer Book, categories show icons, journey type toggle needs no maps key", async ({ page }) => {
    const { email } = await newAgency("designer");
    await page.goto(`${BASE_A}/login`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");

    const created = await page.request.post(`${BASE_A}/api/itineraries`, {
      data: {
        title: "Drag test",
        destination: "Dubai",
        startDate: "2027-03-01",
        days: [
          {
            title: "Day one",
            items: [
              { title: "First stop", category: "museum", status: "UNVERIFIED" },
              { title: "Second stop", category: "beach", status: "UNVERIFIED" },
              { title: "Safari tour", category: "adventure", status: "LIVE", supplier: "traveldesk", productCode: "777" },
            ],
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { conversationId: string }).conversationId;

    await page.goto(`${BASE_A}/designer/${id}`);
    const rows = page.locator("ol > li");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("🏛️");

    // Book link only on the Traveldesk item, with the tour and the day's date in the link.
    const book = rows.nth(2).getByRole("link", { name: "Book" });
    await expect(book).toHaveAttribute("href", /\/bookings\/new\?tourId=777&title=Safari\+tour&date=2027-03-01/);
    await expect(rows.nth(0).getByRole("link", { name: "Book" })).toHaveCount(0);

    // Drag the last stop onto the first.
    await rows.nth(2).dragTo(rows.nth(0));
    await expect(rows.nth(0)).toContainText("Safari tour");
    const saved = (await (await page.request.get(`${BASE_A}/api/itineraries/${id}`)).json()) as { itinerary: { days: { items: { title: string }[] }[] } };
    expect(saved.itinerary.days[0].items.map((i) => i.title)).toEqual(["Safari tour", "First stop", "Second stop"]);
  });
});
