import { appConfig } from "@/lib/config";

/**
 * Вход: слева (на компьютере) — что CRM делает за владельца, в его же словах;
 * справа — форма. На телефоне только форма.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
      <aside className="border-line bg-surface relative hidden overflow-hidden border-r px-14 py-12 lg:flex lg:flex-col">
        <p className="font-display text-[20px] font-semibold">
          {appConfig.productName.toLowerCase()}
        </p>
        <div className="my-auto max-w-[34rem]">
          <h2 className="font-display text-[clamp(2.4rem,3.6vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.015em]">
            Zapytanie przychodzi.
            <br />
            Ty odpowiadasz pierwszy.
          </h2>
          <p className="text-ink-soft mt-5 max-w-[30rem] text-[17px] leading-relaxed">
            Formularz ze strony, Meta i Google w jednej kolejce. Oferta i umowa w kilku kliknięciach
            — także z telefonu, między jednym a drugim zleceniem.
          </p>
          <dl className="border-line mt-10 grid max-w-[30rem] grid-cols-3 gap-6 border-t pt-6">
            {[
              ["Kolejka", "kto czeka najdłużej"],
              ["Kalendarz", "zajęte terminy"],
              ["Dokumenty", "oferta i umowa"],
            ].map(([term, desc]) => (
              <div key={term}>
                <dt className="text-sm font-bold">{term}</dt>
                <dd className="text-ink-soft mt-1 text-[13px]">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[22rem]">{children}</div>
      </main>
    </div>
  );
}
