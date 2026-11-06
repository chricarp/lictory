// Imported first by the entry point: validates the collaboration service's
// configuration before any other module reads the environment. See
// docs/operations/configuration.md.
import { loadConfiguration } from "@lictory/core/config/validate";

loadConfiguration("collaboration");
