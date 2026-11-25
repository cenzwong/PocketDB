import assert from "node:assert/strict";
import { connectNode } from "../dist/index.js";

assert.equal(typeof connectNode, "function");
console.log("@pocketdb/node-client package import passed");
