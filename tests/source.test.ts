import { describe, it, expect } from "vitest";
import { parseSource } from "../src/lib/source.js";

describe("parseSource", () => {
  // ── Shorthand formats ──

  it("parses user/repo", () => {
    expect(parseSource("user/repo")).toEqual({
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
    });
  });

  it("parses user/repo@ref", () => {
    expect(parseSource("user/repo@v1.0")).toEqual({
      owner: "user",
      repo: "repo",
      ref: "v1.0",
      subpath: null,
    });
  });

  it("parses user/repo@sha", () => {
    expect(parseSource("user/repo@abc123")).toEqual({
      owner: "user",
      repo: "repo",
      ref: "abc123",
      subpath: null,
    });
  });

  it("parses user/repo/path/to/skill", () => {
    expect(parseSource("user/repo/path/to/skill")).toEqual({
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: "path/to/skill",
    });
  });

  it("parses user/repo/path/to/skill@ref", () => {
    expect(parseSource("user/repo/skills/my-skill@main")).toEqual({
      owner: "user",
      repo: "repo",
      ref: "main",
      subpath: "skills/my-skill",
    });
  });

  // ── URL formats ──

  it("parses https://github.com/user/repo", () => {
    expect(parseSource("https://github.com/user/repo")).toEqual({
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
    });
  });

  it("parses URL with .git suffix", () => {
    expect(parseSource("https://github.com/user/repo.git")).toEqual({
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
    });
  });

  it("parses URL with tree/branch/path", () => {
    expect(
      parseSource("https://github.com/user/repo/tree/main/skills/my-skill")
    ).toEqual({
      owner: "user",
      repo: "repo",
      ref: "main",
      subpath: "skills/my-skill",
    });
  });

  it("parses URL with tree/branch and no subpath", () => {
    expect(
      parseSource("https://github.com/user/repo/tree/develop")
    ).toEqual({
      owner: "user",
      repo: "repo",
      ref: "develop",
      subpath: null,
    });
  });

  it("handles trailing slashes in URLs", () => {
    expect(parseSource("https://github.com/user/repo/")).toEqual({
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
    });
  });

  // ── Whitespace handling ──

  it("trims whitespace", () => {
    expect(parseSource("  user/repo  ")).toEqual({
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
    });
  });

  // ── Error cases ──

  it("throws on empty string", () => {
    expect(() => parseSource("")).toThrow("cannot be empty");
  });

  it("throws on whitespace only", () => {
    expect(() => parseSource("   ")).toThrow("cannot be empty");
  });

  it("throws on single word (no slash)", () => {
    expect(() => parseSource("justrepo")).toThrow("user/repo");
  });

  it("throws on non-GitHub URL", () => {
    expect(() => parseSource("https://gitlab.com/user/repo")).toThrow(
      "Only GitHub"
    );
  });

  it("throws on GitHub URL without repo", () => {
    expect(() => parseSource("https://github.com/user")).toThrow(
      "at least user/repo"
    );
  });

  it("throws on GitHub URL with non-tree path", () => {
    expect(() =>
      parseSource("https://github.com/user/repo/blob/main/file.ts")
    ).toThrow("/tree/");
  });

  it("throws on GitHub URL with empty ref after /tree/", () => {
    expect(() =>
      parseSource("https://github.com/user/repo/tree/")
    ).toThrow("missing ref");
  });
});
