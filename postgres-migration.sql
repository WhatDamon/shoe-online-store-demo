BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 41e28c896353

CREATE TABLE audit_logs (
    id VARCHAR(36) NOT NULL, 
    entity_id VARCHAR(80) NOT NULL, 
    action VARCHAR(80) NOT NULL, 
    details JSON NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id)
);

CREATE INDEX ix_audit_logs_entity_id ON audit_logs (entity_id);

CREATE TABLE carts (
    id VARCHAR(36) NOT NULL, 
    revision INTEGER NOT NULL, 
    PRIMARY KEY (id)
);

CREATE TABLE products (
    id VARCHAR(80) NOT NULL, 
    handle VARCHAR(100) NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    description VARCHAR(4000) NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (handle)
);

CREATE TABLE webhook_events (
    id VARCHAR(36) NOT NULL, 
    provider VARCHAR(50) NOT NULL, 
    external_id VARCHAR(200) NOT NULL, 
    payload JSON NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (provider, external_id)
);

CREATE TABLE orders (
    id VARCHAR(36) NOT NULL, 
    cart_id VARCHAR(36) NOT NULL, 
    idempotency_key VARCHAR(128) NOT NULL, 
    status VARCHAR(30) NOT NULL, 
    total NUMERIC(12, 2) NOT NULL, 
    currency VARCHAR(3) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CHECK (status IN ('pending_payment', 'cancelled')), 
    CHECK (total >= 0), 
    FOREIGN KEY(cart_id) REFERENCES carts (id), 
    UNIQUE (cart_id, idempotency_key)
);

CREATE INDEX ix_orders_cart_id ON orders (cart_id);

CREATE TABLE product_media (
    id VARCHAR(36) NOT NULL, 
    product_id VARCHAR(80) NOT NULL, 
    url VARCHAR(500) NOT NULL, 
    color VARCHAR(100), 
    position INTEGER NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE INDEX ix_product_media_product_id ON product_media (product_id);

CREATE TABLE product_variants (
    id VARCHAR(36) NOT NULL, 
    product_id VARCHAR(80) NOT NULL, 
    sku VARCHAR(160) NOT NULL, 
    color VARCHAR(100) NOT NULL, 
    color_hex VARCHAR(7) NOT NULL, 
    size INTEGER NOT NULL, 
    price NUMERIC(12, 2) NOT NULL, 
    currency VARCHAR(3) NOT NULL, 
    PRIMARY KEY (id), 
    CHECK (price >= 0), 
    FOREIGN KEY(product_id) REFERENCES products (id), 
    UNIQUE (product_id, color, size), 
    UNIQUE (sku)
);

CREATE INDEX ix_product_variants_product_id ON product_variants (product_id);

CREATE TABLE cart_items (
    id VARCHAR(36) NOT NULL, 
    cart_id VARCHAR(36) NOT NULL, 
    variant_id VARCHAR(36) NOT NULL, 
    quantity INTEGER NOT NULL, 
    PRIMARY KEY (id), 
    CHECK (quantity > 0), 
    FOREIGN KEY(cart_id) REFERENCES carts (id), 
    FOREIGN KEY(variant_id) REFERENCES product_variants (id), 
    UNIQUE (cart_id, variant_id)
);

CREATE INDEX ix_cart_items_cart_id ON cart_items (cart_id);

CREATE TABLE inventory (
    variant_id VARCHAR(36) NOT NULL, 
    available INTEGER NOT NULL, 
    reserved INTEGER NOT NULL, 
    PRIMARY KEY (variant_id), 
    CHECK (available >= 0), 
    CHECK (reserved >= 0), 
    FOREIGN KEY(variant_id) REFERENCES product_variants (id)
);

CREATE TABLE inventory_reservations (
    id VARCHAR(36) NOT NULL, 
    order_id VARCHAR(36) NOT NULL, 
    variant_id VARCHAR(36) NOT NULL, 
    quantity INTEGER NOT NULL, 
    status VARCHAR(20) NOT NULL, 
    PRIMARY KEY (id), 
    CHECK (status IN ('active', 'released')), 
    CHECK (quantity > 0), 
    FOREIGN KEY(order_id) REFERENCES orders (id), 
    FOREIGN KEY(variant_id) REFERENCES product_variants (id), 
    UNIQUE (order_id, variant_id)
);

CREATE INDEX ix_inventory_reservations_order_id ON inventory_reservations (order_id);

CREATE TABLE order_items (
    id VARCHAR(36) NOT NULL, 
    order_id VARCHAR(36) NOT NULL, 
    variant_id VARCHAR(36) NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    sku VARCHAR(160) NOT NULL, 
    color VARCHAR(100) NOT NULL, 
    size INTEGER NOT NULL, 
    unit_price NUMERIC(12, 2) NOT NULL, 
    quantity INTEGER NOT NULL, 
    PRIMARY KEY (id), 
    CHECK (quantity > 0), 
    FOREIGN KEY(order_id) REFERENCES orders (id), 
    FOREIGN KEY(variant_id) REFERENCES product_variants (id)
);

CREATE INDEX ix_order_items_order_id ON order_items (order_id);

CREATE TABLE payments (
    id VARCHAR(36) NOT NULL, 
    order_id VARCHAR(36) NOT NULL, 
    provider VARCHAR(30) NOT NULL, 
    status VARCHAR(30) NOT NULL, 
    PRIMARY KEY (id), 
    CHECK (status = 'disabled'), 
    FOREIGN KEY(order_id) REFERENCES orders (id), 
    UNIQUE (order_id)
);

CREATE TABLE payment_events (
    id VARCHAR(36) NOT NULL, 
    payment_id VARCHAR(36) NOT NULL, 
    event VARCHAR(80) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(payment_id) REFERENCES payments (id)
);

INSERT INTO alembic_version (version_num) VALUES ('41e28c896353') RETURNING alembic_version.version_num;

COMMIT;

