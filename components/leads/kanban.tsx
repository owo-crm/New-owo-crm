"use client";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { editLead, undoLead } from "@/lib/leads/actions";
import type { Lead, PipelineStage } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { eventDateLabel } from "./lead-list";
function Ticket({
  lead,
  stages,
  pending,
  move,
}: {
  lead: Lead;
  stages: PipelineStage[];
  pending: boolean;
  move: (lead: Lead, stage: string) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: lead.id,
    disabled: pending,
  });
  return (
    <article
      ref={setNodeRef}
      className={cn(
        "ticket-edge bg-surface-2 rounded-t-[14px] px-4 pt-3 pb-6",
        isDragging && "opacity-30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-soft text-xs">#{lead.number}</p>
        <button
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          aria-label={t("leads.dragLead", { name: lead.client_name })}
          className="text-ink-soft hover:bg-line flex size-11 touch-none items-center justify-center rounded-lg"
          disabled={pending}
        >
          <GripVertical className="size-5" />
        </button>
      </div>
      <Link
        href={`/leady/${lead.id}`}
        className="block min-h-11 text-lg font-semibold break-words hover:underline"
      >
        {lead.client_name}
      </Link>
      <p className="text-ink-soft mt-1 text-sm">
        {eventDateLabel(lead.event_date)} · {lead.event_city}
      </p>
      <div className="mt-4">
        <Select
          label={t("leads.moveStage")}
          value={lead.stage_key}
          disabled={pending}
          onChange={(event) => move(lead, event.target.value)}
        >
          {stages.map((stage) => (
            <option key={stage.key} value={stage.key}>
              {stage.label_pl}
            </option>
          ))}
        </Select>
      </div>
    </article>
  );
}
function Column({
  stage,
  children,
  count,
}: {
  stage: PipelineStage;
  children: React.ReactNode;
  count: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  return (
    <section
      ref={setNodeRef}
      data-testid={`stage-${stage.key}`}
      className={cn(
        "border-line bg-surface min-h-[240px] w-[280px] shrink-0 rounded-xl border p-3",
        isOver && "border-ink-soft",
      )}
    >
      <h2 className="mb-4 flex items-center justify-between gap-2 px-1 text-sm font-semibold">
        <span>{stage.label_pl}</span>
        <span className="text-ink-soft">{count}</span>
      </h2>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}
export function Kanban({
  leads,
  stages,
  total,
}: {
  leads: Lead[];
  stages: PipelineStage[];
  total: number;
}) {
  const [current, optimistic] = useOptimistic(
    leads,
    (items: Lead[], patch: { id: string; stage: string }) =>
      items.map((lead) => (lead.id === patch.id ? { ...lead, stage_key: patch.stage } : lead)),
  );
  const [active, setActive] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [undo, setUndo] = useState<{ id: string; eventId: string }>();
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(undefined), 8000);
    return () => clearTimeout(timer);
  }, [undo]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  function move(lead: Lead, stage: string) {
    if (lead.stage_key === stage || pending) return;
    setError(undefined);
    startTransition(async () => {
      optimistic({ id: lead.id, stage });
      const result = await editLead(lead.id, lead.updated_at, "stage_key", stage);
      if (result.error) setError(result.error);
      else if (result.eventId) setUndo({ id: lead.id, eventId: result.eventId });
    });
  }
  return (
    <>
      <p className="text-ink-soft mb-4 text-sm">
        {t("leads.boardHint", { shown: leads.length, total })}
      </p>
      {error ? (
        <p role="alert" className="text-urgent mb-4">
          {error}
        </p>
      ) : null}
      {undo ? (
        <div
          role="status"
          className="bg-surface-2 mb-4 flex items-center justify-between gap-3 rounded-[14px] px-4 py-2"
        >
          <span>{t("leads.saved")}</span>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await undoLead(undo.id, undo.eventId);
                setUndo(undefined);
                if (result.error) setError(result.error);
              })
            }
          >
            {t("leads.undo")}
          </Button>
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        accessibility={{
          screenReaderInstructions: { draggable: t("leads.dragInstructions") },
          announcements: {
            onDragStart: () => t("leads.dragStarted"),
            onDragOver: () => undefined,
            onDragEnd: () => t("leads.dragEnded"),
            onDragCancel: () => t("leads.dragCancelled"),
          },
        }}
        onDragStart={(event) => setActive(String(event.active.id))}
        onDragCancel={() => setActive(null)}
        onDragEnd={(event) => {
          setActive(null);
          const lead = current.find((l) => l.id === event.active.id);
          const stage = stages.find((s) => s.key === event.over?.id);
          if (lead && stage) move(lead, stage.key);
        }}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <Column
              key={stage.key}
              stage={stage}
              count={current.filter((l) => l.stage_key === stage.key).length}
            >
              {current
                .filter((l) => l.stage_key === stage.key)
                .map((lead) => (
                  <Ticket key={lead.id} lead={lead} stages={stages} pending={pending} move={move} />
                ))}
            </Column>
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <div className="border-line-strong bg-surface-2 w-[254px] rounded-[14px] border p-5 font-semibold">
              {current.find((l) => l.id === active)?.client_name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {error ? (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t("leads.refresh")}
        </Button>
      ) : null}
    </>
  );
}
