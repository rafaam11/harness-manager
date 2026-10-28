import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "../../../scripts/node-runtime.ps1");
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function powershell(body: string): any {
  const code = `$ProgressPreference='SilentlyContinue'; . '${script.replaceAll("'", "''")}'; $ErrorActionPreference='Stop'; [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false; ${body}`;
  const stdout = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(code, "utf16le").toString("base64")], { encoding: "utf8", timeout: 15_000, windowsHide: true, stdio: "pipe" });
  return JSON.parse(stdout.trim());
}

function simulate(states: object[], failCommand = "", installedVersion = "v22.20.0") {
  const json = JSON.stringify(states).replaceAll("'", "''");
  return powershell(`
    $script:states = '${json}' | ConvertFrom-Json; $script:index = 0; $script:calls = @()
    function Get-HmNodeState { $value=$script:states[[Math]::Min($script:index,$script:states.Count-1)]; $script:index++; return $value }
    function Read-HmRuntimeVersion([string]$File) { return '${installedVersion}' }
    function Get-HmNodeRealPath([string]$File) { return $File }
    function Invoke-HmRuntimeCommand([string]$Command,[string[]]$Arguments) {
      $line=$Command+' '+($Arguments -join ' '); $script:calls += $line
      if ('${failCommand}' -and $line -like '*${failCommand}*') { throw 'simulated failure' }
    }
    function Write-Host { }
    $failure=$null
    try { Install-HmNodeRuntime } catch { $failure=$_.Exception.Message }
    @{ calls=@($script:calls); error=$failure } | ConvertTo-Json -Compress
  `);
}

const fresh = { state: "fresh", nvm: null, detail: "empty PC" };
const empty = { state: "empty-nvm", nvm: "C:\\nvm\\nvm.exe", nvmRoot: "C:\\nvm", versions: [] };
const installed = { ...empty, versions: ["22.19.0", "22.20.0", "24.0.0"] };
const ready = { state: "ready", node: "C:\\nvm\\v22.20.0\\node.exe", nodeVersion: "v22.20.0", detail: "ready" };

function inventory({ duplicate = false, alias = false, mixed = false, version = "v24.20.0" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-node-inventory-")); temporary.push(dir);
  const a = path.join(dir, "a"); const b = path.join(dir, "b"); const nvm = path.join(dir, "nvm");
  fs.mkdirSync(a); fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, "node.exe"), "fixture");
  if (duplicate || alias) fs.writeFileSync(path.join(b, "node.exe"), "fixture");
  if (mixed) {
    fs.mkdirSync(nvm);
    fs.writeFileSync(path.join(nvm, "nvm.exe"), "fixture");
    fs.writeFileSync(path.join(nvm, "settings.txt"), `root: ${nvm}\r\npath: ${path.join(dir, "active")}\r\n`);
  }
  const quote = (value: string) => value.replaceAll("'", "''");
  return powershell(`
    $env:LOCALAPPDATA='${quote(dir)}'; $env:ProgramFiles='${quote(dir)}'; [Environment]::SetEnvironmentVariable('ProgramFiles(x86)','','Process'); $env:Path='${quote(a)};${quote(b)}'; $env:HM_NODE_ORIGINAL_PATH=''
    function Update-HmRuntimeEnvironment { $env:NVM_HOME='${mixed ? quote(nvm) : ""}'; $env:NVM_SYMLINK='${mixed ? quote(path.join(dir, "active")) : ""}' }
    function Get-HmRuntimeRegistrations { [PSCustomObject]@{name='Node.js';version='24.20.0';location='';id='test-msi'} }
    function Get-HmRuntimeCommand([string]$Name) {
      if ($Name -eq 'node.exe') { return '${quote(path.join(a, "node.exe"))}' }
      if ($Name -eq 'npm.cmd') { return '${quote(path.join(a, "npm.cmd"))}' }
      return $null
    }
    function Read-HmRuntimeVersion([string]$File) { if ($File -like '*nvm.exe') { return '1.2.2' }; if ($File -like '*npm.cmd') { return '11.0.0' }; return '${version}' }
    function Get-HmNodeRealPath([string]$File) { ${alias ? `return '${quote(path.join(a, "node.exe"))}'` : "return $File"} }
    Get-HmNodeState -DefaultNvmLink '${quote(path.join(dir, 'default-link'))}' | ConvertTo-Json -Depth 6 -Compress
  `);
}

describe.runIf(process.platform === "win32")("shared bootstrap/install Node protection", () => {
  it("resolves an actual directory junction to the Node executable it points to", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-node-link-")); temporary.push(dir);
    const alias = path.join(dir, "node-link");
    fs.symlinkSync(path.dirname(process.execPath), alias, "junction");
    const file = path.join(alias, path.basename(process.execPath)).replaceAll("'", "''");
    expect(powershell(`Get-HmNodeRealPath '${file}' | ConvertTo-Json -Compress`).toLowerCase()).toBe(fs.realpathSync(process.execPath).toLowerCase());
  });

  it("detects distinct Node installations, while treating symlink aliases as one runtime", () => {
    const duplicate = inventory({ duplicate: true });
    expect(duplicate.state).toBe("blocked");
    expect(duplicate.candidates).toHaveLength(2);
    expect(inventory({ alias: true }).state).toBe("ready");
  });

  it("preserves a healthy MSI runtime and blocks mixed or unsupported runtimes", () => {
    expect(inventory().state).toBe("ready");
    expect(inventory({ mixed: true }).detail).toContain("MSI Node와 NVM");
    expect(inventory({ version: "v20.20.0" }).state).toBe("blocked");
    expect(inventory({ version: "v22.11.0" }).state).toBe("blocked");
  });
  it("preserves existing Node and rejects mixed/broken installations without invoking an installer", () => {
    expect(simulate([ready])).toEqual({ calls: [], error: null });
    expect(simulate([{ state: "blocked", detail: "MSI + NVM" }])).toEqual({ calls: [], error: "MSI + NVM" });
    expect(simulate([fresh, ready])).toEqual({ calls: [], error: null });
  });

  it("installs NVM then Node 22, activates the concrete version, and verifies it", () => {
    const result = simulate([fresh, fresh, empty, installed, ready]);
    expect(result.error).toBeNull();
    expect(result.calls).toEqual([
      "winget.exe install --id CoreyButler.NVMforWindows --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity",
      "C:\\nvm\\nvm.exe install 22", "C:\\nvm\\nvm.exe use 22.20.0",
    ]);
  });

  it("uses an existing empty NVM without reinstalling it", () => {
    expect(simulate([empty, installed, ready]).calls).toEqual(["C:\\nvm\\nvm.exe install 22", "C:\\nvm\\nvm.exe use 22.20.0"]);
  });

  it("does not activate after failed or falsely successful installation", () => {
    expect(simulate([empty], "install 22").error).toBe("simulated failure");
    const missing = simulate([empty, empty]);
    expect(missing.error).toContain("Node 22");
    expect(missing.calls).toHaveLength(1);
    expect(simulate([empty, installed], "", "v24.20.0").calls).toHaveLength(1);
  });

  it("fails verification when nvm use exits successfully without activating the requested version", () => {
    expect(simulate([empty, installed, { ...ready, nodeVersion: "v24.20.0" }]).error).toContain("활성화 검증 실패");
    expect(simulate([empty, installed, { ...ready, node: "C:\\other-node\\node.exe" }]).error).toContain("활성화 검증 실패");
  });

  it("detects MSI registration even when Node is hidden from PATH", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-node-inventory-")); temporary.push(dir);
    const literal = dir.replaceAll("'", "''");
    const result = powershell(`
      $env:LOCALAPPDATA='${literal}'; $env:ProgramFiles='${literal}'; [Environment]::SetEnvironmentVariable('ProgramFiles(x86)','','Process'); $env:Path='${literal}'; $env:HM_NODE_ORIGINAL_PATH=''
      function Update-HmRuntimeEnvironment { $env:NVM_HOME=''; $env:NVM_SYMLINK='' }
      function Get-HmRuntimeRegistrations { [PSCustomObject]@{name='Node.js';version='24.20.0';location='';id='test-msi'} }
      function Get-HmRuntimeCommand { return $null }
      Get-HmNodeState | ConvertTo-Json -Depth 6 -Compress
    `);
    expect(result.state).toBe("blocked");
    expect(result.detail).toContain("기존 Node 설치");
    expect(result.registrations).toHaveLength(1);
  });

  it("bootstrap invokes the same guarded runtime script, never an MSI Node install", () => {
    const bootstrap = fs.readFileSync(path.resolve(__dirname, "../../../scripts/bootstrap.ps1"), "utf8");
    expect(bootstrap).not.toContain("OpenJS.NodeJS.LTS");
    expect(bootstrap).toContain("scripts\\node-runtime.ps1') -Install");
    expect(fs.readFileSync(script).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});
