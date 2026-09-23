# Chrome Web Store listing draft

## Short description (max 132 chars)

```
Histórico não oficial da coleta MUNIC 2026 (IBGE) por município, ao longo do tempo — guardado só no seu navegador.
```
(114 chars — limit is 132)

## Detailed description

```
MUNIC-PRO adiciona três botões azuis à página do SIGC "Situação das
Prefeituras, com Críticas da UF" (SIGC MUNIC 2026, IBGE), ao lado dos
botões nativos — que não são alterados.

O PROBLEMA: o SIGC mostra apenas a situação ATUAL da coleta. A cada
atualização, o valor anterior é sobrescrito — não há como ver o que mudou
desde a semana passada, nem acompanhar o ritmo de cada agência ao longo
do tempo. Esta extensão guarda o que o SIGC não guarda.

• Relatório-PRO — consulta a situação atual de toda a UF (uma requisição
  ao próprio servidor do SIGC) — a menos que a fotografia mais recente já
  guardada tenha menos de um minuto, caso em que reaproveita o histórico
  sem consultar de novo. Guarda uma fotografia datada e abre um painel
  com até cinco abas:
  - Município — uma linha por município, por questionário (Básico e
    Suplementar) e por indicador (críticas informativas, críticas
    comparativas, situação), colorida como no relatório em Excel de
    2025 que substitui. Cada coluna é uma leitura que trouxe mudança:
    as duas últimas de hoje, a última do dia anterior com leitura e,
    antes disso, a última de cada semana. As exportações trazem todas.
  - Assistência e Assistência % — os mesmos municípios agrupados por
    assistência (agrupamento fixo, embutido na extensão, para os
    municípios da Bahia: 50 agências em 6 assistências), em contagem e
    em percentual. Em outras UFs essas duas abas não aparecem.
  - Agência e Agência % — o mesmo, agrupado por agência.
  Todas as tabelas têm ordenação, paginação, busca geral e um filtro por
  coluna, usando o jQuery/DataTables que a própria página do SIGC já
  carrega — nada é baixado ou embutido para isso. A tabela rola na
  horizontal dentro do painel, e o menu "Colunas" oculta as colunas que
  você não usa (Assistência, Agência, Questionário…) até você mostrá-las
  de novo.
• CSV-PRO — exporta uma linha por município por consulta (separador
  `;`, com BOM, pronto para o Excel brasileiro).
• Backup JSON — exporta o histórico completo guardado, como cópia de
  segurança.
• Página de Opções (em chrome://extensions, no ícone da extensão) — mostra
  quantas leituras e linhas de histórico existem e desde quando, permite
  exportar o mesmo Backup JSON do painel, importar um Backup JSON antigo
  de volta (mesclando com o que já está guardado, sem duplicar linhas já
  presentes) e apagar todo o histórico. Não depende da página do SIGC
  estar aberta.

O histórico é guardado como SCD tipo 2 no IndexedDB do navegador: uma
linha por combinação de município/questionário/indicador, com as datas
em que cada estado começou e terminou a valer. Um município que não muda
de uma consulta para outra não custa nada a mais para guardar, por mais
vezes que a extensão seja usada.

PRIVACIDADE: não há nenhum recurso externo nesta extensão — nenhuma
imagem, biblioteca, fonte ou script de fora, nada. A única requisição de
rede é a consulta do Relatório-PRO, que vai ao próprio servidor do SIGC
MUNIC 2026 (mesma origem da página, mesma sessão já autenticada do
usuário), acionada por clique. O histórico e os arquivos exportados
ficam apenas no seu computador — nada é enviado ao desenvolvedor, e não
há telemetria. Isso é verificado automaticamente a cada alteração no
código-fonte (veja o repositório).

AVISO: projeto independente, sem vínculo oficial com o IBGE. Protótipo
para uso e demonstração à equipe de desenvolvimento do SIGC. Use por sua
conta e risco.

Código-fonte aberto: https://github.com/leoniedu/munic-pro
```

## Single purpose (dashboard field)

```
Adds unofficial tools to the SIGC MUNIC 2026 (IBGE) status report page:
one button that fetches the current status and keeps a dated history of
it (a panel of up to five tabs — município, assistência, assistência %,
agência, agência %), a CSV export of that history, and a full JSON backup of it.
It requests NO browser permissions at all, and exists strictly to
keep that history locally and let the user save it — nothing is
transmitted anywhere outside the SIGC server the data came from.
```

## Host permission justification (dashboard field)

Limit: 1000 characters. Current text is 996.

```
The content script is matched to three hosts SIGC is served from — portalweb.ibge.gov.br, portalweb2.ibge.gov.br and w3sigcmunic2026.ibge.gov.br — not the whole ibge.gov.br domain. The path is not narrowed because the F5 gateway in front of the portal rewrites URLs with a generated prefix that can change; gating on page content is more robust than matching a path.

On any page other than the MUNIC report the script does nothing: it checks for four element IDs belonging to that report's own buttons, and if they are absent it builds no UI, reads nothing and opens no database.

On the report page it adds a button that keeps a dated history of the report's own status data — the page shows only the current value and overwrites it — plus a CSV export and a JSON backup.

The only network call is one click-triggered POST to the SIGC server itself, same origin, in the user's existing session. No other site is accessed and there is no external resource of any kind: no CDN, font or analytics.
```

## Storage permission justification (dashboard field)

**Not applicable — no permission is requested.** The `permissions` list is
absent from the manifest.

The collection history is kept in IndexedDB on the extension's own
origin, opened by its service worker and its options page — IndexedDB
needs no declared permission. The content script reaches the worker with
`chrome.runtime.sendMessage`, which needs none either; it is the only
`chrome.*` API in `extension/`. `chrome.storage` is not used anywhere. An
earlier version declared `storage` and `downloads`; neither was ever
exercised, and both were removed rather than justified, because the
justification would have been false.


## Downloads permission justification (dashboard field)

**Not applicable — no permission is requested.** Exports are produced with
`Blob` + `URL.createObjectURL` and an anchor click, which is the browser's
ordinary download path and needs no permission. The `chrome.downloads` API
is not used.


## Data safety / Privacy practices (dashboard form — required to submit)

"Collect" here means Google's definition: **transmitting data off the
user's machine**. Reading data already on the page, storing it locally in
IndexedDB, showing it, and saving a file locally are not collection.
Unlike SIGC-PRO, this extension DOES store data on purpose — the
collection history is the whole point — but storing locally is not the
same thing as collecting under this definition, and every answer below is
still No.

| Data type | Answer | Why |
|---|---|---|
| Personally identifiable information | **No** | The report contains no personal data — it is município/agência-level aggregate status (situação, críticas counts), never names, addresses or individuals. |
| Health information | **No** | Never handled. |
| Financial and payment information | **No** | Never handled. |
| Authentication information | **No** | The extension never reads, stores or transmits credentials, cookies or tokens. The one request reuses the page's existing session (`credentials: 'same-origin'`) — the browser attaches the cookie, the extension never sees it. |
| Personal communications | **No** | Never handled. |
| Location | **No** | Never handled — this report carries no geographic coordinates. |
| Web history | **No** | Never handled. |
| User activity | **No** | No analytics, no telemetry, no click tracking. |
| Website content | **No** | Município/agência status read from the SIGC page is stored **locally, in the user's own browser (IndexedDB)**, on purpose — that history is the extension's entire function — and exported to files the user saves themselves. It is never transmitted to the developer or to any third party; the only network request sends nothing anywhere, it only reads the current status back from the same SIGC server the data already lives on. |

Required certifications — all three can be affirmed:

- [x] Not being sold to third parties, outside of approved use cases
- [x] Not being used or transferred for purposes unrelated to the item's core functionality
- [x] Not being used or transferred to determine creditworthiness or for lending purposes

## Category

Productivity (or "Tools" if available for the target region)

## Privacy policy URL

https://leoniedu.github.io/munic-pro/PRIVACY_POLICY.html

## Store visibility

Unlisted (installable only via direct link, not searchable).
