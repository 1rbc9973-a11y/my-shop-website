const $ = id => document.getElementById(id);

let shops = [];
let products = [];
let selectedShop = "";
let cart = new Map();
let activeCategory = "All";
let sortMode = "featured";
let submitting = false;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function notify(text) {
  let toast = $("toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }

  toast.textContent = text;
  toast.hidden = false;
}

function priceOf(product) {
  return Number(product.sellingPrice);
}

function money(value) {
  return "₹" + Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function categoryOf(name) {
  const n = name.toLowerCase();

  if (/rice|atta|flour|dal|pulse|grain|wheat|sugar|salt|oil|masala|spice/.test(n)) {
    return "Groceries";
  }
  if (/milk|curd|yogurt|paneer|butter|cheese|ghee/.test(n)) {
    return "Dairy";
  }
  if (/soap|shampoo|toothpaste|brush|detergent|cleaner/.test(n)) {
    return "Personal Care";
  }
  if (/biscuit|cookie|chips|chocolate|snack|juice|drink/.test(n)) {
    return "Snacks";
  }

  return "Other";
}

function setupInteractiveControls() {
  const catalog = document.querySelector(".catalog");

  if (catalog && !$("categoryBar")) {
    const bar = document.createElement("div");
    bar.id = "categoryBar";
    bar.className = "categoryBar";
    bar.setAttribute("aria-label", "Product categories");

    const heading = $("productSearch").closest(".sectionHeading");
    heading.after(bar);
  }

  const bar = $("categoryBar");

  if (bar) {
    bar.addEventListener("click", event => {
      const button = event.target.closest("button[data-category]");
      if (!button) return;

      activeCategory = button.dataset.category;
      renderCategories();
      renderProducts();
    });
  }

  if (!$("sortProducts")) {
    const toolbar = document.createElement("div");
    toolbar.className = "shopToolbar";

    const count = document.createElement("span");
    count.id = "visibleCount";
    count.textContent = "Explore available products";

    const label = document.createElement("label");
    label.textContent = "Sort: ";

    const select = document.createElement("select");
    select.id = "sortProducts";
    select.setAttribute("aria-label", "Sort products");

    [
      ["featured", "Recommended"],
      ["priceLow", "Price: Low to High"],
      ["priceHigh", "Price: High to Low"],
      ["discount", "Biggest Discount"],
      ["name", "Name: A to Z"]
    ].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    });

    select.addEventListener("change", () => {
      sortMode = select.value;
      renderProducts();
    });

    label.append(select);
    toolbar.append(count, label);
    $("categoryBar").after(toolbar);
  }
}

function renderCategories() {
  const bar = $("categoryBar");
  if (!bar) return;

  const categories = [
    "All",
    ...new Set(products.map(p => categoryOf(p.name)))
  ];

  bar.replaceChildren();

  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "categoryChip" +
      (category === activeCategory ? " active" : "");
    button.dataset.category = category;
    button.textContent = category;
    bar.append(button);
  }

  if (!categories.includes(activeCategory)) {
    activeCategory = "All";
    renderCategories();
  }
}

async function loadShops() {
  try {
    shops = await api("/api/shops");

    const select = $("shopSelect");
    select.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = shops.length
      ? "Choose a local shop"
      : "No shops available yet";
    select.append(placeholder);

    for (const shop of shops) {
      const option = document.createElement("option");
      option.value = shop.shop_id;
      option.textContent = shop.shop_name;
      select.append(option);
    }

    $("catalogMessage").textContent = shops.length
      ? "Choose a shop to explore its products."
      : "Register a shop to start browsing products.";
  } catch (error) {
    $("catalogMessage").textContent = error.message;
  }
}

async function selectShop(shopId) {
  selectedShop = shopId;
  cart.clear();
  products = [];
  activeCategory = "All";
  renderCart();
  renderCategories();
  renderProducts();

  if (!shopId) {
    $("catalogTitle").textContent = "Explore products";
    $("catalogMessage").textContent = "Choose a shop to get started.";
    return;
  }

  const shop = shops.find(s => s.shop_id === shopId);
  $("catalogTitle").textContent = shop?.shop_name || "Shop products";
  $("catalogMessage").textContent = "Loading products...";

  try {
    const data = await api(
      `/api/customer/shops/${encodeURIComponent(shopId)}/products`
    );

    if (selectedShop !== shopId) return;

    products = data.products;
    $("catalogTitle").textContent = data.shop.shop_name;
    $("catalogMessage").textContent =
      `${products.length} products available at this shop.`;

    renderCategories();
    renderProducts();
    renderCart();
  } catch (error) {
    if (selectedShop === shopId) {
      $("catalogMessage").textContent = error.message;
    }
  }
}

function visibleProducts() {
  const query = $("productSearch").value.trim().toLowerCase();

  let list = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(query);
    const matchesCategory =
      activeCategory === "All" ||
      categoryOf(product.name) === activeCategory;

    return matchesSearch && matchesCategory;
  });

  if (sortMode === "priceLow") {
    list.sort((a, b) => priceOf(a) - priceOf(b));
  } else if (sortMode === "priceHigh") {
    list.sort((a, b) => priceOf(b) - priceOf(a));
  } else if (sortMode === "discount") {
    list.sort((a, b) => Number(b.discount) - Number(a.discount));
  } else if (sortMode === "name") {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return list;
}

function renderProducts() {
  const container = $("products");
  container.replaceChildren();

  const list = visibleProducts();

  if ($("visibleCount")) {
    $("visibleCount").textContent =
      `${list.length} product${list.length === 1 ? "" : "s"}`;
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "emptyCart";
    empty.textContent = selectedShop
      ? "No products match your search. Try another name or category."
      : "Choose a shop to see its products.";
    container.append(empty);
    return;
  }

  for (const product of list) {
    const card = document.createElement("article");
    card.className = "productCard";

    const media = document.createElement("div");
    media.className = "productMedia";

    if (product.image_path) {
      const image = document.createElement("img");
      image.src = product.image_path;
      image.alt = product.name;
      image.loading = "lazy";
      image.onerror = () => {
        const placeholder = document.createElement("div");
        placeholder.className = "productPlaceholder";
        placeholder.textContent = "🛍️";
        media.replaceChildren(placeholder);
      };
      media.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "productPlaceholder";
      placeholder.textContent = "🛍️";
      media.append(placeholder);
    }

    if (Number(product.discount) > 0) {
      const badge = document.createElement("span");
      badge.className = "discountBadge";
      badge.textContent = `${product.discount}% OFF`;
      media.append(badge);
    }

    const title = document.createElement("h3");
    title.textContent = product.name;

    const priceRow = document.createElement("div");
    priceRow.className = "priceRow";

    const price = document.createElement("span");
    price.className = "salePrice";
    price.textContent = money(priceOf(product));
    priceRow.append(price);

    if (Number(product.discount) > 0) {
      const mrp = document.createElement("span");
      mrp.className = "mrp";
      mrp.textContent = money(product.mrp);
      priceRow.append(mrp);
    }

    const stock = document.createElement("p");
    stock.className = "stockText";
    stock.textContent = Number(product.stock) <= 5
      ? `Only ${product.stock} left`
      : "In stock";

    const add = document.createElement("button");
    add.type = "button";
    add.className = "addButton";
    add.textContent = cart.has(product.id) ? "Add Another +" : "Add to Cart";
    add.disabled = Number(product.stock) <= 0;

    add.onclick = () => {
      const current = cart.get(product.id) || 0;

      if (current >= Number(product.stock)) {
        notify("You've reached the available stock quantity.");
        return;
      }

      cart.set(product.id, current + 1);
      renderCart();
      renderProducts();
      notify(`${product.name} added to cart`);
    };

    card.append(media, title, priceRow, stock, add);
    container.append(card);
  }
}

function renderCart() {
  const container = $("cartItems");
  container.replaceChildren();

  let count = 0;
  let total = 0;

  for (const [productId, quantity] of cart) {
    const product = products.find(p => p.id === productId);
    if (!product) continue;

    count += quantity;
    total += priceOf(product) * quantity;

    const row = document.createElement("div");
    row.className = "cartRow";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "cartProductName";
    name.textContent = product.name;

    const subtotal = document.createElement("small");
    subtotal.textContent = `${money(priceOf(product) * quantity)}`;

    info.append(name, subtotal);

    const controls = document.createElement("div");
    controls.className = "quantityControls";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `Remove one ${product.name}`);

    minus.onclick = () => {
      if (quantity <= 1) cart.delete(productId);
      else cart.set(productId, quantity - 1);

      renderCart();
      renderProducts();
    };

    const qty = document.createElement("span");
    qty.textContent = quantity;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `Add one ${product.name}`);
    plus.disabled = quantity >= Number(product.stock);

    plus.onclick = () => {
      if (quantity >= Number(product.stock)) {
        notify("Not enough stock available.");
        return;
      }

      cart.set(productId, quantity + 1);
      renderCart();
      renderProducts();
    };

    controls.append(minus, qty, plus);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "removeItem";
    remove.textContent = "Remove";
    remove.onclick = () => {
      cart.delete(productId);
      renderCart();
      renderProducts();
    };

    row.append(info, controls, remove);
    container.append(row);
  }

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "emptyCart";
    empty.innerHTML = "<span>🛒</span>Your cart is waiting for something good.";
    container.append(empty);
  }

  $("cartCount").textContent = `${count} item${count === 1 ? "" : "s"}`;
  $("cartTotal").textContent = money(total);
  $("placeOrder").disabled = submitting || count === 0 || !selectedShop;
}

$("shopSelect").addEventListener("change", event => {
  selectShop(event.target.value);
});

$("productSearch").addEventListener("input", renderProducts);

$("checkoutForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (submitting) return;

  if (!selectedShop || cart.size === 0) {
    message("Choose a shop and add products first.");
    return;
  }

  const customerName = $("customerName").value.trim();
  const phone = $("phone").value.trim();
  const address = $("address").value.trim();

  if (!customerName || !phone || !address) {
    message("Please fill in all delivery details.");
    return;
  }

  const orderItems = [...cart.entries()].map(([productId, quantity]) => ({
    productId: Number(productId),
    quantity
  }));

  submitting = true;
  $("placeOrder").disabled = true;
  message("Placing your order...");

  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        shopId: selectedShop,
        customerName,
        phone,
        address,
        items: orderItems
      })
    });

    cart.clear();
    message(
      `Order placed successfully! Your order ID is #${result.orderId}. ` +
      `Total: ${money(result.totalAmount)}.`
    );

    notify(`Order #${result.orderId} placed successfully!`);

    await selectShop(selectedShop);
    $("checkoutForm").reset();
  } catch (error) {
    message(error.message);
    notify("We couldn't place your order. Please check the details.");

    // Refresh stock in case another customer ordered first.
    try {
      const currentShop = selectedShop;
      const data = await api(
        `/api/customer/shops/${encodeURIComponent(currentShop)}/products`
      );

      if (selectedShop === currentShop) {
        products = data.products;
        renderProducts();
        renderCart();
      }
    } catch (_) {
      // Keep the original checkout error visible.
    }
  } finally {
    submitting = false;
    $("placeOrder").disabled = cart.size === 0 || !selectedShop;
  }
});

setupInteractiveControls();
loadShops();