import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRequiredEnv } from "./env";

describe("getRequiredEnv", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns the value when the env var is set", () => {
    process.env.MY_VAR = "hello";
    expect(getRequiredEnv("MY_VAR")).toBe("hello");
  });

  it("throws when the env var is missing", () => {
    delete process.env.MY_VAR;
    expect(() => getRequiredEnv("MY_VAR")).toThrow(
      "Missing required environment variable: MY_VAR",
    );
  });
});
