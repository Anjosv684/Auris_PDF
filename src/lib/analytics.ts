import posthog from "posthog-js";

const isConfigured = Boolean(import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST);

export function capture(event: string, properties?: Record<string, unknown>) {
  if (isConfigured) posthog.capture(event, properties);
}

export const posthogLog = {
  info(message: string, attributes?: Parameters<typeof posthog.logger.info>[1]) {
    if (isConfigured) posthog.logger.info(message, attributes);
  },
};
