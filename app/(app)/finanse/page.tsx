import { redirect } from "next/navigation";

/** Старый адрес: финансы теперь в «Statystyka» (решение 024). */
export default async function FinanceRedirect({ searchParams }: PageProps<"/finanse">) {
  const m = (await searchParams).m;
  redirect(typeof m === "string" ? `/statystyka?m=${encodeURIComponent(m)}` : "/statystyka");
}
