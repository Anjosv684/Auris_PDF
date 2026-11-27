"""Ponte entre o Auris PDF (Tauri) e o motor de compressão (compressor.py).

Uso: auris-compress <entrada.pdf> <saida.pdf> <leve|media|forte> <cinza 0|1>
Imprime uma linha JSON com o resultado ({"antes", "depois", "modo", "reducao"})
ou {"erro": "..."} com código de saída 1.
"""
import json
import sys

NIVEL = {"leve": "Leve", "media": "Média", "forte": "Forte"}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        entrada, saida, nivel, cinza = sys.argv[1:5]
        from compressor import comprimir
        r = comprimir(entrada, saida, NIVEL[nivel.lower()], cinza == "1")
        print(json.dumps(r))
        return 0
    except Exception as e:  # noqa: BLE001
        msg = str(e) or e.__class__.__name__
        print(json.dumps({"erro": msg}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
