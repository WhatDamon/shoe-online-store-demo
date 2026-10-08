"""Run against the two locally started services; creates then cancels a demo order."""

import argparse
from uuid import UUID, uuid4

import httpx


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    base_url = parser.parse_args().base_url.rstrip("/")
    with httpx.Client(base_url=base_url, timeout=25) as client:

        def request(method: str, path: str, **kwargs) -> dict:
            response = client.request(method, f"/api/commerce/{path}", **kwargs)
            response.raise_for_status()
            assert UUID(response.headers["X-Request-ID"]).version == 4
            assert response.headers["Cache-Control"] == "no-store"
            return response.json()

        for path in ["/", "/shop?q=Urban", "/product/dc-1001", "/cart", "/checkout"]:
            assert client.get(path).status_code == 200, path
        catalog = request("GET", "catalog/products/dc-1001")
        variant = next(v for v in catalog["variants"] if v["available"] >= 2)
        origin = {"Origin": base_url}
        cart = request(
            "POST",
            "cart/items",
            headers=origin,
            json={
                "variant_id": variant["id"],
                "quantity": 1,
                "price": "0.01",
            },
        )
        assert cart["total"] == variant["price"]
        item_id = cart["items"][0]["id"]
        request("PATCH", f"cart/items/{item_id}", headers=origin, json={"quantity": 2})
        preview = request("POST", "checkout/preview", headers=origin)
        headers = {**origin, "Idempotency-Key": str(uuid4())}
        order = request("POST", "checkout/create-order", headers=headers)
        try:
            assert order["status"] == "pending_payment"
            assert order["total"] == preview["total"]
            assert request("POST", "checkout/create-order", headers=headers)["id"] == order["id"]
            assert request("GET", f"orders/{order['id']}")["id"] == order["id"]
            with httpx.Client(base_url=base_url, timeout=25) as stranger:
                denied = stranger.get(f"/api/commerce/orders/{order['id']}")
                assert denied.status_code == 404
                assert denied.json()["code"] == "order_not_found"
            denied_origin = client.post(
                "/api/commerce/checkout/create-order",
                headers={
                    "Origin": "https://untrusted.example",
                    "Idempotency-Key": str(uuid4()),
                },
            )
            assert denied_origin.status_code == 403
            assert denied_origin.json()["code"] == "invalid_origin"
            invalid = client.post(
                "/api/commerce/cart/items",
                headers={**origin, "X-Request-ID": "public-header-must-not-be-trusted"},
                json={"variant_id": "private-invalid-input", "quantity": 0},
            )
            assert invalid.status_code == 422
            assert invalid.json() == {
                "code": "invalid_request",
                "detail": "Request validation failed",
            }
            assert UUID(invalid.headers["X-Request-ID"]).version == 4
            assert "private-invalid-input" not in invalid.text
            payment = request(
                "POST",
                "payments/session",
                headers=origin,
                json={"order_id": order["id"]},
            )
            assert payment["code"] == "payment_disabled" and payment["charged"] is False
            assert request("GET", f"orders/{order['id']}")["status"] == "pending_payment"
        finally:
            cancelled = request("POST", f"orders/{order['id']}/cancel", headers=origin)
            assert cancelled["status"] == "cancelled"
        restored = request("GET", "catalog/products/dc-1001")
        assert (
            next(v for v in restored["variants"] if v["id"] == variant["id"])["available"]
            == variant["available"]
        )
        print(
            "PASS: pages, HttpOnly session proxy, cart mutation, repricing, "
            "idempotent order, ownership, origin checks, disabled payment, "
            "cancellation and stock restoration."
        )


if __name__ == "__main__":
    main()
