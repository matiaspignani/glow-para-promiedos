# Cómo publicar una versión

La publicación en la Chrome Web Store es automática al subir un tag `vX.Y.Z` (workflow `.github/workflows/release.yml`).

## Publicar

1. Subí `version` en `manifest.json` (tiene que ser mayor que la ya publicada).
2. Commit: `git commit -am "chore: bump version to X.Y.Z"` y `git push`.
3. Tag y push del tag (esto **publica de verdad**):

   ```bash
   git tag vX.Y.Z
   git push --tags
   ```

El workflow verifica que el tag sea `v` + la versión de `manifest.json`, arma `dist/glow-para-promiedos-X.Y.Z.zip`, lo sube a la tienda, lo envía a revisión y crea el GitHub Release con el zip adjunto. La revisión de Google puede tardar horas o días.

## Probar sin publicar (dry run)

En GitHub: **Actions → Release → Run workflow**, con `dry_run` en `true` (es el valor por defecto). Arma y valida el zip, pero no sube nada ni crea el release.

## Secretos necesarios

Cargarlos en **Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Qué es |
|---|---|
| `CWS_SERVICE_ACCOUNT_JSON` | Clave JSON de la cuenta de servicio (contenido completo del archivo) |
| `CWS_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings |
| `CWS_EXTENSION_ID` | ID de la extensión (en la URL de su ficha) |

Alta de la cuenta de servicio: en Google Cloud habilitar "Chrome Web Store API", crear la cuenta de servicio (sin roles) y una clave JSON; después, en el Developer Dashboard → Account, agregar el correo de la cuenta de servicio (solo se admite una por publisher).

## Notas

- Solo el paso de publicación recibe los secretos, y `tools/cws-publish.mjs` nunca imprime tokens ni la clave.
- El script se puede correr a mano con las tres variables de entorno: `node tools/cws-publish.mjs dist/glow-para-promiedos-X.Y.Z.zip`.
- Si algo falla después de subir el zip, la tienda conserva el borrador: corregí y subí una versión mayor.
