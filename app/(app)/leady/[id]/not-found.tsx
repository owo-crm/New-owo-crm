import Link from "next/link";
import { t } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
export default function LeadNotFound() {
  return (
    <section>
      <h1 className="text-3xl">{t("leads.notFound")}</h1>
      <Link href="/leady" className={buttonVariants({ variant: "secondary", className: "mt-5" })}>
        {t("leads.back")}
      </Link>
    </section>
  );
}
