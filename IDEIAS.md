# Ideias e melhorias do Auris PDF

Lista de pedidos para juntar várias melhorias numa atualização só.
Quando uma ideia entra numa versão publicada, ela passa para "Já lançado".

## Para a próxima versão (1.0.4)

Pedidos de clientes (suporte Aliança Tur, 27/11/2026):
- [x] **Converter PDF para Word (.docx)**: mantém texto, tabelas e imagens; páginas escaneadas passam por OCR antes. Botão na barra e cartão na tela inicial; o .docx abre direto no Word.
- [x] **Converter foto para PDF**: a função já existia ("Imagens → PDF"); agora tem botão na barra e "Converter em PDF com Auris PDF" no botão direito sobre fotos no Explorer.
- [x] **Digitalizar / OCR**: transformar PDF escaneado em PDF pesquisável (texto selecionável e com busca). Botão "OCR" na barra, cartão na tela inicial e aviso automático quando o PDF aberto parece escaneado.
- [ ] **Editar os textos do PDF**: clicar num texto existente e alterar.

## Ideias para depois

_(nada ainda)_

## Já lançado

### 1.0.3
- **Ícones padronizados**: toda a interface em Lucide outline (traço único de 1,75px, azul claro ou branco), no lugar dos ícones coloridos da prancha. Ícone do programa e dos arquivos .pdf continuam.

### 1.0.2
- **Tela de abertura**: no lugar da tela preta com um quadrado branco, abrir com a logo Auris e uma barrinha de carregamento.
- **Impressão nativa estilo Acrobat**: diálogo próprio com pré-visualização, impressão vetorial em segundo plano (PDFium), impressão rápida com Ctrl+Shift+P, impressão em lote (todas as abas) e "Imprimir com Auris PDF" no botão direito do Explorer.
- **Ícones novos**: ícone do programa (documento com caneta), ícone dos arquivos .pdf no Explorer e os 10 ícones de função na tela inicial, na barra de ferramentas e no cabeçalho das janelas.
- **Botão "Salvar como"** na barra, ao lado do Salvar (Ctrl+Shift+S).
- Tela inicial mais limpa: sem a logo grande e sem a frase "Vários arquivos abrem em abas".

### 1.0.1
- Motor de compressão próprio (PyMuPDF) no lugar do motor JavaScript.
- Logo Auris no ícone do .exe, no instalador, na barra do topo e na tela inicial.
- Dica ao passar o mouse em todos os ícones.

### 1.0.0
- Atualização automática: aviso quando há versão nova, botão "Verificar atualizações" e tela de progresso ao atualizar.
