import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/paths";

// Next.js 16: бывший middleware.ts. Быстрая проверка наличия cookie сессии;
// настоящая проверка (сессия в базе) — в requireUser() на каждой закрытой странице.
const SESSION_COOKIE = "owo_session";

export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;

  if (!hasSession && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/logowanie";
    loginUrl.search = "";
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }
  // С экрана входа вошедшего уводит сама страница, проверив сессию в базе.
  // Здесь этого делать нельзя: cookie может остаться от удалённой сессии,
  // и тогда /logowanie → /dzisiaj → requireUser() → /logowanie зацикливается.
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Всё, кроме статики, картинок и файлов из public/.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
