import { readFileSync } from "node:fs";

const frontend = readFileSync("src/main.tsx", "utf8");
const native = readFileSync("src-tauri/src/lib.rs", "utf8");
const invoked = new Set(
  [...frontend.matchAll(/\binvoke(?:<[^>]+>)?\(\s*["']([^"']+)/g)].map(
    (match) => match[1],
  ),
);
const handlerBlock = native.match(/tauri::generate_handler!\[([^\]]+)\]/s)?.[1];

if (!handlerBlock) {
  console.error("Unable to find the Tauri command registration list.");
  process.exit(1);
}

const registered = new Set(
  handlerBlock
    .split(",")
    .map((command) => command.trim())
    .filter(Boolean),
);
const missing = [...invoked].filter((command) => !registered.has(command)).sort();

if (missing.length) {
  console.error(`Frontend IPC commands are not registered natively: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`IPC contract OK: ${invoked.size} frontend commands are registered.`);
