import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  test,
  expect,
  request,
  type APIRequestContext,
} from "@playwright/test";
const baseURL = "http://127.0.0.1:8081/api/v1";
const origin = "http://localhost:5174";
const database =
  process.env.TEST_DATABASE_URL ||
  "postgres://noma:noma@localhost:5432/noma_test";
async function account(role = "agent") {
  const client = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: origin },
  });
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await client.post(`${baseURL}/auth/register`, {
    data: {
      email,
      password: "Integration-test-passphrase!",
      first_name: "Noma",
      last_name: "Tester",
      role,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { client, email, user: await response.json() };
}
const listing = (title: string) => ({
  title,
  description:
    "A spacious home with plenty of natural light and a private courtyard.",
  listing_type: "sale",
  property_type: "house",
  price: 85000000,
  bedrooms: 4,
  bathrooms: 4,
  size_sqm: 320,
  state_id: "10000000-0000-4000-8000-000000000001",
  city_id: "20000000-0000-4000-8000-000000000001",
  area_id: "30000000-0000-4000-8000-000000000001",
  address: "12 Test Street",
  images: [
    "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=900&q=80",
  ],
});
async function create(client: APIRequestContext, title: string) {
  const response = await client.post(`${baseURL}/properties`, {
    data: listing(title),
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function databaseCommand(statement: string) {
  return execFileSync("psql", [database, "-Atc", statement], {
    encoding: "utf8",
  }).trim();
}

test("email verification and password recovery tokens are single-use", async () => {
  const member = await account("user");
  expect(member.user.is_verified).toBe(false);
  expect(member.user.has_password).toBe(true);

  const providers = await member.client.get(`${baseURL}/auth/providers`);
  expect(await providers.json()).toEqual({
    google_client_id: null,
    email: false,
  });
  expect(
    (
      await member.client.post(`${baseURL}/auth/verify-email/resend`, {
        data: {},
      })
    ).status(),
  ).toBe(503);
  expect(
    (
      await member.client.post(`${baseURL}/auth/google`, {
        data: { credential: "invalid", role: "user" },
      })
    ).status(),
  ).toBe(400);

  const verificationToken = `verify-${crypto.randomUUID()}`;
  const verificationHash = createHash("sha256")
    .update(verificationToken)
    .digest("hex");
  databaseCommand(
    `INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES('${verificationHash}','${member.user.id}','verify_email',now()+interval '1 hour')`,
  );
  expect(
    (
      await member.client.post(`${baseURL}/auth/verify-email`, {
        data: { token: verificationToken },
      })
    ).status(),
  ).toBe(204);
  expect(
    (await (await member.client.get(`${baseURL}/auth/me`)).json()).is_verified,
  ).toBe(true);
  expect(
    (
      await member.client.post(`${baseURL}/auth/verify-email`, {
        data: { token: verificationToken },
      })
    ).status(),
  ).toBe(400);

  expect(
    (
      await member.client.post(`${baseURL}/auth/password/forgot`, {
        data: { email: "missing-account@example.test" },
      })
    ).status(),
  ).toBe(204);
  expect(
    (
      await member.client.post(`${baseURL}/auth/password/forgot`, {
        data: { email: member.email },
      })
    ).status(),
  ).toBe(204);
  expect(
    Number(
      databaseCommand(
        `SELECT count(*) FROM auth_tokens WHERE user_id='${member.user.id}' AND purpose='reset_password' AND used_at IS NULL`,
      ),
    ),
  ).toBe(1);

  databaseCommand(
    `UPDATE auth_tokens SET used_at=now() WHERE user_id='${member.user.id}' AND purpose='reset_password' AND used_at IS NULL`,
  );
  const resetToken = `reset-${crypto.randomUUID()}`;
  const resetHash = createHash("sha256").update(resetToken).digest("hex");
  databaseCommand(
    `INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES('${resetHash}','${member.user.id}','reset_password',now()+interval '1 hour')`,
  );
  const replacement = "A-new-integration-passphrase!";
  expect(
    (
      await member.client.post(`${baseURL}/auth/password/reset`, {
        data: { token: resetToken, new_password: replacement },
      })
    ).status(),
  ).toBe(204);
  expect((await member.client.get(`${baseURL}/auth/me`)).status()).toBe(401);
  expect(
    (
      await member.client.post(`${baseURL}/auth/login`, {
        data: { email: member.email, password: "Integration-test-passphrase!" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await member.client.post(`${baseURL}/auth/login`, {
        data: { email: member.email, password: replacement },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await member.client.post(`${baseURL}/auth/password/reset`, {
        data: { token: resetToken, new_password: replacement },
      })
    ).status(),
  ).toBe(400);
});
test("ownership, publishing, search, favorites, inquiries and session revocation", async () => {
  const owner = await account();
  const other = await account();
  const seeker = await account("user");
  const anonymous = await request.newContext();
  const profile = await owner.client.put(`${baseURL}/account/profile`, {
    data: {
      first_name: "Ada",
      last_name: "Okafor",
      phone: "+234 801 234 5678",
      whatsapp: "+234 809 876 5432",
      telegram: "@ada_homes",
      instagram: "ada.homes",
    },
  });
  expect(profile.status(), await profile.text()).toBe(200);
  const profileBody = await profile.json();
  expect(profileBody.phone).toBe("+234 801 234 5678");
  expect(profileBody.whatsapp).toBe("+234 809 876 5432");
  expect(
    (
      await owner.client.put(`${baseURL}/account/profile`, {
        data: { first_name: "Ada", last_name: "Okafor", phone: "invalid" },
      })
    ).status(),
  ).toBe(400);
  const tag = `Noma-${crypto.randomUUID()}`;
  const property = await create(owner.client, tag);
  expect(
    (await anonymous.get(`${baseURL}/properties/${property.slug}`)).status(),
  ).toBe(404);
  expect(
    (await owner.client.get(`${baseURL}/properties/${property.slug}`)).status(),
  ).toBe(200);
  expect(
    (
      await other.client.put(`${baseURL}/properties/${property.id}`, {
        data: listing("Attempted unauthorized edit"),
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await seeker.client.post(`${baseURL}/properties`, {
        data: {
          ...listing("A user can create a rental listing"),
          videos: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await other.client.patch(`${baseURL}/properties/${property.id}/status`, {
        data: { status: "active" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await owner.client.patch(`${baseURL}/properties/${property.id}/status`, {
        data: { status: "active" },
      })
    ).status(),
  ).toBe(204);
  const details = await anonymous.get(`${baseURL}/properties/${property.slug}`);
  expect(details.status()).toBe(200);
  expect(details.headers()["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const ready = await anonymous.get("http://127.0.0.1:8081/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: "ready" });
  const payload = await details.json();
  expect(payload.agent.email).toBeUndefined();
  expect(payload.password_hash).toBeUndefined();
  const search = await anonymous.get(`${baseURL}/properties`, {
    params: { q: tag },
  });
  expect((await search.json()).data.map((p: any) => p.id)).toContain(
    property.id,
  );
  expect(
    (await seeker.client.put(`${baseURL}/favorites/${property.id}`)).status(),
  ).toBe(204);
  expect(
    (await seeker.client.put(`${baseURL}/favorites/${property.id}`)).status(),
  ).toBe(204);
  expect(
    await (await seeker.client.get(`${baseURL}/favorites`)).json(),
  ).toEqual([property.id]);
  expect(
    (await (await seeker.client.get(`${baseURL}/favorites/properties`)).json())
      .data[0].id,
  ).toBe(property.id);
  expect(
    (
      await seeker.client.post(
        `${baseURL}/properties/${property.id}/inquiries`,
        { data: { message: "Can I arrange a viewing this weekend?" } },
      )
    ).status(),
  ).toBe(201);
  for (const message of [
    "Is the service charge included in the advertised price?",
    "Please share the earliest available inspection time.",
  ]) {
    expect(
      (
        await seeker.client.post(
          `${baseURL}/properties/${property.id}/inquiries`,
          { data: { message } },
        )
      ).status(),
    ).toBe(201);
  }
  let inquiryCursor: string | null = null;
  const inquiryIds: string[] = [];
  for (let page = 0; page < 4; page++) {
    const response = await owner.client.get(`${baseURL}/dashboard/inquiries`, {
      params: {
        limit: "1",
        ...(inquiryCursor ? { cursor: inquiryCursor } : {}),
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    const value = await response.json();
    expect(value.data[0].email).toBe(seeker.email);
    inquiryIds.push(...value.data.map((lead: any) => lead.id));
    inquiryCursor = value.next_cursor;
    if (!inquiryCursor) break;
  }
  expect(new Set(inquiryIds).size).toBe(3);
  expect(
    await (await owner.client.get(`${baseURL}/dashboard/summary`)).json(),
  ).toEqual({
    total_properties: 1,
    active_properties: 1,
    inquiries: 3,
  });
  expect(
    (await (await other.client.get(`${baseURL}/dashboard/inquiries`)).json())
      .data,
  ).toEqual([]);
  expect(
    (
      await owner.client.patch(`${baseURL}/properties/${property.id}/status`, {
        data: { status: "suspended" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await owner.client.put(`${baseURL}/account/password`, {
        data: {
          current_password: "Not-the-current-password!",
          new_password: "Replacement-passphrase!",
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await owner.client.put(`${baseURL}/account/password`, {
        data: {
          current_password: "Integration-test-passphrase!",
          new_password: "Replacement-passphrase!",
        },
      })
    ).status(),
  ).toBe(204);
  expect((await owner.client.get(`${baseURL}/auth/me`)).status()).toBe(401);
  expect(
    (
      await owner.client.post(`${baseURL}/auth/login`, {
        data: {
          email: owner.email,
          password: "Integration-test-passphrase!",
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await owner.client.post(`${baseURL}/auth/login`, {
        data: {
          email: owner.email,
          password: "Replacement-passphrase!",
        },
      })
    ).status(),
  ).toBe(200);
  expect((await owner.client.post(`${baseURL}/auth/logout`)).status()).toBe(
    204,
  );
  expect((await owner.client.get(`${baseURL}/auth/me`)).status()).toBe(401);
  expect(
    Number(
      execFileSync(
        "psql",
        [
          database,
          "-tAc",
          `SELECT count(*) FROM sessions WHERE user_id='${owner.user.id}'`,
        ],
        { encoding: "utf8" },
      ).trim(),
    ),
  ).toBe(0);
  await Promise.all([
    owner.client.dispose(),
    other.client.dispose(),
    seeker.client.dispose(),
    anonymous.dispose(),
  ]);
});
test("stable keyset pagination across equal prices and dates", async () => {
  const owner = await account();
  const tag = `Pagination-${crypto.randomUUID()}`;
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const p = await create(owner.client, `${tag} home ${i}`);
    ids.push(p.id);
    expect(
      (
        await owner.client.patch(`${baseURL}/properties/${p.id}/status`, {
          data: { status: "active" },
        })
      ).status(),
    ).toBe(204);
  }
  for (const sort of ["newest", "featured", "price_asc", "price_desc"]) {
    let cursor: string | null = null;
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const response = await owner.client.get(`${baseURL}/properties`, {
        params: { q: tag, sort, limit: "1", ...(cursor ? { cursor } : {}) },
      });
      expect(response.status(), await response.text()).toBe(200);
      const value = await response.json();
      seen.push(...value.data.map((p: any) => p.id));
      cursor = value.next_cursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen.sort()).toEqual(ids.sort());
  }
  for (const id of ids) {
    expect(
      (await owner.client.put(`${baseURL}/favorites/${id}`)).status(),
    ).toBe(204);
  }
  let savedCursor: string | null = null;
  const savedIds: string[] = [];
  for (let page = 0; page < 4; page++) {
    const response = await owner.client.get(`${baseURL}/favorites/properties`, {
      params: { limit: "1", ...(savedCursor ? { cursor: savedCursor } : {}) },
    });
    expect(response.status(), await response.text()).toBe(200);
    const value = await response.json();
    savedIds.push(...value.data.map((property: any) => property.id));
    savedCursor = value.next_cursor;
    if (!savedCursor) break;
  }
  expect(new Set(savedIds).size).toBe(3);
  expect(savedIds.sort()).toEqual(ids.sort());
  let dashboardCursor: string | null = null;
  const dashboardIds: string[] = [];
  for (let page = 0; page < 4; page++) {
    const response = await owner.client.get(`${baseURL}/dashboard/properties`, {
      params: {
        limit: "1",
        ...(dashboardCursor ? { cursor: dashboardCursor } : {}),
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    const value = await response.json();
    dashboardIds.push(...value.data.map((property: any) => property.id));
    dashboardCursor = value.next_cursor;
    if (!dashboardCursor) break;
  }
  expect(new Set(dashboardIds).size).toBe(3);
  expect(dashboardIds.sort()).toEqual(ids.sort());
  expect(
    await (await owner.client.get(`${baseURL}/dashboard/summary`)).json(),
  ).toEqual({
    total_properties: 3,
    active_properties: 3,
    inquiries: 0,
  });
  expect(
    (await owner.client.get(`${baseURL}/properties?cursor=broken`)).status(),
  ).toBe(400);
  expect(
    (
      await owner.client.get(`${baseURL}/dashboard/properties?cursor=broken`)
    ).status(),
  ).toBe(400);
  await owner.client.dispose();
});
test("invalid location hierarchy, privilege escalation and cross-origin mutations are rejected", async () => {
  const owner = await account();
  const loopbackAlias = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: "http://127.0.0.1:5174" },
  });
  expect(
    (
      await loopbackAlias.post(`${baseURL}/auth/login`, {
        data: { email: "missing@example.test", password: "not-a-password" },
      })
    ).status(),
  ).toBe(401);
  await loopbackAlias.dispose();
  const locations = await (
    await owner.client.get(`${baseURL}/locations`)
  ).json();
  expect(locations).toHaveLength(37);
  expect(locations.every((state: any) => state.cities.length >= 1)).toBe(true);
  expect(locations.map((state: any) => state.name)).toEqual(
    [...locations.map((state: any) => state.name)].sort(),
  );
  const data = listing("Invalid location property");
  data.state_id = "10000000-0000-4000-8000-000000000002";
  expect(
    (await owner.client.post(`${baseURL}/properties`, { data })).status(),
  ).toBe(400);
  expect(
    (
      await owner.client.post(`${baseURL}/auth/register`, {
        data: {
          email: "admin@example.test",
          password: "This-is-not-an-admin-password",
          first_name: "Fake",
          last_name: "Admin",
          role: "admin",
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await owner.client.post(`${baseURL}/properties`, {
        data: listing("Rejected cross-origin listing"),
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  await owner.client.dispose();
});
test("homepage and mobile search remain usable", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find a place that feels right." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Search properties" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Rent", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Rent", exact: true })
    .click();
  await expect(page).toHaveURL(/listing_type=rent/);
  await page.getByRole("button", { name: /More filters/ }).click();
  await page
    .getByRole("combobox", { name: "State", exact: true })
    .selectOption({ label: "Lagos" });
  await page
    .getByRole("combobox", { name: "City", exact: true })
    .selectOption({ label: "Lagos" });
  await page
    .getByRole("combobox", { name: "Area", exact: true })
    .selectOption({ label: "Lekki Phase 1" });
  await page
    .getByRole("combobox", { name: "Minimum bedrooms" })
    .selectOption("3");
  await page.getByRole("button", { name: "Show properties" }).click();
  await expect(page).toHaveURL(/state_id=10000000-0000-4000-8000-000000000001/);
  await expect(page).toHaveURL(/area_id=30000000-0000-4000-8000-000000000001/);
  await expect(page).toHaveURL(/min_bedrooms=3/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
test("a signed-in user can create a rental draft and publish through the browser", async ({
  page,
}) => {
  await page.goto("/dashboard/new");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/join\?next=/);
  await page.getByLabel("First name").fill("Browser");
  await page.getByLabel("Last name").fill("Tester");
  await page
    .getByLabel("Email address")
    .fill(`browser-${crypto.randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-passphrase!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/dashboard/new", { timeout: 15_000 });
  await page
    .getByLabel("Property title")
    .fill("A browser-tested home in Lekki");
  await page
    .getByLabel("Description", { exact: true })
    .fill(
      "A spacious home with natural light, generous rooms and a peaceful garden.",
    );
  await page.getByLabel("Price (₦)").fill("65000000");
  await page
    .getByRole("combobox", { name: "State", exact: true })
    .selectOption({ label: "Lagos" });
  await page
    .getByRole("combobox", { name: "City", exact: true })
    .selectOption({ label: "Lagos" });
  await page
    .getByRole("combobox", { name: "Area", exact: true })
    .selectOption({ label: "Lekki Phase 1" });
  await page.getByLabel("Street address").fill("20 Integration Street");
  await page
    .getByLabel("Property image URLs")
    .fill("https://images.unsplash.com/photo-1600596542815-ffad4c1539a9");
  await page
    .getByLabel("Video or YouTube URLs")
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page
    .getByLabel("Status of A browser-tested home in Lekki")
    .selectOption("active");
  await expect(page.locator(".status-pill")).toHaveText("active");
  await page
    .getByRole("link", { name: "A browser-tested home in Lekki" })
    .click();
  await expect(
    page.getByRole("heading", { name: "A browser-tested home in Lekki" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByTitle("A browser-tested home in Lekki video 1"),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Hi, Browser" }).click();
  await expect(page).toHaveURL("/account");
  await page.getByLabel("Phone number").fill("+234 802 345 6789");
  await page.getByLabel("WhatsApp number").fill("+234 802 345 6789");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(
    page.getByText("Your account details have been updated."),
  ).toBeVisible();
});

test("agent profiles, amenities, inquiry statuses and administrator boundaries", async () => {
  const owner = await account();
  const seeker = await account("user");
  expect(
    (
      await owner.client.put(`${baseURL}/agent/profile`, {
        data: {
          agency_name: "NOMA Test Agency",
          bio: "Helping people find their next chapter.",
        },
      })
    ).status(),
  ).toBe(204);
  expect(
    (await (await owner.client.get(`${baseURL}/agent/profile`)).json())
      .verification_status,
  ).toBe("pending");
  expect(
    (
      await seeker.client.put(`${baseURL}/agent/profile`, {
        data: { agency_name: "Unauthorized", bio: "" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await owner.client.get(`${baseURL}/admin/queue/properties`)).status(),
  ).toBe(403);
  expect(
    (
      await owner.client.post(`${baseURL}/images/signature`, {
        data: { resource_type: "image" },
      })
    ).status(),
  ).toBe(503);
  expect(
    (
      await seeker.client.post(`${baseURL}/images/signature`, {
        data: { resource_type: "video" },
      })
    ).status(),
  ).toBe(503);
  const amenities = await (
    await owner.client.get(`${baseURL}/amenities`)
  ).json();
  const tag = `Amenities-${crypto.randomUUID()}`;
  const created = await owner.client.post(`${baseURL}/properties`, {
    data: { ...listing(tag), amenity_ids: [amenities[0].id] },
  });
  expect(created.status()).toBe(200);
  const property = await created.json();
  expect(
    (
      await owner.client.patch(`${baseURL}/properties/${property.id}/status`, {
        data: { status: "active" },
      })
    ).status(),
  ).toBe(204);
  const details = await (
    await owner.client.get(`${baseURL}/properties/${property.slug}`)
  ).json();
  expect(details.amenity_ids).toEqual([amenities[0].id]);
  expect(details.amenities).toEqual([amenities[0].name]);
  expect(
    (
      await (
        await owner.client.get(`${baseURL}/properties`, {
          params: { q: tag, amenities: amenities[0].id },
        })
      ).json()
    ).data,
  ).toHaveLength(1);
  expect(
    (
      await (
        await owner.client.get(`${baseURL}/properties`, {
          params: { q: tag, amenities: amenities[1].id },
        })
      ).json()
    ).data,
  ).toHaveLength(0);
  expect(
    (
      await (
        await owner.client.get(`${baseURL}/properties`, {
          params: {
            q: tag,
            state_id: "10000000-0000-4000-8000-000000000001",
            city_id: "20000000-0000-4000-8000-000000000001",
            area_id: "30000000-0000-4000-8000-000000000001",
            min_price: "80000000",
            max_price: "90000000",
            min_bedrooms: "4",
            max_bedrooms: "4",
            amenities: amenities[0].id,
          },
        })
      ).json()
    ).data,
  ).toHaveLength(1);
  expect(
    (
      await owner.client.get(`${baseURL}/properties`, {
        params: { q: tag, max_price: "80000000" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await (
        await owner.client.get(`${baseURL}/properties`, {
          params: { q: tag, max_price: "80000000" },
        })
      ).json()
    ).data,
  ).toHaveLength(0);
  expect(
    (
      await owner.client.get(`${baseURL}/properties`, {
        params: { min_bedrooms: "5", max_bedrooms: "2" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await owner.client.get(`${baseURL}/properties`, {
        params: { listing_type: "auction" },
      })
    ).status(),
  ).toBe(400);
  await seeker.client.post(`${baseURL}/properties/${property.id}/inquiries`, {
    data: { message: "Please arrange a viewing for tomorrow." },
  });
  const leads = await (
    await owner.client.get(`${baseURL}/dashboard/inquiries`)
  ).json();
  expect(
    (
      await seeker.client.patch(
        `${baseURL}/dashboard/inquiries/${leads.data[0].id}`,
        { data: { status: "closed" } },
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await owner.client.patch(
        `${baseURL}/dashboard/inquiries/${leads.data[0].id}`,
        { data: { status: "contacted" } },
      )
    ).status(),
  ).toBe(204);
  await owner.client.dispose();
  await seeker.client.dispose();
});

test("administrator review is audited and verification stays independent", async () => {
  const administrator = await account();
  const owner = await account();
  const seeker = await account("user");
  if (new URL(database).pathname !== "/noma_test")
    throw new Error(
      "Administrator fixture requires the isolated noma_test database",
    );
  expect(administrator.user.id).toMatch(/^[0-9a-f-]{36}$/);
  execFileSync("psql", [
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `UPDATE users SET role='admin' WHERE id='${administrator.user.id}'`,
  ]);
  const metricsResponse = await administrator.client.get(
    `${baseURL}/admin/metrics`,
  );
  expect(metricsResponse.status()).toBe(200);
  const metrics = await metricsResponse.json();
  expect(metrics.total_users).toBeGreaterThanOrEqual(3);
  expect(metrics.active_users).toBeGreaterThanOrEqual(3);
  expect(metrics).toHaveProperty("photos_uploaded_today");
  const property = await create(
    owner.client,
    `Reviewed home ${crypto.randomUUID()}`,
  );
  await owner.client.patch(`${baseURL}/properties/${property.id}/status`, {
    data: { status: "active" },
  });
  const report = {
    category: "inaccurate",
    details: "The advertised bedroom count does not match the property photos.",
  };
  expect(
    (
      await seeker.client.post(`${baseURL}/properties/${property.id}/reports`, {
        data: report,
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await seeker.client.post(`${baseURL}/properties/${property.id}/reports`, {
        data: report,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await owner.client.post(`${baseURL}/properties/${property.id}/reports`, {
        data: report,
      })
    ).status(),
  ).toBe(400);
  const queue = await (
    await administrator.client.get(`${baseURL}/admin/queue/reports`)
  ).json();
  const queuedReport = queue.data.find(
    (item: any) => item.property_id === property.id,
  );
  expect(queuedReport.details).toBe(report.details);
  expect(
    (
      await administrator.client.get(
        `${baseURL}/admin/queue/reports?cursor=broken`,
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await owner.client.patch(`${baseURL}/admin/reports/${queuedReport.id}`, {
        data: {
          action: "resolved",
          reason: "Attempted unauthorized report resolution.",
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await administrator.client.patch(
        `${baseURL}/admin/reports/${queuedReport.id}`,
        {
          data: {
            action: "resolved",
            reason: "Listing details were corrected after evidence review.",
          },
        },
      )
    ).status(),
  ).toBe(204);
  expect(
    (
      await (
        await administrator.client.get(`${baseURL}/admin/queue/reports`)
      ).json()
    ).data.map((item: any) => item.id),
  ).not.toContain(queuedReport.id);
  expect(
    (
      await administrator.client.post(
        `${baseURL}/admin/reviews/${owner.user.id}`,
        {
          data: {
            target_type: "agent",
            action: "verify",
            reason: "Test identity evidence reviewed.",
          },
        },
      )
    ).status(),
  ).toBe(204);
  let detail = await (
    await owner.client.get(`${baseURL}/properties/${property.slug}`)
  ).json();
  expect(detail.agent.verification_status).toBe("verified");
  expect(detail.is_verified).toBe(false);
  expect(
    (
      await administrator.client.post(
        `${baseURL}/admin/reviews/${property.id}`,
        {
          data: {
            target_type: "property",
            action: "verify",
            reason: "Test property evidence reviewed.",
          },
        },
      )
    ).status(),
  ).toBe(204);
  detail = await (
    await owner.client.get(`${baseURL}/properties/${property.slug}`)
  ).json();
  expect(detail.is_verified).toBe(true);
  expect(
    (
      await owner.client.put(`${baseURL}/properties/${property.id}`, {
        data: listing("Updated property after verification"),
      })
    ).status(),
  ).toBe(200);
  detail = await (
    await owner.client.get(`${baseURL}/properties/${property.slug}`)
  ).json();
  expect(detail.is_verified).toBe(false);
  expect(
    (
      await administrator.client.post(
        `${baseURL}/admin/reviews/${property.id}`,
        {
          data: {
            target_type: "property",
            action: "suspend",
            reason: "Test discrepancy found in evidence.",
          },
        },
      )
    ).status(),
  ).toBe(204);
  expect(
    (
      await owner.client.patch(`${baseURL}/properties/${property.id}/status`, {
        data: { status: "active" },
      })
    ).status(),
  ).toBe(403);
  const audit = execFileSync(
    "psql",
    [
      database,
      "-tAc",
      `SELECT count(*) FROM moderation_events WHERE actor_id='${administrator.user.id}'`,
    ],
    { encoding: "utf8" },
  );
  expect(Number(audit.trim())).toBe(4);
  await administrator.client.dispose();
  await owner.client.dispose();
  await seeker.client.dispose();
});

test("malformed edit identifiers cannot create a new property", async () => {
  const owner = await account();
  const response = await owner.client.put(`${baseURL}/properties/not-a-uuid`, {
    data: listing("This edit must never create a listing"),
  });
  expect(response.status()).toBe(400);
  expect(
    (await (await owner.client.get(`${baseURL}/dashboard/properties`)).json())
      .data,
  ).toHaveLength(0);
  await owner.client.dispose();
});

test("managed photos are owned, attached once and queued when removed", async () => {
  const owner = await account();
  const other = await account();
  const uploadId = crypto.randomUUID();
  const publicId = `noma/${owner.user.id}/${crypto.randomUUID()}`;
  const url = `https://res.cloudinary.com/test/image/upload/${publicId}.jpg`;
  execFileSync("psql", [
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `INSERT INTO image_uploads(id,user_id,public_id,secure_url,status,confirmed_at) VALUES('${uploadId}','${owner.user.id}','${publicId}','${url}','uploaded',now())`,
  ]);
  const managedListing = {
    ...listing(`Managed image ${crypto.randomUUID()}`),
    images: [{ upload_id: uploadId, url }],
  };
  expect(
    (
      await other.client.post(`${baseURL}/properties`, {
        data: managedListing,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await owner.client.post(`${baseURL}/properties`, {
        data: {
          ...managedListing,
          images: [managedListing.images[0], managedListing.images[0]],
        },
      })
    ).status(),
  ).toBe(400);
  const created = await owner.client.post(`${baseURL}/properties`, {
    data: managedListing,
  });
  expect(created.status(), await created.text()).toBe(200);
  const property = await created.json();
  expect(
    execFileSync(
      "psql",
      [
        database,
        "-tAc",
        `SELECT status || ':' || property_id FROM image_uploads WHERE id='${uploadId}'`,
      ],
      { encoding: "utf8" },
    ).trim(),
  ).toBe(`attached:${property.id}`);
  const update = await owner.client.put(
    `${baseURL}/properties/${property.id}`,
    { data: listing("Managed photo removed from this property") },
  );
  expect(update.status(), await update.text()).toBe(200);
  expect(
    execFileSync(
      "psql",
      [
        database,
        "-tAc",
        `SELECT status FROM image_uploads WHERE id='${uploadId}'`,
      ],
      { encoding: "utf8" },
    ).trim(),
  ).toBe("pending_delete");
  expect(
    Number(
      execFileSync(
        "psql",
        [
          database,
          "-tAc",
          `SELECT count(*) FROM property_images WHERE property_id='${property.id}' AND upload_id IS NOT NULL`,
        ],
        { encoding: "utf8" },
      ).trim(),
    ),
  ).toBe(0);
  await owner.client.dispose();
  await other.client.dispose();
});
