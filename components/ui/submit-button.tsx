"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/** Кнопка отправки формы: во время отправки блокируется и показывает «Chwileczkę…». */
export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} aria-disabled={pending} {...props}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          {t("common.loading")}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
