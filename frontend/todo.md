# Plano de transformação — site de restaurante

- [x] Redefinir a direção visual para uma experiência de delivery em português.
- [x] Criar a identidade do restaurante, navegação e conteúdo de descoberta.
- [x] Implementar categorias, busca, pratos e complementos.
- [x] Implementar carrinho lateral e resumo do pedido.
- [x] Implementar checkout com endereço, forma de pagamento e botão de confirmação.
- [x] Conectar o cadastro/login ao fluxo do auth-service em modo real ou demonstração.
- [x] Conectar a criação de pagamento ao payment-service em modo real ou demonstração.
- [x] Conectar a confirmação de pedido/notificação ao notification-service em modo real ou demonstração.
- [x] Validar estados de sucesso, erro, vazio e responsividade mobile.
- [ ] Salvar checkpoint final e entregar a versão atualizada.

## Ajustes do fluxo autenticado e entrega

- [x] Mapear os endpoints reais de autenticação, pagamento e notificações no backend.
- [x] Bloquear checkout e confirmação quando não houver sessão autenticada.
- [x] Encadear autenticação, criação de pedido, pagamento e notificação na ordem correta.
- [x] Criar estado de entrega com motoboy, rota, etapas e atualização visual.
- [x] Validar falhas intermediárias sem confirmar um pedido incompleto.
- [ ] Salvar checkpoint final desta revisão.

## Cadastro e avisos do site

- [x] Criar tela/modal de cadastro com nome, e-mail e senha.
- [x] Conectar o cadastro ao endpoint `/auth/register` em modo real e manter demonstração local.
- [x] Reutilizar a conta criada para liberar o checkout autenticado.
- [x] Criar faixa de aviso colorida com mensagem e botão X.
- [x] Validar fechamento, responsividade e estados de erro do cadastro.
- [ ] Salvar checkpoint final desta atualização.

## Refinamento responsivo e pacote ZIP

- [x] Auditar a composição em desktop e mobile.
- [x] Corrigir hero, navegação, categorias e grid de pratos.
- [x] Melhorar carrinho, checkout, cadastro e faixa de aviso em telas estreitas.
- [x] Validar TypeScript, build e screenshots representativos.
- [x] Criar ZIP final sem dependências instaladas e sem arquivos sensíveis.

## Integração do pacote completo

- [x] Copiar o frontend para uma pasta única junto dos microsserviços.
- [x] Adicionar serviço/container do frontend ao Docker Compose.
- [x] Ajustar CORS, portas, URLs e documentação de execução conjunta.
- [x] Validar os endpoints usados pelo frontend contra o backend integrado.
- [ ] Criar ZIP único com frontend, microsserviços, Compose e segredos de exemplo.
