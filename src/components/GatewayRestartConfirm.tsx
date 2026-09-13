/**
 * The confirmation for restarting the gateway, in one place.
 *
 * Restarting drops connected channels and interrupts active sessions, so the
 * wording matters — and there are now two entry points (the labelled action in
 * the sidebar's system block, and the icon in the account menu's header). Two
 * copies of that sentence is how one of them ends up understating what the
 * button does.
 *
 * The caller owns the `open` boolean and calls `runAction("restart")` itself;
 * this component owns only the copy and the labels.
 */

import { ConfirmDialog } from "@nous-research/ui/ui/components/confirm-dialog";
import { useI18n } from "@/i18n";

interface GatewayRestartConfirmProps {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}

export function GatewayRestartConfirm({
  loading,
  onCancel,
  onConfirm,
  open,
}: GatewayRestartConfirmProps) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      cancelLabel={t.common.cancel}
      confirmLabel={t.status.restartGateway}
      description={
        t.status.restartGatewayConfirmMessage ??
        "This restarts the Hermes gateway process. Connected channels and active sessions will reconnect afterward."
      }
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      open={open}
      title={t.status.restartGatewayConfirmTitle ?? `${t.status.restartGateway}?`}
    />
  );
}
