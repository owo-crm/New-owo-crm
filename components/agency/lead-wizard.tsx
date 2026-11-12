"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Card } from "@/components/app-shell/page";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Picker } from "@/components/ui/picker";
import { createAgencyLeadAction } from "@/lib/agency/actions";
import { parseMoneyField } from "@/lib/agency/schemas";
import { formatMoney } from "@/lib/finance/money";
import { t } from "@/lib/i18n";

/**
 * Пошаговая форма лида агентства. Шаги разведены намеренно: на первом — только то,
 * без чего лид бесполезен, остальное можно дозаполнить позже в карточке.
 */

type Member = { userId: string; name: string };
type Service = { id: string; name: string; system_key: "crm" | "ads" | null };

const STEPS = ["s1", "s2", "s3", "s4"] as const;

export function LeadWizard({ members, services }: { members: Member[]; services: Service[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();

  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [note, setNote] = useState("");

  const adsService = services.find((s) => s.system_key === "ads");
  const adsPicked = adsService ? picked.includes(adsService.id) : false;
  const canContinue = step !== 0 || (name.trim().length > 1 && (phone.trim() || email.trim()));
  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const submit = () =>
    start(async () => {
      setError(undefined);
      const result = await createAgencyLeadAction({
        name,
        contactName,
        phone,
        email,
        city,
        referredBy: referredBy || null,
        serviceIds: picked,
        monthlyBudgetGrosze: adsPicked && budget ? parseMoneyField(budget) : null,
        note,
      });
      if (result.id) {
        router.push(`/leady/${result.id}`);
        router.refresh();
      } else setError(result.error);
    });

  return (
    <Card>
      <div className="grid gap-5">
        <ol
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
          aria-label={t("agency.lead.summary")}
        >
          {STEPS.map((key, i) => (
            <li key={key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (i < step ? setStep(i) : null)}
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
                className={[
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                  i === step
                    ? "bg-accent text-on-accent"
                    : i < step
                      ? "text-ink-soft hover:bg-surface-2 cursor-pointer"
                      : "text-ink-faint",
                ].join(" ")}
              >
                {i < step ? <Check className="size-3.5" /> : null}
                {t(`agency.lead.${key}`)}
              </button>
              {i < STEPS.length - 1 ? <span className="text-ink-faint text-[12px]">·</span> : null}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("agency.lead.company")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sm:col-span-2"
              autoFocus
              required
            />
            <Field
              label={t("agency.lead.contactName")}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <Field
              label={t("agency.lead.city")}
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            <Field
              label={t("agency.lead.phone")}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Field
              label={t("agency.lead.email")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-2">
            <label className="text-ink-soft text-[13px] font-medium" htmlFor="referred-by">
              {t("agency.lead.referredBy")}
            </label>
            <Picker
              id="referred-by"
              value={referredBy}
              onChange={(e) => setReferredBy(e.target.value)}
              className="border-line-strong bg-surface h-10 rounded-lg border px-3 text-[14px] lg:h-9"
            >
              <option value="">{t("agency.lead.referredNobody")}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Picker>
            <p className="text-ink-faint text-[13px]">{t("agency.lead.referredHint")}</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-3">
            <p className="text-ink-soft text-[13px]">{t("agency.lead.servicesHint")}</p>
            {services.length === 0 ? (
              <p className="text-ink-faint text-[13.5px]">{t("agency.lead.servicesEmpty")}</p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {services.map((s) => (
                  <li key={s.id}>
                    <label className="hover:bg-surface-2 flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px]">
                      <input
                        type="checkbox"
                        checked={picked.includes(s.id)}
                        onChange={() => toggle(s.id)}
                        className="size-4"
                      />
                      {s.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-4">
            {adsPicked ? (
              <Field
                label={t("agency.lead.budget")}
                hint={t("agency.lead.budgetHint")}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            ) : null}
            <div className="grid gap-1.5">
              <label className="text-ink-soft text-[13px] font-medium" htmlFor="lead-note">
                {t("agency.lead.note")}
              </label>
              <textarea
                id="lead-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder={t("agency.lead.notePlaceholder")}
                className="border-line-strong bg-surface text-ink placeholder:text-ink-faint focus:border-ink min-h-24 rounded-lg border px-3 py-2 text-[14px] focus:outline-none"
              />
            </div>
            <dl className="border-line text-ink-soft grid gap-1 border-t pt-3 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt>{t("agency.lead.company")}</dt>
                <dd className="text-ink font-medium">{name || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{t("agency.lead.referredBy")}</dt>
                <dd className="text-ink font-medium">
                  {members.find((m) => m.userId === referredBy)?.name ??
                    t("agency.lead.referredNobody")}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{t("agency.lead.services")}</dt>
                <dd className="text-ink text-right font-medium">
                  {picked.length
                    ? services
                        .filter((s) => picked.includes(s.id))
                        .map((s) => s.name)
                        .join(", ")
                    : "—"}
                </dd>
              </div>
              {adsPicked && budget ? (
                <div className="flex justify-between gap-3">
                  <dt>{t("agency.lead.budget")}</dt>
                  <dd className="text-ink font-medium">{formatMoney(parseMoneyField(budget))}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-urgent text-[13.5px]">
            {error}
          </p>
        ) : null}

        <div className="border-line flex items-center justify-between gap-3 border-t pt-4">
          <span className="text-ink-faint text-[12.5px]">
            {t("agency.lead.step", { n: step + 1, all: STEPS.length })}
          </span>
          <span className="flex gap-2">
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={pending}>
                {t("agency.lead.back")}
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canContinue}>
                {t("agency.lead.next")}
              </Button>
            ) : (
              <Button onClick={submit} disabled={pending}>
                {t("agency.lead.create")}
              </Button>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}
