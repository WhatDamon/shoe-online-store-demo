from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.states import OrderStatus

Money = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)\.[0-9]{2}$")]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
Stock = Annotated[int, Field(ge=0)]
ItemQuantity = Annotated[int, Field(ge=1, le=99)]


class ResponseModel(BaseModel):
    # Validate output without coercing numbers to strings or leaking internal fields.
    model_config = ConfigDict(strict=True, extra="ignore")


class ErrorResponse(ResponseModel):
    code: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")]
    detail: str


class HealthResponse(ResponseModel):
    status: Literal["ok"]
    payment_enabled: bool


class MediaResponse(ResponseModel):
    url: str
    color: str | None


class VariantResponse(ResponseModel):
    id: str
    sku: str
    color: str
    color_hex: str
    size: int
    price: Money
    currency: Currency
    available: Stock


class ProductResponse(ResponseModel):
    id: str
    handle: str
    title: str
    description: str
    media: list[MediaResponse]
    variants: list[VariantResponse]


class OrderItemResponse(ResponseModel):
    id: str
    variant_id: str
    title: str
    sku: str
    color: str
    size: int
    quantity: ItemQuantity
    unit_price: Money


class CartItemResponse(OrderItemResponse):
    subtotal: Money
    available: Stock
    sellable: bool


class CartResponse(ResponseModel):
    items: list[CartItemResponse]
    total: Money
    currency: Currency


class OrderResponse(ResponseModel):
    id: str
    status: OrderStatus
    expires_at: str | None
    cancellation_reason: Literal["expired", "customer_cancelled"] | None
    total: Money
    currency: Currency
    payment_enabled: bool
    message: str
    items: list[OrderItemResponse]


class PaymentResponse(ResponseModel):
    code: Literal["payment_disabled", "payment_ready", "order_not_payable", "currency_unsupported"]
    payment_enabled: bool
    provider: Literal["mock", "stripe"]
    order_id: str
    order_status: OrderStatus
    # A hosted checkout URL exists only for a session that needs payment, so the field
    # defaults to None; the validator below keeps that the only shape the wire allows.
    redirect_url: str | None = None
    message: str

    @model_validator(mode="after")
    def validate_redirect_url(self) -> "PaymentResponse":
        if self.code == "payment_ready" and self.redirect_url is None:
            raise ValueError("redirect_url is required when code is payment_ready")
        if self.code != "payment_ready" and self.redirect_url is not None:
            raise ValueError("redirect_url is only set when code is payment_ready")
        return self
