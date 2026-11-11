import type { MessageKey } from "@/lib/i18n";

/**
 * Отраслевые пресеты: набор настроек под тип бизнеса (этапы воронки, позже — поля,
 * шаблоны оферт и договоров). Новый сегмент = новый пресет, а не новый код.
 * Подробно: docs/00-product.md.
 */
export type StageKind = "open" | "won" | "lost";

export type PipelineStagePreset = {
  key: string;
  labelPl: string;
  kind: StageKind;
};

export type IndustryPreset = {
  key: string;
  labelKey: MessageKey;
  stages: PipelineStagePreset[];
};

export const PRESETS = {
  "event-services": {
    key: "event-services",
    labelKey: "presets.event-services",
    stages: [
      { key: "new", labelPl: "Nowy", kind: "open" },
      { key: "contacted", labelPl: "Skontaktowano", kind: "open" },
      { key: "offer_sent", labelPl: "Oferta wysłana", kind: "open" },
      { key: "offer_accepted", labelPl: "Oferta zaakceptowana", kind: "open" },
      { key: "contract_sent", labelPl: "Umowa wysłana", kind: "open" },
      { key: "deposit_paid", labelPl: "Zadatek wpłacony", kind: "won" },
      { key: "rejected", labelPl: "Odrzucony", kind: "lost" },
      { key: "spam", labelPl: "Spam", kind: "lost" },
    ],
  },
  // Кабинет самого агентства OWO Ads: лиды с лендинга + экраны /agencja (решение 021).
  agency: {
    key: "agency",
    labelKey: "presets.agency",
    stages: [
      { key: "new", labelPl: "Nowy", kind: "open" },
      { key: "contacted", labelPl: "Kontakt", kind: "open" },
      { key: "meeting", labelPl: "Spotkanie", kind: "open" },
      { key: "offer_sent", labelPl: "Oferta", kind: "open" },
      { key: "client", labelPl: "Klient", kind: "won" },
      { key: "rejected", labelPl: "Odrzucony", kind: "lost" },
      { key: "spam", labelPl: "Spam", kind: "lost" },
    ],
  },
} as const satisfies Record<string, IndustryPreset>;

export type PresetKey = keyof typeof PRESETS;

export const PRESET_KEYS = Object.keys(PRESETS) as [PresetKey, ...PresetKey[]];

export function isPresetKey(value: string): value is PresetKey {
  return value in PRESETS;
}

/** Экраны /agencja видны только в организации с этим пресетом. */
export function isAgency(preset: string) {
  return preset === "agency";
}
