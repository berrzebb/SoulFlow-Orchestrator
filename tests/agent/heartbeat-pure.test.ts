import { describe, it, expect } from "vitest";
import { is_heartbeat_empty } from "@src/heartbeat/service.js";

describe("is_heartbeat_empty", () => {
  it("returns true for null", () => {
    expect(is_heartbeat_empty(null)).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(is_heartbeat_empty("")).toBe(true);
  });

  it("returns true for whitespace only", () => {
    expect(is_heartbeat_empty("   \n  \n  ")).toBe(true);
  });

  it("returns true for comments only", () => {
    expect(is_heartbeat_empty("# Header\n<!-- comment -->")).toBe(true);
  });

  it("returns true for unchecked/checked checkboxes only", () => {
    expect(is_heartbeat_empty("- [ ]\n* [ ]\n- [x]\n* [x]")).toBe(true);
  });

  it("returns true for mixed comments + checkboxes", () => {
    expect(is_heartbeat_empty("# Heartbeat\n- [ ]\n<!-- status -->\n* [x]")).toBe(true);
  });

  it("returns false for text content", () => {
    expect(is_heartbeat_empty("check the logs")).toBe(false);
  });

  it("returns false for text after header", () => {
    expect(is_heartbeat_empty("# Header\nsome text")).toBe(false);
  });

  it("returns false for text after checkbox", () => {
    expect(is_heartbeat_empty("- [ ]\naction needed")).toBe(false);
  });
});
