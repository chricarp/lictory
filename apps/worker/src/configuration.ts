// Imported first by the entry point: validates the worker's configuration
// before any other module reads the environment. See
// docs/operations/configuration.md.
import { mailTransportRule } from "@lictory/core/config/mail";
import { loadConfiguration } from "@lictory/core/config/validate";

loadConfiguration("worker", [mailTransportRule]);
