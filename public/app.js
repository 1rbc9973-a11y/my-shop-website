const $ = id => document.getElementById(id);

let mode = "login";
let previewUrl = null;

function showMessage(id, message) {
  $(id).textContent = message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";

  $("loginTab").classList.toggle("active", !registering);
  $("registerTab").classList.toggle("active", registering);
  $("shopNameField").hidden = !registering;
  $("shopName").required = registering;
  $("password").autocomplete = registering
    ? "new-password"
    : "current-password";
  $("formTitle").textContent = registering
    ? "Create Your Online Shop"
    : "Shopkeeper Login";
  $("authButton").textContent = registering
    ? "Create Shop"
    : "Sign In";

  showMessage("authMessage", "");
}

$("loginTab").onclick = () => setMode("login");
$("registerTab").onclick = () => setMode("register");

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submitBtn = $("authButton");
  submitBtn.disabled = true;
  showMessage("authMessage", "Please wait...");

  const body = {
    shopId: $("shopId").value.trim(),
    password: $("password").value
  };

  if (mode === "register") {
    body.shopName = $("shopName").value.trim();
  }

  try {
    const endpoint = mode === "register"
      ? "/api/register"
      : "/api/login";

    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(body)
    });

    if (mode === "register") {
      setMode("login");
      showMessage("authMessage", result.message);
      return;
    }

    await showDashboard();
    $("password").value = "";
  } catch (error) {
    showMessage("authMessage", error.message);
  } finally {
    submitBtn.disabled = false;
  }
});

async function showDashboard() {
  const shop = await api("/api/me");

  $("auth").hidden = true;
  $("dashboard").hidden = false;
  $("shopTitle").textContent = shop.shop_name;

  $("shopLinkArea").textContent =
    "Your shop ID: " + shop.shop_id;

  await Promise.all([
  loadProducts(),
  loadOrders()
]);
}

async function loadProducts() {
  const products = await api("/api/products");
  const container = $("products");
  container.replaceChildren();

  // Dashboard statistics
  const totalStock = products.reduce(
    (sum, p) => sum + Number(p.stock || 0), 0
  );

  const inventoryValue = products.reduce(
    (sum, p) =>
      sum + Number(p.sellingPrice || 0) * Number(p.stock || 0),
    0
  );

  const lowStock = products.filter(
    p => Number(p.stock || 0) <= 5
  ).length;

  $("totalProducts").textContent = products.length;
  $("totalStock").textContent = totalStock;
  $("inventoryValue").textContent =
    "₹" + inventoryValue.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  $("lowStock").textContent = lowStock;

  if (products.length === 0) {
    container.textContent =
      "No products yet. Add your first product!";
    return;
  }

  for (const product of products) {
    const card = document.createElement("article");
    card.className = "product";

    if (product.image_path) {
      const image = document.createElement("img");
      image.src = product.image_path;
      image.alt = product.name;
      image.loading = "lazy";
      image.className = "productImage";
      card.append(image);
    }

    const title = document.createElement("h4");
    title.textContent = product.name;

    const details = document.createElement("p");
    details.textContent =
      `MRP: ₹${Number(product.mrp).toFixed(2)} | ` +
      `Discount: ${product.discount}% | ` +
      `Selling price: ₹${Number(product.sellingPrice).toFixed(2)} | ` +
      `Stock: ${product.stock}`;

    const stockStatus = document.createElement("p");
    const quantity = Number(product.stock || 0);

    if (quantity === 0) {
      stockStatus.textContent = "Out of stock";
      stockStatus.className = "stockStatus outOfStock";
    } else if (quantity <= 5) {
      stockStatus.textContent = "Low stock";
      stockStatus.className = "stockStatus lowStockStatus";
    } else {
      stockStatus.textContent = "In stock";
      stockStatus.className = "stockStatus inStock";
    }

    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.className = "deleteButton";

    remove.onclick = async () => {
      if (!confirm(`Delete ${product.name}?`)) return;

      try {
        await api(`/api/products/${product.id}`, {
          method: "DELETE"
        });
        await loadProducts();
      } catch (error) {
        alert(error.message);
      }
    };

    card.append(title, details, stockStatus, remove);
    container.append(card);
  }
}

function updatePricePreview() {
  const mrp = Number($("mrp").value) || 0;
  const discount = Number($("discount").value) || 0;
  const price = mrp * (1 - discount / 100);

  $("pricePreview").textContent =
    "₹" + Math.max(0, price).toFixed(2);
}

$("mrp").addEventListener("input", updatePricePreview);
$("discount").addEventListener("input", updatePricePreview);

$("productForm").addEventListener("submit", async event => {
  event.preventDefault();

  const formData = new FormData();
  formData.append("name", $("productName").value.trim());
  formData.append("mrp", $("mrp").value);
  formData.append("discount", $("discount").value);
  formData.append("stock", $("stock").value);

  const image = $("productImage").files[0];
  if (image) formData.append("image", image);

  try {
    showMessage("productMessage", "Saving product...");

    const response = await fetch("/api/products", {
      method: "POST",
      body: formData
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Upload failed.");

    $("productForm").reset();
    $("imagePreview").hidden = true;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;

    $("discount").value = 0;
    $("stock").value = 1;
    updatePricePreview();

    showMessage("productMessage", "Product added successfully!");
    await loadProducts();
  } catch (error) {
    showMessage("productMessage", error.message);
  }
});

$("logoutButton").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    $("dashboard").hidden = true;
    $("auth").hidden = false;
    $("password").value = "";
    setMode("login");
  }
};

$("productImage").addEventListener("change", () => {
  const file = $("productImage").files[0];
  const preview = $("imagePreview");

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;

  if (!file) {
    preview.hidden = true;
    preview.removeAttribute("src");
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)
      || file.size > 5 * 1024 * 1024) {
    $("productImage").value = "";
    preview.hidden = true;
    showMessage("productMessage", "Choose a JPEG, PNG, or WebP image up to 5 MB.");
    return;
  }

  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  preview.hidden = false;
});
// Restore the session after refreshing the page.
api("/api/me")
  .then(showDashboard)
  .catch(() => {
    $("auth").hidden = false;
    $("dashboard").hidden = true;
  });
  const ORDER_STATUSES = [
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready for Pickup",
  "Out for Delivery",
  "Delivered",
  "Cancelled"
];

let cachedOrders = [];

async function loadOrders() {
  const container = $("orders");
  showMessage("ordersMessage", "Loading orders...");

  try {
    cachedOrders = await api("/api/orders");
    renderOrders();
    showMessage(
      "ordersMessage",
      cachedOrders.length
        ? `${cachedOrders.length} order(s) found.`
        : "No customer orders yet."
    );
  } catch (error) {
    container.replaceChildren();
    showMessage("ordersMessage", error.message);
  }
}

function renderOrders() {
  const container = $("orders");
  container.replaceChildren();

  const query = $("orderSearch").value.trim().toLowerCase();
  const status = $("orderStatusFilter").value;

  const filtered = cachedOrders.filter(order => {
    const matchesSearch =
      String(order.id).includes(query) ||
      order.customerName.toLowerCase().includes(query) ||
      order.phone.includes(query);

    return matchesSearch &&
      (status === "All" || order.status === status);
  });

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.textContent = "No matching orders found.";
    container.append(empty);
    return;
  }

  for (const order of filtered) {
    const card = document.createElement("article");
    card.className = "orderCard";

    const heading = document.createElement("div");
    heading.className = "orderCardHeading";

    const title = document.createElement("h4");
    title.textContent = `Order #${order.id}`;

    const badge = document.createElement("span");
    badge.className =
      "orderBadge " + order.status.toLowerCase().replaceAll(" ", "-");
    badge.textContent = order.status;

    heading.append(title, badge);

    const customer = document.createElement("p");
    customer.textContent = `Customer: ${order.customerName}`;

    const phone = document.createElement("p");
    phone.textContent = `Phone: ${order.phone}`;

    const address = document.createElement("p");
    address.textContent = `Address: ${order.address}`;

    const date = document.createElement("p");
    date.textContent = `Placed: ${order.createdAt}`;

    const itemList = document.createElement("ul");

    for (const item of order.items) {
      const li = document.createElement("li");
      li.textContent =
        `${item.name} × ${item.quantity} — ₹${Number(item.subtotal).toFixed(2)}`;
      itemList.append(li);
    }

    const total = document.createElement("p");
    total.className = "orderTotal";
    total.textContent =
      `Order total: ₹${Number(order.totalAmount).toFixed(2)}`;

    const label = document.createElement("label");
    label.textContent = "Update order status";

    const select = document.createElement("select");
    select.className = "orderStatusSelect";

    for (const value of ORDER_STATUSES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = value === order.status;

      if (
        order.status === "Cancelled" ||
        order.status === "Delivered"
      ) {
        option.disabled = value !== order.status;
      }

      select.append(option);
    }

    label.append(select);

    const update = document.createElement("button");
    update.textContent = "Save Status";
    update.className = "primary";

    if (
      order.status === "Cancelled" ||
      order.status === "Delivered"
    ) {
      update.disabled = true;
    }

    select.onchange = () => {
      update.disabled =
        select.value === order.status ||
        order.status === "Cancelled" ||
        order.status === "Delivered";
    };

    update.onclick = async () => {
      const nextStatus = select.value;
      update.disabled = true;
      showMessage("ordersMessage", `Updating order #${order.id}...`);

      try {
        await api(`/api/orders/${order.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus })
        });

        await Promise.all([loadOrders(), loadProducts()]);
      } catch (error) {
        alert(error.message);
        update.disabled = false;
      }
    };

    card.append(
      heading,
      customer,
      phone,
      address,
      date,
      itemList,
      total,
      label,
      update
    );

    container.append(card);
  }
}

$("orderSearch").addEventListener("input", renderOrders);
$("orderStatusFilter").addEventListener("change", renderOrders);
$("refreshOrders").onclick = loadOrders;
