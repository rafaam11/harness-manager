import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, it, expect, vi } from "vitest";
import { probeMcp } from "./mcp-probe.js";
const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
it("initializes a real isolated stdio server and never calls tools or a model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-mcp-probe-")); roots.push(root);
  const log = path.join(root, "messages.jsonl"), script = path.join(root, "server.cjs");
  await fs.writeFile(script, `const fs=require('fs');let pending='';process.stdin.on('data',chunk=>{pending+=chunk;const lines=pending.split('\\n');pending=lines.pop();for(const line of lines){const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},m.method+'\\n');if(m.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',capabilities:{},serverInfo:{name:'fixture'}}}));}});`);
  const result = await probeMcp({ name: "fixture", scope: "user", transport: "stdio", command: process.execPath, args: [script] }, process.env, new AbortController().signal);
  expect(result).toMatchObject({ ok: true }); expect((await fs.readFile(log, "utf8")).trim().split("\n")).toEqual(["initialize", "notifications/initialized"]);
});
it("negotiates a streamable HTTP session and closes it without calling tools", async () => {
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    methods.push(options.method === "DELETE" ? "DELETE" : JSON.parse(options.body).method);
    return options.method === "DELETE" ? new Response(null, { status: 200 }) : JSON.parse(options.body).id === 1 ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fixture" } } }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "fixture" } }) : new Response(null, { status: 202 });
  }));
  expect((await probeMcp({ name: "fixture", scope: "user", transport: "http", url: "http://localhost/mcp" }, {}, new AbortController().signal)).ok).toBe(true);
  expect(methods).toEqual(["initialize", "notifications/initialized", "DELETE"]);
});
it("reports authentication failure and unsupported transports as unverified", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  expect((await probeMcp({ name: "fixture", scope: "user", transport: "http", url: "http://localhost/mcp" }, {}, new AbortController().signal)).ok).toBe(false);
  expect((await probeMcp({ name: "fixture", scope: "user", transport: "sse" }, {}, new AbortController().signal)).ok).toBe(false);
});
