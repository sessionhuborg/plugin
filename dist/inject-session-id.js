#!/usr/bin/env node
// SessionHub Plugin v1.0.5

var __import_meta_url = require('url').pathToFileURL(__filename).href;
var import_meta = { url: __import_meta_url };

"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/inject-session-id.ts
var import_process = require("process");
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = require("os");
var sessionhubDir = import_path.default.join((0, import_os.homedir)(), ".sessionhub");
try {
  import_fs.default.mkdirSync(sessionhubDir, { recursive: true });
} catch {
}
function escapeShellString(str) {
  return str.replace(/[\n\r]/g, "").replace(/[\\"`$]/g, "\\$&");
}
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}
function checkConfig() {
  try {
    const configPath = import_path.default.join((0, import_os.homedir)(), ".sessionhub", "config.json");
    if (!import_fs.default.existsSync(configPath)) {
      return { configured: false, error: "SessionHub is not configured yet." };
    }
    const configData = import_fs.default.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configData);
    const apiKey = config?.user?.apiKey;
    if (!apiKey) {
      return { configured: false, error: "SessionHub API key is not set." };
    }
    return { configured: true };
  } catch {
    return { configured: false, error: "Could not read SessionHub config." };
  }
}
async function readStdin() {
  if (import_process.stdin.isTTY) {
    return { cwd: process.cwd() };
  }
  let inputData = "";
  for await (const chunk of import_process.stdin) {
    inputData += chunk;
  }
  if (inputData.trim()) {
    try {
      return JSON.parse(inputData);
    } catch {
      return { cwd: process.cwd() };
    }
  }
  return { cwd: process.cwd() };
}
async function main() {
  try {
    const hookInput = await readStdin();
    const sessionId = hookInput.session_id;
    const projectDir = process.env.CLAUDE_PROJECT_DIR || hookInput.cwd || process.cwd();
    const { configured } = checkConfig();
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (envFile && projectDir) {
      try {
        const escapedPath = escapeShellString(projectDir);
        import_fs.default.appendFileSync(envFile, `export SESSIONHUB_PROJECT_DIR="${escapedPath}"
`);
      } catch {
      }
    }
    const contextParts = [];
    if (!configured) {
      contextParts.push(
        "**SessionHub Setup Required**: Run `/setup <your-api-key>` to enable session capture. Get your API key at https://sessionhub.dev/settings"
      );
    }
    if (sessionId && isValidUUID(sessionId)) {
      contextParts.push(
        `[SESSIONHUB_SESSION_ID:${sessionId}] [SESSIONHUB_PROJECT_DIR:${projectDir}]`
      );
    }
    if (contextParts.length > 0) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: contextParts.join(" | ")
        }
      }));
    }
  } catch {
  }
}
main();
//# sourceMappingURL=inject-session-id.js.map
