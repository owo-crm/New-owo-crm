import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Сообщение под формой: ошибка или успех. role=alert — скринридер прочитает сразу. */
export function Notice({
  tone,
  children,
  className,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-sm",
        tone === "error"
          ? "border-urgent/30 bg-urgent/5 text-ink"
          : "border-ok/30 bg-ok/5 text-ink",
        className,
      )}
    >
      <Icon
        className={cn("mt-px size-[18px] shrink-0", tone === "error" ? "text-urgent" : "text-ok")}
      />
      <div>{children}</div>
    </div>
  );
}
