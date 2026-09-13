"""
Compone las capturas 1280x800 de la Chrome Web Store.

Uso:
    1. Captura el popup a pantalla completa (Win+Shift+S) y guarda los PNG en
       store/crudas/ con los nombres que aparecen en TARJETAS.
    2. python store/montar-capturas.py
    3. Los resultados quedan en store/capturas/.

Requiere Pillow.
"""

import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 800
GROUND = (14, 22, 28)
INK = (232, 239, 243)
MUTED = (125, 145, 157)
ACCENT = (79, 199, 209)

AQUI = os.path.dirname(os.path.abspath(__file__))
CRUDAS = os.path.join(AQUI, "crudas")
SALIDA = os.path.join(AQUI, "capturas")

# (fichero de entrada, titular, apoyo)
TARJETAS = [
    ("actividad.png", "Sabes quién se fue", "Con su nombre, su foto y cuándo pasó."),
    ("nosiguen.png", "Y quién no te corresponde", "Las cuentas que sigues y no te siguen."),
    ("revisando.png", "Trabaja sola", "Revisa en segundo plano cada pocas horas."),
    ("bienvenida.png", "Empieza con un clic", "Nada que configurar: usa la sesión que ya tienes."),
    ("ingles.png", "English and Spanish", "Switch languages whenever you like."),
]


def fuente(tam, negrita=False):
    """Segoe UI en Windows; si no está, la de Pillow, que al menos no revienta."""
    for nombre in (("segoeuib.ttf", "segoeui.ttf") if negrita else ("segoeui.ttf",)):
        try:
            return ImageFont.truetype(nombre, tam)
        except OSError:
            continue
    return ImageFont.load_default(tam)


def sombra(img, radio=26, opacidad=90):
    """Sombra suave bajo el popup, para que no flote sobre el fondo plano."""
    from PIL import ImageFilter

    capa = Image.new("RGBA", (img.width + radio * 4, img.height + radio * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(capa)
    d.rounded_rectangle(
        [radio * 2, radio * 2 + 8, radio * 2 + img.width, radio * 2 + img.height + 8],
        radius=14,
        fill=(0, 0, 0, opacidad),
    )
    return capa.filter(ImageFilter.GaussianBlur(radio))


def componer(ruta, titular, apoyo, destino):
    lienzo = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(lienzo)

    # Halo del color de marca detrás del popup.
    aura = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(aura).ellipse([W * 0.42, -H * 0.25, W * 1.15, H * 0.95], fill=(79, 199, 209, 26))
    from PIL import ImageFilter

    lienzo.paste(Image.alpha_composite(lienzo.convert("RGBA"), aura.filter(ImageFilter.GaussianBlur(90))).convert("RGB"))

    d = ImageDraw.Draw(lienzo)
    d.text((92, 268), titular, font=fuente(52, True), fill=INK)
    d.text((92, 344), apoyo, font=fuente(24), fill=MUTED)
    d.line([(92, 236), (152, 236)], fill=ACCENT, width=4)

    popup = Image.open(ruta).convert("RGBA")

    # Encajar en una caja, no escalar solo por altura: un popup corto se volvia
    # desproporcionadamente ancho y se salia del lienzo por la derecha.
    caja_w, caja_h = int(W * 0.40), int(H * 0.84)
    escala = min(caja_w / popup.width, caja_h / popup.height)
    popup = popup.resize((round(popup.width * escala), round(popup.height * escala)), Image.LANCZOS)

    x = W - popup.width - 96
    y = (H - popup.height) // 2
    s = sombra(popup)
    lienzo.paste(s, (x - s.width // 2 + popup.width // 2, y - s.height // 2 + popup.height // 2), s)
    lienzo.paste(popup, (x, y), popup)

    lienzo.save(destino, quality=95)
    print(f"  {os.path.basename(destino)}")


def main():
    os.makedirs(SALIDA, exist_ok=True)
    if not os.path.isdir(CRUDAS):
        os.makedirs(CRUDAS)
        print(f"Creada {CRUDAS}. Pon ahí las capturas del popup:")
        for n, _, _ in TARJETAS:
            print(f"  - {n}")
        return

    hechas = 0
    for i, (fichero, titular, apoyo) in enumerate(TARJETAS, 1):
        origen = os.path.join(CRUDAS, fichero)
        if not os.path.isfile(origen):
            print(f"  (falta {fichero}, se salta)")
            continue
        componer(origen, titular, apoyo, os.path.join(SALIDA, f"{i}-{fichero}"))
        hechas += 1

    print(f"\n{hechas} capturas listas en store/capturas/")


if __name__ == "__main__":
    main()
