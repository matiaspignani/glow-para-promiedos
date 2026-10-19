# Chrome Web Store — ficha lista para copiar

> Chrome Web Store es donde se publican las extensiones de Chrome. El "App Store" de Apple es otra cosa (ver al final).

## Datos generales

| Campo | Valor |
|---|---|
| Nombre | Glow para Promiedos |
| Resumen (≤132) | Mejoras no oficiales para Promiedos: tema oscuro, tus clubes en la barra, estadísticas, noticias y sin publicidad. |
| Idioma | Español |
| Categoría sugerida | Entretenimiento / Diversión (elegí la que ofrezca el panel; no hay una de deportes específica) |
| Política de privacidad | URL pública de `PRIVACY.md` (ver "Antes de enviar") |
| Icono | `icons/icon128.png` |
| Captura(s) 1280×800 | `store/screenshots/01…04` |
| Tile promocional chico 440×280 | `store/assets/promo-440x280.png` |

## Descripción detallada

Glow para Promiedos es una extensión **no oficial** que rediseña la experiencia de promiedos.com.ar y la pone alrededor de tus clubes.

• Tema oscuro con tablas, tarjetas y escudos más legibles.
• Barra superior con la liga y los escudos de todos tus clubes (el activo en color, el resto en gris).
• Panel "Mi equipo": posición, puntos, goles, efectividad, líderes de la tabla, tus jugadores en los rankings, noticias de la semana y redes oficiales del club.
• Elegí un club distinto para cada liga: la extensión te lo pregunta y lo recuerda.
• Pestaña "Equipos y estadísticas" con tarjetas y escudos más grandes.
• Oculta los banners publicitarios del sitio.
• Se adapta a tu pantalla: tablas en columnas, partidos siempre a la vista y menú izquierdo minimizable.
• Bienvenida guiada la primera vez: elegís tu club de hincha y, si querés, un simpatizante.
• Cada mejora se prende y se apaga con un interruptor (⚙).
• Tus preferencias se guardan en tu cuenta de Google (sincronización de Chrome), si querés.
• Un botón opcional "Invitame un café" en los ajustes, con un alias de Mercado Pago para copiar, para quien quiera apoyar el desarrollo. No hay publicidad ni funciones pagas.

No recopilamos datos personales. Las noticias se piden a Google Noticias con el nombre del club que elegiste.

Glow para Promiedos no está afiliada, patrocinada ni respaldada por Promiedos ni por ningún club. Los nombres y escudos pertenecen a sus dueños.

## Pestaña "Privacy practices"

- **Propósito único:** Mejorar la visualización y el uso de Promiedos (promiedos.com.ar) alrededor de los clubes que sigue el usuario.
- **Justificación de `storage`:** Guardar las preferencias del usuario (clubes elegidos y mejoras activadas), localmente y, si el usuario lo permite, sincronizadas con su cuenta de Google mediante `chrome.storage.sync`.
- **Justificación del permiso de host `https://news.google.com/*`:** Mostrar noticias recientes del club elegido leyendo el feed RSS público de Google Noticias desde el service worker.
- **Justificación de la ejecución en `https://*.promiedos.com.ar/*`:** Aplicar estilos y agregar la barra superior y el panel sobre el sitio, que es el único propósito de la extensión.
- **¿Usa código remoto?** No. Todo el código está dentro del paquete; solo se descargan datos (RSS) que se muestran como texto.
- **Uso de datos:** la extensión no recopila ni vende datos y no usa analíticas. Lee las páginas de Promiedos localmente. Envía a Google Noticias el nombre del club elegido para traer noticias. Revisá las casillas con ese criterio y respondé de forma coherente con la política de privacidad.
- **Trader / no trader (UE):** lo declarás vos, según si ofrecés la extensión con fines comerciales.

## Instrucciones de prueba para el revisor

1. Abrí https://www.promiedos.com.ar/league/liga-profesional/hc
2. En el panel de la derecha elegí un equipo con el buscador.
3. Tocá ⚙ en la barra superior para ver los interruptores y probar apagar mejoras.
4. Abrí "Equipos y estadísticas" para ver las tarjetas rediseñadas.

## Antes de enviar (lo que hace falta de tu lado)

- [ ] Cuenta de desarrollador de Chrome Web Store: pago único (USD 5 al momento de escribir esto; confirmalo en el panel) y verificación en dos pasos activada en la cuenta de Google. El correo del desarrollador no se puede cambiar después.
- [ ] Declarar si sos "trader" o "no trader" (obligatorio por la ley de servicios digitales de la UE).
- [ ] Poner la política de privacidad en una URL pública (GitHub Pages, Google Sites, Notion público) y reemplazar `[tu-correo@ejemplo.com]`.
- [ ] Subir `dist/glow-para-promiedos-0.6.0.zip`.
- [ ] Subir icono, captura(s) y tile de `store/`.
- [ ] Completar "Privacy practices" con el texto de arriba.

## Riesgos que conviene conocer

- **Marca:** el nombre usa "para Promiedos" y la ficha aclara que es no oficial, para no sugerir afiliación (política de Impersonation / IP). Aun así, Promiedos podría pedir la baja; no hay forma de descartarlo.
- **Escudos y datos:** los escudos se cargan desde el servidor de Promiedos y los datos salen de sus páginas. Revisá sus términos de uso si pensás distribuir ampliamente.
- **Ocultar publicidad:** una extensión puede ocultar anuncios, pero **no** debe meter los suyos sobre el sitio ajeno (ver informe de publicidad).
- **Una sola finalidad:** todas las funciones giran alrededor de Promiedos; si agregás funciones ajenas, Google puede rechazarla.

## Apple App Store

El App Store es solo para Safari. Para llevar esta extensión hay que convertirla a una extensión web de Safari con `xcrun safari-web-extension-converter` (requiere una Mac con Xcode), una cuenta Apple Developer (USD 99 por año) y pasar la revisión de Apple. No se puede hacer desde Windows. Diferencias a revisar: `chrome.storage.sync` no se sincroniza igual en Safari, y la sintaxis CSS anidada pide Safari 17.2 o más nuevo.
