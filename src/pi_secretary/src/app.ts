import { Pushes, type PushDelivery } from "./push-service.ts";
import { modelLifetime } from "./model-retry.ts";
import { activitiesFor } from "./activity.ts";
import { activityHistoryFor } from "./activity-history.ts";
import { Settings } from "./settings.ts";
import type { TaskPlan, Execution } from "./contracts.ts";
import { Store } from "./store.ts";
import { Authorization } from "./authorization.ts";
import { Scheduler } from "./scheduler.ts";
import { Host } from "./host.ts";
import { World } from "./world.ts";
import { modelConfig, type StreamFn, type ModelConfig } from "./model.ts";
import type { Model, Api } from "@earendil-works/pi-ai";
export class App {
  private worldWork?: Promise<void>;
  readonly settings: Settings;
  readonly pushes: Pushes;
  private constructor(
    readonly store: Store,
    readonly authorization: Authorization,
    readonly scheduler: Scheduler,
    readonly host: Host,
    readonly world?: World,
    options: { clock?: () => number; pushDelivery?: PushDelivery } = {},
  ) {
    this.pushes = new Pushes(store, options.clock, options.pushDelivery);
    this.settings = new Settings(store, host, world);
    // Initialize durable configuration before any query is accepted.
    this.settings.draft();
  }
  static async open(
    directory: string,
    config?: ModelConfig | { main: ModelConfig; task: ModelConfig },
    dsn?: string,
    options: { clock?: () => number; pushDelivery?: PushDelivery } = {},
  ) {
    const store = await Store.open(directory);
    try {
      const chosen =
        config && "main" in config
          ? config.main
          : (config ?? modelConfig("main"));
      const task =
        config && "task" in config
          ? config.task
          : (config ?? modelConfig("task"));
      const auth = new Authorization(store);
      auth.recover();
      const world = dsn ? new World(store, auth, dsn) : undefined;
      const scheduler = new Scheduler(store, auth, task.model, task.stream);
      await scheduler.recover();
      const host = new Host(
        store,
        scheduler,
        chosen.model,
        chosen.stream,
        world,
        options.clock,
      );
      const app = new App(store, auth, scheduler, host, world, options);
      void world?.memorySearch.advance();
      // Warm the disposable read index once, before accepting UI requests.
      try {
        activityHistoryFor(store);
      } catch {
        /* A display projection must not prevent business recovery. */
      }
      return app;
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  activitySnapshot() {
    return activitiesFor(this.store).snapshot(this);
  }
  async pump() {
    void this.pushes.tick().catch(() => {});
    void this.world?.memorySearch.advance();
    if (this.world && !this.worldWork && !this.settings.blocked)
      this.worldWork = this.world
        .drain()
        .catch((error) => console.error(String(error)))
        .finally(() => {
          this.worldWork = undefined;
        });
    void this.settings.tick();
    this.scheduler.tick();
    this.scheduler.retire();
    this.host.deliverFeedback();
    this.host.wakeups.fireDue();
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
      await this.settings.tick();
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
            ((p.pending_requests?.length ?? 0) > 0 ||
              (p.next_due_at && Date.parse(p.next_due_at) <= Date.now())) &&
            !p.active_execution_ids.some(
              (eid) =>
                !["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(
                  this.store.get<Execution>("Execution", eid).state,
                ),
            ),
        );
      if (!pending && !due && !this.host.wakeups.hasDue()) break;
    }
    await this.host.drain();
    await this.pushes.tick();
    await this.world?.memorySearch.catchUp();
  }
  async close() {
    modelLifetime(this.store).abort(Error("CORE_STOPPING"));
    await this.pushes.close();
    await this.settings.close();
    await this.host.close();
    await this.scheduler.close();
    await this.worldWork;
    await this.world?.close();
    await this.store.close();
  }
}
