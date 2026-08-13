# Design direction — Microservices Test Console

## Approach 1 — Signal Room
A dark, editorial operations console with warm paper panels, electric chartreuse accents, and a signal-inspired visual language. It should feel like a calm control room for diagnosing distributed systems without looking like a generic cyberpunk dashboard.

**Probability:** 0.07

## Approach 2 — Ceramic Infrastructure
A light, tactile admin interface with mineral neutrals, cobalt accents, and soft card surfaces. The emotional intent is dependable, humane, and legible: infrastructure tooling that feels approachable during a stressful incident.

**Probability:** 0.04

## Approach 3 — Blue Hour Grid
A restrained navy interface with cool cyan highlights, compact telemetry modules, and a more technical command-center mood. It prioritizes rapid scanning and dense operational context.

**Probability:** 0.06

## Selected approach: Praça Quente

### Design Movement
Editorial food commerce with the warmth of a neighborhood trattoria: generous food photography, handcrafted accents, and a clean ordering rhythm designed for mobile-first discovery.

### Core Principles
1. **Appetite first:** the hero and dish photography should make the next order feel obvious.
2. **Warm confidence:** cream paper, terracotta, charcoal and yellow create the feeling of a real neighborhood kitchen.
3. **A short path to checkout:** categories, dish cards, cart and checkout must be readable without explanation.
4. **The backend stays helpful:** authentication, payment and notification details appear at the moments where the customer needs trust, not as technical clutter.

### Color Philosophy
A warm cream canvas feels like a menu on paper. Terracotta carries the restaurant's appetite and action color, charcoal adds depth, sage communicates calm confirmation, and a small sun-yellow accent makes discovery feel lively without becoming childish.

### Layout Paradigm
A wide storefront rhythm leads with a split hero, then moves through category navigation, a three-column dish grid, an instructional strip and a persistent cart drawer. On mobile, discovery becomes one column and the order drawer becomes a full-width sheet.

### Signature Elements
- A small oven-and-flame mark next to the lowercase `forno da praça` wordmark.
- Terracotta pill actions and a round yellow “feito na praça” stamp.
- Editorial dish cards with generous crops, short descriptions and a direct “Adicionar” action.

### Interaction Philosophy
Actions should feel like a friendly counter order: select a category, add a dish, review quantities, choose an address and confirm. Toasts confirm small actions, while the cart and checkout hold the full order state in view.

### Animation
Use short 160–220ms transitions with a strong ease-out. Cards enter with a slight upward translation and opacity ramp. Health checks pulse only while running; success and error states settle immediately. Respect reduced-motion preferences and never animate layout dimensions.

### Typography System
Use **DM Sans** for navigation, labels and form controls, with **Playfair Display** for the restaurant name, hero headlines, dish names and section titles. Use **DM Mono** only for small operational notes such as hours, delivery and test mode.

### Brand Essence
Uma cozinha de bairro que entrega comida caprichada sem transformar o pedido em burocracia. É para quem quer pizza, brasa e doce com cara de feito na hora.

**Personalidade:** calorosa, caprichosa, direta.

### Brand Voice
As frases são acolhedoras, apetitosas e objetivas. O site fala como alguém que conhece a própria cozinha, sem exagerar em promessas.

- “O forno aceso esperando por você.”
- “Da nossa cozinha para a sua mesa.”

### Wordmark & Logo
O símbolo combina uma chama simples com um arco de forno e uma fatia, acompanhado do wordmark serifado em minúsculas `forno da praça`.

### Signature Brand Color
**Terracota da casa — `#C64E35`**. É a cor dos botões, links de ação e pequenos sinais de calor da marca.

## Style Decisions
- Keep the storefront light and warm; dark mode is not part of the first delivery.
- Keep the cart, address and payment choice visible in the customer journey.
- Use generated food photography as the main visual material, with no fake reviews or testimonials.
- Keep the backend integration behind the customer-facing moments: login, payment confirmation and order notification.
