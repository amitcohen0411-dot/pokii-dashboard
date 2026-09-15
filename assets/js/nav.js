import { logout } from "./auth.js";

const TABS = [
  { href: "dashboard.html", label: "Dashboard", icon: "🏠" },
  { href: "purchases.html", label: "Purchases", icon: "🧾" },
  { href: "orders.html", label: "Orders", icon: "📮" },
  { href: "inventory.html", label: "Inventory", icon: "📦" },
  { href: "sales.html", label: "Sales", icon: "💸" },
  { href: "vinted-activity.html", label: "Activity", icon: "💬" },
];

export function renderNav(activeHref) {
  const topnav = document.createElement("div");
  topnav.className = "topnav";
  topnav.innerHTML = `
    <span class="brand">Pokii Dashboard</span>
    <span class="spacer"></span>
    <button class="logout" id="logout-btn">Log out</button>
  `;
  document.body.prepend(topnav);
  document.getElementById("logout-btn").addEventListener("click", logout);

  const tabbar = document.createElement("div");
  tabbar.className = "tabbar";
  tabbar.innerHTML = TABS.map(
    (t) => `<a href="${t.href}" class="${t.href === activeHref ? "active" : ""}">${t.icon}<br>${t.label}</a>`,
  ).join("");
  document.body.appendChild(tabbar);
}
