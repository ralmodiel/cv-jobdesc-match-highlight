// Shared by the browser checks: a Chromium that exists on this machine (CHROME_PATH, the Playwright cache, or system Chrome).
// BROWSER=firefox or BROWSER=webkit runs the same checks in that engine (its Playwright build must be installed).
import { chromium, firefox, webkit } from "playwright-core";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const CACHED = `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const OTHER = { firefox, webkit }[process.env.BROWSER];
export const launch = () => OTHER ? OTHER.launch() : chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
  : existsSync(CACHED) ? { executablePath: CACHED, args: ["--no-sandbox"] } : { channel: "chrome" });
