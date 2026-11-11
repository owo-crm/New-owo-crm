import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ClientStatus, OrderStatus } from "@/lib/agency/schemas";

/** Название месяца: «listopad 2026». */
export function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${t(`agency.months.${m}` as MessageKey)} ${y}`;
}

const CLIENT_TONE: Record<ClientStatus, string> = {
  active: "text-ok",
  lead: "text-ink",
  paused: "text-hold",
  lost: "text-ink-faint",
};
const ORDER_TONE: Record<OrderStatus, string> = {
  draft: "text-ink-soft",
  invoiced: "text-hold",
  paid: "text-ok",
  cancelled: "text-ink-faint line-through",
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return (
    <span className={cn("text-[13px] font-semibold", CLIENT_TONE[status])}>
      {t(`agency.status.${status}` as MessageKey)}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cn("text-[13px] font-semibold", ORDER_TONE[status])}>
      {t(`agency.orderStatus.${status}` as MessageKey)}
    </span>
  );
}
