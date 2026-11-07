import { describe, it, expect } from "vitest";
import { parseSource, isGitHubSource, isRegistrySource } from "../src/lib/source.js";

describe("parseSource", () => {
  // ── GitHub Shorthand formats ──

  it("parses user/repo as GitHub source", () => {
    const res = parseSource("user/repo");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
      raw: "user/repo",
    });
  });

  it("parses user/repo@ref", () => {
    const res = parseSource("user/repo@v1.0");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "v1.0",
      subpath: null,
      raw: "user/repo@v1.0",
    });
  });

  it("parses user/repo@sha", () => {
    const res = parseSource("user/repo@abc123");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "abc123",
      subpath: null,
      raw: "user/repo@abc123",
    });
  });

  it("parses user/repo/path/to/skill", () => {
    const res = parseSource("user/repo/path/to/skill");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: "path/to/skill",
      raw: "user/repo/path/to/skill",
    });
  });

  it("parses user/repo/path/to/skill@ref", () => {
    const res = parseSource("user/repo/skills/my-skill@main");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "main",
      subpath: "skills/my-skill",
      raw: "user/repo/skills/my-skill@main",
    });
  });

  // ── GitHub URL formats ──

  it("parses https://github.com/user/repo", () => {
    const res = parseSource("https://github.com/user/repo");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
      raw: "https://github.com/user/repo",
    });
  });

  it("parses URL with .git suffix", () => {
    const res = parseSource("https://github.com/user/repo.git");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
      raw: "https://github.com/user/repo.git",
    });
  });

  it("parses URL with tree/branch/path", () => {
    const res = parseSource("https://github.com/user/repo/tree/main/skills/my-skill");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "main",
      subpath: "skills/my-skill",
      raw: "https://github.com/user/repo/tree/main/skills/my-skill",
    });
  });

  it("parses URL with tree/branch and no subpath", () => {
    const res = parseSource("https://github.com/user/repo/tree/develop");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "develop",
      subpath: null,
      raw: "https://github.com/user/repo/tree/develop",
    });
  });

  it("handles trailing slashes in URLs", () => {
    const res = parseSource("https://github.com/user/repo/");
    expect(isGitHubSource(res)).toBe(true);
    expect(res).toEqual({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: null,
      subpath: null,
      raw: "https://github.com/user/repo/",
    });
  });

  it("trims whitespace", () => {
    const res = parseSource("  user/repo  ");
    expect(isGitHubSource(res)).toBe(true);
    expect(res.owner).toBe("user");
    expect(res.repo).toBe("repo");
  });

  // ── Registry Source Formats (New) ──

  it("parses bare skill name as Registry source", () => {
    const res = parseSource("pdf-summarizer");
    expect(isRegistrySource(res)).toBe(true);
    expect(res).toEqual({
      type: "registry",
      name: "pdf-summarizer",
      range: null,
      raw: "pdf-summarizer",
    });
  });

  it("parses skill name with exact version as Registry source", () => {
    const res = parseSource("pdf-summarizer@1.2.0");
    expect(isRegistrySource(res)).toBe(true);
    expect(res).toEqual({
      type: "registry",
      name: "pdf-summarizer",
      range: "1.2.0",
      raw: "pdf-summarizer@1.2.0",
    });
  });

  it("parses skill name with semver range as Registry source", () => {
    const res = parseSource("text-cleaner@^1.0.0");
    expect(isRegistrySource(res)).toBe(true);
    expect(res).toEqual({
      type: "registry",
      name: "text-cleaner",
      range: "^1.0.0",
      raw: "text-cleaner@^1.0.0",
    });
  });

  it("parses scoped package name without range as Registry source", () => {
    const res = parseSource("@acme/pdf-summarizer");
    expect(isRegistrySource(res)).toBe(true);
    expect(res).toEqual({
      type: "registry",
      name: "@acme/pdf-summarizer",
      range: null,
      raw: "@acme/pdf-summarizer",
    });
  });

  it("parses scoped package name with semver range as Registry source", () => {
    const res = parseSource("@acme/pdf-summarizer@~2.1.0");
    expect(isRegistrySource(res)).toBe(true);
    expect(res).toEqual({
      type: "registry",
      name: "@acme/pdf-summarizer",
      range: "~2.1.0",
      raw: "@acme/pdf-summarizer@~2.1.0",
    });
  });

  // ── Error cases ──

  it("throws on empty string", () => {
    expect(() => parseSource("")).toThrow("cannot be empty");
  });

  it("throws on whitespace only", () => {
    expect(() => parseSource("   ")).toThrow("cannot be empty");
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

  it("throws on invalid registry package name", () => {
    expect(() => parseSource("-invalid-name")).toThrow("Invalid package name");
    expect(() => parseSource("ab")).toThrow("Invalid package name");
  });

  it("throws on empty range after @ for registry package", () => {
    expect(() => parseSource("pdf-summarizer@")).toThrow("empty version range");
  });
});
