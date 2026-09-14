#!/usr/bin/env node
/**
 * CLI against a running ArduLoops (http://127.0.0.1:8767).
 * Same MAVLink as the UI — not a second SITL port.
 *
 *   npm run cli -- state
 *   npm run cli -- param get ATC_RAT_RLL_P
 */
const BASE = process.env.ARDULOOPS_HTTP || "http://127.0.0.1:8767";

const HELP = `ArduLoops CLI — HTTP to the running app (npm run dev or the exe), not a second MAVLink.

npm run cli -- state
npm run cli -- statustext [N]
npm run cli -- param get NAME
npm run cli -- param set NAME VALUE
npm run cli -- param list [GLOB]     e.g. ATC_RAT_*
npm run cli -- mode STABILIZE
npm run cli -- arm | disarm
npm run cli -- reboot
npm run cli -- connect [tcpout:127.0.0.1:5763]
npm run cli -- health
`;

async function get(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  return text.endsWith("\n") ? text : text + "\n";
}

async function post(body) {
  const r = await fetch(BASE + "/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 204) {
    throw new Error("HTTP " + r.status);
  }
  return "ok\n";
}

async function main(args) {
  if (!args.length || args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  const [cmd, a, b, c] = args;
  let out;
  switch (cmd) {
    case "state":
      out = await get("/state");
      break;
    case "statustext":
      out = await get("/statustext?n=" + (a || "10"));
      break;
    case "param":
      if (a === "get") {
        if (!b) throw new Error("param get NAME");
        out = await get("/param?name=" + encodeURIComponent(b));
      } else if (a === "set") {
        if (!b || c == null) throw new Error("param set NAME VALUE");
        await post({ op: "param", name: b, value: Number(c) });
        out = await get(
          "/param?name=" + encodeURIComponent(b) + "&fresh=1",
        );
      } else if (a === "list") {
        out = await get("/params?glob=" + encodeURIComponent(b || "*"));
      } else {
        throw new Error("param get|set|list");
      }
      break;
    case "mode":
      if (!a) throw new Error("mode NAME");
      out = await post({ op: "mode", mode: a });
      break;
    case "arm":
      out = await post({ op: "arm", on: true });
      break;
    case "disarm":
      out = await post({ op: "arm", on: false });
      break;
    case "reboot":
      out = await post({ op: "reboot" });
      break;
    case "connect":
      out = await post({
        op: "connect",
        url: a || "tcpout:127.0.0.1:5763",
      });
      break;
    case "disconnect":
      out = await post({ op: "disconnect" });
      break;
    case "health":
      out = await get("/health");
      break;
    default:
      throw new Error("unknown command: " + cmd + "\n" + HELP);
  }
  process.stdout.write(out.endsWith("\n") ? out : out + "\n");
  return 0;
}

main(process.argv.slice(2)).catch((err) => {
  const refused =
    err && err.cause && (err.cause.code === "ECONNREFUSED" || err.cause.code === "UND_ERR_SOCKET");
  if (refused) {
    process.stderr.write(
      "no ArduLoops at " + BASE + " — start npm run dev or the desktop app\n",
    );
  } else {
    process.stderr.write(String(err.message || err) + "\n");
  }
  process.exit(1);
});
