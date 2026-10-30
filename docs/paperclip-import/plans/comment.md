## Plano completo — revisão 3, pronto para o seu aval

Está tudo no [plano](/TES/issues/TES-1#document-plan), revisão 3. Nada foi contratado e nada roda.

**Sobre o dbt 2 e o Sail — você estava certo em parte, e isso muda o plano.** Fui conferir as fontes. A compatibilidade do Sail com dbt é real: a LakeSail mantém o `lakehq/dbt-sail`, ele aparece na documentação do próprio dbt ("Sail setup"), e o Sail hoje também expõe um servidor **Arrow Flight SQL** (porta 32010) com acesso via **ADBC**, além do Spark Connect (50051). O que continua valendo é a outra metade: esse adapter é dbt **Python** 1.8+, não o motor Rust do dbt 2. No dbt v2 os adapters passaram a viver dentro do monorepo Rust do `dbt-labs/dbt` e conversam por drivers ADBC, e adapters fora da árvore não são suportados. O adapter Spark do v2 só oferece `thrift`, `http` e `livy` — ou seja, ele não alcança o Spark Connect do Sail.

Como você mandou forçar o caminho Rust, reformulei: **escrevemos o adapter `sail` para o motor Rust do dbt 2, usando ADBC Flight SQL contra o Flight SQL do Sail.** Isso é coerente porque os adapters do v2 são ADBC por design e o Sail já tem o servidor correspondente. Duas consequências que quero registradas: o v0 compila a partir de um fork Apache-2.0 do dbt (e abrimos o PR upstream em paralelo), e o papel de dbt deixa de ser analytics e passa a ser engenharia Rust. É o maior risco do v0, então ele tem portão: spike de dois dias (M1.5) que prova com código rodando `CREATE TABLE AS`, view, drop e introspecção de catálogo. Se falhar, eu volto com a evidência — não troco de caminho sozinho. O fallback documentado é o `dbt-sail` Python.

**Nome.** Concordo com o inglês. Recomendo **Windward** — náutico, uma palavra, sem usar a marca "Sail". Alternativas no card: Lodestar, Halyard e Keelstone (composto inventado, menor risco de marca). Busca de marca de verdade só antes de lançamento público.

**Como funciona a dinâmica** (seção 4 do plano, resumindo):

- Cada agente é uma identidade fixa com o seu próprio `AGENTS.md` — é esse arquivo que faz o agente saber quem é, o que entrega e no que não mexe. Os nove arquivos estão escritos na **seção 6** do plano, do jeito exato que vão ser instalados. Leia como se fosse a contratação, não um resumo dela.
- Todos rodam no adapter `claude_local`, na sua assinatura. Zero gasto de nuvem.
- Eu crio cada um com **heartbeat desligado**. Agente só executa quando tem tarefa atribuída, e tarefa só existe quando eu crio. Aprovar as contratações cria o time parado — começar a construir é uma decisão separada, e eu volto com o recorte do M0 antes.
- Trabalho é tarefa com critério de aceite, responsável e dependência. Tarefa B que depende da A acorda sozinha quando A termina.
- Nove agentes dividem a mesma cota, então rodo em sequência: um ou dois implementando com o revisor atrás, não nove ao mesmo tempo.

**Revisão de código** (seção 5). Virou estrutura, não cultura: toda tarefa de código tem uma tarefa de revisão pareada que bloqueia o avanço; revisão de diff e QA são portões independentes; nada fecha sem o QA ter rodado de verdade no seu OrbStack com evidência anexada. Por isso proponho um **nono papel que você não marcou: Code Reviewer**. Seus oito cobrem construir e verificar comportamento, mas falta o portão que pega "compila e a demo funciona, mas o código está errado". Dá para cobrir com subagente descartável, mais barato e sem memória das decisões passadas — minha recomendação é a contratação. O card deixa você aprovar os oito e recusar o nono.

**O card acima pede três coisas:** o nome, as contratações autorizadas e a confirmação do caminho Rust do dbt com o portão M1.5. Já vem marcado com a minha recomendação, então aprovar o padrão é um clique. Ao aceitar, eu submeto só as contratações marcadas, com heartbeat desligado, e volto com as tarefas do M0 para o seu aval antes de qualquer execução.
