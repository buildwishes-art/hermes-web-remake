/**
 * Outgoing-message transforms.
 *
 * A plugin that renders a control in the composer can only *look* like it
 * works unless it can also change what the message says. `registerSlot` gives
 * it the button; this gives it the effect.
 *
 * The host calls `applySendTransforms` on the text it is about to submit —
 * after the built-in Build/Plan prefix, and never on a slash command, which
 * dispatches before this point. Transforms run in registration order, each
 * seeing the previous one's output.
 *
 * WHY THIS IS DELIBERATELY NARROW
 * A transform receives the message and returns a message. It does not get the
 * session, the socket, or the ability to cancel the send. A plugin that wants
 * to steer a turn should say so in the text the model reads, where the user
 * can see it in the transcript, rather than acting on the conversation
 * invisibly.
 *
 * A transform that throws, returns a non-string, or empties the message is
 * skipped and the previous text stands. A broken plugin must not be able to
 * swallow what someone typed.
 */

export type SendTransform = (text: string) => string;

interface TransformEntry {
  plugin: string;
  fn: SendTransform;
}

const _transforms: TransformEntry[] = [];

/**
 * Register (or replace) a plugin's transform. Re-registering the same plugin
 * replaces its entry in place rather than stacking a second copy — plugin
 * bundles re-run on HMR and on a dashboard reload.
 */
export function registerSendTransform(plugin: string, fn: SendTransform): void {
  if (!plugin || typeof fn !== "function") return;
  const at = _transforms.findIndex((t) => t.plugin === plugin);
  if (at === -1) _transforms.push({ plugin, fn });
  else _transforms[at] = { plugin, fn };
}

export function unregisterSendTransform(plugin: string): void {
  const at = _transforms.findIndex((t) => t.plugin === plugin);
  if (at !== -1) _transforms.splice(at, 1);
}

/** Registered plugin names, in the order their transforms run. */
export function getSendTransforms(): string[] {
  return _transforms.map((t) => t.plugin);
}

/** Apply every registered transform, skipping any that misbehaves. */
export function applySendTransforms(text: string): string {
  let out = text;
  for (const { plugin, fn } of _transforms) {
    try {
      const next = fn(out);
      if (typeof next === "string" && next.trim()) out = next;
      else if (typeof next !== "string") {
        console.warn(`[plugins] ${plugin} send transform returned a non-string; skipped`);
      }
    } catch (err) {
      console.warn(`[plugins] ${plugin} send transform threw; skipped`, err);
    }
  }
  return out;
}
