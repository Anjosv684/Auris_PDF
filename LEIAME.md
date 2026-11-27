# Auris PDF

Leitor e editor de PDF para Windows, no visual Auris. Tudo roda localmente: nenhum arquivo sai do computador.

## Funcionalidades

**Visualizar**
- Abas, miniaturas, rolagem contínua e zoom suave (Ctrl + roda do mouse)
- Busca com destaque (Ctrl+F), seleção e cópia de texto, links internos
- PDFs com senha
- Impressão (Ctrl+P)

**Editar**
- Destaque: selecione o texto e clique no marcador, ou arraste
- Caixa de texto, desenho à mão livre, retângulo, elipse, linha e seta, com cor, espessura, preenchimento e opacidade
- **Imagens**: Ctrl+V (prints, logos), arrastar arquivo para a página ou botão Inserir
  - mover e redimensionar mantendo a proporção (Shift libera)
  - guias de alinhamento magnéticas (Alt desliga)
  - "Remover fundo branco" e "Em todas as páginas"
- Carimbos: APROVADO, RECEBIDO, CONFERIDO, PAGO, REPROVADO… ou personalizado, com data
- Assinatura manuscrita e rubrica: desenhar ou importar imagem; fica guardada para reutilizar
- Preencher formulários do próprio PDF
- Desfazer e refazer (Ctrl+Z / Ctrl+Y), duplicar (Ctrl+D), mover com as setas do teclado, excluir com Delete

**Assinatura digital ICP-Brasil (PAdES)**
- Certificado **A3** (token ou cartão) ou **A1 instalado** no Windows; o PIN é pedido pelo driver do token
- Certificado **A1 em arquivo** (.pfx / .p12)
- Carimbo visível posicionável: nome, CPF/CNPJ parcial, data, motivo
- Várias assinaturas no mesmo PDF: cada nova é acrescentada sem invalidar as anteriores
- Painel de verificação: íntegra ou alterada, quem assinou, quando, emissor e validade

**Páginas e arquivos**
- Organizar: reordenar arrastando, girar, excluir, duplicar, inserir página em branco ou de outro PDF, extrair
- Juntar vários PDFs, escolhendo as páginas de cada um
- Dividir por intervalos, a cada N páginas, página por página ou extraindo páginas
- Comprimir (Leve, Média, Forte, tons de cinza), um ou vários arquivos
- Exportar páginas como PNG/JPG e converter imagens em PDF

**Windows**
- Registrado para abrir `.pdf`. Em Configurações (⚙) → "Definir como leitor padrão" abre a tela do Windows; é um clique.
- Dois cliques em outro PDF abrem numa nova aba da janela que já está aberta
- Menu do botão direito do Explorer: *Abrir*, *Comprimir* e *Juntar com Auris PDF* (funciona com vários arquivos selecionados)

## Como gerar o instalador

### Opção A: no seu PC
1. Instale:
   - **Node.js LTS**: https://nodejs.org
   - **Rust**: https://rustup.rs
   - **Visual Studio Build Tools** com "Desenvolvimento para desktop com C++" (o instalador do Rust oferece)
2. Dê dois cliques em `build-windows.bat`.
3. O instalador sai em `src-tauri\target\release\bundle\nsis\Auris PDF_1.0.0_x64-setup.exe`, com cerca de 10 MB.

### Opção B: no GitHub, sem instalar nada
1. Suba esta pasta num repositório (pode ser privado).
2. Abra a aba **Actions**, depois **Build Windows** e clique em **Run workflow**.
3. Em uns 10 minutos o instalador aparece em **Artifacts**.

### Distribuir
Mande o `…setup.exe` (de preferência dentro de um .zip no WhatsApp). Sem assinatura de código, o Windows mostra "O Windows protegeu o computador". É só clicar em **Mais informações → Executar assim mesmo**.

## Desenvolvimento
```
npm install
npm run dev        # versão web em http://localhost:5173 (sem token A3)
npm run app:dev    # app desktop com recarga automática
```

Estrutura:
- `src/lib/`: núcleo
  - `export.ts`: grava as edições no PDF
  - `sign.ts`: PAdES, CMS e verificação
  - `incremental.ts`: salvamento incremental
  - `pages.ts`: organizar, juntar e dividir
  - `compress.ts`
- `src/components/`: interface em React
- `src-tauri/`: backend em Rust
  - arquivos em disco
  - associação de arquivos e instância única
  - certificados do Windows via `SignedCms`

## Limitações conhecidas
- Editar o **texto original** do PDF ainda não é possível. Para corrigir um trecho, cubra com um retângulo branco e escreva por cima.
- **OCR** e **conversão para Word** ainda não estão incluídos (próxima fase).
- As anotações são gravadas "achatadas" no conteúdo da página, e o arquivo fica igual em qualquer leitor.
- Sobre a assinatura digital:
  - a assinatura gerada é PAdES (ETSI.CAdES.detached, com SHA-256 e o atributo *signing-certificate-v2*), aceita pelo Adobe e pelo validador do ITI
  - não inclui carimbo do tempo de ACT nem o identificador de política ICP-Brasil (AD-RB), que ficam para uma versão futura
  - após assinar, qualquer edição invalida a assinatura

## Licenças de terceiros
PDF.js (Apache-2.0), pdf-lib (MIT), node-forge (BSD-3), React (MIT), Tauri (MIT/Apache-2.0), lucide (ISC).
Todas permitem uso comercial.
