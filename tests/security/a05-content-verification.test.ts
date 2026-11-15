import { describe, it, expect } from "vitest";
import { checkMagicBytes, validateSkillMd, ALLOWED_EXTENSIONS } from "../../src/lib/validation.js";

describe("A-05: Content verification and magic bytes", () => {
  it("rejects ELF, PE, Mach-O, Java class, and WASM binary magic bytes", () => {
    // ELF: 0x7F 'E' 'L' 'F'
    expect(() => checkMagicBytes(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "script.py")).toThrow(
      /ELF executable/i
    );
    // PE MZ: 0x4D 0x5A
    expect(() => checkMagicBytes(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "readme.txt")).toThrow(
      /Windows PE executable/i
    );
    // Mach-O: 0xFE 0xED 0xFA 0xCE
    expect(() => checkMagicBytes(Buffer.from([0xfe, 0xed, 0xfa, 0xce]), "tool.sh")).toThrow(
      /Mach-O.*prohibited/i
    );
    // Java class: 0xCA 0xFE 0xBA 0xBE
    expect(() => checkMagicBytes(Buffer.from([0xca, 0xfe, 0xba, 0xbe]), "class.json")).toThrow(
      /(Java class|Mach-O)/i
    );
    // WASM: 0x00 0x61 0x73 0x6d (\0asm)
    expect(() => checkMagicBytes(Buffer.from([0x00, 0x61, 0x73, 0x6d]), "module.js")).toThrow(
      /WebAssembly/i
    );
  });

  it("does not allow binary extensions by default", () => {
    expect(ALLOWED_EXTENSIONS.has(".exe")).toBe(false);
    expect(ALLOWED_EXTENSIONS.has(".dll")).toBe(false);
    expect(ALLOWED_EXTENSIONS.has(".so")).toBe(false);
    expect(ALLOWED_EXTENSIONS.has(".dylib")).toBe(false);
  });

  it("requires SKILL.md frontmatter with valid name and non-empty description", () => {
    expect(() => validateSkillMd("No frontmatter here at all")).toThrow(/must begin with YAML/i);
    expect(() =>
      validateSkillMd(`---\nname: my-skill\ndescription: ""\n---\n# Title\nValid content`)
    ).toThrow(/description/i);
  });
});
