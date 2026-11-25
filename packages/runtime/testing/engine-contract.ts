import { describe, expect, it } from "vitest";
import type {
  EngineAdapter,
  EngineConfig,
  EngineRequest,
  EngineResponse,
  InstanceId,
  SessionContext,
} from "../src/contracts";

export interface EngineContractCase {
  readonly adapter: EngineAdapter;
  readonly config: EngineConfig;
  readonly instanceId: InstanceId;
  readonly request: EngineRequest;
  readonly expectedResponse: EngineResponse;
  readonly sessionContext: SessionContext;
}

export function defineEngineAdapterContract(
  name: string,
  createCase: () => EngineContractCase,
): void {
  describe(`${name} engine contract`, () => {
    it("publishes capabilities and a stable engine identity", () => {
      const { adapter } = createCase();
      expect(adapter.id.trim()).not.toBe("");
      expect(adapter.capabilities().operations.length).toBeGreaterThan(0);
    });

    it("starts, reports health and stops an instance", async () => {
      const { adapter, config, instanceId } = createCase();
      const instance = adapter.createInstance(config, instanceId);

      await instance.start();
      await expect(instance.health()).resolves.toMatchObject({
        status: "healthy",
      });
      await instance.stop();
      await expect(instance.health()).resolves.toMatchObject({
        status: "stopped",
      });
    });

    it("opens a session, executes a request and closes the session", async () => {
      const {
        adapter,
        config,
        instanceId,
        request,
        expectedResponse,
        sessionContext,
      } = createCase();
      const instance = adapter.createInstance(config, instanceId);

      await instance.start();
      const session = await instance.openSession(sessionContext);
      await expect(instance.execute(session, request)).resolves.toEqual(
        expectedResponse,
      );
      await instance.closeSession(session);
      await instance.stop();
    });
  });
}
