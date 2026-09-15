#!/usr/bin/env node
/**
 * Cursor MCP over the running ArduLoops HTTP API (http://127.0.0.1:8767).
 * Dev helper. The shipped feature is `arduloops.exe --mcp` (same tools).
 */
import readline from "node:readline";

const BASE = process.env.ARDULOOPS_HTTP || "http://127.0.0.1:8767";

const TOOLS = [
  {
    name: "ardupilot_connect",
    description:
      "Point ArduLoops at a MAVLink URL. Default tcpout:127.0.0.1:5763.",
    inputSchema: {
      type: "object",
      properties: { conn_str: { type: "string" } },
    },
  },
  {
    name: "ardupilot_vehicle_state",
    description: "Mode, armed, attitude, altitude from the live ArduLoops link.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ardupilot_get_param",
    description: "Read one parameter by exact name, e.g. ATC_RAT_RLL_P.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "ardupilot_set_param",
    description: "Set one parameter (float32).",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, value: { type: "number" } },
      required: ["name", "value"],
    },
  },
  {
    name: "ardupilot_list_params",
    description: "List cached parameters, optional glob e.g. ATC_RAT_*.",
    inputSchema: {
      type: "object",
      properties: { glob: { type: ["string", "null"] } },
    },
  },
  {
    name: "ardupilot_set_mode",
    description: "Set flight mode by name, e.g. STABILIZE, ALT_HOLD.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string" } },
      required: ["mode"],
    },
  },
  {
    name: "ardupilot_arm",
    description: "ARM. Requires ArduLoops to be linked.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ardupilot_disarm",
    description: "DISARM.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ardupilot_recent_statustext",
    description: "Recent STATUSTEXT, newest first.",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer" } },
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function getJson(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: r.status };
  }
}

async function postCmd(body) {
  const r = await fetch(BASE + "/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 204) {
    throw new Error("HTTP " + r.status);
  }
  return { ok: true };
}

async function callTool(name, args = {}) {
  switch (name) {
    case "ardupilot_connect":
      return postCmd({
        op: "connect",
        url: args.conn_str || "tcpout:127.0.0.1:5763",
      });
    case "ardupilot_vehicle_state":
      return getJson("/state");
    case "ardupilot_get_param":
      return getJson("/param?name=" + encodeURIComponent(args.name));
    case "ardupilot_set_param":
      await postCmd({ op: "param", name: args.name, value: args.value });
      return getJson(
        "/param?name=" + encodeURIComponent(args.name) + "&fresh=1",
      );
    case "ardupilot_list_params":
      return getJson(
        "/params?glob=" + encodeURIComponent(args.glob || "*"),
      );
    case "ardupilot_set_mode":
      return postCmd({ op: "mode", mode: args.mode });
    case "ardupilot_arm":
      return postCmd({ op: "arm", on: true });
    case "ardupilot_disarm":
      return postCmd({ op: "arm", on: false });
    case "ardupilot_recent_statustext":
      return getJson("/statustext?n=" + (args.n || 10));
    default:
      throw new Error("unknown tool " + name);
  }
}

function result(id, obj) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    },
  });
}

function fail(id, message) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: message }],
      isError: true,
    },
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "arduloops", version: "0.2.0" },
        },
      });
      return;
    }
    if (method === "notifications/initialized") return;
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const out = await callTool(params.name, params.arguments || {});
      result(id, out);
      return;
    }
    if (id != null) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      });
    }
  } catch (err) {
    const text =
      err && err.cause && err.cause.code === "ECONNREFUSED"
        ? "ArduLoops is not running (http://127.0.0.1:8767). Start npm run dev or the desktop app."
        : String(err.message || err);
    if (id != null) fail(id, text);
  }
});
