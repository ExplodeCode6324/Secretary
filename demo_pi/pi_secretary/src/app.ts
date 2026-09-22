import type { TaskPlan, Execution } from "./contracts.ts";
import { Store } from "./store.ts";
import { Authorization } from "./authorization.ts";
import { Scheduler } from "./scheduler.ts";
import { Host } from "./host.ts";
import { World } from "./world.ts";
import { modelConfig, type StreamFn } from "./model.ts";
import type { Model, Api } from "@earendil-works/pi-ai";
export class App {
  private worldWork?: Promise<void>;
  private constructor(
    readonly store: Store,
    readonly authorization: Authorization,
    readonly scheduler: Scheduler,
    readonly host: Host,
    readonly world?: World,
  ) {}
  static async open(
    directory: string,
    config?: { model: Model<Api>; stream: StreamFn },
    dsn?: string,
  ) {
    const store = await Store.open(directory);
    try {
      const chosen = config ?? modelConfig();
      const auth = new Authorization(store);
      auth.recover();
      const world = dsn ? new World(store, auth, dsn) : undefined;
      const scheduler = new Scheduler(store, auth, chosen.model, chosen.stream);
      scheduler.recover();
      const host = new Host(
        store,
        scheduler,
        chosen.model,
        chosen.stream,
        world,
      );
      return new App(store, auth, scheduler, host, world);
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  async pump() {
    if (this.world && !this.worldWork)
      this.worldWork = this.world
        .drain()
        .catch((error) => console.error(String(error)))
        .finally(() => {
          this.worldWork = undefined;
        });
    this.scheduler.tick();
    this.scheduler.retire();
    this.host.deliverFeedback();
    void this.host
      .drain()
      .then(() => this.host.maintainIfNeeded())
      .catch((error) => console.error(String(error)));
  }
  async settle() {
    for (let n = 0; n < 8; n++) {
      await this.pump();
      await this.host.drain();
      await this.worldWork;
      await this.scheduler.idle();
      this.host.deliverFeedback();
      const pending = this.store
        .all("Input")
        .some((i) => "state" in i && i.state === "ACCEPTED");
      const due = this.store
        .all<TaskPlan>("TaskPlan")
        .some(
          (p) =>
            p.state === "ACTIVE" &&
            p.next_due_at &&
            Date.parse(p.next_due_at) <= Date.now() &&
            !p.active_execution_ids.some(
              (eid) =>
                !["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(
                  this.store.get<Execution>("Execution", eid).state,
                ),
            ),
        );
      if (!pending && !due) break;
    }
    await this.host.drain();
  }
  async close() {
    await this.host.close();
    await this.scheduler.close();
    await this.worldWork;
    await this.world?.close();
    await this.store.close();
  }
}
