// @vitest-environment node

import { describe, expect, it } from "vitest";
import { pickWindowsExecutable } from "./provider-launch.js";

describe("executable resolution", () => {
  it("prefers executable and cmd shims over extensionless or PowerShell shims", () => {
    expect(
      pickWindowsExecutable([
        "C:\Users\me\AppData\Roaming\npm\codex",
        "C:\Users\me\AppData\Roaming\npm\codex.ps1",
        "C:\Users\me\AppData\Roaming\npm\codex.cmd",
      ]),
    ).toBe("C:\Users\me\AppData\Roaming\npm\codex.cmd");
  });

  it("prefers a native exe over every shim", () => {
    expect(
      pickWindowsExecutable(["C:\tools\claude.cmd", "C:\Users\me\.local\bin\claude.exe"]),
    ).toBe("C:\Users\me\.local\bin\claude.exe");
  });

  it("returns null when only PowerShell shims or blanks are found", () => {
    expect(pickWindowsExecutable(["  ", "C:\npm\codex.ps1"])).toBeNull();
  });
});
