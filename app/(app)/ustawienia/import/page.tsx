import { Card, PageHeader } from "@/components/app-shell/page";
import { ImportForm } from "@/components/team/forms";

export default function ImportPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Import leadów"
        subtitle="Wgraj arkusz „Lidy” z bota (Google Sheets → Plik → Pobierz → CSV). Najpierw sprawdź plik, potem importuj. Ponowny import nie tworzy duplikatów i nie wysyła powiadomień."
      />
      <Card>
        <ImportForm />
      </Card>
    </div>
  );
}
