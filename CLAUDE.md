# Glow para Promiedos — notas del proyecto

Extensión de Chrome (Manifest V3, sin build) que mejora promiedos.com.ar: tema oscuro, barra superior con la liga y "mis clubes", panel lateral "Mi equipo" (stats, noticias, redes oficiales), diseño adaptable, interruptores por mejora y preferencias sincronizadas con la cuenta de Google. **No oficial**; versión actual en `manifest.json`.

## Estructura
- `manifest.json` — nombre "Glow para Promiedos", `minimum_chrome_version: 120` (el CSS usa anidamiento), permisos mínimos: `storage` + host `news.google.com`.
- `layout.js` (document_start) — detecta pantalla/ventana y publica `html[data-pg-*]`; aplica `data-pg-off` antes del primer pintado.
- `content.css` — cada mejora está dentro de `html:not([data-pg-off~="<mejora>"]) { ... }` (anidamiento CSS). Selectores con `[class*=]` porque el sitio usa CSS-modules con hashes que cambian.
- `content.js` — widget en Shadow DOM: barra superior, panel, ajustes (⚙), resaltado, noticias, redes, minimizar menú izquierdo.
- `background.js` — service worker: RSS de Google Noticias (`pg-news`) y `socials.json` (`pg-socials`).
- `socials.json` — redes oficiales verificadas en el sitio de cada club (clave = id de equipo de Promiedos). No agregar cuentas sin verificarlas en el sitio oficial.
- `store/` — ficha (`LISTING.md`), política (`PRIVACY.md`, `privacy.html`), capturas y tile. `dist/` — zip para la tienda. `tools/` — pruebas.

## Próximo partido, en vivo e historial (0.7.0)
- `content.js` pide la página del equipo (`/team/<slug>/<id>`, mismo origen) para el próximo partido, la cuenta regresiva y los últimos resultados; el chip `.mpill` va en la barra de ligas y flota en el resto de las páginas. Funciona sin datos de liga (home, equipo, partido).
- El sitio es una SPA: un vigía de URL (`onRoute`) vuelve a pedir los datos al cambiar de página, porque `__NEXT_DATA__` queda viejo.
- "Solo en vivo": marca con `.pg-nolive` las filas sin `[class*="time_live"]` y oculta los bloques vacíos.
- Historial: en `/game/<slug>/<id>` los datos `head_to_head`, `recent_form` y `game_info` siguen en `initialData.game`. Forma: 1 = V, 2 = E, 0 = D (más reciente primero). Horarios en hora argentina (UTC-3).
- Pruebas nuevas en `tools/cdp.mjs`: `home`, `game`, `route`, `calendar`, `calfilter`, `ultrawide`.
- Calendario (`/calendario`, 0.8.0): barra de filtros en el Shadow DOM (solo mis equipos, liga, cumpleaños). Agrupa por `[class*="label_block"]` (la liga) y su contenedor; los partidos propios se reconocen por el slug del enlace (`a-vs-b`) contra `url_name` de mis clubes. Se ocultan con `.pg-calhide`; los filtros se guardan en `pgCal` (local).

## Datos
Promiedos es Next.js: los datos salen del `<script id="__NEXT_DATA__">` de cada página. Páginas de liga: `/league/<slug>/<id>` (tablas) y `/league/<slug>/<id>/equipos` (equipos y estadísticas, sin tablas).

## Almacenamiento
Sincronizado (chrome.storage.sync, con interruptor `pgSyncOn`): `pgFavTeam`, `pgLeagueFavs`, `pgLeagueDismissed`, `pgFeatures`. Local: `pgFocus`, `pgDockOpen`, `pgLeftCollapsed`, `pgSyncOn`.

## Cómo probar (no hay tests automáticos)
- `node tools/cdp.mjs <carpetaExtension> <carpetaSalida> smoke seeded settings equipos leftmenu prompt coffee` — abre Edge sin pantalla con la extensión real cargada sobre el sitio en vivo, siembra el almacenamiento desde el mundo aislado y guarda capturas 1280×800. Ruta de Edge fija dentro del script.
- `node tools/harness.mjs <carpetaExtension>` — copia local de las páginas con la extensión inyectada (sin hidratar: no hay filas de tabla).
- Chrome 137+ de marca ya no acepta `--load-extension`; por eso se usa Edge.

## Convenciones
- Artefactos (código, comentarios, commits) en inglés; textos de interfaz en español neutro/rioplatense.
- Commits convencionales. Sin "Co-Authored-By" ni atribución de IA.
- Sin publicidad inyectada en el sitio ajeno (política de la Chrome Web Store). Donaciones: alias de Mercado Pago en `DONATE` de `content.js`.

## Pendiente
1. ~~Correo de contacto~~ — hecho (matiaspignani@gmail.com).
2. Política publicada en https://matiaspignani.github.io/glow-para-promiedos/ (desde `docs/index.html`, copia de `store/privacy.html`; mantenerlas iguales). Falta pegarla en la pestaña Privacidad de la Chrome Web Store.
3. Primera versión ya publicada a mano. Las siguientes salen con `git tag vX.Y.Z` + `git push --tags` (ver `RELEASING.md`; workflow `.github/workflows/release.yml`, script `tools/cws-publish.mjs`). Falta que el usuario cargue los secretos `CWS_SERVICE_ACCOUNT_JSON`, `CWS_PUBLISHER_ID` y `CWS_EXTENSION_ID` y autorice la cuenta de servicio en el Developer Dashboard; probar antes con el dry run (workflow_dispatch).
4. La cuenta de desarrollador ya declaró su condición de comerciante/no comerciante; si se agrega cobro (versión Pro), revisarla antes de cobrar.
