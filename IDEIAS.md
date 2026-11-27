# Ideias e melhorias do Auris PDF

Lista de pedidos para juntar várias melhorias numa atualização só.
Quando uma ideia entra numa versão publicada, ela passa para "Já lançado".

## Para a próxima versão (1.0.9)

_(nada ainda)_

## Ideias para depois

_(nada ainda)_

## Já lançado

### 1.0.8
Assinatura em lote e janela integrada (27/11/2026):
- **Assinar PDFs em lote:** nova tela "Assinar PDFs" (menu Assinar → "Assinar vários PDFs de uma vez", card da tela inicial, link na assinatura de um PDF).
  - Escolhe vários PDFs, define o local da assinatura numa prévia da página (arrastar/redimensionar, atalhos esquerda/centro/direita; última, primeira, todas ou página N) e aplica em todos.
  - Três jeitos: certificado digital (PAdES ICP-Brasil, A1 ou token A3 com PIN uma vez só para todos), carimbo pessoal em PNG (fica guardado) ou assinatura à mão.
  - No certificado dá para incluir a rubrica/carimbo dentro do quadro da assinatura.
  - Salva ao lado do original como "nome (assinado).pdf" (ou numa pasta escolhida), mostra ✓/erro por arquivo, botões "Abrir pasta" e "Abrir no Auris".
  - Novo evento de uso: `assinar_lote` (tipo, arquivos).
- **Barra da janela integrada:** sem a barra branca do Windows; minimizar, maximizar/restaurar e fechar ficam na barra do Auris (fechar fica vermelho no hover). Arrastar pela barra move a janela e o duplo clique maximiza. Fechar continua perguntando sobre alterações não salvas.

### 1.0.7
Correções na edição de texto (27/11/2026):
- **Textos se sobrepondo ao editar**: em linhas muito juntas, a edição pegava pedaços da linha de cima/de baixo e embaralhava. Agora só a linha clicada é alterada.
- **Colunas na mesma altura** (tabelas, "Nome: …   Data: …") viravam uma linha só e eram reescritas encavaladas; agora cada pedaço é editado separado.
- **Arrastar o texto**: arrastar uma linha leva o texto para outro lugar (o lugar antigo fica limpo). Durante a edição, a alça ✥ ao lado do quadro também arrasta.
- Tela mais limpa: sem contorno tracejado em todas as linhas (só destaca a linha embaixo do mouse) e dica "Enter aplica • Esc cancela" ao lado do quadro.
- O quadro de edição às vezes abria e sumia sozinho logo depois de uma edição (a página era montada duas vezes); corrigido, e páginas escaneadas não fazem mais OCR em dobro depois de cada edição.
- **Barra de ferramentas**: "Assinar" e "Organizar" encavalavam nos ícones vizinhos e a ponta direita (zoom, busca) ficava cortada em janelas menores. Agora nada encolhe por cima do vizinho, os textos somem e fica só o ícone em telas menores, e se ainda faltar espaço a rodinha do mouse rola a barra para o lado.

### 1.0.6
Pedidos internos (27/11/2026):
- **Acompanhamento de uso (PostHog)**: painel com as ferramentas mais usadas, os erros que aparecem para os usuários e quem usa mais. Depois da atualização abre uma **tela de boas-vindas** que pede **nome e filial** e deixa escolher o **tema** em cartões com miniatura de cada visual (o tema muda na hora ao clicar). Dá para trocar depois em Configurações → Meu nome, filial e tema. Não envia nome de arquivo nem conteúdo de documento; dá para desligar em Configurações → Enviar estatísticas de uso.

### 1.0.5
Pedidos internos (27/11/2026):
- **Temas da interface** (Configurações → Tema): **Azul** (o atual), **Claro** (fundo branco), **Escuro** (grafite) e **Automático** (segue o modo claro/escuro do Windows). A escolha fica salva e a tela de abertura já sai na cor do tema. A página do PDF continua branca em todos.

Correções (27/11/2026):
- Menu da engrenagem (Configurações) abria esticado ocupando a largura da tela; agora é uma caixinha pequena no canto.

### 1.0.4
Pedidos de clientes (suporte Aliança Tur, 27/11/2026):
- **Converter PDF para Word (.docx)**: mantém texto, tabelas e imagens; páginas escaneadas passam por OCR antes. Botão na barra e cartão na tela inicial; o .docx abre direto no Word.
- **Converter foto para PDF**: a função já existia ("Imagens → PDF"); agora tem botão na barra e "Converter em PDF com Auris PDF" no botão direito sobre fotos no Explorer.
- **Digitalizar / OCR**: transformar PDF escaneado em PDF pesquisável (texto selecionável e com busca). Botão "OCR" na barra, cartão na tela inicial e aviso automático quando o PDF aberto parece escaneado.
- **Editar os textos do PDF**: ferramenta "Editar texto" (tecla X): clique numa linha, altere e aperte Enter. Mantém posição, tamanho, cor e negrito/itálico; dá para desfazer (Ctrl+Z). Funciona também em PDF escaneado: a linha é lida por OCR, o papel é repintado e o texto novo sai na fonte, tamanho e cor mais parecidos com o original.

Pedidos internos (27/11/2026):
- **Botão direito na imagem colada**: girar 90°, espelhar na horizontal/vertical, trazer para frente / avançar / recuar / enviar para trás, remover fundo branco, repetir em todas as páginas, duplicar e excluir. A ordem das camadas também vale para formas, textos e carimbos.
- **Girar o documento**: barrinha discreta no centro inferior (quase transparente até passar o mouse) com girar à esquerda/direita. Dá para esconder no "x" da própria barra ou em Configurações → Barra de giro do documento.

Correções (27/11/2026):
- OCR dava "Tesseract language initialisation failed" no app instalado (caminho com prefixo `\\?\` do Windows).
- Menu "⋯ Mais ferramentas" e menu de carimbos abriam cortados (invisíveis) dentro da barra de ferramentas.

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
