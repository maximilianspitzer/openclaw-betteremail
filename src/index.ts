import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export default {
  id: "betteremail",
  name: "BetterEmail Digest",

  register(api: OpenClawPluginApi) {
    api.logger.info("betteremail plugin loaded");
  },
};
