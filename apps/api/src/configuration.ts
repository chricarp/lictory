// Imported first by the entry point: validates the API's configuration before
// any other module reads the environment. See docs/operations/configuration.md.
import { aiRules } from "@lictory/core/config/ai";
import { mailTransportRule } from "@lictory/core/config/mail";
import { loadConfiguration } from "@lictory/core/config/validate";

loadConfiguration("api", [mailTransportRule, ...aiRules]);
