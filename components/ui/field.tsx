import { useId } from "react";
import { cn } from "@/lib/utils";

const inputClass =
  "h-10 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-soft focus:border-ink focus:outline-none aria-invalid:border-urgent";

type FieldProps = React.ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
};

/** Поле формы: подпись + ввод + подсказка/ошибка. Ошибка связана с полем для скринридеров. */
export function Field({ label, hint, error, className, id, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={inputId} className="text-ink text-sm font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-urgent text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-ink-soft text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type CheckboxProps = React.ComponentProps<"input"> & { label: React.ReactNode; error?: string };

export function Checkbox({ label, error, id, ...props }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={inputId}
        className="text-ink-soft flex cursor-pointer items-start gap-3 text-sm"
      >
        <input
          id={inputId}
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--urgent)]"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={`${inputId}-error`} className="text-urgent text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type SelectProps = React.ComponentProps<"select"> & { label: string; error?: string };

export function Select({ label, error, id, children, ...props }: SelectProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className="text-ink text-sm font-semibold">
        {label}
      </label>
      <select id={inputId} className={cn(inputClass, "appearance-auto")} {...props}>
        {children}
      </select>
      {error ? <p className="text-urgent text-sm">{error}</p> : null}
    </div>
  );
}
