"""
Arma el ZIP para la Chrome Web Store y comprueba lo que suele hacer que
rechacen un paquete.

    python scripts/empaquetar.py

Deja store/followapp-<version>.zip listo para subir.
"""

import io
import json
import os
import re
import sys
import zipfile

# La consola de Windows va en cp1252 y revienta con acentos o flechas.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(RAIZ, "dist")
SALIDA = os.path.join(RAIZ, "store")

fallos: list[str] = []
avisos: list[str] = []


def error(m: str) -> None:
    fallos.append(m)
    print(f"  FALLO   {m}")


def aviso(m: str) -> None:
    avisos.append(m)
    print(f"  aviso   {m}")


def bien(m: str) -> None:
    print(f"  ok      {m}")


def comprobar() -> dict:
    print("Comprobaciones previas\n")

    ruta = os.path.join(DIST, "manifest.json")
    if not os.path.isfile(ruta):
        error("no hay dist/manifest.json — ejecuta npm run build")
        return {}

    m = json.load(io.open(ruta, encoding="utf-8"))

    # El manifest tiene que ir en la RAIZ del zip, no dentro de una carpeta.
    bien("manifest.json en la raíz")

    if m.get("manifest_version") != 3:
        error("manifest_version debe ser 3")
    else:
        bien("manifest v3")

    v = m.get("version", "")
    if not re.fullmatch(r"\d+(\.\d+){0,3}", v):
        error(f"versión inválida: {v!r}")
    else:
        bien(f"versión {v}")

    # Iconos: los cuatro tamaños, y que existan de verdad.
    for tam in ("16", "32", "48", "128"):
        rel = m.get("icons", {}).get(tam)
        if not rel:
            error(f"falta el icono de {tam}px en el manifest")
        elif not os.path.isfile(os.path.join(DIST, rel)):
            error(f"el manifest declara {rel} pero no está en dist/")
    if not fallos:
        bien("los cuatro iconos existen")

    # Si hay default_locale, su catálogo es obligatorio.
    loc = m.get("default_locale")
    if loc:
        cat = os.path.join(DIST, "_locales", loc, "messages.json")
        if not os.path.isfile(cat):
            error(f"default_locale es {loc!r} pero falta _locales/{loc}/messages.json")
        else:
            bien(f"catálogo de {loc} presente")

        # __MSG_x__ sin su clave en el catálogo rompe la ficha.
        claves = set(json.load(io.open(cat, encoding="utf-8")).keys())
        for campo in ("name", "description"):
            val = m.get(campo, "")
            mm = re.fullmatch(r"__MSG_(\w+)__", val)
            if mm and mm.group(1) not in claves:
                error(f"{campo} usa __MSG_{mm.group(1)}__ y no está en el catálogo")

    # Código remoto: motivo habitual de rechazo.
    for base, _, ficheros in os.walk(DIST):
        for f in ficheros:
            if not f.endswith((".js", ".html")):
                continue
            texto = io.open(os.path.join(base, f), encoding="utf-8", errors="ignore").read()
            for patron, que in (
                (r"<script[^>]+src=[\"']https?://", "script remoto"),
                (r"\beval\s*\(", "eval()"),
                (r"new\s+Function\s*\(", "new Function()"),
            ):
                if re.search(patron, texto):
                    error(f"{que} en {f} — la Web Store rechaza código remoto")
    bien("sin código remoto")

    mapas = [f for _, _, fs in os.walk(DIST) for f in fs if f.endswith(".map")]
    if mapas:
        aviso(f"{len(mapas)} source maps: se excluyen del zip para aligerarlo")

    return m


def empaquetar(m: dict) -> str:
    os.makedirs(SALIDA, exist_ok=True)
    destino = os.path.join(SALIDA, f"followapp-{m['version']}.zip")

    n = 0
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, _, ficheros in os.walk(DIST):
            for f in sorted(ficheros):
                if f.endswith(".map"):
                    continue
                completo = os.path.join(base, f)
                # Ruta relativa a dist/: el manifest queda en la raíz del zip.
                z.write(completo, os.path.relpath(completo, DIST).replace(os.sep, "/"))
                n += 1

    return destino, n


def main() -> int:
    m = comprobar()
    if fallos:
        print(f"\n{len(fallos)} fallo(s). No se empaqueta.")
        return 1

    destino, n = empaquetar(m)
    kb = os.path.getsize(destino) / 1024

    print(f"\n{n} archivos · {kb:.0f} KB")
    print(f"→ {os.path.relpath(destino, RAIZ)}")
    if avisos:
        print(f"\n{len(avisos)} aviso(s), ninguno bloqueante.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
