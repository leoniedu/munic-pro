# MUNIC-PRO

Extensão de navegador (Chrome, Manifest V3) para acompanhar a coleta da
**MUNIC 2026** (IBGE) — histórico da situação por município e relatórios por
agência, direto na página do SIGC.

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

- **Relatório-PRO** — lê a situação de todos os municípios da UF e guarda
  uma fotografia datada, e então abre o painel. Só rebusca se a última
  leitura tiver mais de um minuto, para não repetir a consulta a cada
  clique; a linha de status diz qual caminho foi tomado.
- **CSV-PRO** — uma linha por município por leitura, para análise fora
  do navegador (LibreOffice, R).
- **Backup JSON** — o histórico inteiro num arquivo, para que não se
  perca se os dados do navegador forem limpos.

O painel tem cinco abas: **Município** (uma linha por município,
questionário e indicador, uma coluna por data, colorida por situação),
**Assistência** e **Assistência %**, **Agência** e **Agência %**.


## Instalação

1. Baixe `dist/munic-pro-extension.zip` e descompacte.
2. Em `chrome://extensions`, ative o **Modo do desenvolvedor**.
3. **Carregar sem compactação** e aponte para a pasta `extension/`.

## Privacidade

**Nenhum dado sai do seu computador.**

Diferentemente do SIGC-PRO, esta extensão **guarda** dados: o histórico é
o produto. Mas, como ele, **não pede permissão nenhuma** ao navegador — o
IndexedDB e o download por Blob são APIs da própria página, e nenhum dos
dois exige permissão declarada.

O histórico fica no navegador, na sua máquina. **Limpar os dados de
navegação apaga o histórico** — é para isso que existe o Backup JSON.

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
