# Documentação da Arquitetura — LIFE CRIMINAL EXPERIENCE (LCE)

## 1. Visão Geral (Módulo 1 — Fundação Técnica)

O **LIFE CRIMINAL EXPERIENCE (LCE)** é um jogo multiplayer online de simulação de vida urbana em 3D executado no navegador, construído sobre uma arquitetura modular pensada para evoluir em múltiplos módulos sem reconstrução.

Esta primeira entrega estabelece:
- **Identidade visual e abertura LCE** (tema escuro moderno, responsivo para desktop e mobile).
- **Autenticação e persistência no plano gratuito Spark** via Firebase Authentication + Cloud Firestore.
- **Universo compartilhado autoritativo** via servidor Node.js (Express + WebSocket `ws`).
- **Distrito Central 3D interativo** em Three.js + React Three Fiber + Drei com personagem controlável em terceira pessoa.
- **Governança administrativa real**, validada simultaneamente por assinatura JWT no backend e regras zero-trust no Cloud Firestore.

---

## 2. Estrutura de Arquivos

| Caminho | Responsabilidade |
|---|---|
| `server.ts` & `src/server/worldServer.ts` | Servidor Node.js (porta 3000) com Express, middleware Vite, verificação criptográfica de Firebase ID Tokens (`jose` + JWKS público do Google) e servidor WebSocket `/ws/world` com rate limiting, validação de colisão, sincronização de aparência e detector de sessões inativas. |
| `firebase-blueprint.json` | Esquema formal (IR) das entidades e coleções do Cloud Firestore (incluindo `experience` e coordenadas persistidas `lastX`, `lastZ`, `lastRotY`). |
| `firestore.rules` | Regras de segurança zero-trust implantadas no Firestore (bloqueia edição de saldos, nível, experiência e status pelo cliente, isola PII e valida RBAC administrativo). |
| `tests/multiplayer.e2e.ts` | Suíte automatizada de testes com dois clientes WebSocket simultâneos validando presença, movimentação independente, reconexão, isolamento de identidade e rate limiting. |
| `security_spec.md` & `firestore.rules.test.ts` | Especificação de ameaças e 12 cenários adversariais ("Dirty Dozen") documentados para auditoria das regras. |
| `src/config/firebase.ts` | Inicialização do Firebase Web SDK (`Auth` + `Firestore` com `firestoreDatabaseId`) e validação de conectividade na inicialização. |
| `src/config/gameModules.ts` | Catálogo dos 10 menus principais, opções de criação de personagem e planta dos estabelecimentos do Distrito Central 3D. |
| `src/types/*` | Contratos TypeScript de conta privada, personagem, protocolo multiplayer e governança administrativa. |
| `src/services/authService.ts` | Login com Google, login/cadastro com E-mail/Senha, sincronização da subcoleção privada `/users/{uid}/private/account` e verificação de token no servidor. |
| `src/services/characterService.ts` | Criação do personagem com validação sincronizada ao blueprint, atualização estética e persistência periódica de localização (`lastX`, `lastZ`, `lastRotY`). |
| `src/services/adminService.ts` | Resolução dupla de privilégio administrativo (backend JWT + `/admins/{uid}`), leitura/gravação de `/economyConfig/global`, moderação operacional e trilha `/adminAuditLogs`. |
| `src/services/multiplayerService.ts` | Cliente WebSocket com autenticação por ID Token, reconexão exponencial, heartbeat, sincronização de aparência em tempo real e envio imediato de parada. |
| `src/context/GameContext.tsx` | Estado global de sessão, personagem, presença multiplayer, checkpoint de localização, configurações e navegação de módulos. |
| `src/components/splash/SplashScreen.tsx` | Tela de abertura cinematográfica LCE. |
| `src/components/auth/AuthScreen.tsx` | Fluxo de login, cadastro e verificação de e-mail. |
| `src/components/character/CharacterCreator.tsx` | Criação civil e visual do cidadão com visualização em tempo real. |
| `src/components/layout/GameShell.tsx` | HUD superior enxuto + barra inferior retrátil com os 10 módulos e portal Admin condicional. |
| `src/components/layout/ModuleDrawer.tsx` | Telas funcionais (Painel, Personagem, Configurações, Admin) e estruturas preparadas para os próximos módulos econômicos. |
| `src/components/world3d/*` | Cena 3D modular (`CityCanvas`, `UrbanEnvironment`, `PlayerController`, `RemotePlayers`, `CharacterAvatar3D`, `proceduralTextures`) com identificação do personagem sobre a cabeça e anel de identificação local. |
| `src/components/admin/AdminPanel.tsx` | Console administrativo separado para preços-base da economia mista, cidadãos e auditoria. |

---

## 3. Modelo de Dados e Segurança

### Coleções no Cloud Firestore
1. **`/users/{userId}`**: Perfil jogável público/compartilhado (sem e-mail/PII).
   - Na criação, `firestore.rules` exige exatamente `cashBalance == 500`, `bankBalance == 1000`, `level == 1`, `experience == 0`, `reputation == 0`, `status == 'active'`, coordenadas iniciais dentro dos limites do distrito e carimbos `request.time`.
   - Em atualizações feitas pelo jogador, somente campos cosméticos e última posição válida (`coatColor`, `accentColor`, `skinTone`, `style`, `district`, `lastX`, `lastZ`, `lastRotY`, `updatedAt`) são aceitos; qualquer tentativa de alterar saldos, nível, experiência, reputação ou status é rejeitada pelo Firestore (`PERMISSION_DENIED`).
2. **`/users/{userId}/private/account`**: Subcoleção isolada de PII (e-mail e provedor), legível apenas pelo titular ou administrador.
3. **`/admins/{adminUid}`**: Registro autoritativo de administradores no banco de dados. Jogadores comuns não podem criar ou editar esta coleção.
4. **`/economyConfig/global`**: Preços-base e parâmetros da economia mista. Legível por cidadãos autenticados e gravável exclusivamente por administradores verificados.
5. **`/adminAuditLogs/{logId}`**: Trilha de auditoria append-only (`update` e `delete` permanentemente bloqueados).

### Autorização Administrativa Real
- O frontend **nunca** libera a área administrativa por comparação de texto local.
- O acesso exige:
  1. Verificação criptográfica do ID Token Firebase no backend Node.js (`GET /api/admin/session` usando JWKS oficial do Google — zero chaves privadas no frontend e zero dependência do plano Blaze).
  2. Validação real de permissão no Cloud Firestore via `isAdmin()` (coleção `/admins/{uid}` + conta fundadora com `email_verified == true`).

---

## 4. Arquitetura Multiplayer Compartilhada

- Endpoint WebSocket: `/ws/world` na mesma porta HTTP `3000` (`maxPayload: 4096` bytes).
- Ao conectar, o cliente envia `player:join` acompanhado do Firebase ID Token (e-mail verificado obrigatório). Conexões não autenticadas são encerradas automaticamente em até 10 segundos ou imediatamente com código `1008`.
- O servidor valida o token, registra o cidadão no distrito `distrito-central` usando exclusivamente o `uid` extraído do JWT, retorna `world:snapshot` e difunde eventos idempotentes `player:joined`, `player:moved`, `player:updated` e `player:left`.
- Proteções ativas: limite de frequência por socket (rate limiting), verificação de colisão e fronteiras do distrito (`[-36, 36]`), proteção anti-teleporte e monitoramento periódico de liveness (ping/pong) que remove automaticamente sessões encerradas ou congeladas.
- **Ambiente de execução**: O servidor roda localmente no ambiente de desenvolvimento do AI Studio (porta 3000); para múltiplos jogadores via internet fora da sessão de preview, será necessária publicação/deploy explícito do serviço.

---

## 5. Sistema Econômico, Bancário e Profissões Legais (Módulo 2 — Ativo)

### Coleções no Cloud Firestore (Integradas sem Duplicação)
- **`/wallets/{uid}`**: Carteira individual privada com separação estrita entre **Dinheiro Limpo** (`cleanCash`), **Dinheiro Sujo** (`dirtyCash`) e parcelas patrimoniais (`companiesValue`, `realEstateValue`, `vehiclesValue`, `investmentsValue`, `otherAssetsValue`). Leitura privada (apenas titular ou admin); edição direta pelo navegador bloqueada.
- **`/bank_accounts/{uid}`**: Conta bancária legal no **Banco Central LCE** (`accountNumber`, `balance`, `status`, `lastTxId`). Leitura privada; movimentação somente em transações atômicas pareadas com `/transactions/{txId}`.
- **`/bank_directory/{uid}`**: Diretório público não-PII (`characterName`, `alias`, `accountNumber`, `active`) permitindo buscar destinatários para transferência sem jamais expor saldos ou e-mail.
- **`/transactions/{txId}`**: Extrato financeiro imutável (`update: false`, `delete: false`) contendo `id`, `operationId`, `type`, `currencyCategory`, `amount`, `fromUid`, `toUid`, `actorUid`, `participants`, `description`, `status` e `createdAt`.
- **`/jobs/{jobId}`**: Catálogo administrável das 4 profissões legais (`entregador`, `supermercado`, `motorista`, `mecanico`).
- **`/work_sessions/{sessionId}`**: Expedientes controlados pelo relógio do servidor (`startedAt == request.time`, trava de transição `in_progress -> completed/cancelled` e exigência `request.time >= startedAt + durationSeconds`).
- **`/salary_payments/{sessionId}`**: Registro imutável chaveado 1-para-1 pelo `sessionId`, tornando pagamentos duplicados matematicamente impossíveis.
- **`/job_experience/{uid}`**: Progressão profissional em 5 patentes (`Iniciante`, `Intermediário`, `Experiente`, `Especialista`, `Mestre`) com multiplicador salarial calculado no servidor.
- **`/admin_logs/{logId}`**: Trilha imutável de todas as intervenções administrativas (alteração de economia, profissões, moderação e ajustes financeiros auditados).

### Motor Financeiro Autoritativo no Plano Gratuito (Spark)
- Como o plano Spark/Starter não exige Cloud Functions nem IAM Admin SDK pago, todas as operações econômicas e trabalhistas passam por endpoints autoritativos no servidor Node.js (`src/server/economyRoutes.ts` + `src/server/firestoreRest.ts`):
  - `POST /api/economy/bootstrap`, `/deposit`, `/withdraw`, `/transfer`
  - `POST /api/jobs/start`, `/complete`, `/cancel`
  - `GET /api/admin/economy/overview`, `POST /api/admin/economy/seed-jobs`, `PUT /api/admin/economy/jobs/:jobId`, `POST /api/admin/economy/adjust`
- O servidor valida criptograficamente o Firebase ID Token via JWKS (`jose`), aplica mutex por usuário/operação, valida saldos, limites diários, cooldowns e relógio do servidor, e submete commits atômicos multi-documento via **Firestore REST API v1 (`documents:commit`)** usando o token verificado — garantindo dupla validação simultânea (Node.js + `firestore.rules`).

### Status das Entregas e Próximos Módulos
- **Implementado de forma real (Módulos 1 e 2)**: Identidade LCE, Firebase Auth + Firestore zero-trust, personagem 3D persistente, cidade 3D com atalhos de proximidade para Banco Central LCE e Agência Metropolitana, multiplayer WebSocket real, carteira individual (limpo/sujo/patrimônio), Banco Central LCE (depósito, saque, transferência P2P com confirmação), extrato imutável, 4 profissões legais com progressão em 5 níveis e console administrativo completo com auditoria.
- **Estruturas preparadas (Próximos Módulos)**: Empresas, Investimentos, Garagem (compra/posse de veículos) e Mercado/Negociações P2P de bens.
- **Dependência de configuração externa opcional**: Para habilitar cadastro/login por **E-mail e Senha** além do **Google Sign-In**, basta ativar *Email/Password* no Firebase Console (`Authentication > Sign-in method`).

