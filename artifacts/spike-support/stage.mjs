import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withFixture(site, action, pglite) {
  const stage = await mkdtemp(join(tmpdir(), "pocketdb-fixture-"));
  try {
    await cp(site, stage, { recursive: true });
    await cp(new URL("./peer-rpc.js", import.meta.url), join(stage, "peer-rpc.js"));
    if (pglite) await cp(pglite, join(stage, "vendor"), { recursive: true });
    return await action(stage);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
