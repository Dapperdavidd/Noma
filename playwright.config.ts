import { defineConfig } from "@playwright/test";
const testDatabase =
  process.env.TEST_DATABASE_URL ||
  "postgres://noma:noma@localhost:5432/noma_test";
if (new URL(testDatabase).pathname !== "/noma_test")
  throw new Error(
    "Integration tests require an isolated database named noma_test",
  );
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "cargo run -p noma-api",
      url: "http://127.0.0.1:8081/health",
      timeout: 180000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: testDatabase,
        CLOUDINARY_CLOUD_NAME: "",
        CLOUDINARY_API_KEY: "",
        CLOUDINARY_API_SECRET: "",
        CLOUDINARY_UPLOAD_PRESET: "",
        GOOGLE_CLIENT_ID: "",
        RESEND_API_KEY: "",
        API_BIND: "127.0.0.1:8081",
        WEB_ORIGINS: "http://localhost:5174,http://127.0.0.1:5174",
        COOKIE_SECURE: "false",
        RUST_LOG: "warn",
      },
    },
    {
      command: "npm run dev --workspace apps/web -- --port 5174",
      url: "http://localhost:5174",
      reuseExistingServer: !process.env.CI,
      env: { NOMA_API_TARGET: "http://127.0.0.1:8081" },
    },
  ],
});
