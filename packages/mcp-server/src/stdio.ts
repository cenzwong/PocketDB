#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createPocketDBMcpServer } from "./index.js";

await serveStdio(() => createPocketDBMcpServer());
console.error("PocketDB MCP server running over stdio");
