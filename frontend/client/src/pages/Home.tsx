// Forno da Praça: experiência de cliente para delivery, com o fluxo de autenticação, pagamento e notificação preservado nos momentos certos.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, Clock3, Heart, MapPin, Menu, Minus, Plus, Search, ShoppingBag, Sparkles, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Dish = { id: string; name: string; description: string; price: number; category: string; image: string; tag?: string };
type CartItem = Dish & { quantity: number };

const dishes: Dish[] = [
  { id: "pizza-margherita", name: "Margherita da casa", description: "Molho de tomate assado, fior di latte, manjericão e azeite da praça.", price: 42.9, category: "Pizzas", image: "/manus-storage/forno-da-praca-pizza_1e2f0c40.jpg", tag: "Queridinha" },
  { id: "pizza-calabresa", name: "Calabresa na brasa", description: "Calabresa artesanal, cebola roxa, muçarela e pimenta-de-cheiro.", price: 45.9, category: "Pizzas", image: "/manus-storage/forno-da-praca-pizza_1e2f0c40.jpg" },
  { id: "burger", name: "Brasa da Praça", description: "Blend da casa, queijo meia-cura, cebola crocante e molho defumado.", price: 36.9, category: "Sanduíches", image: "/manus-storage/forno-da-praca-burger_9a6b4c0e.jpg", tag: "Novo" },
  { id: "brownie", name: "Brownie de brigadeiro", description: "Chocolate intenso, creme de baunilha e castanhas tostadas.", price: 18.9, category: "Doces", image: "/manus-storage/forno-da-praca-dessert_731bbfe2.jpg" },
  { id: "focaccia", name: "Focaccia de alho", description: "Massa de fermentação lenta, alho confitado, alecrim e flor de sal.", price: 16.9, category: "Para compartilhar", image: "/manus-storage/forno-da-praca-pizza_1e2f0c40.jpg" },
  { id: "limonada", name: "Limonada da varanda", description: "Limão espremido, capim-limão e um toque de mel.", price: 10.9, category: "Bebidas", image: "/manus-storage/forno-da-praca-dessert_731bbfe2.jpg" },
];
const categories = ["Todos", "Pizzas", "Sanduíches", "Para compartilhar", "Doces", "Bebidas"];
const API = { auth: import.meta.env.VITE_AUTH_URL || "http://localhost:3002", payment: import.meta.env.VITE_PAYMENT_URL || "http://localhost:3001" };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Logo() { return <div className="restaurant-logo"><img src="/manus-storage/forno-da-praca-logo_68b742e9.png" alt="" /><span>forno<br /><b>da praça</b></span></div>; }
function Quantity({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <div className="quantity"><button onClick={() => onChange(Math.max(0, value - 1))}><Minus size={13} /></button><b>{value}</b><button onClick={() => onChange(value + 1)}><Plus size={13} /></button></div>; }

export default function Home() {
  const [category, setCategory] = useState("Todos");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<"login" | "register">("login");
  const [alertVisible, setAlertVisible] = useState(true);
  const [session, setSession] = useState<{ email: string; token?: string } | null>(null);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [deliveryStage, setDeliveryStage] = useState(1);
  const [demoMode, setDemoMode] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [address, setAddress] = useState("Rua das Flores, 120 — Centro");
  const [payment, setPayment] = useState("PIX");
  const [loading, setLoading] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  const filtered = useMemo(() => dishes.filter((dish) => (category === "Todos" || dish.category === category) && `${dish.name} ${dish.description}`.toLowerCase().includes(query.toLowerCase())), [category, query]);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const delivery = subtotal > 0 && subtotal < 55 ? 6.9 : 0;
  const total = subtotal + delivery;
  useEffect(() => { if (!trackingOpen || !demoMode) return; const timer = window.setInterval(() => setDeliveryStage((stage) => Math.min(stage + 1, 3)), 4200); return () => window.clearInterval(timer); }, [trackingOpen, demoMode]);

  function add(dish: Dish) { setCart((current) => { const existing = current.find((item) => item.id === dish.id); return existing ? current.map((item) => item.id === dish.id ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { ...dish, quantity: 1 }]; }); toast.success(`${dish.name} entrou no pedido`, { description: "Você pode revisar tudo no carrinho." }); }
  function update(id: string, quantity: number) { setCart((current) => quantity === 0 ? current.filter((item) => item.id !== id) : current.map((item) => item.id === id ? { ...item, quantity } : item)); }
  async function createOrder() {
    setLoading(true);
    try {
      if (demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 850));
      } else {
        const paymentResponse = await fetch(`${API.payment}/api/v1/payments/charges`, { method: "POST", headers: { "content-type": "application/json", "Authorization": session?.token ? `Bearer ${session.token}` : "", "Idempotency-Key": `forno-${Date.now()}` }, body: JSON.stringify({ orderId: `PED-${Date.now()}`, restaurantId: "forno-da-praca", method: payment, productAmountCents: Math.round(subtotal * 100), deliveryFeeCents: Math.round(delivery * 100) }) });
        if (!paymentResponse.ok) throw new Error("O serviço de pagamentos não aprovou o pedido.");
        // O payment-service publica o evento aprovado pela outbox; o notification-service o consome. O frontend não duplica essa responsabilidade.
      }
      setOrderSuccess(true); setTrackingOpen(true); setDeliveryStage(1); setCart([]); setCheckoutOpen(false); setCartOpen(false);
      toast.success("Pedido recebido pela cozinha", { description: demoMode ? "Modo demonstração: pagamento e notificação simulados." : "Pagamento confirmado e notificação enviada." });
    } catch (error) {
      toast.error("Não conseguimos confirmar agora", { description: error instanceof Error ? error.message : "Verifique se os microsserviços estão rodando." });
    } finally { setLoading(false); }
  }
  async function login() {
    setLoading(true);
    try {
      let accessToken = "demo-token";
      if (demoMode) await new Promise((resolve) => setTimeout(resolve, 650));
      else { const response = await fetch(`${API.auth}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); const body = await response.json().catch(() => null); if (!response.ok || !body?.accessToken) throw new Error(body?.error || "E-mail ou senha não reconhecidos."); accessToken = body.accessToken; }
      setSession({ email, token: accessToken }); setAccountOpen(false); if (cart.length > 0) setCheckoutOpen(true); toast.success("Conta conectada", { description: demoMode ? "Sessão demonstrativa iniciada." : "Auth service respondeu com sucesso." });
    } catch (error) { toast.error("Não conseguimos entrar", { description: error instanceof Error ? error.message : "Verifique o auth-service." }); } finally { setLoading(false); }
  }
  async function register() {
    setLoading(true);
    try {
      if (!name.trim() || !email.trim() || !password.trim()) throw new Error("Preencha nome, e-mail e senha para criar sua conta.");
      if (demoMode) { await new Promise((resolve) => setTimeout(resolve, 700)); setSession({ email, token: "demo-token" }); setAccountOpen(false); if (cart.length > 0) setCheckoutOpen(true); toast.success("Conta criada", { description: "Você já pode continuar para o checkout." }); }
      else { const response = await fetch(`${API.auth}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, role: "CLIENTE", name }) }); if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || "Não foi possível criar sua conta."); } setAccountMode("login"); toast.success("Conta criada", { description: "Agora entre com seu e-mail e senha para continuar." }); }
    } catch (error) { toast.error("Não conseguimos criar sua conta", { description: error instanceof Error ? error.message : "Tente novamente." }); } finally { setLoading(false); }
  }

  return <div className="restaurant-app">
    {alertVisible && <div className="announcement"><Sparkles size={14} /><span>Hoje tem forno aceso: entrega grátis em pedidos acima de R$ 55</span><button onClick={() => setCategory("Pizzas")}>Ver novidades <ArrowRight size={13} /></button><button className="announcement-close" aria-label="Fechar aviso" onClick={() => setAlertVisible(false)}><X size={14} /></button></div>}
    <header className="restaurant-header"><div className="header-inner"><button className="mobile-menu-button" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><Logo /><nav className={cn("restaurant-nav", mobileMenu && "open")}><button onClick={() => { document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" }); setMobileMenu(false); }}>Cardápio</button><button onClick={() => document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" })}>Como funciona</button><button onClick={() => toast("Estamos na Rua das Flores, 120", { description: "Centro · São Paulo" })}>Onde estamos</button><button className="mobile-nav-close" onClick={() => setMobileMenu(false)}><X size={18} /></button></nav><div className="header-actions"><button className="location-button" onClick={() => toast("Entregamos em até 6 km", { description: "Informe seu endereço no checkout." })}><MapPin size={16} /><span>Centro e região</span><ChevronDown size={14} /></button><button className="account-button" onClick={() => { setAccountMode("login"); setAccountOpen(true); }}><UserRound size={17} /><span>{session ? "Minha conta" : "Entrar"}</span></button><button className="cart-button" onClick={() => setCartOpen(true)}><ShoppingBag size={18} /><span className="cart-label">Meu pedido</span>{totalItems > 0 && <b>{totalItems}</b>}</button></div></div></header>
    <main>
      <section className="restaurant-hero"><div className="hero-content"><span className="hero-kicker">COMIDA DE VERDADE, SEM PRESSA</span><h1>O forno aceso<br /><em>esperando por você.</em></h1><p>Pizza de fermentação lenta, sanduíches na brasa e sobremesas que chegam quentinhas na sua porta.</p><button className="hero-cta" onClick={() => document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" })}>Pedir agora <ArrowRight size={17} /></button><div className="hero-meta"><span><Clock3 size={14} /> 30–45 min</span><span><MapPin size={14} /> taxa a partir de R$ 0</span></div></div><div className="hero-image"><img src="/manus-storage/forno-da-praca-hero_1164892e.jpg" alt="Pizza artesanal saindo do forno" /><div className="hero-stamp">feito<br /><b>na praça</b></div></div></section>
      <section className="category-strip" id="cardapio"><div className="section-intro"><span>O que dá vontade hoje?</span><small>Escolha uma categoria e monte seu pedido.</small></div><div className="category-list">{categories.map((item) => <button key={item} className={cn(category === item && "active")} onClick={() => setCategory(item)}>{item}</button>)}</div></section>
      <section className="menu-section"><div className="menu-heading"><div><span className="eyebrow">CARDÁPIO DA CASA</span><h2>Feito para compartilhar<br /><em>ou guardar só para você.</em></h2></div><div className="search-box"><Search size={17} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar no cardápio" /></div></div><div className="dish-grid">{filtered.map((dish) => <article className="dish-card" key={dish.id}><div className="dish-image"><img src={dish.image} alt={dish.name} />{dish.tag && <span>{dish.tag}</span>}<button className="favorite-button" onClick={() => toast("Salvo para depois", { description: dish.name })}><Heart size={17} /></button></div><div className="dish-copy"><div><h3>{dish.name}</h3><p>{dish.description}</p></div><div className="dish-bottom"><strong>{money(dish.price)}</strong><button className="add-button" onClick={() => add(dish)}><Plus size={16} /> Adicionar</button></div></div></article>)}</div>{filtered.length === 0 && <div className="empty-menu"><Search size={23} /><h3>Nada encontrado por aqui</h3><p>Tente outro nome ou escolha uma categoria.</p></div>}</section>
      <section className="how-section" id="como-funciona"><div className="how-heading"><span className="eyebrow">COMO FUNCIONA</span><h2>Da nossa cozinha<br /><em>para a sua mesa.</em></h2></div><div className="how-steps"><div><span>01</span><h3>Escolha seus favoritos</h3><p>Monte seu pedido com calma. Os complementos aparecem no carrinho.</p></div><div><span>02</span><h3>Confirme o endereço</h3><p>O pagamento passa pelo nosso serviço seguro e você acompanha tudo.</p></div><div><span>03</span><h3>Receba quentinho</h3><p>A cozinha prepara, a notificação avisa e a praça chega até você.</p></div></div></section>
      <footer className="restaurant-footer"><div><Logo /><p>Uma cozinha pequena, com vontade grande de alimentar bem.</p></div><div className="footer-links"><span>Segunda a domingo · 18h às 23h</span><span>Rua das Flores, 120 · Centro</span></div><div className="footer-test"><span>Ambiente de teste</span><label><input type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} /> modo demonstração</label></div></footer>
    </main>

    {cartOpen && <div className="drawer-backdrop" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">SEU PEDIDO</span><h2>Na sacola <em>{totalItems ? `(${totalItems})` : "vazia"}</em></h2></div><button className="close-button" onClick={() => setCartOpen(false)}><X size={19} /></button></div>{cart.length === 0 ? <div className="empty-cart"><ShoppingBag size={29} /><h3>Comece pelo cardápio</h3><p>Adicione algo gostoso e ele aparece aqui.</p><button onClick={() => { setCartOpen(false); document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" }); }}>Ver cardápio <ArrowRight size={15} /></button></div> : <><div className="cart-items">{cart.map((item) => <div className="cart-item" key={item.id}><img src={item.image} alt="" /><div><h3>{item.name}</h3><span>{money(item.price)}</span><Quantity value={item.quantity} onChange={(value) => update(item.id, value)} /></div><strong>{money(item.price * item.quantity)}</strong></div>)}</div><div className="cart-totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Entrega</span><b>{delivery === 0 ? "Grátis" : money(delivery)}</b></div><div className="total-line"><span>Total</span><b>{money(total)}</b></div></div><Button className="checkout-button" onClick={() => { if (!session) { setCartOpen(false); setAccountOpen(true); toast("Entre para continuar", { description: "Precisamos de uma conta para proteger seu pedido e acompanhar a entrega." }); return; } setCheckoutOpen(true); setCartOpen(false); }}>Continuar para entrega <ArrowRight size={17} /></Button><p className="cart-note"><ShieldCheckIcon /> Pagamento processado com segurança.</p></>}</aside></div>}
    {checkoutOpen && <div className="modal-backdrop"><div className="checkout-modal"><div className="modal-head"><div><span className="eyebrow">ÚLTIMO PASSO</span><h2>Onde entregamos?</h2></div><button className="close-button" onClick={() => setCheckoutOpen(false)}><X size={19} /></button></div><label className="form-label">Endereço de entrega<Input value={address} onChange={(event) => setAddress(event.target.value)} /></label><span className="form-label">Forma de pagamento</span><div className="payment-options">{["PIX", "Cartão", "Dinheiro"].map((item) => <button key={item} className={cn(payment === item && "selected")} onClick={() => setPayment(item)}><span>{payment === item && <Check size={13} />}</span>{item}</button>)}</div><div className="checkout-summary"><span>Pedido da praça</span><b>{money(total)}</b></div><Button className="checkout-button" onClick={createOrder} disabled={loading}>{loading ? "Confirmando pedido..." : "Confirmar pedido"}<ArrowRight size={17} /></Button><p className="checkout-note">Ao confirmar, o pagamento é criado e a cozinha recebe uma notificação.</p></div></div>}
    {accountOpen && <div className="modal-backdrop"><div className="account-modal"><button className="close-button" onClick={() => setAccountOpen(false)}><X size={19} /></button><Logo />{accountMode === "login" ? <><span className="eyebrow">BEM-VINDO DE VOLTA</span><h2>Entre para acompanhar<br /><em>seus pedidos.</em></h2></> : <><span className="eyebrow">PRIMEIRO PEDIDO?</span><h2>Crie sua conta<br /><em>e peça sem pressa.</em></h2></>} {accountMode === "register" && <label className="form-label">Nome completo<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Como podemos chamar você?" /></label>}<label className="form-label">E-mail<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" /></label><label className="form-label">Senha<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" /></label><Button className="checkout-button" onClick={accountMode === "login" ? login : register} disabled={loading}>{loading ? (accountMode === "login" ? "Conectando..." : "Criando conta...") : accountMode === "login" ? "Entrar" : "Criar minha conta"}<ArrowRight size={17} /></Button><p className="account-note">{accountMode === "login" ? <>Ainda não tem conta? <button onClick={() => setAccountMode("register")}>Criar agora</button></> : <>Já tem uma conta? <button onClick={() => setAccountMode("login")}>Entrar</button></>}</p></div></div>}
    {orderSuccess && <div className="success-toast"><div><Check size={18} /></div><section><strong>Pedido confirmado</strong><span>O pagamento foi aceito e a cozinha foi avisada.</span></section><button onClick={() => setOrderSuccess(false)}><X size={15} /></button></div>}
    {trackingOpen && <div className="modal-backdrop"><div className="tracking-modal"><div className="modal-head"><div><span className="eyebrow">PEDIDO #FP-2408</span><h2>Está a caminho.</h2><p className="tracking-intro">A cozinha recebeu seu pedido. Acompanhe a rota do motoboy por aqui.</p></div><button className="close-button" onClick={() => setTrackingOpen(false)}><X size={19} /></button></div><div className="route-map"><div className="route-line" /><div className="route-stop home"><span>Você</span><i /></div><div className="route-stop rider"><span>Rafa · motoboy</span><i /></div><div className="route-stop restaurant"><span>Forno da Praça</span><i /></div><div className="route-label">rota estimada · 2,4 km</div></div><div className="delivery-progress"><div className={cn(deliveryStage >= 1 && "done")}><span>{deliveryStage >= 1 ? <Check size={12} /> : "1"}</span><strong>Pedido confirmado</strong><small>Pagamento aprovado</small></div><div className={cn(deliveryStage >= 2 && "done")}><span>{deliveryStage >= 2 ? <Check size={12} /> : "2"}</span><strong>Em preparo</strong><small>{deliveryStage >= 2 ? "A cozinha está preparando" : "Aguardando a cozinha"}</small></div><div className={cn(deliveryStage >= 3 && "done")}><span>{deliveryStage >= 3 ? <Check size={12} /> : "3"}</span><strong>Motoboy a caminho</strong><small>{deliveryStage >= 3 ? "Chega em cerca de 18 min" : "Sai assim que ficar pronto"}</small></div></div><div className="rider-card"><div className="rider-avatar">R</div><div><strong>Rafa está cuidando da entrega</strong><span>Você receberá uma notificação a cada mudança.</span></div><Clock3 size={17} /></div></div></div>}
  </div>;
}
function ShieldCheckIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 5 6v5c0 4.4 3 8.4 7 10 4-1.6 7-5.6 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>; }
