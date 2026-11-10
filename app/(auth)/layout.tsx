import { LeadTicket } from "@/components/leads/lead-ticket";
import { appConfig } from "@/lib/config";

/**
 * Экраны входа: слева (на компьютере) — обещание продукта и пример «бона» нового лида,
 * справа — форма. На телефоне только форма.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="border-line bg-surface relative hidden overflow-hidden border-r px-12 py-12 lg:flex lg:flex-col">
        <p className="font-display text-[22px] font-semibold">
          {appConfig.productName.toLowerCase()}
        </p>

        <div className="mt-auto max-w-[32rem]">
          <h2 className="font-display text-[clamp(2.6rem,4vw,3.75rem)] leading-[1] font-semibold tracking-[-0.01em]">
            Zapytanie przychodzi. Ty odpowiadasz pierwszy.
          </h2>
          <p className="text-ink-soft mt-5 max-w-[27rem] text-[17px] leading-relaxed">
            Powiadomienie w kilka sekund, oferta i umowa w trzech kliknięciach. Także z telefonu, w
            przerwie między eventami.
          </p>
        </div>

        {/* Пример, как выглядит новый лид. Декорация — скрыта от скринридеров. */}
        <div className="mt-12 flex gap-4" aria-hidden>
          <LeadTicket
            className="w-[272px] shrink-0"
            waitingMinutes={2}
            source="Meta Ads"
            name="Anna i Michał"
            details="Wesele · 120 gości · Gdańsk"
            eventDate="sob 14.06.2027"
            dateStatus="free"
            actions={
              <>
                <span className="bg-ink text-bg flex-1 rounded-[10px] py-2.5 text-center text-sm font-bold">
                  Oferta
                </span>
                <span className="border-line-strong flex-1 rounded-[10px] border-[1.5px] py-2.5 text-center text-sm font-bold">
                  Zadzwoń
                </span>
              </>
            }
          />
          <LeadTicket
            className="w-[272px] shrink-0 opacity-60"
            waitingMinutes={14}
            source="Strona"
            name="Kasia Zielińska"
            details="18. urodziny · 60 gości · Gdynia"
            eventDate="sob 20.03.2027"
            dateStatus="busy"
          />
        </div>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10 lg:px-16">
        <p className="font-display text-xl font-semibold lg:hidden">
          {appConfig.productName.toLowerCase()}
        </p>
        <div className="my-auto w-full max-w-[25rem] py-10 lg:mx-auto">{children}</div>
      </main>
    </div>
  );
}
