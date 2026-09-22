# MUNIC-PRO

Extensão de navegador (Chrome, Manifest V3) para acompanhar a coleta da
**MUNIC 2026** (IBGE) — histórico da situação por município e relatórios por
assistência e agência, direto na página do SIGC.

Projeto irmão do [SIGC-PRO](https://github.com/leoniedu/sigc-pro), no mesmo
espírito e com as mesmas convenções, mas **separado de propósito**: o SIGC-PRO
não armazena nada, e esta extensão precisa guardar histórico. Ver
[Privacidade](#privacidade).

> ⚠️ **Aviso:** projeto independente, sem vínculo com o IBGE. Use por sua
> conta e risco.

## O problema

O SIGC mostra apenas a situação **atual** da coleta. Não há como ver o que
mudou desde a semana passada, nem quanto cada agência avançou — a informação
existe, mas é sobrescrita a cada atualização.

Esta extensão guarda uma fotografia a cada uso e monta o histórico que o SIGC
não guarda.

## Funcionalidades

Na página **Relatório Situação Município** do SIGC MUNIC 2026, um botão azul
ao lado dos nativos:

- **Atualizar** — lê a situação de todos os municípios da UF selecionada e
  guarda uma fotografia datada. Rodar de novo no mesmo dia não duplica nada.
- **Relatório** — abre um painel com três abas:
  - **Município** — uma linha por município e questionário (Básico e
    Suplementar), uma coluna por semana, colorida por situação.
  - **Assistência** — municípios por situação e semana, em número e
    percentual.
  - **Agência** — o mesmo, detalhado por agência.
- **Exportar** — CSV (para LibreOffice ou R) e JSON (cópia de segurança do
  histórico).

A cada atualização o histórico completo também é baixado automaticamente em
JSON, para que nada se perca se o perfil do navegador for limpo.

## Instalação

1. Baixe `dist/munic-pro-extension.zip` e descompacte.
2. Em `chrome://extensions`, ative o **Modo do desenvolvedor**.
3. **Carregar sem compactação** e aponte para a pasta `extension/`.

## Privacidade

**Nenhum dado sai do seu computador.**

Diferentemente do SIGC-PRO — que não guarda nada e não pede permissão alguma —
esta extensão **precisa** armazenar dados para existir: o histórico é o
produto. Por isso pede duas permissões:

- **`storage`** — guarda o histórico da situação da coleta no IndexedDB do
  próprio navegador, na sua máquina.
- **`downloads`** — grava a cópia de segurança em JSON na sua pasta de
  Downloads.

As requisições de rede vão **exclusivamente ao próprio servidor do SIGC**, nas
mesmas URLs que a página já usa, e só mediante clique. Não há servidor
externo, telemetria, analytics nem envio de dados para lugar nenhum.

O histórico fica apenas no seu navegador e nos arquivos que você baixar.
Limpar os dados do navegador apaga o histórico guardado — por isso a cópia em
JSON é automática.

## Desenvolvimento

```sh
bun install
bun test
git config core.hooksPath .githooks   # versão automática + dist/
```

Convenções herdadas do SIGC-PRO: commits convencionais, testes em `bun`, e um
hook de pre-commit que incrementa a versão do manifesto e reconstrói o zip de
distribuição quando `extension/` muda.

O desenho está em
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Licença

MIT.
