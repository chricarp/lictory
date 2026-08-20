import { createApp } from "./app";
import { consumeJobs } from "./infrastructure/queue/consumer";
import type { Env, JobMessage } from "./bindings";

export {
  FireTriggerWorkflow,
  ProcessMediaWorkflow,
  ProcessNoteWorkflow,
} from "./features/understanding/workflows";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: consumeJobs,
} satisfies ExportedHandler<Env, JobMessage>;
