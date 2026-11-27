"""Ponte entre o Auris PDF (Tauri) e os motores PyMuPDF.

Uso:
  auris-compress <entrada.pdf> <saida.pdf> <leve|media|forte> <cinza 0|1>
  auris-compress ocr <entrada.pdf> <saida.pdf> <pasta-tessdata> [forcar 0|1]
  auris-compress word <entrada.pdf> <saida.docx> [pasta-tessdata]

Durante o trabalho imprime linhas "PROGRESSO <feitas> <total>".
No fim imprime uma linha JSON com o resultado, ou {"erro": "..."} com código de saída 1.
"""
import json
import sys

NIVEL = {"leve": "Leve", "media": "Média", "forte": "Forte"}


def progresso(feitas: int, total: int):
    print(f"PROGRESSO {feitas} {total}", flush=True)


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        args = sys.argv[1:]
        if args and args[0] == "word":
            entrada, saida = args[1:3]
            tessdata = args[3] if len(args) > 3 and args[3] else None
            from word import para_word
            r = para_word(entrada, saida, tessdata, progresso=progresso)
        elif args and args[0] == "ocr":
            entrada, saida, tessdata = args[1:4]
            forcar = len(args) > 4 and args[4] == "1"
            from ocr import ocr
            r = ocr(entrada, saida, tessdata, forcar=forcar, progresso=progresso)
        else:
            entrada, saida, nivel, cinza = args[:4]
            from compressor import comprimir
            r = comprimir(entrada, saida, NIVEL[nivel.lower()], cinza == "1")
        print(json.dumps(r), flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        msg = str(e) or e.__class__.__name__
        print(json.dumps({"erro": msg}, ensure_ascii=False), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
