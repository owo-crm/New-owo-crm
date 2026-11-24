// Dane TESTOWE — używane tylko poza produkcją (SITE_ENV != production), oznaczone „dane testowe”
// i wyłączone z indeksowania. Służą do sprawdzenia wyglądu katalogu przed otrzymaniem prawdziwych ofert.
export const fixtures = [
  {
    id: "demo-1", demo: true, slug: "demo-gdansk-wrzeszcz-3-pokoje", title: "Mieszkanie 3-pokojowe (przykład)",
    city: "Gdańsk", district: "Wrzeszcz", price: null, currency: "PLN", area: 58, rooms: 3, type: "mieszkanie",
    description: "Przykładowa karta oferty do testów układu strony. Nie jest to prawdziwa nieruchomość.",
    features: [["Balkon", "tak"]], images: [{ src: "/img/salon-drewno.webp", alt: "Zdjęcie przykładowe" }],
    status: "active", published: "2026-11-24", updated: "2026-11-24",
  },
];
